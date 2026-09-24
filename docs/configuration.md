# Configuration Reference

Every setting RAPID reads lives in [`config.yaml`](../config.yaml) at the repository root. Edit it and run `make deploy` — there are no context flags and no environment variables to set.

The loader is [`infra/lib/config.ts`](../infra/lib/config.ts). It reads the file, applies defaults, and validates the result **before any resource is provisioned**, so an invalid value fails synth rather than half-deploying a stack. This page documents exactly the keys that loader reads: nothing in `config.yaml` is inert.

---

## Top-level keys

| Key | Type | Required | Default | Effect |
|---|---|---|---|---|
| `deploymentPrefix` | string | Yes | — | Prefixed onto every resource name so the stack can be deployed more than once in the same account and region. 1–20 characters, lowercase letters, numbers, and hyphens, starting and ending with a letter or number. |
| `region` | string | Yes | — | The AWS region the stack deploys into. Bedrock model access must be enabled in this region. |
| `modelId` | string | No | `global.anthropic.claude-haiku-4-5-20251001-v1:0` | Default Bedrock model for every agent. Ships commented out, so the default applies unless you uncomment it. Any agent can override it. |
| `deploymentMode` | `local` \| `pipeline` | No | `local` | Where container images come from. `local` builds them from source on your machine via CDK Docker assets; `pipeline` pulls them from ECR. `make enable-cicd` switches this for you. |
| `frontendMode` | `none` \| `internal` \| `public` \| `cloudfront` | Yes | — | Which Streamlit frontend to deploy. `none` provisions no VPC, load balancer, CloudFront distribution, or Cognito user pool. Every other value provisions resources that bill while idle. See [`docs/frontend.md`](frontend.md) and [`docs/cost-and-teardown.md`](cost-and-teardown.md). |
| `domainName` | string \| null | Conditional | `null` | Custom domain for the frontend. **Required** when `frontendMode` is `public` — the loader rejects that combination without it, because a public load balancer with no certificate would serve plaintext HTTP. Optional for `cloudfront`, where it replaces the generated CloudFront URL. Ignored by `none` and `internal`. |
| `hostedZoneName` | string \| null | No | derived from `domainName` | The Route 53 hosted zone used for certificate validation and alias records. Derived by taking the last two labels of `domainName` (`agent.example.com` → `example.com`). Set it explicitly when your zone has three or more labels. `null` when `domainName` is unset. |
| `agents` | list of mappings | Yes | — | One [agent entry](#agents) per AgentCore Runtime to deploy. Each entry also gets cross-session Memory, an ECR repository, and — in `pipeline` mode — its own CI/CD pipeline. Must contain at least one entry. |
| `mcpServers` | list of mappings | Yes | — | One [MCP server entry](#mcpservers) per MCP AgentCore Runtime to deploy. Each entry also gets an ECR repository and, in `pipeline` mode, its own pipeline. |
| `knowledgeBases` | list of mappings | No | `[]` | One [knowledge base entry](#knowledgebases) per Bedrock Knowledge Base to create, each with an S3 documents bucket and a vector index. Omit the key entirely if you want no knowledge bases. |

### Required, optional, and gone

`agents` and `mcpServers` are **required**. Earlier versions let you omit them and fell back to a source directory named `src` sitting directly beneath `agent/` and beneath `mcp/`. This repository has never used that layout — every agent and MCP server lives in its own named subdirectory — so the fallback pointed at a directory that does not exist and produced a confusing downstream failure instead of a clear one. Omitting either key now raises an error naming the key and showing a minimal example.

Three keys that older copies of `config.yaml` declared — `documentsBucketName`, `sagemakerExecutionRoleArn`, and `createAdminRole` — **no longer exist**. None of them was ever read by the loader. Knowledge base bucket names are derived as `{deploymentPrefix}-kb-{name}-{account}-{region}` with no override path, and the SageMaker developer-environment construct that was the only consumer of the other two has been removed. If you are migrating an old config file, delete all three.

---

## `agents[]`

| Field | Type | Required | Default | Effect |
|---|---|---|---|---|
| `name` | string | Yes | — | Identifier for the agent. Kebab-case: lowercase letters, numbers, and hyphens, starting with a letter, 1–63 characters. Must be unique across `agents`. Drives the runtime name and the default source directory. |
| `sourceDir` | string | No | `agent/{name}/src` | Path to the agent source, relative to the repository root. Must exist on disk. |
| `modelId` | string | No | top-level `modelId` | Bedrock model for this agent, injected as the `MODEL_ID` environment variable. |
| `knowledgeBase` | string | No | — | Name of an entry in `knowledgeBases`. Injects `KNOWLEDGE_BASE_ID` and grants the agent retrieve access. A name that is not defined is an error. |
| `mcpServers` | list of strings | No | all defined MCP servers | Names of entries in `mcpServers` this agent may invoke. Maximum 10 per agent. The agent is granted invoke permission on exactly these runtimes and no others. A name that is not defined is an error. |

## `mcpServers[]`

| Field | Type | Required | Default | Effect |
|---|---|---|---|---|
| `name` | string | Yes | — | Identifier for the MCP server. Same kebab-case rule as agent names, unique across `mcpServers`. |
| `sourceDir` | string | No | `mcp/{name}/src` | Path to the MCP server source, relative to the repository root. Must exist on disk. |

## `knowledgeBases[]`

| Field | Type | Required | Default | Effect |
|---|---|---|---|---|
| `name` | string | Yes | — | Identifier for the knowledge base. Same kebab-case rule, unique across `knowledgeBases`. Agents reference this value in their `knowledgeBase` field. |
| `sourceDir` | string | No | `knowledge-bases/{name}` | Directory of documents uploaded to the knowledge base bucket on deploy. Must exist on disk. Re-upload later with `make ingest-kb KB={name}`. |

---

## The default model

The loader's default when `modelId` is absent or empty is:

```text
global.anthropic.claude-haiku-4-5-20251001-v1:0
```

Model access must be enabled for that identifier in the region you set, or the first invocation fails. See [`docs/troubleshooting.md`](troubleshooting.md).

---

## What validation catches

The loader raises a descriptive error, before any construct is created, for each of the following:

- A missing or empty `region`, `deploymentPrefix`, or `frontendMode`, or a `deploymentPrefix` that breaks the character rule.
- A `deploymentMode` or `frontendMode` value outside its accepted set — the error lists the accepted values.
- `frontendMode: public` without a `domainName`.
- A missing `agents` or `mcpServers` key, or an `agents` list with zero entries.
- A name that is not kebab-case, or a duplicate name within `agents`, `mcpServers`, or `knowledgeBases`.
- An agent referencing an MCP server or a knowledge base that is not defined, or referencing more than 10 MCP servers.
- A resolved `sourceDir` that does not exist on disk, for any agent, MCP server, or knowledge base.

---

## The shipped configuration

This is the body of [`config.yaml`](../config.yaml) as shipped, reproduced so you can read the comments alongside the table above. The file itself is the source of truth.

```yaml
# Deployment prefix — makes all resource names unique so the stack can be
# deployed multiple times in the same account/region.
# Lowercase letters, numbers, and hyphens. 1-20 characters.
deploymentPrefix: rapid-v1

# AWS region to deploy into. Bedrock model access must be enabled here.
region: us-west-2

# Default Bedrock model ID. Agents inherit this unless they set their own.
# Omit to use the default: global.anthropic.claude-haiku-4-5-20251001-v1:0
# modelId: global.anthropic.claude-haiku-4-5-20251001-v1:0

# Image source. "local" builds Docker images from source on your machine.
# "pipeline" pulls images from ECR, and is set for you by `make enable-cicd`.
deploymentMode: local            # local | pipeline

# Which frontend to deploy. Each non-"none" value provisions resources that
# bill continuously whether or not anyone uses them. See docs/frontend.md.
frontendMode: none               # none | internal | public | cloudfront

# Required when frontendMode is "public". Optional for "cloudfront", where it
# enables a custom domain instead of the CloudFront distribution URL.
domainName:                      # e.g. agent.example.com

# Optional. Overrides the Route 53 hosted zone used for certificate validation
# and alias records. By default this is derived from domainName by taking the
# last two labels (agent.example.com -> example.com).
hostedZoneName:

# Knowledge bases. Each gets an S3 bucket and a Bedrock Knowledge Base.
# Documents in knowledge-bases/{name}/ are uploaded on deploy.
knowledgeBases:
  - name: support-docs           # sourceDir defaults to knowledge-bases/{name}
  - name: it-docs

# Agents. Required. Each entry gets its own AgentCore Runtime, cross-session
# Memory, ECR repository, and (in pipeline mode) CI/CD pipeline.
agents:
  - name: customer-support       # sourceDir defaults to agent/{name}/src
    modelId: global.anthropic.claude-haiku-4-5-20251001-v1:0
    knowledgeBase: support-docs
    mcpServers:
      - support-tools
  - name: it-helpdesk
    modelId: global.anthropic.claude-haiku-4-5-20251001-v1:0
    knowledgeBase: it-docs

# MCP servers. Required. Each entry gets its own AgentCore Runtime, ECR
# repository, and (in pipeline mode) CI/CD pipeline.
mcpServers:
  - name: support-tools          # sourceDir defaults to mcp/{name}/src
```

The frontend-mode comment is abbreviated here; the file carries the full per-mode resource and cost breakdown.

---

## Deployment outputs are not configuration

`make deploy` writes `.rapid/outputs.json`: a machine-readable map of the deployed agents, MCP servers, and knowledge bases with their ARNs and IDs. It is **generated by deployment, machine-local, and not tracked in git**. Read it, script against it, delete it freely — never edit it expecting a deployment to change, and never commit it. Every input to a deployment lives in `config.yaml`.

---

## Related reading

- [`docs/frontend.md`](frontend.md) — what each `frontendMode` provisions and how it is authenticated
- [`docs/cost-and-teardown.md`](cost-and-teardown.md) — which of those resources bill while idle
- [`docs/troubleshooting.md`](troubleshooting.md) — what to check when a deploy or an invocation fails
