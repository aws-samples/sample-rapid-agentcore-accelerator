# Frontend Modes

The `frontendMode` key in [`config.yaml`](../config.yaml) controls whether a Streamlit chat UI is deployed alongside your agents, how it is reachable, and how users authenticate to it.

The shipped default is `none`. It provisions **no network-exposed endpoint** and nothing that bills while idle. Every other value provisions a VPC with a NAT gateway, an Application Load Balancer, and a Fargate task — all three bill by the hour from creation until deletion, whether or not anyone uses the UI. Read [cost and teardown](cost-and-teardown.md) before switching.

---

## Mode comparison

| Mode | Resources provisioned | Bills while idle | Network exposure | User authentication |
|---|---|---|---|---|
| `none` (default) | None | Nothing | No endpoint is created | Not applicable — you reach the agent with your own AWS credentials |
| `internal` | VPC (2 AZs), 1 NAT gateway, internal ALB, Fargate service | NAT gateway, ALB, Fargate task | Internal ALB, reachable only from inside the VPC | **None.** Network reachability is the only boundary |
| `public` | VPC (2 AZs), 1 NAT gateway, internet-facing ALB with HTTPS, ACM certificate, Route 53 alias record, Fargate service, Cognito user pool | NAT gateway, ALB, Fargate task | Public HTTPS endpoint on your domain | Cognito, enforced at the ALB listener |
| `cloudfront` | VPC (2 AZs), 1 NAT gateway, private ALB, Fargate service, CloudFront distribution, Cognito user pool | NAT gateway, ALB, Fargate task, CloudFront | Public HTTPS endpoint via CloudFront; the ALB accepts traffic only from CloudFront's managed prefix list | Cognito — enforced in the Streamlit app without a custom domain, at the ALB listener with one |

