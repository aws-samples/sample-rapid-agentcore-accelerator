# Changelog

All notable changes to RAPID are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Breaking: knowledge bases are now Amazon Bedrock managed knowledge bases (type `MANAGED`).** Each `knowledgeBases[]` entry in `config.yaml` keeps its meaning (`name`, `sourceDir`) and agents still receive `KNOWLEDGE_BASE_ID`, but the resource behind it is replaced. S3 Vectors is no longer used as a knowledge base store; Amazon Bedrock now owns the datastore, embedding, reranking, parsing, and chunking, and the vector bucket, vector index, and supplemental-data bucket are gone.
  - **The knowledge base ID changes.** Anything that stored or hardcoded the old ID must read the new one from `.rapid/outputs.json` or from the `KNOWLEDGE_BASE_ID` environment variable.
  - **Vectors are not migrated.** The new knowledge base starts empty. `make deploy` or `make ingest-kb` repopulates it from the documents under `knowledge-bases/{name}/`.
  - **Affected usage.** Update any of the following in code you added on top of RAPID:
    - Code that calls `retrieve` with `vectorSearchConfiguration`. A managed knowledge base rejects it with a `ValidationException`; use `managedSearchConfiguration`. The shipped `retrieve_from_knowledge_base` tools are already updated and keep their signature and output format.
    - Code that imports `ParsingStrategy` or `ChunkingStrategy` from the `BedrockKnowledgeBase` construct. Both exports are removed, and `addS3DataSource` no longer accepts parsing or chunking options.
    - Code that passes the `supplementalDataBucket` prop. The prop is removed, along with `embeddingModelId` and `vectorDimension`.
  - **Upgrading an existing deployment.** Updating the stack in place replaces the knowledge base and its data source, and the old resources are deleted after the new ones exist. If the update fails, CloudFormation rolls back to the previous state. The fallback is `make destroy` followed by `make deploy`.
- **`make deploy` now uploads and ingests documents.** After the stack deploys, it runs `scripts/ingest-kb-assets.sh` for every knowledge base, so the knowledge base is populated when the command returns. A failed ingestion makes `make deploy` exit non-zero but leaves the deployed stack in place. With `deploymentMode: pipeline`, the pipeline still deploys the stack only; run `make ingest-kb` to upload and ingest documents.
  - **Opt out with `NO_WAIT=1`.** Set `NO_WAIT=1` to start ingestion jobs without waiting for completion (e.g., `make deploy NO_WAIT=1` or `make ingest-kb KB=support-docs NO_WAIT=1`). In no-wait mode, the script starts each job and exits immediately; job failures after startup are not reported. See [docs/configuration.md](docs/configuration.md) for details.
- **`knowledgeBases` is restricted to seven regions.** When `knowledgeBases` has at least one entry, `region` must be one of `us-east-1`, `us-west-2`, `eu-west-1`, `eu-west-2`, `eu-central-1`, `ap-northeast-1`, or `ap-southeast-2`; the configuration loader raises an error otherwise. Configurations without knowledge bases are unaffected.
- **`aws-cdk-lib` is pinned to 2.262.0** (previously 2.258.0), a version whose `CfnKnowledgeBase` and `CfnDataSource` types include the managed knowledge base properties. Run `npm install` in `infra/` after pulling.

### Fixed

- **`make logs` works again.** `scripts/logs.sh` read a top-level `agentRuntimeArn` that `.rapid/outputs.json` never contains, so it always exited with "agentRuntimeArn is empty". It now takes the agent name like `chat.sh` (`make logs AGENT=it-helpdesk`, defaulting to `customer-support`), reads `agents.<name>.runtimeArn`, and lists the deployed agents when the name is unknown.

## [1.0.0] - 2026-08-20

Initial public release.

### Added

- Apache-2.0 `LICENSE`, `NOTICE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and this changelog at the repository root.

### Changed

- **`agents` and `mcpServers` are now required keys in `config.yaml`.** Previously, omitting either key made the configuration loader fall back to a source directory named `src` sitting directly beneath `agent/` and beneath `mcp/`. This repository has never used that layout — every agent and MCP server lives in its own named subdirectory — so the fallback pointed at a directory that does not exist and the omission surfaced as a confusing failure later in synthesis. The loader now raises an error naming the missing key, the rule that resolves each entry's name to a source directory under `agent/` or `mcp/`, and a minimal valid fragment:

  ```yaml
  agents:
    - name: customer-support
  mcpServers:
    - name: support-tools
  ```

- **Default model changed from `global.anthropic.claude-haiku-4-5-20251001-v1:0` to `global.anthropic.claude-sonnet-5-5`.** This applies to the configuration loader default, the shipped `config.yaml` agents, `make doctor`, and the documentation. Enable access to the new model in your target region, or set `modelId` explicitly to keep the previous one.
- **Default `region` changed from `eu-central-1` to `us-west-2`,** so that the shipped configuration matches the region used in the documented quickstart. Set `region` to whichever region you have Amazon Bedrock model access in.

- **Default `frontendMode` changed from `cloudfront` to `none`.** The previous default provisioned a VPC with a NAT gateway, an Application Load Balancer, a CloudFront distribution, and a Cognito user pool — recurring cost and an authentication setup step that the quickstart did not describe. `none` provisions no network-exposed endpoint and none of those resources. Set `frontendMode` back to `cloudfront` when you want the hosted frontend; see [docs/frontend.md](docs/frontend.md) for what each mode provisions and what it costs while idle.

### Removed

- Three inert keys deleted from `config.yaml`. None was read by `infra/lib/config.ts`, so none had any effect on a deployment:
  - `documentsBucketName` — read only by a script that no Makefile target invoked; that script has been removed. Knowledge-base bucket names come from deploy outputs in `.rapid/outputs.json`.
  - `sagemakerExecutionRoleArn` — consumed only by the `PrototypeDeveloperEnvironment` construct, which the stack never instantiated. The construct has been removed.
  - `createAdminRole` — same construct, same removal. No code path in this repository provisions an `AdministratorAccess` role.

  If you carried a `config.yaml` forward from a pre-release checkout, delete these three keys. Any other value you set is unaffected.

## Development history

<!--
PLACEHOLDER — Requirement 1.10.

The pre-1.0 development history was not published. If the published git history
is squashed or truncated at the release commit, replace this section with a
summary of the development history that the truncation discards, covering at
minimum:

  - The date range of pre-release development and the number of commits squashed.
  - The major milestones in order (initial CDK stack, AgentCore Runtime
    integration, knowledge-base construct, MCP server support, multi-agent
    configuration, frontend modes, CI/CD pipelines, documentation set).
  - The reason the history was truncated.

If the full history is published, replace this section with a note stating that
the complete history is available in the repository and delete the placeholder.
-->

Pre-1.0 development happened in a private repository and its commit history is not published here. If that history is squashed or truncated at the release commit, a summary of what the truncation discards is recorded in this section.
