// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2_actions from 'aws-cdk-lib/aws-elasticloadbalancingv2-actions';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { CognitoAuth } from '../cognito-auth';

/**
 * Cognito authentication configuration for the Streamlit frontend.
 */
export interface CognitoAuthConfig {
  /**
   * Cognito User Pool for authentication
   */
  readonly userPool: cognito.IUserPool;

  /**
   * Cognito User Pool Client
   */
  readonly userPoolClient: cognito.IUserPoolClient;

  /**
   * Cognito User Pool Domain
   */
  readonly userPoolDomain: cognito.IUserPoolDomain;

  /**
   * The CognitoAuth construct instance.
   * When provided, callback URLs will be automatically configured with the ALB DNS.
   * @default - Callback URLs must be configured manually
   */
  readonly cognitoAuthConstruct?: CognitoAuth;
}

/**
 * Custom domain and TLS configuration for the Streamlit frontend.
 * When provided, creates a Route 53 A record and configures HTTPS.
 */
export interface DomainConfig {
  /**
   * Domain name for the application (e.g., 'app.example.com').
   */
  readonly domainName: string;

  /**
   * Route 53 hosted zone for the domain.
   */
  readonly hostedZone: route53.IHostedZone;

  /**
   * SSL certificate for HTTPS.
   * If not provided, a DNS-validated certificate will be auto-created.
   * @default - Auto-created certificate
   */
  readonly certificate?: certificatemanager.ICertificate;
}

export interface StreamlitFrontendProps {
  /**
   * VPC to deploy the Fargate service in
   */
  readonly vpc: ec2.IVpc;

  /**
   * Cognito authentication configuration.
   * When provided, ALB will require Cognito login.
   * @default - No authentication (use for internal deployments)
   */
  readonly cognito?: CognitoAuthConfig;

  /**
   * Custom domain and TLS configuration.
   * When provided, creates Route 53 A record and configures HTTPS.
   * Required for public ALBs.
   * @default - No custom domain (only valid for internal ALBs)
   */
  readonly domain?: DomainConfig;

  /**
   * AgentCore Runtime ARN to connect to
   */
  readonly agentRuntimeArn: string;

  /**
   * Path to the frontend Docker context
   */
  readonly dockerContextPath: string;

  /**
   * Security group for the AgentCore Runtime (to allow ingress from Fargate)
   * @default - No ingress rule added
   */
  readonly agentCoreSecurityGroup?: ec2.ISecurityGroup;

  /**
   * Whether to make the ALB internet-facing (public) or internal-facing (private).
   * 
   * **Note:** Public ALBs require domain configuration for HTTPS.
   * 
   * @default true - ALB will be internet-facing (requires domain config)
   */
  readonly publicLoadBalancer?: boolean;

  /**
   * Whether to enable real-time streaming of agent responses.
   * When enabled, the frontend will display agent responses as they are generated.
   * 
   * @default false - Streaming is disabled
   */
  readonly enableStreaming?: boolean;
}

/**
 * Streamlit Frontend Construct
 * 
 * This construct implements AWS security best practices for Streamlit applications
 * following the approved security pattern:
 * 
 * - ALB in public or private subnet with HTTPS listener (when certificate provided)
 * - ECS Fargate tasks in private subnet (no public IP)
 * - Security groups with least-privilege access
 * - Optional HTTPS with certificate management
 * - HTTP to HTTPS redirection when certificate is available
 * - Configurable ALB placement (internet-facing or internal)
 * - Optional Cognito authentication
 * 
 * ## Authentication Model
 * 
 * The frontend uses a simplified auth model with two independent concerns:
 * 1. **Agent Target**: Where is the agent? (LOCAL_AGENT_URL or AGENTCORE_RUNTIME_ARN)
 * 2. **Outbound Auth**: How does the frontend authenticate to the agent?
 *    - NONE: Direct HTTP to local agent (LOCAL_AGENT_URL set)
 *    - OAuth: Uses Cognito access token (COGNITO_AUTH_ENABLED=true + user token)
 *    - IAM: Uses AWS credentials (default when using AGENTCORE_RUNTIME_ARN)
 * 
 * The construct only controls inbound auth (ALB → Streamlit) via Cognito.
 * Outbound auth (Streamlit → Agent) is determined by environment variables at runtime.
 * 
 * Supported configurations:
 * 1. Internal ALB without Cognito - for VPC-only access
 * 2. Public ALB with Cognito - for internet-facing with authentication
 * 3. Internal ALB with Cognito - requires additional DNS configuration
 * 
 * For MVP/development: Can run with HTTP only (certificate optional)
 * For production: Provide ACM certificate for HTTPS enforcement
 */
