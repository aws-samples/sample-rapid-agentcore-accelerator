# Cost and Teardown

What RAPID provisions in your AWS account, which of those resources bill while nobody is using them, and what is left behind after teardown.

This page names services and links to their official AWS pricing pages. It states no prices — rates vary by region and change over time, so the pricing page is the only correct source.

---

## The short version

- The shipped default (`frontendMode: none`, `deploymentMode: local`) provisions **no resource that bills continuously**. Costs are driven by what you actually invoke, plus a small amount of storage.
- Every non-`none` `frontendMode` provisions **at least three resources that bill by the hour whether or not anyone uses them**: a NAT gateway, an Application Load Balancer, and a Fargate task. `cloudfront` adds a CloudFront distribution.
- Bedrock model invocations are billed separately from all of the above.
- `make destroy` removes the CloudFormation stack. It does not remove everything — see [Teardown](#teardown).

---

## Resources that bill continuously

These four resources bill on an hourly or per-hour-plus-data basis from the moment they exist until you delete them. Idle traffic does not reduce the charge.

| Resource | Provisioned by `frontendMode` | Billing basis | Pricing |
|---|---|---|---|
| NAT gateway (1 per deployment) | `internal`, `public`, `cloudfront` | Per hour, plus per GB processed | [Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/) |
| Application Load Balancer | `internal`, `public`, `cloudfront` | Per hour, plus capacity units | [Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) |
| Fargate task (Streamlit UI, 0.25 vCPU / 0.5 GB, `desiredCount: 1`) | `internal`, `public`, `cloudfront` | Per vCPU-second and GB-second while running | [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/) |
| CloudFront distribution | `cloudfront` | Per request and per GB transferred; no hourly floor, but the distribution stays billable-on-use indefinitely | [Amazon CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/) |

### Per-mode summary

| `frontendMode` | Resources provisioned | Bills while idle |
|---|---|---|
| `none` (default) | None. No VPC, no load balancer, no Fargate service, no Cognito user pool, no CloudFront distribution. | Nothing |
| `internal` | VPC, 1 NAT gateway, internal ALB, Fargate service | NAT gateway, ALB, Fargate task |
| `public` | VPC, 1 NAT gateway, public ALB with HTTPS, Fargate service, Cognito user pool, Route 53 alias record, ACM certificate | NAT gateway, ALB, Fargate task |
| `cloudfront` | VPC, 1 NAT gateway, private ALB, Fargate service, CloudFront distribution, Cognito user pool | NAT gateway, ALB, Fargate task, CloudFront |

`none` is the shipped default in [`config.yaml`](../config.yaml). You interact with the agent through `make chat`, or run the Streamlit UI on your own machine with `make ui` — neither provisions any of the above. See [`docs/frontend.md`](frontend.md) for what each mode gives you and how it is authenticated.

The Cognito user pool (`public` and `cloudfront`) has no hourly charge; it is billed on monthly active users. The ACM public certificate is free. The Route 53 hosted zone is looked up, not created — you are already paying for it if you set `domainName`. See [Amazon Cognito pricing](https://aws.amazon.com/cognito/pricing/) and [Amazon Route 53 pricing](https://aws.amazon.com/route53/pricing/).

---

## Resources that bill on use or on storage

The default deployment provisions these regardless of `frontendMode`.

| Resource | Billing basis | Pricing |
|---|---|---|
| AgentCore Runtime, one per agent and per MCP server | Per-second CPU and memory consumption during a session; no charge for an idle runtime with no sessions | [Bedrock AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/) |
| AgentCore Memory, one per agent | Stored events and memory-extraction activity | [Bedrock AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/) |
| Bedrock model invocations (agent reasoning, embeddings, memory extraction) | Per input and output token | [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) |
| S3 buckets — knowledge base documents, supplemental data, access logs | Storage and requests | [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/) |
| S3 Vectors bucket and index backing each knowledge base | Vector storage and queries | [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/) |
| ECR repositories for agent and MCP container images | Storage per GB-month | [Amazon ECR pricing](https://aws.amazon.com/ecr/pricing/) |
| CloudWatch Logs from runtimes and, in non-`none` modes, the Fargate task | Ingestion, storage, and queries | [Amazon CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/) |

**Bedrock model usage is billed separately from the infrastructure this stack provisions.** Tearing the stack down stops nothing you have already spent on tokens, and a stack that is deployed but never invoked incurs no model charges at all. Model cost is a function of your traffic and your chosen `modelId`, not of the deployment.

---

## CI/CD costs (opt-in)

`make enable-cicd` switches `deploymentMode` to `pipeline` and provisions a CodeCommit repository, one CodePipeline per agent and per MCP server, one for the infrastructure, and the CodeBuild projects behind them. None of these bills hourly; CodePipeline bills per active pipeline per month and CodeBuild bills per build minute.

- [AWS CodePipeline pricing](https://aws.amazon.com/codepipeline/pricing/)
- [AWS CodeBuild pricing](https://aws.amazon.com/codebuild/pricing/)
- [AWS CodeCommit pricing](https://aws.amazon.com/codecommit/pricing/)

---

## Teardown

```bash
make destroy
```

This runs `npx cdk destroy --all --force` against the deployed stack. Most resources are created with `RemovalPolicy.DESTROY` and S3 buckets with `autoDeleteObjects`, so buckets, ECR repositories, the VPC, the load balancer, the Fargate service, the CloudFront distribution, and the Cognito user pool are removed with the stack.

Confirm the account is clean afterwards rather than assuming it: check the CloudFormation console for the stack, then the resources listed below.

### What teardown leaves behind

> **Pending verification.** The list below is derived from the removal policies in the CDK constructs and from the warnings `make destroy` already prints. It has **not yet been confirmed against an observed `make destroy` run**, and will be corrected and completed once it has been. Treat it as a checklist to verify, not as a guarantee.

| Resource | Why it survives | Removal step | Cost after teardown |
|---|---|---|---|
| AgentCore Runtimes (one per agent, one per MCP server) | Reported by `make destroy` as possibly needing manual cleanup | Bedrock AgentCore console → Runtimes → delete, or `aws bedrock-agentcore-control delete-agent-runtime` | None while no session runs. A surviving runtime with no traffic incurs no compute charge |
| AgentCore Memory stores (one per agent) | Reported by `make destroy` as possibly needing manual cleanup | Bedrock AgentCore console → Memory → delete, or `aws bedrock-agentcore-control delete-memory` | Yes — stored events are billed until deleted |
| CodeCommit repository (`pipeline` mode only) | Created with the CDK default retain policy so the source is not destroyed with the stack | CodeCommit console → delete repository, or `aws codecommit delete-repository` | Yes — repository storage above the free allowance |
| CloudWatch log groups for the runtimes and the Fargate task | Service-created outside the stack, with no expiry set | `aws logs delete-log-group`, or set a retention policy instead of deleting | Yes — log storage until deleted or expired |
| CDK bootstrap staging bucket and container-asset ECR repository (`cdk-*-assets-*`, `cdk-*-container-assets-*`) | Created by `cdk bootstrap`, not by this stack, so `cdk destroy` never touches them. They hold the container images built during deploy | Empty the bucket and the repository. Delete them only if no other CDK app uses the account | Yes — S3 and ECR storage for the retained assets |
| `.rapid/outputs.json` | Local file written by `make deploy`; machine-local and untracked | Delete the file | None |

---

## Related reading

- [`docs/configuration.md`](configuration.md) — every `config.yaml` key, its default, and its effect
- [`docs/frontend.md`](frontend.md) — what each `frontendMode` provisions and how it is authenticated
- [AWS Pricing Calculator](https://calculator.aws/) — model a deployment before you create it
