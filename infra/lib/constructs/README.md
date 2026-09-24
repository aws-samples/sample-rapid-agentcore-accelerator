# Custom Constructs

Reusable L3 constructs for this project. The constructs below are organized by whether they are wired into the default deployment or available as opt-in additions.

---

## Default constructs (wired into AgentCoreStack)

These constructs are used by the Core Stack in a standard quickstart deployment.

### AgentCoreAgent

Creates an AgentCore agent with Runtime and Memory for AI agent deployments.

See [agentcore-agent/README.md](./agentcore-agent/README.md) for detailed documentation.

```typescript
const agent = new AgentCoreAgent(this, 'Agent', {
  runtimeName: 'my_agent',
  agentAssetPath: path.join(__dirname, '../../../agent/customer-support/src'),
  vpc: myVpc,
});
```

### AgentCoreMCPServer

Deploys a Model Context Protocol (MCP) server to Amazon Bedrock AgentCore Runtime. Supports local asset or ECR image deployment, public or VPC networking, and IAM or Cognito auth.

See [agentcore-mcp-server/README.md](./agentcore-mcp-server/README.md) for detailed documentation.

```typescript
const mcpServer = new AgentCoreMCPServer(this, 'MCPServer', {
  runtimeName: 'my_mcp_server',
  mcpAssetPath: path.join(__dirname, '../../../mcp/support-tools/src'),
});
```

### AgentCorePipeline

Creates a CodePipeline for building and deploying AgentCore agents with support for both standalone and monorepo modes.

See [agentcore-pipeline/README.md](./agentcore-pipeline/README.md) for detailed documentation.

```typescript
const pipeline = new AgentCorePipeline(this, 'Pipeline', {
  pipelineName: 'agent-pipeline',
  ecrRepository: myEcrRepo,
  buildConfig: { sourceDirectory: 'agent/customer-support/src' },
});
```

### BedrockKnowledgeBase

Creates a Bedrock Knowledge Base backed by S3Vectors for RAG applications with advanced parsing and chunking options.

See [bedrock-knowledge-base/README.md](./bedrock-knowledge-base/README.md) for detailed documentation.

```typescript
const kb = new BedrockKnowledgeBase(this, 'DocsKB', {
  knowledgeBaseName: 'my-docs-kb',
});
kb.addS3DataSource({ dataSourceName: 'docs', bucket: myBucket });
```

### MonorepoSource

Creates a monorepo-style CI/CD system with selective pipeline triggering using glob patterns. Automatically triggers only relevant pipelines when specific files change.

See [monorepo-source/README.md](./monorepo-source/README.md) for detailed documentation.

```typescript
const monorepoSource = new MonorepoSource(this, 'MonorepoSource', {
  repositoryConfig: { repositoryName: 'my-monorepo', branch: 'main' },
});
```

### CdkDeployPipeline

> Created alongside `MonorepoSource` when `deploymentMode: pipeline` is set in `config.yaml`. Not created in `direct` mode.

Creates the self-mutating CodePipeline that synthesizes and deploys the infrastructure stack when `infra/**` or `config.yaml` changes.

See [cdk-deploy-pipeline/README.md](./cdk-deploy-pipeline/README.md) for detailed documentation.

```typescript
const infraPipeline = new CdkDeployPipeline(this, 'InfraPipeline', {
  pipelineName: 'my-infra-pipeline',
  description: 'Self-mutating CDK deploy pipeline for infrastructure changes',
});
```

---

## Opt-in constructs (not wired in by default — add when you need them)

These constructs are **not** part of the default deployment. Add them to your stack when your use case requires them.

### StreamlitFrontend

> ⚠️ **Not wired in by default.** Enabled via `frontendMode` (`internal` or `public`) in `config.yaml`.

Deploys a Streamlit app on Fargate with ALB. Add this construct when you need a hosted chat UI for your agent.

See [streamlit-frontend/README.md](./streamlit-frontend/README.md) for detailed documentation.

```typescript
const frontend = new StreamlitFrontend(this, 'Frontend', {
  vpc: myVpc,
  agentRuntimeArn: agent.runtime.agentRuntimeArn,
  dockerContextPath: path.join(__dirname, '../../frontend/src'),
});
```

### CognitoAuth

> ⚠️ **Not wired in by default.** Enabled via `frontendMode: public` in `config.yaml`.

Creates a Cognito User Pool with app client and hosted UI domain for authentication. Add this construct when you need public-facing auth on your frontend.

See [cognito-auth/README.md](./cognito-auth/README.md) for detailed documentation.

```typescript
const auth = new CognitoAuth(this, 'Auth', {
  userPoolName: 'my-app-users',
});
```

### CloudFrontFrontend

> ⚠️ **Not wired in by default.** Enabled via `frontendMode: cloudfront` in `config.yaml`.

Puts a CloudFront distribution in front of a private ALB using a VPC origin, so the load balancer never becomes internet-facing. Add this construct when you want public access to the chat UI without a public ALB.

See [cloudfront-frontend/README.md](./cloudfront-frontend/README.md) for detailed documentation.

```typescript
const cdn = new CloudFrontFrontend(this, 'CloudFrontFrontend', {
  vpc: myVpc,
  alb: frontend.service.loadBalancer,
});
```

### MultimodalProcessingPipeline

> ⚠️ **Not wired in by default.**

Creates an event-driven multimodal processing pipeline using Amazon Bedrock Data Automation (BDA). Add this construct when you need to transform PDFs, DOCX, or images into clean markdown for RAG ingestion.

See [multimodal-processing-pipeline/README.md](./multimodal-processing-pipeline/README.md) for detailed documentation.

```typescript
const pipeline = new MultimodalProcessingPipeline(this, 'DocPipeline', {
  pipelineName: 'my-doc-processor',
});
```

---

## Unclassified constructs

Any construct that appears in this directory but is not listed above has not yet been classified as default-path or opt-in.

> ⚠️ **Default-path status undetermined.** If you add a new construct, place its entry here until it is classified, then move it to the appropriate section above.
