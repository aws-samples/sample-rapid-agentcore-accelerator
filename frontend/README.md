# Streamlit Frontend

A Streamlit web application that provides a chat interface for interacting with AI agents deployed on Amazon Bedrock AgentCore Runtime or locally running agents. Features cognito based authentication.

## Structure

```text
frontend/
├── src/                    # Application source code
│   ├── app.py              # Main Streamlit application (thin orchestration layer)
│   ├── core/               # Library functions (non-UI)
│   │   ├── __init__.py     # Module exports
│   │   ├── config.py       # AppConfig dataclass + OutboundAuth enum
│   │   ├── invocations.py  # Agent invocation handlers
│   │   ├── streaming.py    # Stream event types and parser
│   │   └── utils.py        # Utility functions
│   ├── chatui/             # UI rendering components
│   │   ├── __init__.py     # Module exports
│   │   └── components.py   # Tool rendering and streaming UI functions
│   ├── Dockerfile          # Container image definition
│   ├── pyproject.toml      # Python dependencies
│   └── uv.lock             # Locked dependencies
├── local/                  # Local development files
│   ├── run_local.sh        # Development runner script
│   ├── docker_build.sh     # Build the frontend container image
│   ├── docker_run.sh       # Run the frontend container locally
│   ├── .env.example        # Environment template
│   └── .env                # Local environment (gitignored)
└── README.md
```

## Quick Start

### Option 1: Connect to Locally Running Agent

```bash
# 1. Start your agent locally (in another terminal, from the repository root)
make docker-run AGENT=customer-support

# 2. Set up frontend
cd frontend/src
uv sync

# 3. Configure environment
cp ../local/.env.example ../local/.env
# Edit .env and set:
#   LOCAL_AGENT_URL=http://localhost:8080

# 4. Start the frontend
cd .. && ./local/run_local.sh
```

### Option 1b: Run the frontend as a container

`run_local.sh` runs Streamlit directly. To exercise the same image that gets deployed to Fargate, build and run the container instead. It reads `local/.env` the same way:

```bash
cd frontend
./local/docker_build.sh
./local/docker_run.sh
```

Set `LOCAL_AGENT_URL=http://host.docker.internal:8080` in `local/.env` when the agent is running on the host, since `localhost` inside the container is the container itself.

### Option 2: Connect to AgentCore Runtime

```bash
# 1. Set up frontend
cd frontend/src
uv sync

# 2. Configure environment
cp ../local/.env.example ../local/.env
# Edit .env and set:
#   AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:...
#   AWS_REGION=us-west-2

# 3. Configure AWS credentials
aws configure

# 4. Start the frontend
cd .. && ./local/run_local.sh
```

The app will be available at `http://localhost:8501`

## Features

- 🔌 **Local Agent Support** - Connect to locally running agents for development
- 🔐 **Flexible Authentication** - Supports Cognito OAuth, IAM, or no-auth modes
- 💬 **Chat Interface** - Clean, responsive chat UI for agent interaction
- 🔒 **JWT Token Handling** - Secure token-based authentication with AgentCore
- 🚀 **Session Management** - Persistent chat sessions with unique session IDs
- ⚡ **Real-time Streaming** - Stream agent responses incrementally with tool usage display

## Environment Variables

Configure in `local/.env`:

| Variable | Description | Example |
|----------|-------------|---------|
| `LOCAL_AGENT_URL` | URL of locally running agent | `http://localhost:8080` |
| `AGENTCORE_RUNTIME_ARN` | AgentCore Runtime ARN | `arn:aws:bedrock-agentcore:...` |
| `AWS_REGION` | AWS region | `us-west-2` |
| `COGNITO_AUTH_ENABLED` | Set by CDK when Cognito is configured | `false` |
| `STREAMING_ENABLED` | Enable real-time streaming responses | `false` |

**Priority**: If `LOCAL_AGENT_URL` is set, it takes precedence over `AGENTCORE_RUNTIME_ARN`.

## Authentication Configurations

The frontend supports multiple deployment modes based on environment configuration:

| Configuration | Frontend Auth | Backend Auth | Use Case |
|---------------|---------------|--------------|----------|
| **Local Agent** | None | Direct HTTP | Local development with local agent |
| **AgentCore + IAM** | None | IAM credentials | Local testing or internal tools |
| **AgentCore + Cognito** | Cognito OAuth | OAuth Bearer | Internet-facing with user auth |

### Authentication Selection Logic

The app automatically determines the authentication method based on configuration:

