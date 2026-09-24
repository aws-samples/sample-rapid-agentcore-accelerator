# AgentCorePipeline Construct

An L3 CDK construct that creates a complete CI/CD pipeline for building container images and deploying them to AgentCore Runtime.

## Features

- **CodeCommit Repository**: Creates a new repository or uses an existing one (standalone mode)
- **CodeBuild Project**: ARM64 Docker builds with privileged mode
- **CodePipeline**: Orchestrates the source → build → deploy workflow
- **AgentCore Integration**: Automatically updates AgentCore Runtime with new container images
- **S3 Artifact Bucket**: Encrypted storage for pipeline artifacts
- **Monorepo Support**: Selective triggering based on glob pattern matching

## Usage

### Basic Usage

```typescript
import { AgentCorePipeline } from './lib/constructs/agentcore-pipeline';
import * as ecr from 'aws-cdk-lib/aws-ecr';

// Create or reference an ECR repository
const ecrRepo = new ecr.Repository(this, 'AgentImages', {
  repositoryName: 'my-agent-images',
});

const pipeline = new AgentCorePipeline(this, 'AgentPipeline', {
  pipelineName: 'my-agent-pipeline',
  ecrRepository: ecrRepo,
  agentRuntimeId: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/my-runtime',
  buildConfig: {
    sourceDirectory: 'agent/src',
  },
});
```

### With Custom Configuration

```typescript
const pipeline = new AgentCorePipeline(this, 'AgentPipeline', {
  pipelineName: 'my-agent-pipeline',
  ecrRepository: ecrRepo,
  agentRuntimeId: 'my-runtime-id',
  sourceConfig: {
    repositoryName: 'my-custom-repo',
    branch: 'develop',
  },
  buildConfig: {
    sourceDirectory: 'mcp/server',
    dockerfilePath: 'Dockerfile.prod',
    timeoutMinutes: 45,
    computeType: codebuild.ComputeType.XLARGE,
  },
});
```

### Monorepo Mode

Use with `MonorepoSource` for selective pipeline triggering based on glob pattern matching:

```typescript
import { MonorepoSource } from './lib/constructs/monorepo-source';
import { AgentCorePipeline } from './lib/constructs/agentcore-pipeline';

// Create the monorepo source
const monorepoSource = new MonorepoSource(this, 'MonorepoSource', {
  repositoryConfig: {
    repositoryName: 'my-monorepo',
  },
});

// Create pipeline in monorepo mode
const agentPipeline = new AgentCorePipeline(this, 'AgentPipeline', {
  pipelineName: 'agent-pipeline',
  ecrRepository: agentEcrRepo,
  agentRuntimeId: 'agent-runtime-id',
  buildConfig: {
    sourceDirectory: 'agent/src',
  },
  monorepoConfig: {
    source: monorepoSource,
    triggerPaths: ['agent/**', 'shared/**/*.py'],  // Glob patterns
  },
});

// Create another pipeline for an MCP server
const mcpPipeline = new AgentCorePipeline(this, 'McpPipeline', {
  pipelineName: 'mcp-pipeline',
  ecrRepository: mcpEcrRepo,
  agentRuntimeId: 'mcp-runtime-id',
  buildConfig: {
    sourceDirectory: 'mcp/server',
  },
  monorepoConfig: {
    source: monorepoSource,
    triggerPaths: ['mcp/**'],  // Any file in mcp directory
  },
});
```

### Using with AgentCoreAgent

```typescript
import { AgentCorePipeline } from './lib/constructs/agentcore-pipeline';
import { AgentCoreAgent } from './lib/constructs/agentcore-agent';

// Create the agent first to get the runtime ID and ECR repository
const agent = new AgentCoreAgent(this, 'Agent', {
  runtimeName: 'my-agent',
  // ... other config
});

// Create the CI/CD pipeline using the agent's ECR repository
const pipeline = new AgentCorePipeline(this, 'Pipeline', {
  pipelineName: 'agent-pipeline',
  ecrRepository: agent.ecrRepository,
  agentRuntimeId: agent.runtimeId,
  buildConfig: {
    sourceDirectory: 'agent/src',
  },
});
```

