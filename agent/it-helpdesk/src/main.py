# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""
IT Helpdesk Agent with AgentCore Memory Integration

An internal IT support agent that helps employees troubleshoot common
technical issues, check system status, manage password resets, and
submit IT tickets. Uses AgentCore Runtime + Memory.
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
from tools.it_helpdesk import check_system_status, reset_password, create_it_ticket, get_vpn_config
from tools.mcp_tools import get_mcp_client_iam_auth
from utils import extract_session_context, format_sse_event

logger = logging.getLogger(__name__)

# Initialize the AgentCore runtime app
app = BedrockAgentCoreApp()

# Memory configuration from environment
MEMORY_ID = os.environ.get("MEMORY_ID")
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION")

# Knowledge Base configuration from environment
KNOWLEDGE_BASE_ID = os.environ.get("KNOWLEDGE_BASE_ID")

SYSTEM_PROMPT = """You are an internal IT helpdesk agent for Acme Corp.

You help employees with common technical issues including:
- Password resets and account access problems
- VPN connectivity and remote access setup
- Software installation and troubleshooting
- System status checks and outage information
- Hardware requests and IT ticket creation

You have access to a knowledge base containing IT policies, troubleshooting guides, 
software documentation, and security procedures. Use it when employees ask about 
setup instructions, common error resolutions, or IT policies.

Be helpful, patient, and clear in your explanations. Provide step-by-step instructions 
when guiding users through troubleshooting. If you cannot resolve an issue, create an 
IT ticket for the appropriate team.

Always prioritize security — never share credentials, and verify identity before 
performing sensitive operations like password resets.
"""

MODEL_ID = os.environ.get("MODEL_ID")


def resolve_mcp_arns() -> list[str]:
    """Resolve MCP server ARNs from environment variables."""
    arns_value = os.environ.get("MCP_RUNTIME_ARNS", "").strip()
    if arns_value:
        return [arn.strip() for arn in arns_value.split(",") if arn.strip()]

    legacy_arn = os.environ.get("MCP_RUNTIME_ARN", "").strip()
    if legacy_arn:
        return [legacy_arn]

    return []


def create_agent(session_id: str, actor_id: str) -> Agent:
    """Create an IT helpdesk agent with tools and session management.
    
    Session management behavior:
    - MEMORY_ID set: Uses AgentCore Memory for persistent cross-session memory
    - MEMORY_ID not set: Uses FileSessionManager for in-session conversation history
    """
    
    tools = [check_system_status, reset_password, create_it_ticket, get_vpn_config]
    
    if MEMORY_ID:
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
        session_manager = FileSessionManager(session_id=session_id)
    
    # Add knowledge base retrieval tool if configured
    if KNOWLEDGE_BASE_ID:
        kb_tool = create_kb_retrieval_tool(KNOWLEDGE_BASE_ID)
        tools.append(kb_tool)
    
    # Add MCP clients with graceful degradation
    mcp_arns = resolve_mcp_arns()
    for arn in mcp_arns:
        try:
            mcp_client = get_mcp_client_iam_auth(arn, AWS_REGION)
            tools.append(mcp_client)
            logger.info(f"Added MCP client for ARN: {arn}")
        except Exception as e:
            logger.error(f"Failed to connect MCP server {arn}: {e}")
    
    return Agent(
        system_prompt=SYSTEM_PROMPT,
        model=MODEL_ID,
        session_manager=session_manager,
        tools=tools,
    )


@app.entrypoint
async def agent_invocation(payload: dict, context):
    """Handler for agent invocation from AgentCore Runtime."""
    user_message = payload.get(
        "prompt", 
        "No prompt found in input. Please provide a JSON payload with a 'prompt' key."
    )

    session_id, actor_id = extract_session_context(context)

    try:
        agent = create_agent(session_id=session_id, actor_id=actor_id)
    except Exception as e:
        logger.error("Failed to create agent: %s", type(e).__name__)
        raise

    try:
        async for event in agent.stream_async(user_message):
            sse_event = format_sse_event(event)
            if sse_event is not None:
                yield sse_event
    except Exception as e:
        logger.error("Error during agent streaming: %s", type(e).__name__)
        raise


# Start the agent when run directly
if __name__ == "__main__":
    print("Starting IT Helpdesk agent...")
    print("Server will be available at http://localhost:8080")
    app.run(host="0.0.0.0", port=8080)
