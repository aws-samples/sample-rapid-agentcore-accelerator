# CdkDeployPipeline Construct

An L3 CDK construct that creates a self-mutating CDK infrastructure deployment pipeline. Whenever infrastructure files change in the monorepo, the pipeline runs `npm install` → `npx cdk synth` → `npx cdk deploy --require-approval never --all`, applying changes without a manual deploy step.

## Features

- **Self-Mutating Deployment**: Deploys the same `AgentCoreStack` that defines the pipeline, so infrastructure changes take effect automatically
- **Monorepo Integration**: Registers with `MonorepoSource` for selective triggering — only runs when infrastructure-related files change
- **CodeBuild Deploy Project**: Runs synth and deploy with configurable compute type and timeout
- **ARM64 Build Environment**: Privileged ARM64 compute, so `cdk deploy` can build the frontend's ARM64 Docker image asset natively (an x86 host would need QEMU registered and fails with `exec format error` without it)
- **S3 Artifact Bucket**: Encrypted, block-public-access storage for pipeline artifacts
- **CloudFormation Output**: Emits the pipeline ARN for cross-stack reference

## Usage

### Basic Usage

```typescript
import { MonorepoSource } from '../monorepo-source';
import { CdkDeployPipeline } from '../cdk-deploy-pipeline';

const monorepoSource = new MonorepoSource(this, 'MonorepoSource', { ... });

const infraPipeline = new CdkDeployPipeline(this, 'InfraPipeline', {
  pipelineName: 'agentcore-infra-pipeline',
  description: 'Self-mutating CDK deploy pipeline for AgentCoreStack',
  monorepoConfig: {
    source: monorepoSource,
  },
});
```

### With Custom Trigger Paths

```typescript
const infraPipeline = new CdkDeployPipeline(this, 'InfraPipeline', {
  pipelineName: 'agentcore-infra-pipeline',
  monorepoConfig: {
    source: monorepoSource,
    triggerPaths: ['infra/**', 'package.json', 'cdk.json', 'tsconfig.json'],
  },
});
```

### With Custom Compute and Timeout

```typescript
import * as codebuild from 'aws-cdk-lib/aws-codebuild';

const infraPipeline = new CdkDeployPipeline(this, 'InfraPipeline', {
  pipelineName: 'agentcore-infra-pipeline',
  monorepoConfig: { source: monorepoSource },
  computeType: codebuild.ComputeType.LARGE,
  timeoutMinutes: 60,
});
```

The build environment is `ARM_CONTAINER`, which accepts `SMALL`, `LARGE`, `XLARGE`, and `X2_LARGE`. `MEDIUM` is rejected at deploy time.

### Wiring into AgentCoreStack

```typescript
import { CdkDeployPipeline } from '../constructs/cdk-deploy-pipeline';

// Inside AgentCoreStack, within the pipeline-mode block:
if (config.deploymentMode === 'pipeline') {
  this.infraPipeline = new CdkDeployPipeline(this, 'InfraPipeline', {
    pipelineName: 'agentcore-infra-pipeline',
    description: 'Self-mutating pipeline for CDK infrastructure',
    monorepoConfig: {
      source: this.monorepoSource!,
      triggerPaths: ['infra/**', 'package.json', 'cdk.json', 'tsconfig.json'],
    },
  });
}
```

## Props

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `pipelineName` | `string` | (required) | Name for the pipeline and related resources |
| `monorepoConfig` | `CdkDeployMonorepoConfig` | (required) | Monorepo integration configuration |
| `monorepoConfig.source` | `MonorepoSource` | (required) | The `MonorepoSource` construct to register with |
| `monorepoConfig.triggerPaths` | `string[]` | see below | Glob patterns that trigger this pipeline |
| `timeoutMinutes` | `number` | `30` | Build timeout for the synth + deploy step |
| `computeType` | `codebuild.ComputeType` | `SMALL` | CodeBuild compute type — ARM64 sizes only (`SMALL`, `LARGE`, `XLARGE`, `X2_LARGE`) |
| `description` | `string` | — | Human-readable description for the pipeline |

**Default trigger paths** (used when `monorepoConfig.triggerPaths` is not provided):

```text
infra/**
config.yaml
```

## Outputs

The construct creates the following CloudFormation output on the enclosing stack:

| Output name | Value | Description |
|-------------|-------|-------------|
| `{id}PipelineArn` | `string` | ARN of the CodePipeline workflow |

For example, if the construct is instantiated with id `InfraPipeline`, the output is named `InfraPipelineArn`.

## How It Works

1. On creation, the construct registers itself with `MonorepoSource` using the provided `triggerPaths`.
2. When a commit lands on the monitored branch, `MonorepoSource` checks which files changed and starts this pipeline only if a file matches one of the trigger patterns.
3. The pipeline's source stage pulls the full repository from CodeCommit (native CodeCommit triggers are disabled; the `MonorepoSource` Lambda controls triggering).
4. The deploy stage runs a CodeBuild project on privileged ARM64 compute that:
   - Installs CDK dependencies (`cd infra && npm install`)
   - Synthesizes the stack (`npx cdk synth`)
   - Deploys all stacks (`npx cdk deploy --require-approval never --all`), which also builds and publishes any Docker image asset the stack still declares — in `pipeline` mode that is the frontend image, since agent and MCP images come from ECR
5. Because the pipeline deploys the same `AgentCoreStack` that defines it, any infrastructure change — including a change to the pipeline itself — applies without a manual step.

For more details on the monorepo triggering mechanism, see the [MonorepoSource README](../monorepo-source/README.md).

## Security Considerations

> **Prototype use only.** The permissions described below are intentionally broad to minimise setup friction for rapid prototyping. They are not appropriate for production or shared environments.

### CDK bootstrap role assumption (`sts:AssumeRole`)

The CodeBuild deploy role holds no direct CloudFormation permissions. It is permitted to assume the five CDK bootstrap roles for the default qualifier `hnb659fds`, and every CloudFormation call goes through them:

- `cdk-<qualifier>-deploy-role-<account>-<region>` — orchestrates the CloudFormation deployment
- `cdk-<qualifier>-file-publishing-role-<account>-<region>` — publishes assets to S3/ECR
- `cdk-<qualifier>-image-publishing-role-<account>-<region>` — publishes container images to ECR
- `cdk-<qualifier>-lookup-role-<account>-<region>` — reads context during synth
- `cdk-<qualifier>-cfn-exec-role-<account>-<region>` — the CloudFormation execution role, which by default carries **AdministratorAccess**

Assuming the `cfn-exec-role` effectively grants the pipeline administrator-level permissions over the account. If you bootstrapped with a custom qualifier, update `cdkQualifier` in the construct to match. For non-prototype use, replace the default `cfn-exec-role` with a least-privilege execution role scoped to only the resource types your stack manages.

### Privileged CodeBuild mode

The deploy project runs in privileged mode so `cdk deploy` can build Docker image assets. That grants the build container elevated access to its own Docker daemon; anything that can modify `infra/` or the frontend Dockerfile runs with those privileges.
