# CloudFrontFrontend Construct

An L3 CDK construct that puts an Amazon CloudFront distribution in front of an **internal** Application Load Balancer using a [CloudFront VPC origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html). The ALB stays private inside the VPC; the public entry point is the CloudFront edge.

Instantiated by `AgentCoreStack` when `config.yaml` sets `frontendMode: cloudfront`. It is not created for any other mode. See [frontend modes](../../../../docs/frontend.md) for what each mode provisions and what it costs.

## Features

- VPC origin to a private ALB, so no internet-facing load balancer is needed
- TLS termination at the CloudFront edge; viewer requests on HTTP are redirected to HTTPS
- Caching disabled — Streamlit is fully dynamic
- All HTTP methods allowed, and all viewer headers except `Host` forwarded to the origin
- Optional custom domain with a DNS-validated ACM certificate and a Route 53 alias record
- `RemovalPolicy.DESTROY` on the distribution, so `make destroy` leaves nothing behind

## Resources Created

- CloudFront Distribution with a single default behaviour
- CloudFront VPC Origin targeting the supplied ALB
- ACM Certificate — only when `domain` is supplied
- Route 53 A record alias — only when `domain` is supplied

## Usage

```typescript
import { CloudFrontFrontend } from './constructs/cloudfront-frontend';

// Without a custom domain — reachable at the distribution URL
const cdn = new CloudFrontFrontend(this, 'CloudFrontFrontend', {
  vpc: myVpc,
  alb: frontend.service.loadBalancer,
});

// With a custom domain
const cdnWithDomain = new CloudFrontFrontend(this, 'CloudFrontFrontend', {
  vpc: myVpc,
  alb: frontend.service.loadBalancer,
  domain: {
    domainName: 'agent.example.com',
    hostedZone: myHostedZone,
  },
});

cdn.distributionUrl; // https://d1234abcd.cloudfront.net
```

## Props

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `vpc` | `ec2.IVpc` | Yes | — | VPC containing the internal ALB |
| `alb` | `elbv2.IApplicationLoadBalancer` | Yes | — | The internal ALB to use as the origin, typically `StreamlitFrontend`'s `service.loadBalancer` |
| `domain` | `CloudFrontFrontendDomainConfig` | No | — | Custom domain configuration. Omit to use the generated distribution domain |

### `CloudFrontFrontendDomainConfig`

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `domainName` | `string` | Yes | Custom domain name, for example `app.example.com` |
| `hostedZone` | `route53.IHostedZone` | Yes | Hosted zone used for the alias record and for certificate DNS validation |

Both props are validated in the constructor: a missing `vpc` or `alb` throws an error naming the prop.

## Exposed Properties

| Property | Type | Description |
|----------|------|-------------|
| `distribution` | `cloudfront.Distribution` | The underlying distribution |
| `distributionId` | `string` | The distribution ID |
| `distributionUrl` | `string` | Full HTTPS URL — the custom domain when `domain` is supplied, otherwise the generated `*.cloudfront.net` domain |

## Distribution Configuration

| Setting | Value | Reason |
|---------|-------|--------|
| Origin protocol policy | `HTTP_ONLY`, port 80 | The origin leg runs inside the VPC over the private VPC origin link |
| Origin keepalive timeout | 30 seconds | Once the Streamlit WebSocket handshake completes inside 30 seconds, CloudFront holds the connection open |
| Viewer protocol policy | `REDIRECT_TO_HTTPS` | Viewers are never served over plain HTTP |
| Allowed methods | `ALLOW_ALL` | Streamlit posts on the same path it reads |
| Cache policy | `CACHING_DISABLED` | Every response is session-specific |
| Origin request policy | `ALL_VIEWER_EXCEPT_HOST_HEADER` | The VPC origin needs the ALB's own `Host` value, not the viewer's |

## Requirements

- The `alb` must be internal. An internet-facing ALB defeats the purpose of the VPC origin and leaves a second, unauthenticated public entry point.
- The ALB security group must admit CloudFront. `AgentCoreStack` does this by replacing the ALB security group's rules with a single rule for the `com.amazonaws.global.cloudfront.origin-facing` managed prefix list.
- When `domain` is supplied, the hosted zone must already exist in the account. The certificate is created in the stack's own region; CloudFront requires `us-east-1`, so a stack in another region needs a cross-region certificate.

## Limitations

This construct is a prototype building block. The following are known and accepted for sample code; each is a production remediation item.

- **`domainName` and the origin protocol disagree.** The VPC origin is pinned to HTTP-only on port 80, while the ALB in the `domainName` variant of `frontendMode: cloudfront` also installs an HTTP-to-HTTPS redirect on port 80. The two configurations are in tension, and this is the least exercised path in the repository. Verify the request path end to end before relying on it. If you have a custom domain, `frontendMode: public` is the better-trodden route. Recorded in [frontend modes](../../../../docs/frontend.md).
- **No access logging.** Neither the distribution nor the origin leg writes access logs, so there is no request-level audit trail. Enable standard or real-time logs to an S3 bucket for production.
- **No web application firewall.** No AWS WAF web ACL is associated, so the distribution has no managed rule protection and no rate limiting. Associate a web ACL before exposing this publicly.
- **Certificate region.** The certificate is created in the stack's region. A stack outside `us-east-1` with a custom domain needs the certificate provisioned in `us-east-1` separately and passed in.
- **No geo restriction and no signed URLs.** The distribution serves every viewer in every country. Authentication is the responsibility of the layer behind it — the Streamlit app's OAuth flow, or the ALB's Cognito action in the `domainName` variant.

Both the access-logging and WAF gaps carry cdk-nag suppressions in [`infra/app.ts`](../../../app.ts), where each suppression states its accepted reason.
