# AgentCoreMCPServer Construct

An L3 CDK construct for deploying Model Context Protocol (MCP) servers to Amazon Bedrock AgentCore Runtime.

## Features

- AgentCore Runtime with MCP protocol configuration
- Two deployment methods: local asset path or ECR repository
- Flexible network modes: Public endpoint or VPC deployment
- Authentication modes: IAM (SigV4) or Cognito (OAuth)
- Automatic environment variable configuration

## Resources Created

- AgentCore Runtime with MCP protocol
- Security group (when using VPC mode)

## Usage

### Public Mode with IAM Auth (Simplest)

```typescript
import { AgentCoreMCPServer } from './constructs/agentcore-mcp-server';

const mcpServer = new AgentCoreMCPServer(this, 'MCPServer', {
  runtimeName: 'my_mcp_server',
  mcpAssetPath: path.join(__dirname, '../../mcp/src'),
  description: 'Customer support MCP tools',
});
```

### VPC Mode

```typescript
import { AgentCoreMCPServer, NetworkMode } from './constructs/agentcore-mcp-server';

const mcpServer = new AgentCoreMCPServer(this, 'MCPServer', {
  runtimeName: 'my_mcp_server',
  mcpAssetPath: path.join(__dirname, '../../mcp/src'),
  networkMode: NetworkMode.VPC,
  vpcConfig: {
    vpc: myVpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  },
});
```

### ECR Mode (For CI/CD Pipelines)

```typescript
import { AgentCoreMCPServer } from './constructs/agentcore-mcp-server';
import * as ecr from 'aws-cdk-lib/aws-ecr';

const ecrRepo = ecr.Repository.fromRepositoryName(this, 'MCPRepo', 'my-mcp-images');

const mcpServer = new AgentCoreMCPServer(this, 'MCPServer', {
  runtimeName: 'my_mcp_server',
  ecrConfig: {
    repository: ecrRepo,
    imageTag: 'latest',
  },
});
```

### Cognito Authentication

```typescript
import { AgentCoreMCPServer, AuthMode } from './constructs/agentcore-mcp-server';

const mcpServer = new AgentCoreMCPServer(this, 'MCPServer', {
  runtimeName: 'my_mcp_server',
  mcpAssetPath: path.join(__dirname, '../../mcp/src'),
  authMode: AuthMode.COGNITO,
  cognitoAuth: {
    userPool: myUserPool,
    userPoolClients: [myClient],
    allowedAudience: ['my-audience'], // optional
  },
});
```

## Props

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `runtimeName` | string | Yes | - | Name for the MCP server runtime |
| `mcpAssetPath` | string | No* | - | Path to the MCP server Docker context |
| `ecrConfig` | EcrConfig | No* | - | ECR configuration for pre-built images |
| `description` | string | No | - | Description for the runtime |
| `networkMode` | NetworkMode | No | `PUBLIC` | Network mode: PUBLIC or VPC |
| `vpcConfig` | VpcConfig | No** | - | VPC configuration |
| `authMode` | AuthMode | No | `IAM` | Authentication mode: IAM or COGNITO |
| `cognitoAuth` | CognitoAuthConfig | No*** | - | Cognito configuration |
| `environmentVariables` | Record<string, string> | No | - | Additional environment variables |

> *Exactly one of `mcpAssetPath` or `ecrConfig` must be provided.
> **Required when `networkMode` is VPC.
> ***Required when `authMode` is COGNITO.

## Exposed Properties

| Property | Type | Description |
|----------|------|-------------|
| `runtime` | Runtime | The AgentCore Runtime |
| `securityGroup` | SecurityGroup \| undefined | Security group (VPC mode only) |
| `networkMode` | NetworkMode | The configured network mode |
| `authMode` | AuthMode | The configured authentication mode |
| `grantPrincipal` | IPrincipal | For adding IAM permissions |

## Environment Variables

The runtime automatically receives:
- `AWS_DEFAULT_REGION` - Current AWS region

## MCP Server Requirements

Your MCP server must:
- Listen on host `0.0.0.0` and port `8000`
- Serve MCP protocol at path `/mcp`
- Use stateless streamable-http transport
- Be containerized with ARM64 platform support

Example FastMCP server:

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP(host="0.0.0.0", stateless_http=True)

@mcp.tool()
def my_tool(param: str) -> dict:
    """Tool description"""
    return {"result": param}

if __name__ == "__main__":
    mcp.run(transport="streamable-http")
```