export class StreamlitFrontend extends Construct {
  public readonly service: ecs_patterns.ApplicationLoadBalancedFargateService;
  public readonly cluster: ecs.Cluster;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly repository: ecr.Repository;
  public readonly loadBalancerUrl: string;
  public readonly certificate?: certificatemanager.ICertificate;
  public readonly cognitoEnabled: boolean;

  constructor(scope: Construct, id: string, props: StreamlitFrontendProps) {
    super(scope, id);

    // Determine if this is a public-facing ALB (default is true)
    const isPublic = props.publicLoadBalancer !== false;

    // Determine if Cognito authentication is enabled
    this.cognitoEnabled = !!props.cognito;

    // Determine if we have domain configuration
    const hasDomainConfig = !!props.domain;

    // Validate: Public ALB requires domain config for HTTPS
    if (isPublic && !hasDomainConfig) {
      throw new Error(
        'Public-facing ALB requires HTTPS. Please provide domain configuration. ' +
        'For internal-only access without HTTPS, set publicLoadBalancer: false.'
      );
    }

    // Warn if using internal ALB with Cognito (requires additional configuration)
    if (this.cognitoEnabled && !isPublic) {
      cdk.Annotations.of(this).addWarningV2(
        'StreamlitFrontend:InternalAlbWithCognito',
        'Using internal ALB with Cognito authentication requires additional DNS configuration. ' +
        'Cognito hosted UI cannot resolve internal ALB DNS names. Consider using a custom domain ' +
        'with Route 53 private hosted zone, or use a public ALB with security group restrictions.'
      );
    }

    // Use provided certificate or let the pattern auto-create one
    this.certificate = props.domain?.certificate;

    // ECR repository for Streamlit frontend image
    this.repository = new ecr.Repository(this, 'Repository', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules: [
        {
          description: 'Keep only last 10 images',
          maxImageCount: 10,
          rulePriority: 1,
        },
      ],
    });

