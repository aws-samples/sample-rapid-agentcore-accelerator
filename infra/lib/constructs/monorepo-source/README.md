# MonorepoSource Construct

An L3 CDK construct that manages a monorepo-style CI/CD system with selective pipeline triggering. This construct creates a CodeCommit repository, EventBridge rule, and Lambda trigger function that detects file changes using glob patterns and selectively starts only the relevant downstream pipelines.

## Features

- **CodeCommit Repository**: Creates a new repository or uses an existing one
- **Glob Pattern Matching**: Uses flexible glob patterns to match changed files (e.g., `agent/**`, `*.py`, `docs/**/*.md`)
- **Selective Triggering**: Only triggers pipelines when files matching their patterns change
- **EventBridge Integration**: Reliable event delivery for repository changes
- **Lambda Trigger Function**: Analyzes changed files and triggers appropriate pipelines
- **SSM Parameter Tracking**: Tracks last processed commit for accurate change detection
- **Pipeline Registry**: Manages mapping between glob patterns and pipelines

## Architecture

```text
Developer → CodeCommit → EventBridge → Lambda → CodePipeline(s)
                                    ↓
                               SSM Parameter
                              (Last Commit)
```

## Usage

### Basic Usage

```typescript
import { MonorepoSource } from './lib/constructs/monorepo-source';
import { AgentCorePipeline } from './lib/constructs/agentcore-pipeline';

// Create the monorepo source
const monorepoSource = new MonorepoSource(this, 'MonorepoSource', {
  repositoryConfig: {
    repositoryName: 'my-monorepo',
    branch: 'main',
  },
});

// Create pipelines that use the monorepo source
const agentPipeline = new AgentCorePipeline(this, 'AgentPipeline', {
  pipelineName: 'agent-pipeline',
  buildConfig: {
    sourceDirectory: 'agent/src',
  },
  monorepoConfig: {
    source: monorepoSource,
    triggerPaths: ['agent/**'],  // Any file in agent directory
  },
});

const frontendPipeline = new AgentCorePipeline(this, 'FrontendPipeline', {
  pipelineName: 'frontend-pipeline',
  buildConfig: {
    sourceDirectory: 'frontend',
  },
  monorepoConfig: {
    source: monorepoSource,
    triggerPaths: ['frontend/**'],  // Any file in frontend directory
  },
});
```

### Advanced Glob Patterns

```typescript
// More specific pattern examples
const apiPipeline = new AgentCorePipeline(this, 'ApiPipeline', {
  pipelineName: 'api-pipeline',
  buildConfig: {
    sourceDirectory: 'api',
  },
  monorepoConfig: {
    source: monorepoSource,
    triggerPaths: [
      'api/**',              // Any file in api directory
      'shared/**/*.py',      // Only Python files in shared
      'config/*.json',       // Config files in root config dir
      'docs/api/**/*.md',    // API documentation changes
    ],
  },
});

// Infrastructure pipeline triggered by CDK or config changes
const infraPipeline = new AgentCorePipeline(this, 'InfraPipeline', {
  pipelineName: 'infra-pipeline',
  buildConfig: {
    sourceDirectory: 'infra',
  },
  monorepoConfig: {
    source: monorepoSource,
    triggerPaths: [
      'infra/**/*.ts',       // TypeScript CDK files
      'infra/**/*.json',     // CDK config files
      '*.json',              // Root config files
      'package*.json',       // Dependency changes
    ],
  },
});
```

### With Existing Repository

```typescript
import * as codecommit from 'aws-cdk-lib/aws-codecommit';

const existingRepo = codecommit.Repository.fromRepositoryName(
  this,
  'ExistingRepo',
  'my-existing-repo'
);

const monorepoSource = new MonorepoSource(this, 'MonorepoSource', {
  repositoryConfig: {
    existingRepository: existingRepo,
    branch: 'develop',
  },
  lambdaTimeoutSeconds: 120,
});
```

### Manual Pipeline Registration

```typescript
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';

// Create your own pipeline
const customPipeline = new codepipeline.Pipeline(this, 'CustomPipeline', {
  // ... pipeline configuration
});

// Register it with the monorepo source using glob patterns
monorepoSource.registerPipeline('custom-pipeline', {
  pipeline: customPipeline,
  triggerPaths: [
    'services/custom/**',     // Any file in custom service
    'shared/utils/**',        // Shared utilities
    'tests/integration/**',   // Integration tests
  ],
});
```

## Glob Pattern Examples

The `triggerPaths` support standard glob patterns:

| Pattern | Matches | Example Files |
|---------|---------|---------------|
| `agent/**` | Any file in agent directory | `agent/src/main.py`, `agent/README.md` |
| `**/*.py` | All Python files | `src/app.py`, `tests/unit/test_app.py` |
| `*.json` | JSON files in root | `package.json`, `tsconfig.json` |
| `docs/**/*.md` | Markdown files in docs | `docs/api/readme.md`, `docs/guides/setup.md` |
| `src/**/*.{ts,js}` | TypeScript/JavaScript in src | `src/index.ts`, `src/utils/helper.js` |
| `config/*` | Files directly in config | `config/dev.yaml`, `config/prod.yaml` |

### Pattern Matching Rules

