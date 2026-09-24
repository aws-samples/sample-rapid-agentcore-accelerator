# Changelog

All notable changes to RAPID are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
