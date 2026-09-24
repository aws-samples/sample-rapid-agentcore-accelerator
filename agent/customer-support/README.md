# Sample Agent

A working customer support agent built with [Strands Agents SDK](https://github.com/strands-agents/strands-agents-python) and integrated with AgentCore Runtime + Memory. Includes MCP (Model Context Protocol) support for connecting to external tools and services. Use this as a starting point for your own agent.

## Structure

```text
agent/customer-support/
├── src/                    # Agent source code
│   ├── main.py             # Entry point - agent setup and invocation handler
│   ├── tools/              # Agent tools
│   │   ├── customer_support.py  # Order lookup, product info, support tickets
│   │   ├── knowledge_base.py    # RAG retrieval from Bedrock Knowledge Base
│   │   └── mcp_tools.py         # MCP client wiring
│   └── utils/              # Helper utilities
└── evals/                  # Agent evaluation framework
```

Local dev commands are not per-agent. `scripts/chat.sh` and `scripts/docker-run.sh`
take the agent name as their first argument, so adding an agent needs no new
scripts — see the repository root [README](../../README.md).

## Quick Start

### 1. Install dependencies

```bash
cd agent/src
uv sync
```

### 2. Build and run locally

Run these from the repository root:

```bash
# Build the ARM64 image and run it (in-session history only)
make docker-run AGENT=customer-support

# Or with AgentCore Memory for persistent cross-session memory
MEMORY_ID=<your-memory-id> ./scripts/docker-run.sh customer-support --build
```

Once the image exists, drop `--build` to skip the rebuild.

### 3. Chat with your agent

```bash
# Against the local container started above
make chat AGENT=customer-support CHAT_ARGS=--local

# Against the deployed runtime
make chat AGENT=customer-support
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG` | `true` | Enable Strands debug logging |
| `MEMORY_ID` | - | AgentCore Memory ID (when set, enables persistent cross-session memory) |
| `KNOWLEDGE_BASE_ID` | - | Bedrock Knowledge Base ID for RAG |
| `MCP_RUNTIME_ARN` | - | AgentCore runtime ARN for MCP server integration |
| `AWS_DEFAULT_REGION` | `us-west-2` | AWS region |

## Customizing for Your Use Case

### 1. Update the system prompt

Edit `src/main.py` and modify `SYSTEM_PROMPT` to match your agent's persona and capabilities:

```python
SYSTEM_PROMPT = """You are a helpful assistant for [Your Company].

You can help users with:
- [Capability 1]
- [Capability 2]

Be helpful and concise.
"""
```

### 2. Add your own tools

Create new tools in `src/tools/` using the `@tool` decorator:

```python
from strands import tool

@tool
def my_custom_tool(param1: str, param2: int) -> str:
    """
    Description of what this tool does.
    
    Args:
        param1: What this parameter is for
        param2: What this parameter is for
    
    Returns:
        What the tool returns
    """
    # Your implementation
    return result
```

Then register it in `src/main.py`:

```python
from tools.my_module import my_custom_tool

def create_agent(...):
    tools = [my_custom_tool, ...]  # Add your tool here
```

### 3. Connect to real backends

Replace the mock data in `src/tools/customer_support.py` with actual API calls:

```python
@tool
def lookup_order(order_id: str) -> str:
    """Look up order status from your backend."""
    # Replace mock with real API call
    response = requests.get(f"https://api.yourcompany.com/orders/{order_id}")
    return format_order_response(response.json())
```

### 4. Change the model

`MODEL_ID` is read from the environment at startup — CDK injects it from the `modelId` key in `config.yaml`, so set it there rather than in the agent source:

```yaml
modelId: global.anthropic.claude-sonnet-4-5-20250929-v1:0
```

The default is `global.anthropic.claude-haiku-4-5-20251001-v1:0`. For a local run, export `MODEL_ID` in your shell before starting the agent. Every model identifier the [configuration reference](../../docs/configuration.md) accepts must be enabled for your account in Amazon Bedrock.

All models must be accessed through Amazon Bedrock, which is designed to provide managed security, compliance monitoring, and cost controls.

### 5. Add knowledge base content

Drop markdown files into `assets/` and deploy a Knowledge Base pointing to them. Set `KNOWLEDGE_BASE_ID` to enable RAG retrieval.

### 6. Enable MCP integration

To connect to MCP servers running in AgentCore runtime:

```bash
# Set the AgentCore runtime ARN for your MCP server
export MCP_RUNTIME_ARN="arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/my-mcp-server"

# The agent will automatically connect and discover tools using IAM authentication
```

The MCPClient is passed directly to the Strands Agent, which manages the connection lifecycle automatically (experimental feature).

## Included Tools

| Tool | Description |
|------|-------------|
| `lookup_order` | Look up order status and details |
| `get_product_info` | Get product information and availability |
| `create_support_ticket` | Create escalation tickets |
| `retrieve_from_knowledge_base` | RAG retrieval (when KB configured) |
| MCP Tools | External tools from MCP servers (when MCP_RUNTIME_ARN configured) |

## Streaming Mode

The agent supports real-time streaming of responses via Server-Sent Events (SSE). When invoked through AgentCore Runtime, the agent streams events as they occur rather than waiting for the complete response.

### How Streaming Works

The agent uses Strands' `agent.stream_async()` method to iterate over events and yields them in SSE format. The streaming flow is:

1. The `@app.entrypoint` handler receives a request with a prompt
2. It creates an agent using `create_agent()` with session/actor context
3. It iterates over `agent.stream_async(prompt)` which yields Strands events
4. Each event is passed to `format_sse_event()` (in `utils/sse.py`) for conversion
5. Formatted events are yielded back to the runtime, which transmits them as SSE

```python
# Simplified streaming flow in main.py
async for event in agent.stream_async(user_message):
    sse_event = format_sse_event(event)
    if sse_event is not None:
        yield sse_event
```

### SSE Event Formatting

The `format_sse_event()` utility in `agent/customer-support/src/utils/sse.py` converts Strands streaming events to SSE-compatible format. It handles:

- **`data` events**: Text deltas from model output (streamed incrementally)
- **`current_tool_use` events**: Tool invocation information (tool ID, name, input)
- **`message` events**: Messages containing tool results
- **`result` events**: Final agent result with complete message

Unknown event types are silently skipped to ensure forward compatibility with future Strands SDK versions.

### Event Types Reference

| Event Type | Description | Example |
|------------|-------------|---------|
| `data` | Text delta from the model | `{"data": "Hello, "}` |
| `data` (reasoning) | Reasoning event (filtered by frontend) | `{"data": "...", "reasoning": true}` |
| `current_tool_use` | Tool invocation started | `{"current_tool_use": {"toolUseId": "abc", "name": "lookup_order", "input": {"order_id": "123"}}}` |
| `message` | Message with tool use or results | `{"message": {"role": "assistant", "content": [...]}}` |
| `result` | Final agent result | `{"result": {"message": {...}}}` |

### SSE Wire Format

Events are transmitted as Server-Sent Events over HTTP. Each event is a JSON object prefixed with `data: ` and terminated with double newlines:

```text
data: {"current_tool_use": {"toolUseId": "abc", "name": "lookup_order", "input": {"order_id": "123"}}}

data: {"message": {"role": "user", "content": [{"toolResult": {"toolUseId": "abc", "status": "success", "content": [{"text": "Order found"}]}}]}}

data: {"data": "Your order "}

data: {"data": "has been shipped!"}

data: {"result": {"message": {"role": "assistant", "content": [...]}}}

```

### Event Sequence for Tool Use

When the agent uses a tool, events are emitted in this order:

1. `current_tool_use` - Tool invocation starts (input may be JSON string)
2. `message` (assistant + toolUse) - Tool use confirmed (input as object)
3. `message` (user + toolResult) - Tool execution result
4. `data` events - Streamed text response
5. `message` (assistant + text) - Complete response
6. `result` - Stream completion marker


### Customizing Event Formatting

To modify how events are formatted, edit `agent/customer-support/src/utils/sse.py`. The `format_sse_event()` function receives raw Strands events and returns SSE-compatible dictionaries (or `None` to skip).

```python
# Example: Add custom handling for a new event type
def format_sse_event(event: dict[str, Any]) -> dict[str, Any] | None:
    # Handle your custom event type
    if "my_custom_event" in event:
        return {"custom": event["my_custom_event"]}
    
    # ... existing handling ...
```

### Debug Logging for Events

To see detailed event structure during development, enable debug logging:

```bash
DEBUG=true ./scripts/docker-run.sh customer-support
```

This logs each streaming event before formatting, which is helpful for understanding the event structure and debugging parsing issues. Debug output includes:
- Event keys for each received event
- Full event JSON (safely serialized)
- Skipped event types

## MCP Integration

The agent supports Model Context Protocol (MCP) integration for connecting to MCP servers running in AgentCore runtime. When `MCP_RUNTIME_ARN` is configured, the agent uses Strands' experimental managed MCP lifecycle feature - the MCPClient is passed directly to the Agent, which handles connection start/stop automatically.

When configured, the agent:
- Constructs the MCP endpoint URL from the runtime ARN
- Connects using AWS IAM authentication  
- Discovers and loads tools from the MCP server automatically

> **Note:** The managed MCP lifecycle is an experimental Strands feature and may change in future versions.

This enables seamless integration with AgentCore runtime MCP servers without manual endpoint configuration or lifecycle management.

## Deploying to AgentCore Runtime

### Option 1: Automated CI/CD (Recommended)

If you've deployed the infrastructure stack, a CodeCommit repository and CI/CD pipeline are already set up. Simply push your changes to the `main` branch:

```bash
git remote add codecommit <codecommit-repo-url>
git push codecommit main
```

This triggers an automated pipeline that builds the ARM64 image and deploys it to AgentCore Runtime.

### Option 2: Manual Build & Push

> **Important:** AgentCore Runtime requires ARM64 container images. If you're building on an x86 machine (Intel/AMD), use Docker buildx:

```bash
# Build for ARM64
docker buildx build --platform linux/arm64 -t rapid-customer-support-agent ./src

# Or build and push directly to ECR
docker buildx build --platform linux/arm64 -t <account>.dkr.ecr.<region>.amazonaws.com/rapid-customer-support-agent:latest --push ./src
```

See the [AgentCore Getting Started Guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/getting-started-custom.html) for full deployment instructions.

## Debug Logging

Debug logging is enabled by default. To disable it:

```bash
DEBUG=false ./scripts/docker-run.sh customer-support
```

## Testing MCP Integration

To test MCP integration locally:

```bash
# Set your AgentCore runtime ARN
export MCP_RUNTIME_ARN="arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/my-mcp-server"

# Run the agent, then chat with it from another shell
./scripts/docker-run.sh customer-support --build
make chat AGENT=customer-support CHAT_ARGS=--local
```

Ensure your AWS credentials have `bedrock-agentcore:InvokeRuntime` permission on the MCP runtime.

## Evaluation

See `evals/README.md` for running agent evaluations against test cases.
