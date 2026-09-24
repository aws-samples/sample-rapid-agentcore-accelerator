# Sample MCP Server

A customer support MCP (Model Context Protocol) server built with [FastMCP](https://github.com/jlowin/fastmcp) for deployment to AgentCore Runtime. Use this as a starting point for your own MCP tool servers.

## Structure

```text
mcp/support-tools/
├── src/                    # MCP server source code
│   ├── main.py             # Entry point - FastMCP server with tools
│   ├── pyproject.toml      # Python dependencies
│   └── Dockerfile          # Container build configuration
└── README.md
```

## Quick Start

### 1. Install dependencies

```bash
cd mcp/support-tools/src
uv sync
```

### 2. Run locally

```bash
cd mcp/support-tools/src
uv run python main.py
```

The server will start at `http://0.0.0.0:8000/mcp`.

### 3. Build and run with Docker

```bash
cd mcp/support-tools/src

# Build the container
docker build -t mcp-server .

# Run the container
docker run -p 8000:8000 mcp-server
```

## Included Tools

| Tool | Description |
|------|-------------|
| `get_support_ticket_status` | Look up the status of a support ticket by ID |
| `search_faq` | Search the FAQ knowledge base for answers |

## Testing the Server

Once running, you can test the MCP server using curl:

```bash
# List available tools
curl -X POST http://localhost:8000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 1}'

# Call a tool
curl -X POST http://localhost:8000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "get_support_ticket_status",
      "arguments": {"ticket_id": "TKT-001"}
    },
    "id": 2
  }'
```

## Customizing for Your Use Case

### Add new tools

Create new tools using the `@mcp.tool()` decorator:

```python
@mcp.tool()
def my_custom_tool(param1: str, param2: int) -> dict:
    """
    Description of what this tool does.
    
    Args:
        param1: What this parameter is for
        param2: What this parameter is for
    
    Returns:
        Dictionary with the result
    """
    # Your implementation
    return {"result": "..."}
```

### Connect to real backends

Replace the sample data with actual API calls:

```python
@mcp.tool()
def get_support_ticket_status(ticket_id: str) -> dict:
    """Get ticket status from your backend."""
    response = requests.get(f"https://api.yourcompany.com/tickets/{ticket_id}")
    return response.json()
```

## Deploying to AgentCore Runtime

### Option 1: Automated CI/CD (Recommended)

If you've deployed the infrastructure stack with the MCP server construct, a CI/CD pipeline is set up. Push changes to the `main` branch to trigger automatic builds and deployments.

### Option 2: Manual Build & Push

> **Important:** AgentCore Runtime requires ARM64 container images.

```bash
# Build for ARM64
docker buildx build --platform linux/arm64 -t mcp-server ./src

# Or build and push directly to ECR
docker buildx build --platform linux/arm64 \
  -t <account>.dkr.ecr.<region>.amazonaws.com/mcp-server:latest \
  --push ./src
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AWS_DEFAULT_REGION` | `us-west-2` | AWS region for SDK calls |

## MCP Protocol

This server uses the stateless streamable-http transport as required by AgentCore Runtime. The server listens on port 8000 at the `/mcp` endpoint.