## Props

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `pipelineName` | string | (required) | Name for the pipeline and related resources |
| `ecrRepository` | IRepository | (required) | ECR repository to push built images to |
| `agentRuntimeId` | string | (required) | The AgentCore Runtime ID to update after build |
| `buildConfig` | BuildConfig | (required) | Build configuration |
| `buildConfig.sourceDirectory` | string | (required) | Path to Dockerfile directory (relative to repo root) |
| `buildConfig.dockerfilePath` | string | 'Dockerfile' | Dockerfile path relative to sourceDirectory |
| `buildConfig.timeoutMinutes` | number | 30 | Build timeout |
| `buildConfig.computeType` | ComputeType | LARGE | CodeBuild compute type |
| `sourceConfig` | SourceRepositoryConfig | - | Source repository configuration (standalone mode) |
| `sourceConfig.existingRepository` | IRepository | - | Use an existing CodeCommit repository |
| `sourceConfig.repositoryName` | string | 'agentcore-monorepo' | Name for new repository |
| `sourceConfig.branch` | string | 'main' | Branch to monitor |
| `monorepoConfig` | MonorepoConfig | - | Monorepo configuration (monorepo mode) |
| `monorepoConfig.source` | MonorepoSource | - | MonorepoSource construct for selective triggering |
| `monorepoConfig.triggerPaths` | string[] | - | Glob patterns that trigger this pipeline |
| `cicdDeployedParameter` | IStringParameter | - | SSM parameter to set to 'true' after first successful build |
| `description` | string | - | Description for the pipeline |

## Configuration Modes

The construct supports two mutually exclusive configuration modes:

### Standalone Mode (Default)
Uses `sourceConfig` to create or use a dedicated CodeCommit repository with native triggers:

```typescript
const pipeline = new AgentCorePipeline(this, 'Pipeline', {
  pipelineName: 'my-pipeline',
  ecrRepository: ecrRepo,
  agentRuntimeId: 'my-runtime-id',
  buildConfig: { sourceDirectory: 'agent/src' },
  sourceConfig: {
    repositoryName: 'my-repo',
    branch: 'main',
  },
});
```

### Monorepo Mode
Uses `monorepoConfig` to integrate with a `MonorepoSource` for selective triggering based on glob patterns:

```typescript
const pipeline = new AgentCorePipeline(this, 'Pipeline', {
  pipelineName: 'my-pipeline',
  ecrRepository: ecrRepo,
  agentRuntimeId: 'my-runtime-id',
  buildConfig: { sourceDirectory: 'agent/src' },
  monorepoConfig: {
    source: monorepoSource,
    triggerPaths: ['agent/**', 'shared/**/*.py'],
  },
});
```

**Note:** You cannot specify both `sourceConfig` and `monorepoConfig` - they are mutually exclusive.

## Glob Pattern Examples

The `triggerPaths` in monorepo mode support standard glob patterns:

| Pattern | Matches | Example Files |
|---------|---------|---------------|
| `agent/**` | Any file in agent directory | `agent/src/main.py`, `agent/README.md` |
| `**/*.py` | All Python files | `src/app.py`, `tests/unit/test_app.py` |
| `*.json` | JSON files in root | `package.json`, `tsconfig.json` |
| `shared/**/*.py` | Python files in shared | `shared/utils.py`, `shared/lib/helpers.py` |

## Outputs

The construct creates the following CloudFormation outputs:

- `{id}RepoCloneUrlHttp` - HTTPS clone URL for CodeCommit (standalone mode only, when creating new repo)
- `{id}RepoCloneUrlSsh` - SSH clone URL for CodeCommit (standalone mode only, when creating new repo)
- `{id}PipelineArn` - CodePipeline ARN

## How Monorepo Mode Works

When using `monorepoConfig`, the pipeline behavior changes:

1. **Repository Source**: Uses the `MonorepoSource`'s repository instead of creating its own
2. **Trigger Disabled**: Sets `trigger: NONE` on the source action to disable native triggers
3. **Auto-Registration**: Automatically registers itself with the `MonorepoSource` using the provided `triggerPaths`
4. **Selective Triggering**: Only starts when changes are detected in files matching the glob patterns

The `MonorepoSource` handles the logic for:
- Detecting which files changed in each commit
- Matching changed paths against registered pipeline glob patterns
- Starting only the relevant pipelines via the CodePipeline API

This enables multiple independent pipelines to coexist in a single repository, with each pipeline only running when files matching its patterns have changes.

## Integration with MonorepoSource

For more details on the monorepo triggering mechanism and glob pattern syntax, see the [MonorepoSource README](../monorepo-source/README.md).