- `*` matches any characters except `/`
- `**` matches any characters including `/` (recursive)
- `?` matches any single character
- `[abc]` matches any character in brackets
- `{a,b}` matches either `a` or `b`
- Patterns are relative to repository root (no leading `/`)

## Props

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `repositoryConfig.existingRepository` | IRepository | - | Use an existing CodeCommit repository |
| `repositoryConfig.repositoryName` | string | 'monorepo' | Name for new repository |
| `repositoryConfig.branch` | string | 'main' | Branch to monitor for changes |
| `lambdaTimeoutSeconds` | number | 60 | Lambda function timeout |
| `description` | string | - | Repository description |

## Methods

### registerPipeline(id: string, registration: PipelineRegistration)

Registers a pipeline to be triggered when changes occur in files matching specified glob patterns.

**Parameters:**
- `id` - Unique identifier for this registration
- `registration.pipeline` - The CodePipeline to trigger
- `registration.triggerPaths` - Array of glob patterns that trigger this pipeline

**Example:**
```typescript
monorepoSource.registerPipeline('infra-pipeline', {
  pipeline: infraPipeline,
  triggerPaths: [
    'infra/**/*.ts',      // CDK TypeScript files
    'infra/**/*.json',    // CDK configuration files
    'package*.json',      // Dependency changes
  ],
});
```

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `repository` | IRepository | The CodeCommit repository |
| `triggerFunction` | Function | The Lambda function handling triggers |
| `eventRule` | Rule | The EventBridge rule capturing repository events |
| `lastCommitParameter` | StringParameter | SSM parameter storing last processed commit |
| `branch` | string | The monitored branch name |

## Outputs

The construct creates the following CloudFormation outputs:

- `{id}RepoCloneUrlHttp` - HTTPS clone URL for CodeCommit
- `{id}RepoCloneUrlSsh` - SSH clone URL for CodeCommit
- `{id}TriggerFunctionArn` - Lambda trigger function ARN
- `{id}LastCommitParameterName` - SSM parameter name for commit tracking

## How It Works

1. **Push Detection**: When code is pushed to the monitored branch, CodeCommit emits an event
2. **Event Filtering**: EventBridge rule filters events to the specific repository and branch
3. **Change Analysis**: Lambda function retrieves the last processed commit from SSM Parameter Store
4. **File Analysis**: Lambda uses CodeCommit's `get_differences` API to find all changed files
5. **Pattern Matching**: Changed files are matched against registered pipeline glob patterns using Python's `fnmatch`
6. **Selective Triggering**: Only pipelines with files matching their patterns are started via `StartPipelineExecution`
7. **State Update**: SSM parameter is updated with the current commit ID

### Example Flow

```text
1. Developer pushes: agent/customer-support/src/main.py, shared/utils.py, docs/readme.md
2. Lambda analyzes changed files
3. Pattern matching:
   - 'agent/**' matches agent/customer-support/src/main.py → triggers agent-pipeline
   - 'shared/**/*.py' matches shared/utils.py → triggers shared-pipeline  
   - 'docs/**/*.md' matches docs/readme.md → triggers docs-pipeline
4. Three pipelines start in parallel
```

## Troubleshooting

### Lambda Function Logs

The trigger function logs detailed information to CloudWatch:
- Repository name and branch
- Current and previous commit IDs
- List of changed files
- Glob patterns matched for each pipeline
- Pipelines successfully triggered
- Any errors encountered

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| No pipelines triggered | Files don't match glob patterns | Check pattern syntax and test with simple patterns like `**` |
| Too many pipelines triggered | Patterns too broad | Use more specific patterns like `src/**/*.py` instead of `**` |
| Lambda timeout | Large commit with many files | Increase `lambdaTimeoutSeconds` |
| Permission denied | Missing IAM permissions | Check Lambda execution role |
| Parameter not found | First run or parameter deleted | Normal behavior - parameter will be created |

## Best Practices

1. **Pattern Specificity**: Use specific patterns to avoid unnecessary triggers
   - ✅ Good: `agent/**/*.py`, `docs/**/*.md`
   - ❌ Avoid: `**`, `*` (too broad)

2. **File Type Targeting**: Target specific file types when possible
   - ✅ Good: `**/*.{ts,js}`, `**/*.py`
   - ❌ Avoid: `src/**` (includes all files)

3. **Shared Dependencies**: Include shared patterns in multiple pipelines
   ```typescript
   // Both pipelines need shared utilities
   agentPipeline: ['agent/**', 'shared/**/*.py']
   apiPipeline: ['api/**', 'shared/**/*.py']
   ```

4. **Testing Patterns**: Test glob patterns locally using tools like `find`
   ```bash
   # Test what files your pattern would match
   find . -path "./agent/**" -type f
   ```

5. **Monitoring**: Monitor CloudWatch logs to verify pattern matching works correctly

6. **Root Files**: Use specific patterns for root-level files
   - ✅ Good: `package.json`, `*.yaml`
   - ❌ Avoid: `*` (matches everything in root)

## Integration with AgentCorePipeline

The `AgentCorePipeline` construct has built-in support for monorepo mode. When using `monorepoConfig`, the pipeline will:

- Use the MonorepoSource's repository instead of creating its own
- Disable native CodeCommit triggers (`trigger: NONE`)
- Automatically register itself with the MonorepoSource

See the [AgentCorePipeline README](../agentcore-pipeline/README.md) for more details on monorepo integration.