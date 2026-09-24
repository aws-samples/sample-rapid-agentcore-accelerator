# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""
Customer Support Agent with AgentCore Memory Integration

A sample customer support agent that can look up orders, check product info,
and create support tickets. Uses AgentCore Runtime + Memory.
Supports MCP (Model Context Protocol) integration for extended capabilities.
"""

import logging
import os

# Enable Strands debug logging if DEBUG=true
if os.environ.get("DEBUG", "false").lower() == "true":
    logging.getLogger("strands").setLevel(logging.DEBUG)
    logging.basicConfig(
        format="%(levelname)s | %(name)s | %(message)s",
        handlers=[logging.StreamHandler()]
    )

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig, RetrievalConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
from strands import Agent
from strands.session.file_session_manager import FileSessionManager

from tools.knowledge_base import create_kb_retrieval_tool
from tools.customer_support import lookup_order, get_product_info, create_support_ticket
from tools.mcp_tools import get_mcp_client_iam_auth
from utils import extract_session_context, format_sse_event

logger = logging.getLogger(__name__)

# Initialize the AgentCore runtime app
app = BedrockAgentCoreApp()

# Memory configuration from environment
# When MEMORY_ID is set, uses AgentCore Memory for persistent cross-session memory
# When MEMORY_ID is not set, uses FileSessionManager for in-session conversation history
MEMORY_ID = os.environ.get("MEMORY_ID")
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION")

# Knowledge Base configuration from environment
KNOWLEDGE_BASE_ID = os.environ.get("KNOWLEDGE_BASE_ID")

SYSTEM_PROMPT = """You are a friendly customer support agent for Acme Corp.

You have tools to look up orders, get product information, and create support tickets. 
You also have access to a knowledge base containing company policies, product catalog details, 
and shipping information - use it when customers ask about returns, warranties, shipping options, 
or need detailed product specs.

When MCP tools are available, you can use them to extend your capabilities with additional 
external services and data sources.

Be helpful, empathetic, and concise. Use your tools to provide accurate information rather than guessing.
If you can't resolve something, create a support ticket.
"""

MODEL_ID = os.environ.get("MODEL_ID")


def resolve_mcp_arns() -> list[str]:
    """Resolve MCP server ARNs from environment variables.

    Priority:
    1. MCP_RUNTIME_ARNS (comma-separated, new multi-agent var)
    2. MCP_RUNTIME_ARN (singular, legacy backwards-compat)
    3. Empty list (no MCP servers)
    """
    arns_value = os.environ.get("MCP_RUNTIME_ARNS", "").strip()
    if arns_value:
        return [arn.strip() for arn in arns_value.split(",") if arn.strip()]

    legacy_arn = os.environ.get("MCP_RUNTIME_ARN", "").strip()
    if legacy_arn:
        return [legacy_arn]

    return []


def create_agent(session_id: str, actor_id: str) -> Agent:
    """Create a customer support agent with tools and session management.
    
    Session management behavior:
    - MEMORY_ID set: Uses AgentCore Memory for persistent cross-session memory
      (remembers users across sessions)
    - MEMORY_ID not set: Uses FileSessionManager for in-session conversation
      history (maintains context within a session)
    
    MCP integration (experimental):
    - Connects to all MCP servers resolved from MCP_RUNTIME_ARNS / MCP_RUNTIME_ARN
    - Graceful degradation: individual MCP connection failures are logged and skipped
    - Agent runs without MCP tools if no servers are reachable
    """
    
    tools = [lookup_order, get_product_info, create_support_ticket]
    
    if MEMORY_ID:
        # Use AgentCore Memory for persistent cross-session memory
        # Retrieval config matches the memory strategies configured in CDK:
        # - SessionSummarizer: /summaries/{actorId}/{sessionId}
        # - UserPreferenceLearner: /preferences/{actorId}
        memory_config = AgentCoreMemoryConfig(
            memory_id=MEMORY_ID,
            session_id=session_id,
            actor_id=actor_id,
            retrieval_config={
                "/summaries/{actorId}/{sessionId}": RetrievalConfig(top_k=5, relevance_score=0.5),
                "/preferences/{actorId}": RetrievalConfig(top_k=5, relevance_score=0.7),
            },
        )
        session_manager = AgentCoreMemorySessionManager(
            agentcore_memory_config=memory_config,
            region_name=AWS_REGION,
        )
    else:
        # Use FileSessionManager for in-session conversation history
        # This ensures the agent maintains context within a single session
        session_manager = FileSessionManager(session_id=session_id)
    
    # Add knowledge base retrieval tool if configured
    if KNOWLEDGE_BASE_ID:
        kb_tool = create_kb_retrieval_tool(KNOWLEDGE_BASE_ID)
        tools.append(kb_tool)
    
    # Add MCP clients (multi-MCP support with graceful degradation)
    mcp_arns = resolve_mcp_arns()
    for arn in mcp_arns:
        try:
            mcp_client = get_mcp_client_iam_auth(arn, AWS_REGION)
            tools.append(mcp_client)
            logger.info(f"Added MCP client for ARN: {arn}")
        except Exception as e:
            logger.error("Failed to connect MCP server %s: %s", arn, type(e).__name__)
            # Continue with remaining servers (graceful degradation)
    
    return Agent(
        system_prompt=SYSTEM_PROMPT,
        model=MODEL_ID,
        session_manager=session_manager,
        tools=tools,
    )


@app.entrypoint
async def agent_invocation(payload: dict, context):
    """
    Handler for agent invocation from AgentCore Runtime.
    
    Supports both streaming and non-streaming modes:
    - Streaming: Yields SSE-formatted events as they occur
    - Non-streaming: Returns complete response (fallback)
    
    Args:
        payload: Request payload containing the user prompt
        context: Runtime context with session and user information
    
    Yields:
        SSE-formatted events during streaming
        
    Returns:
        Response dictionary with the agent's response (non-streaming fallback)
    """
    # Extract prompt from payload
    user_message = payload.get(
        "prompt", 
        "No prompt found in input. Please provide a JSON payload with a 'prompt' key."
    )

    # Get session and actor IDs from context
    session_id, actor_id = extract_session_context(context)

    # Create agent (MCP lifecycle managed automatically)
    try:
        agent = create_agent(session_id=session_id, actor_id=actor_id)
    except Exception as e:
        logger.error("Failed to create agent: %s", type(e).__name__)
        raise

    # Use streaming mode - iterate over events and yield SSE-formatted data
    try:
        async for event in agent.stream_async(user_message):
            # Format the event for SSE transmission
            sse_event = format_sse_event(event)
            if sse_event is not None:
                yield sse_event
    except Exception as e:
        logger.error("Error during agent streaming: %s", type(e).__name__)
        raise

# Start the agent when run directly
if __name__ == "__main__":
    print("Starting agent...")
    print("Server will be available at http://localhost:8080")
    app.run(host="0.0.0.0", port=8080)
