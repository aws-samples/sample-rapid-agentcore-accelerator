# StreamlitFrontend Construct

An L3 CDK construct for deploying a Streamlit application on AWS Fargate with ALB. Supports optional Cognito authentication and flexible ALB placement (public or internal).

## Supported Configurations

| Configuration | ALB Type | Cognito | HTTPS | Use Case |
|--------------|----------|---------|-------|----------|
| **1. Internal without auth** | Internal | ❌ | Optional | VPC-only access, no authentication needed |
| **2. Public with Cognito** | Public | ✅ | **Required** | Internet-facing with user authentication |
| **3. Internal with Cognito** | Internal | ✅ | Optional | VPC access with authentication (requires additional DNS setup) |

## Security Features

✅ **Private Subnet Deployment** - Fargate tasks run in private subnets with no public IP  
✅ **HTTPS Required for Public** - Public ALBs must use HTTPS  
✅ **Least-Privilege Security Groups** - Restricted ingress rules  
✅ **Optional Cognito Authentication** - Integrated user authentication when needed  

## Architecture

```text
[Client] → ALB (Public/Private) → Fargate (Private Subnet) → AgentCore
              ↓                        ↓
         Optional HTTPS           No Public IP
         Optional Cognito
```

## Usage

### Configuration 1: Internal ALB without Cognito

For VPC-only access without authentication. Ideal for internal tools or when access is controlled at the network level.

```typescript
import { StreamlitFrontend } from './constructs/streamlit-frontend';

const frontend = new StreamlitFrontend(this, 'InternalFrontend', {
  vpc: myVpc,
  agentRuntimeArn: myRuntime.agentRuntimeArn,
  dockerContextPath: path.join(__dirname, '../../frontend/src'),
  publicLoadBalancer: false, // Internal ALB
  // No cognito prop = no authentication
});

// Only accessible from within VPC
console.log(frontend.loadBalancerUrl);
```

### Configuration 2: Public ALB with Cognito

For internet-facing applications with user authentication. **HTTPS certificate is required.**

```typescript
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { CognitoAuth } from './constructs/cognito-auth';

const certificate = acm.Certificate.fromCertificateArn(
  this, 'Certificate', 
  'arn:aws:acm:region:account:certificate/cert-id'
);

// Create Cognito auth (callback URLs will be auto-configured)
const auth = new CognitoAuth(this, 'Auth');

const frontend = new StreamlitFrontend(this, 'PublicFrontend', {
  vpc: myVpc,
  cognito: {
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
    userPoolDomain: auth.userPoolDomain,
    cognitoAuthConstruct: auth, // Pass construct to auto-configure callback URLs
  },
  agentRuntimeArn: myRuntime.agentRuntimeArn,
  dockerContextPath: path.join(__dirname, '../../frontend/src'),
  certificate: certificate,
  agentCoreSecurityGroup: mySecurityGroup,
});

// Accessible from internet via HTTPS, requires Cognito login
console.log(frontend.loadBalancerUrl);
```

### Configuration 3: Internal ALB with Cognito

For VPC access with authentication. **Requires additional DNS configuration.**

```typescript
const auth = new CognitoAuth(this, 'Auth');

const frontend = new StreamlitFrontend(this, 'InternalAuthFrontend', {
  vpc: myVpc,
  cognito: {
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
    userPoolDomain: auth.userPoolDomain,
    cognitoAuthConstruct: auth,
  },
  agentRuntimeArn: myRuntime.agentRuntimeArn,
  dockerContextPath: path.join(__dirname, '../../frontend/src'),
  publicLoadBalancer: false,
});

// ⚠️ CDK will emit a warning - additional DNS configuration required
// See "Internal ALB + Cognito" section below
```

### Production Usage (with HTTPS)

```typescript
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { CognitoAuth } from './constructs/cognito-auth';

const certificate = acm.Certificate.fromCertificateArn(
  this, 'Certificate', 
  'arn:aws:acm:region:account:certificate/cert-id'
);

const auth = new CognitoAuth(this, 'Auth');

// Public ALB always requires certificate
const frontend = new StreamlitFrontend(this, 'Frontend', {
  vpc: myVpc,
  cognito: {
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
    userPoolDomain: auth.userPoolDomain,
    cognitoAuthConstruct: auth,
  },
  agentRuntimeArn: myRuntime.agentRuntimeArn,
  dockerContextPath: path.join(__dirname, '../../frontend/src'),
  certificate: certificate,
});
```

## Props

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `vpc` | IVpc | Yes | - | VPC to deploy the Fargate service in |
| `agentRuntimeArn` | string | Yes | - | AgentCore Runtime ARN to connect to |
| `dockerContextPath` | string | Yes | - | Path to the frontend Docker context |
| `cognito` | CognitoAuthConfig | No | - | Cognito authentication config (enables auth) |
| `publicLoadBalancer` | boolean | No | true | ALB internet-facing (true, requires certificate) or internal (false) |
| `certificate` | ICertificate | **Yes for public** | - | SSL certificate for HTTPS (required for public ALB) |
| `domainName` | string | No | - | Domain name for the application |
| `agentCoreSecurityGroup` | ISecurityGroup | No | - | Security group for AgentCore Runtime |

### CognitoAuthConfig

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `userPool` | IUserPool | Yes | Cognito User Pool |
| `userPoolClient` | IUserPoolClient | Yes | Cognito User Pool Client |
| `userPoolDomain` | IUserPoolDomain | Yes | Cognito User Pool Domain |
| `cognitoAuthConstruct` | CognitoAuth | No | Pass the CognitoAuth construct to auto-configure callback URLs |

## Exposed Properties

| Property | Type | Description |
|----------|------|-------------|
| `service` | ApplicationLoadBalancedFargateService | The Fargate service |
| `cluster` | Cluster | The ECS cluster |
| `securityGroup` | SecurityGroup | Fargate security group |
| `repository` | Repository | ECR repository |
| `loadBalancerUrl` | string | ALB URL (HTTP or HTTPS) |
| `certificate` | ICertificate | SSL certificate (if provided) |
| `cognitoEnabled` | boolean | Whether Cognito authentication is enabled |

## Internal ALB + Cognito (Configuration 3)

When using internal ALB with Cognito, there's a DNS challenge:

**The Problem:**
- Internal ALBs have private DNS names only resolvable within the VPC
- Cognito's hosted UI runs on public AWS infrastructure
- Cognito cannot resolve internal ALB DNS names for OAuth callbacks

**Solutions:**

1. **Custom Domain with Route 53** - Set up a private hosted zone with DNS that Cognito can resolve
2. **Public ALB with Security Group Restrictions** - Keep ALB public but restrict access to specific IPs
3. **VPN/Direct Connect** - Configure network-level DNS resolution

The construct will emit a CDK warning when this configuration is detected.

## Container Specs

- CPU: 256 (0.25 vCPU)
- Memory: 512 MB
- Architecture: ARM64
- Port: 8501 (internal)

## Health Check

- Path: `/_stcore/health`
- Interval: 30 seconds
- Timeout: 10 seconds