    // Security group for Fargate service (private subnet)
    this.securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for Fargate Streamlit service in private subnet',
      allowAllOutbound: true,
    });

    // Allow Fargate to communicate with AgentCore Runtime over HTTPS
    if (props.agentCoreSecurityGroup) {
      props.agentCoreSecurityGroup.addIngressRule(
        this.securityGroup,
        ec2.Port.tcp(443),
        'Allow HTTPS from Streamlit Fargate to AgentCore',
      );
    }

    // ECS Cluster
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: props.vpc,
    });

    // Security group for ALB - Follows approved security pattern
    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: props.vpc,
      description: `Security group for Streamlit ALB - ${props.publicLoadBalancer !== false ? 'Internet-facing' : 'Internal'}`,
      allowAllOutbound: true,
    });

    // Configure ingress rules based on ALB type
    if (props.publicLoadBalancer !== false) {
      // For internet-facing ALB (default), allow traffic from internet
      if (this.certificate) {
        albSecurityGroup.addIngressRule(
          ec2.Peer.anyIpv4(),
          ec2.Port.tcp(443),
          'Allow HTTPS traffic from internet',
        );
      }

      albSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(80),
        this.certificate ? 'Allow HTTP traffic for HTTPS redirect' : 'Allow HTTP traffic from internet',
      );
    } else {
      // For internal ALB, allow traffic from VPC CIDR
      if (this.certificate) {
        albSecurityGroup.addIngressRule(
          ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
          ec2.Port.tcp(443),
          'Allow HTTPS traffic from VPC',
        );
      }
      
      albSecurityGroup.addIngressRule(
        ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
        ec2.Port.tcp(80),
        this.certificate ? 'Allow HTTP traffic from VPC for HTTPS redirect' : 'Allow HTTP traffic from VPC',
      );
    }

    // Fargate service with Application Load Balancer (no built-in auth)
    this.service = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster: this.cluster,
      taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }, // Private subnet as required
      assignPublicIp: false, // No public IP as required
      publicLoadBalancer: props.publicLoadBalancer !== false, // Default to true (internet-facing)
      // Use HTTPS if domain config exists, otherwise HTTP
      protocol: hasDomainConfig ? elbv2.ApplicationProtocol.HTTPS : elbv2.ApplicationProtocol.HTTP,
      certificate: this.certificate,
      // Pass domain config - pattern construct auto-creates DNS record and cert if needed
      domainName: props.domain?.domainName,
      domainZone: props.domain?.hostedZone,
      redirectHTTP: false, // We'll handle this manually with Cognito auth
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset(props.dockerContextPath, {
          platform: ecr_assets.Platform.LINUX_ARM64
        }),
        containerPort: 8501,
        environment: {
          AGENTCORE_RUNTIME_ARN: props.agentRuntimeArn,
          AWS_REGION: cdk.Aws.REGION,
          // Inbound auth: Controls whether ALB requires Cognito login
          COGNITO_AUTH_ENABLED: this.cognitoEnabled ? 'true' : 'false',
          // Streaming: Controls real-time response display
          STREAMING_ENABLED: props.enableStreaming ? 'true' : 'false',
          // Note: Outbound auth (Streamlit → Agent) is determined at runtime:
          // - If LOCAL_AGENT_URL is set: Direct HTTP (no auth)
          // - If COGNITO_AUTH_ENABLED=true + user has token: OAuth
          // - Otherwise: IAM credentials (default for AgentCore Runtime)
        },
      },
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 1,
      securityGroups: [this.securityGroup],
    });

    // Configure sticky sessions for Streamlit websockets
    this.service.targetGroup.setAttribute('stickiness.enabled', 'true');
    this.service.targetGroup.setAttribute('stickiness.type', 'lb_cookie');
    this.service.targetGroup.setAttribute('stickiness.lb_cookie.duration_seconds', '86400');

    // Configure health check
    this.service.targetGroup.configureHealthCheck({
      path: '/_stcore/health',
      healthyHttpCodes: '200',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(10),
    });

    // Add ALB security group
    this.service.loadBalancer.addSecurityGroup(albSecurityGroup);

    // Allow Fargate tasks to receive traffic from ALB on container port
    this.securityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(8501),
      'Allow traffic from ALB to Fargate',
    );

    // Configure Cognito authentication on the ALB listener (if enabled)
    if (this.cognitoEnabled && props.cognito) {
      const listener = this.service.listener;
      
      // Add Cognito authentication action
      listener.addAction('CognitoAuth', {
        priority: 100,
        conditions: [
          elbv2.ListenerCondition.pathPatterns(['/*']),
        ],
        action: new elbv2_actions.AuthenticateCognitoAction({
          userPool: props.cognito.userPool,
          userPoolClient: props.cognito.userPoolClient,
          userPoolDomain: props.cognito.userPoolDomain,
          next: elbv2.ListenerAction.forward([this.service.targetGroup]),
        }),
      });

      // Automatically configure callback URLs if CognitoAuth construct is provided
      if (props.cognito.cognitoAuthConstruct) {
        // Use custom domain if configured, otherwise fall back to ALB DNS
        const callbackHost = props.domain?.domainName ?? this.service.loadBalancer.loadBalancerDnsName;
        props.cognito.cognitoAuthConstruct.addAlbCallbackUrls(
          callbackHost,
          hasDomainConfig || !!this.certificate,
        );
      }
    }

    // Add HTTP to HTTPS redirect if using HTTPS
    if (hasDomainConfig) {
      // Add HTTP listener for redirect
      const httpListener = this.service.loadBalancer.addListener('HttpListener', {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
      });
      
      httpListener.addAction('HttpsRedirect', {
        action: elbv2.ListenerAction.redirect({
          protocol: 'HTTPS',
          port: '443',
          permanent: true,
        }),
      });
    }

    // Set the appropriate URL - prefer custom domain if configured
    const hostname = props.domain?.domainName ?? this.service.loadBalancer.loadBalancerDnsName;
    this.loadBalancerUrl = hasDomainConfig
      ? `https://${hostname}`
      : `http://${hostname}`;
  }
}
