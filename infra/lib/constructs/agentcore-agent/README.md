# AgentCoreAgent Construct

An L3 CDK construct for creating an Amazon Bedrock AgentCore agent with Runtime and Memory for AI agent deployments.

## Features

- AgentCore Runtime with Docker-based agent
- Two deployment methods: local asset path or ECR repository
- Integrated Memory with semantic strategy
- Flexible network modes: Public endpoint or VPC deployment
- Automatic Bedrock model permissions
- IAM authentication

## Resources Created

- AgentCore Memory with semantic strategy
- AgentCore Runtime with IAM auth
- Security group (when using VPC mode)
- Bedrock model invocation permissions

## Usage

### Public Mode (Simplest - No VPC Required)

```typescript
import { AgentCoreAgent, NetworkMode } from './constructs/agentcore-agent';

const agent = new AgentCoreAgent(this, 'Agent', {
  runtimeName: 'my_agent',
  agentAssetPath: path.join(__dirname, '../../agent'),
  description: 'My AI agent',
  networkMode: NetworkMode.PUBLIC, // Default - uses public endpoint
});
```

### VPC Mode (For Private Network Access)

```typescript
import { AgentCoreAgent, NetworkMode } from './constructs/agentcore-agent';

const agent = new AgentCoreAgent(this, 'Agent', {
  runtimeName: 'my_agent',
  agentAssetPath: path.join(__dirname, '../../agent'),
  networkMode: NetworkMode.VPC,
  vpcConfig: {
    vpc: myVpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }, // optional
    securityGroups: [mySg], // optional additional security groups
  },
});
```

### ECR Mode (For CI/CD Pipelines)

Use pre-built images from an ECR repository instead of building from local assets:

```typescript
import { AgentCoreAgent } from './constructs/agentcore-agent';
import * as ecr from 'aws-cdk-lib/aws-ecr';

// Reference an existing ECR repository
const ecrRepo = ecr.Repository.fromRepositoryName(this, 'AgentRepo', 'my-agent-images');

const agent = new AgentCoreAgent(this, 'Agent', {
  runtimeName: 'my_agent',
  ecrConfig: {
    repository: ecrRepo,
    imageTag: 'latest', // optional, defaults to 'latest'
  },
});
```

> **Note:** You must provide exactly one of `agentAssetPath` or `ecrConfig`. Providing both or neither will result in a validation error.

### Without Memory (Stateless Agent)

```typescript
const agent = new AgentCoreAgent(this, 'Agent', {
  runtimeName: 'my_agent',
  agentAssetPath: path.join(__dirname, '../../agent'),
  enableMemory: false, // No memory resource created
});
```

## Props

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `runtimeName` | string | Yes | - | Name for the agent runtime |
| `agentAssetPath` | string | No* | - | Path to the agent Docker context (*mutually exclusive with ecrConfig) |
| `ecrConfig` | EcrConfig | No* | - | ECR configuration for pre-built images (*mutually exclusive with agentAssetPath) |
| `description` | string | No | - | Description for the runtime |
| `networkMode` | NetworkMode | No | `PUBLIC` | Network mode: PUBLIC or VPC |
| `vpcConfig` | VpcConfig | No** | - | VPC configuration (**required when networkMode is VPC) |
| `enableMemory` | boolean | No | `true` | Whether to create a Memory resource |
| `memoryName` | string | No | `{runtimeName}_memory` | Memory name (when memory enabled) |
| `memoryExpirationDays` | number | No | `90` | Memory expiration in days (when memory enabled) |
| `environmentVariables` | Record<string, string> | No | - | Additional environment variables |

> **Note:** Exactly one of `agentAssetPath` or `ecrConfig` must be provided.

### EcrConfig Properties

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `repository` | IRepository | Yes | - | The ECR repository containing the agent image |
| `imageTag` | string | No | `latest` | Image tag to use |

### VpcConfig Properties

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `vpc` | IVpc | Yes | - | The VPC to deploy into |
| `vpcSubnets` | SubnetSelection | No | Private with egress | Subnet selection |
| `securityGroups` | ISecurityGroup[] | No | - | Additional security groups |

## Exposed Properties

| Property | Type | Description |
|----------|------|-------------|
| `runtime` | Runtime | The AgentCore Runtime |
| `memory` | Memory \| undefined | The AgentCore Memory (if enabled) |
| `securityGroup` | SecurityGroup \| undefined | Security group (VPC mode only) |
| `networkMode` | NetworkMode | The configured network mode |
| `memoryEnabled` | boolean | Whether memory is enabled |
| `grantPrincipal` | IPrincipal | For adding IAM permissions |

## Environment Variables

The runtime automatically receives:
- `MEMORY_ID` - The memory ID for agent use
- `AWS_DEFAULT_REGION` - Current AWS region

## Permissions

The runtime is automatically granted:
- `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` for all foundation models
- Read/write access to the Memory

## Agent Docker Context

Your agent directory should contain:
- `Dockerfile` - Container definition
- `main.py` - Agent entry point
- `requirements.txt` - Python dependencies