1. **Direct HTTP (no auth)**: When `LOCAL_AGENT_URL` is set
2. **OAuth**: When `COGNITO_AUTH_ENABLED=true` and user has access token
3. **IAM**: All other cases (requires AWS credentials or IAM role)

## Docker Deployment

```bash
# Build from src/ directory
cd frontend/src
docker build -t streamlit-frontend .

# Run with local agent
docker run -p 8501:8501 \
  -e LOCAL_AGENT_URL=http://host.docker.internal:8080 \
  streamlit-frontend

# Run with AgentCore Runtime
docker run -p 8501:8501 \
  -e AGENTCORE_RUNTIME_ARN=your-runtime-arn \
  -e AWS_REGION=us-west-2 \
  streamlit-frontend
```

## Architecture

```text
                    Frontend Auth              Backend Auth
                    ─────────────              ────────────
                          │                         │
User → ALB (optional) → Streamlit UI → Agent (local or AgentCore Runtime)
                           │                    ↑
                      Reads config         HTTP or IAM/OAuth
```

## CDK Deployment

This frontend is deployed using the `StreamlitFrontend` CDK construct:

```typescript
new StreamlitFrontend(this, 'Frontend', {
  vpc: myVpc,
  agentRuntimeArn: runtime.agentRuntimeArn,
  dockerContextPath: './frontend/src',  // Note: src/ directory
});
```

See the CDK construct documentation for full deployment options.

## Streaming Mode

The frontend supports real-time streaming of agent responses, providing immediate feedback as the agent generates text and uses tools.

### Enabling/Disabling Streaming

Set the `STREAMING_ENABLED` environment variable:

```bash
# Enable streaming
STREAMING_ENABLED=true

# Disable streaming (default)
STREAMING_ENABLED=false
```

When streaming is disabled, the frontend uses the traditional request/response pattern where the complete response is displayed after the agent finishes processing.

### How Streaming Works

The streaming implementation follows a layered architecture:

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Streamlit UI (app.py)                     │
│  Uses chatui.components.render_streaming_response()              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Invocation Layer (core/invocations.py)          │
│  invoke_agent_streaming() - Routes to appropriate handler        │
│  ├── invoke_local_agent_streaming() - Local agent via HTTP       │
│  ├── invoke_agent_streaming_oauth() - AgentCore via OAuth        │
│  └── invoke_agent_streaming_iam() - AgentCore via IAM            │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Parser Layer (core/streaming.py)               │
│  parse_stream_event() - Converts SSE data to typed events        │
│  Event types: TextDelta, ToolUse, ToolResult, StreamComplete     │
└─────────────────────────────────────────────────────────────────┘
```

1. **Parser Layer** (`core/streaming.py`): Defines typed event classes and parses SSE-formatted data from the agent into structured `StreamEvent` objects.

2. **Invocation Layer** (`core/invocations.py`): Provides streaming handlers for each authentication mode (local, OAuth, IAM). Uses `httpx` with `httpx-sse` for HTTP streaming.

3. **UI Layer** (`chatui/components.py`): The `render_streaming_response()` function iterates over events and updates the Streamlit UI incrementally.

### Event Types

The streaming parser recognizes these event types:

| Type | Description | UI Behavior |
|------|-------------|-------------|
| `TextDelta` | Incremental text from the agent | Appended to response with typing cursor |
| `ToolUse` | Agent is invoking a tool | Creates expandable status showing tool name and input |
| `ToolResult` | Tool execution completed | Updates status with output, marks complete/error |
| `StreamComplete` | Stream finished | Removes typing cursor, finalizes display |
| `StreamError` | Error during streaming | Displays error message to user |

### Tool Call Display

When the agent uses tools, they're displayed as expandable status containers:

- **Running state**: Shows spinner with tool name while executing
- **Complete state**: Shows checkmark with tool name, input, and output
- **Error state**: Shows error icon with error details

Tool calls are persisted in the message history, so they remain visible when scrolling through the conversation.

### Reasoning Event Filtering

Some AI models emit "reasoning" or "thinking" events that contain internal model reasoning. These events are automatically filtered out and not displayed to users. The parser checks for a `reasoning: true` flag in the event data and skips such events.

Events that are filtered include:
- Events with `reasoning: true` flag
- Associated `reasoningText`, `reasoning_signature`, and `redactedContent` fields

This ensures users see only the final, polished responses without internal model deliberation.

### Backwards Compatibility

When `STREAMING_ENABLED` is not set or set to `false`:
- The frontend uses the existing non-streaming `invoke_agent()` function
- Responses are displayed all at once after the agent completes
- Tool calls are not displayed (only available in streaming mode)
- All existing deployments continue to work without changes