The Cognito user pool itself has no hourly charge; it is billed on monthly active users. See the [per-mode cost table](cost-and-teardown.md#per-mode-summary) for the billing basis of each resource and links to the AWS pricing pages.

---

## `none` (default)

```yaml
frontendMode: none
```

No VPC, no load balancer, no Fargate service, no Cognito user pool, no CloudFront distribution. The agents still deploy as AgentCore Runtimes, which are invoked over the AWS API with SigV4 — there is no HTTP endpoint of your own to protect.

Two ways to talk to the agent:

```bash
make chat          # CLI, streaming, uses your AWS credentials
make ui            # Streamlit on http://localhost:8501, against the deployed agents
```

`make ui` reads the runtime ARNs from `.rapid/outputs.json` (written by `make deploy`, machine-local, untracked). To point it at an agent running on your own machine instead, copy `frontend/local/.env.example` to `.env` in the same directory and set `LOCAL_AGENT_URL=http://localhost:8080`.

## `internal`

```yaml
frontendMode: internal
```

An internal-facing ALB in front of the Streamlit app on Fargate (ARM64, 0.25 vCPU, 0.5 GB, one task). The ALB security group admits HTTP on port 80 from the VPC CIDR only, so you reach it over a VPN, a Direct Connect link, a bastion host, or a peered VPC.

**There is no authentication.** The app treats every request as an anonymous internal user. Anyone with a network path to the VPC has full use of your agents. Use this mode only where the network boundary is itself the access control you want.

## `public`

```yaml
frontendMode: public
domainName: agent.example.com
```

An internet-facing ALB with an HTTPS listener, a DNS-validated ACM certificate, and a Route 53 alias record. `domainName` is required. The hosted zone is derived from the last two labels of the domain (`agent.example.com` → `example.com`) and must already exist in your account; set `hostedZoneName` explicitly if your zone has three or more labels.

Authentication is enforced **at the load balancer**. The HTTPS listener carries an `AuthenticateCognitoAction` on `/*`, so an unauthenticated request is redirected to the Cognito hosted UI and never reaches the Streamlit container. Port 80 redirects to 443. The app reads the authenticated identity from the ALB's OIDC headers.

## `cloudfront`

```yaml
frontendMode: cloudfront
# domainName: agent.example.com   # optional
```

A CloudFront distribution in front of a private ALB, connected by a VPC origin. Caching is disabled — Streamlit is fully dynamic — and the viewer protocol policy redirects HTTP to HTTPS. The ALB security group's default rules are replaced with a single rule admitting CloudFront's `com.amazonaws.global.cloudfront.origin-facing` managed prefix list, and the ALB idle timeout is raised to 3600 seconds so Streamlit's WebSocket connection survives.

A Cognito user pool is **always** created in this mode, with or without a custom domain. Where it is enforced differs:

- **Without `domainName`** — you reach the app at the CloudFront distribution URL. The ALB listener stays on HTTP inside the VPC and the Streamlit app performs the OAuth authorization-code flow itself, using a public Cognito client with no secret. The distribution URL is registered as the OAuth callback.
- **With `domainName`** — a certificate and Route 53 alias are created for your domain on the distribution, and authentication moves to the ALB listener as an `AuthenticateCognitoAction`, as in `public` mode. This variant is the least exercised path in the repository: the CloudFront VPC origin is configured HTTP-only on port 80 while the ALB in this variant also installs an HTTP-to-HTTPS redirect, so verify the request path end to end before relying on it. If you have a domain, `public` is the better-trodden route.

> **Security note.** This mode disables Streamlit's XSRF protection and WebSocket compression (`--server.enableXsrfProtection=false --server.enableWebsocketCompression=false`), because proxying through CloudFront produces a hostname mismatch that breaks Streamlit's XSRF validation. Compensating controls: the ALB accepts traffic only from the CloudFront managed prefix list and sits in a private subnet, and Cognito login is required before any agent interaction. For production, add your own XSRF token validation or a WAF, or use `frontendMode: public`, where Streamlit's built-in check keeps working.

---

## Creating a user in the Cognito user pool

`public` and `cloudfront` both create a user pool with self sign-up **disabled**, so nobody can register themselves. You create each user as an administrator after the deploy finishes. The pool's password policy requires at least 8 characters including an uppercase letter, a lowercase letter, and a digit; symbols are not required. MFA is not enabled.

### AWS Console

1. Open the **Amazon Cognito** console in your deployment region and choose **User pools**.
2. Select the pool for your deployment — `{deploymentPrefix}-public-users` or `{deploymentPrefix}-cloudfront-users`. The stack also emits its ID as the `CognitoUserPoolId` output.
3. Open the **Users** tab and choose **Create user**.
4. Set **Invitation message** to *Don't send an invitation*, enter the user's email address as the username, tick **Mark email address as verified**, and set a password.
5. Choose **Create user**. The user is created in `FORCE_CHANGE_PASSWORD` state and will be asked to set a new password at first sign-in.
6. Open the `FrontendUrl` stack output and sign in. The `CognitoHostedUiUrl` output gives the hosted UI directly.

### AWS CLI

Set the stack name and region first. The stack is named `AgentCore-{deploymentPrefix}` — with the shipped `deploymentPrefix: rapid-v1`, that is `AgentCore-rapid-v1`.

```bash
STACK_NAME="AgentCore-rapid-v1"
REGION="us-west-2"
USER_EMAIL="you@example.com"
TEMP_PASSWORD="ChangeMe123"
```

Discover the user pool ID from the stack outputs:

```bash
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`CognitoUserPoolId`].OutputValue' \
  --output text)
```

Create the user, suppressing the invitation email:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USER_EMAIL" \
  --user-attributes Name=email,Value="$USER_EMAIL" Name=email_verified,Value=true \
  --temporary-password "$TEMP_PASSWORD" \
  --message-action SUPPRESS \
  --region "$REGION"
```

Make the password permanent, which skips the forced change at first sign-in:

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USER_EMAIL" \
  --password "$TEMP_PASSWORD" \
  --permanent \
  --region "$REGION"
```

Retrieve the URL to sign in to:

```bash
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`FrontendUrl`].OutputValue' \
  --output text
```

Use a password you are willing to type into a sample deployment, and treat these accounts as disposable. Access and ID tokens are valid for one hour; refresh tokens for 30 days.

---

## Multi-agent frontend

When `config.yaml` declares more than one agent, the stack injects an `AGENT_REGISTRY` environment variable — a JSON map of agent name to runtime ARN — and the Streamlit UI offers an agent selector. With a single agent it injects `AGENTCORE_RUNTIME_ARN` instead. This applies to every non-`none` mode and to `make ui`.

---

## Related reading

- [Cost and teardown](cost-and-teardown.md) — what each mode bills, and what survives `make destroy`
- [Configuration reference](configuration.md) — every `config.yaml` key, its default, and its effect
- [Application Load Balancer Cognito authentication](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-authenticate-users.html)
- [Amazon Cognito user pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools.html)
- [CloudFront VPC origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)
