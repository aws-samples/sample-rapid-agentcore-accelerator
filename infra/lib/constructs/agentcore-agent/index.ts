// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';

/**
 * Network mode for the AgentCore Runtime
 */
export enum NetworkMode {
  /**
   * Use public endpoint (no VPC required, simpler setup)
   */
  PUBLIC = 'PUBLIC',

  /**
   * Use VPC mode (requires VPC with private subnets)
   */
  VPC = 'VPC',
}

/**
 * Authentication mode for the AgentCore Runtime
 */
export enum AuthMode {
  /**
   * Use IAM authentication (default)
   */
  IAM = 'IAM',

  /**
   * Use Cognito User Pool authentication (OAuth)
   */
  COGNITO = 'COGNITO',
}

/**
 * Cognito authentication configuration for the AgentCore Runtime
 */
export interface CognitoAuthConfig {
  /**
   * The Cognito User Pool for authentication
   */
  readonly userPool: cognito.IUserPool;

  /**
   * The Cognito User Pool Clients
   */
  readonly userPoolClients: cognito.IUserPoolClient[];

  /**
   * Optional array of allowed audiences
   * @default - No audience restriction
   */
  readonly allowedAudience?: string[];
}

/**
 * VPC configuration for the runtime when using VPC network mode
 */
export interface VpcConfig {
  /**
   * The VPC to deploy the runtime into
   */
  readonly vpc: ec2.IVpc;

  /**
   * Subnet selection for the runtime
   * @default - Private subnets with egress
   */
  readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * Additional security groups for the runtime
   * @default - Only the auto-created security group
   */
  readonly securityGroups?: ec2.ISecurityGroup[];
}

/**
 * ECR configuration for the agent runtime.
 * Use this as an alternative to agentAssetPath for pre-built images from CI/CD pipelines.
 */
export interface EcrConfig {
  /**
   * The ECR repository containing the agent image
   */
  readonly repository: ecr.IRepository;

  /**
   * Image tag to use
   * @default 'latest'
   */
  readonly imageTag?: string;
}

export interface AgentCoreAgentProps {
  /**
   * Name for the agent runtime
   */
  readonly runtimeName: string;

  /**
   * Bedrock model ID used by this agent (e.g. 'global.anthropic.claude-haiku-4-5-20251001-v1:0').
   * Used to scope IAM permissions to only the configured model's inference profile.
   * @default - Grants access to all foundation models (less secure)
   */
  readonly modelId?: string;

  /**
   * Path to the agent Docker context (mutually exclusive with ecrConfig)
   * @default - Not specified, must provide ecrConfig instead
   */
  readonly agentAssetPath?: string;

  /**
   * ECR configuration for using pre-built images (mutually exclusive with agentAssetPath)
   * @default - Not specified, must provide agentAssetPath instead
   */
  readonly ecrConfig?: EcrConfig;

  /**
   * Description for the runtime
   * @default - No description
   */
  readonly description?: string;

  /**
   * Network mode for the runtime
   * @default NetworkMode.PUBLIC
   */
  readonly networkMode?: NetworkMode;

  /**
   * VPC configuration (required when networkMode is VPC)
   */
  readonly vpcConfig?: VpcConfig;

  /**
   * Authentication mode for the runtime
   * @default AuthMode.IAM
   */
  readonly authMode?: AuthMode;

  /**
   * Cognito authentication configuration (required when authMode is COGNITO)
   */
  readonly cognitoAuth?: CognitoAuthConfig;

  /**
   * Whether to create a Memory resource for the runtime
   * @default true
   */
  readonly enableMemory?: boolean;

  /**
   * Memory name (only used when enableMemory is true)
   * @default '{runtimeName}_memory'
   */
  readonly memoryName?: string;

  /**
   * Memory expiration in days (only used when enableMemory is true)
   * @default 90
   */
  readonly memoryExpirationDays?: number;

  /**
   * Additional environment variables for the runtime
   */
  readonly environmentVariables?: Record<string, string>;
}

export class AgentCoreAgent extends Construct {
  public readonly runtime: agentcore.Runtime;
  public readonly memory: agentcore.Memory | undefined;
  public readonly securityGroup: ec2.SecurityGroup | undefined;
  public readonly networkMode: NetworkMode;
  public readonly authMode: AuthMode;
  public readonly memoryEnabled: boolean;
  /** The ARN of the execution role attached to the AgentCore Runtime. */
  public readonly runtimeRoleArn: string;

  constructor(scope: Construct, id: string, props: AgentCoreAgentProps) {
    super(scope, id);

    // Validate deployment method - exactly one of agentAssetPath or ecrConfig must be provided
    if (props.agentAssetPath && props.ecrConfig) {
      throw new Error('Cannot specify both agentAssetPath and ecrConfig. Choose one deployment method.');
    }
    if (!props.agentAssetPath && !props.ecrConfig) {
      throw new Error('Must specify either agentAssetPath or ecrConfig for agent deployment.');
    }

    // Determine network mode
    this.networkMode = props.networkMode ?? (props.vpcConfig ? NetworkMode.VPC : NetworkMode.PUBLIC);

    // Validate VPC config when VPC mode is explicitly requested
    if (this.networkMode === NetworkMode.VPC && !props.vpcConfig) {
      throw new Error('vpcConfig is required when networkMode is VPC');
    }

    // Determine auth mode
    this.authMode = props.authMode ?? AuthMode.IAM;

    // Validate Cognito config when Cognito auth is requested
    if (this.authMode === AuthMode.COGNITO && !props.cognitoAuth) {
      throw new Error('cognitoAuth is required when authMode is COGNITO');
    }

    // Determine if memory should be created
    this.memoryEnabled = props.enableMemory !== false;

    // Create Memory with semantic strategy (if enabled)
    if (this.memoryEnabled) {
      this.memory = new agentcore.Memory(this, 'Memory', {
        memoryName: props.memoryName ?? `${props.runtimeName}_memory`,
        description: `Memory for ${props.runtimeName}`,
        expirationDuration: cdk.Duration.days(props.memoryExpirationDays ?? 90),
        memoryStrategies: [
          agentcore.MemoryStrategy.usingSummarization({
            strategyName: 'SessionSummarizer',
            namespaces: ['/summaries/{actorId}/{sessionId}']
          }),
          agentcore.MemoryStrategy.usingUserPreference({
            strategyName: 'UserPreferenceLearner',
            namespaces: ['/preferences/{actorId}']
          })
        ],
      });
    }

    // Build network configuration
    const { networkConfig, securityGroup } = this.buildNetworkConfig(props);
    this.securityGroup = securityGroup;

    // Build environment variables
    const envVars: Record<string, string> = {
      AWS_DEFAULT_REGION: cdk.Aws.REGION,
      ...props.environmentVariables,
    };
    if (this.memory) {
      // Presence of MEMORY_ID signals to the agent that memory is enabled
      envVars.MEMORY_ID = this.memory.memoryId;
    }

    // Create Runtime
    let artifact: agentcore.AgentRuntimeArtifact;
    if (props.ecrConfig) {
      // Use ECR-based artifact
      const imageTag = props.ecrConfig.imageTag ?? 'latest';
      artifact = agentcore.AgentRuntimeArtifact.fromEcrRepository(props.ecrConfig.repository, imageTag);
    } else {
      // Use asset-based artifact (backward compatibility).
      // AgentCore Runtime requires ARM64, so force the platform here. On a
      // non-ARM host this is a cross-arch build that also needs QEMU emulation
      // (see GETTING_STARTED — register with `docker run --privileged --rm
      // tonistiigi/binfmt --install arm64` before `cdk deploy`).
      artifact = agentcore.AgentRuntimeArtifact.fromAsset(props.agentAssetPath!, {
        platform: Platform.LINUX_ARM64,
      });
    }

    // Build authorizer configuration
    const authorizerConfig = this.buildAuthorizerConfig(props);

    this.runtime = new agentcore.Runtime(this, 'Runtime', {
      runtimeName: props.runtimeName,
      agentRuntimeArtifact: artifact,
      description: props.description,
      networkConfiguration: networkConfig,
      authorizerConfiguration: authorizerConfig,
      environmentVariables: envVars,
    });

    // Capture the execution role ARN for downstream use (e.g. scoped iam:PassRole in CI/CD)
    this.runtimeRoleArn = (this.runtime.grantPrincipal as iam.IRole).roleArn;

    // Grant Bedrock model invocation (scoped to the configured model when provided).
    // Supports all three Bedrock model id shapes so users can freely switch between them:
    //   - Global inference profile         global.<model>
    //   - Geographic cross-Region profile  us. | eu. | apac. | us-gov. <model>
    //   - Direct foundation model          <provider>.<model>
    const bedrockResources: string[] = [];
    if (props.modelId) {
      // Known global/geographic inference-profile prefixes, longest first so
      // 'us-gov' is matched before 'us'. This covers every Bedrock inference-profile
      // geography available today — extend it if AWS introduces a new one.
      const profilePrefix = /^(global|us-gov|us|eu|apac)\./;

      // Underlying foundation model. The '*' region segment intentionally covers the
      // source Region, every destination Region of a cross-Region profile, and the
      // region-less global FM ARN — so this single ARN is correct for all profile types.
      const foundationModelId = props.modelId.replace(profilePrefix, '');
      bedrockResources.push(`arn:aws:bedrock:*::foundation-model/${foundationModelId}`);

      // Inference-profile resource. Only meaningful for profile-prefixed ids; for a
      // direct foundation-model id it is omitted (the ARN would never match anyway).
      if (profilePrefix.test(props.modelId)) {
        bedrockResources.push(
          `arn:aws:bedrock:*:${cdk.Aws.ACCOUNT_ID}:inference-profile/${props.modelId}`,
        );
      }
    } else {
      throw new Error(
        'modelId is required for the AgentCoreAgent construct. ' +
        'Provide a Bedrock model ID (e.g., "global.anthropic.claude-haiku-4-5-20251001-v1:0") ' +
        'to scope IAM permissions to specific foundation models.'
      );
    }

    this.runtime.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: bedrockResources,
      }),
    );

    // Grant Memory access (if enabled)
    if (this.memory) {
      this.memory.grantRead(this.runtime);
      this.memory.grantWrite(this.runtime);
    }
  }

  private buildNetworkConfig(props: AgentCoreAgentProps): {
    networkConfig: agentcore.RuntimeNetworkConfiguration | undefined;
    securityGroup: ec2.SecurityGroup | undefined;
  } {
    if (this.networkMode === NetworkMode.PUBLIC) {
      return { networkConfig: undefined, securityGroup: undefined };
    }

    // VPC mode
    const vpc = props.vpcConfig!.vpc;
    const vpcSubnets = props.vpcConfig!.vpcSubnets ?? { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };
    const additionalSecurityGroups = props.vpcConfig!.securityGroups ?? [];

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc,
      description: `Security group for ${props.runtimeName}`,
      allowAllOutbound: true,
    });

    const networkConfig = agentcore.RuntimeNetworkConfiguration.usingVpc(this, {
      vpc,
      vpcSubnets,
      securityGroups: [...additionalSecurityGroups, securityGroup],
    });

    return { networkConfig, securityGroup };
  }

  /**
   * The runtime's grant principal for adding permissions
   */
  public get grantPrincipal(): iam.IPrincipal {
    return this.runtime.grantPrincipal;
  }

  private buildAuthorizerConfig(props: AgentCoreAgentProps): agentcore.RuntimeAuthorizerConfiguration {
    if (this.authMode === AuthMode.COGNITO && props.cognitoAuth) {
      return agentcore.RuntimeAuthorizerConfiguration.usingCognito(
        props.cognitoAuth.userPool,
        props.cognitoAuth.userPoolClients,
        props.cognitoAuth.allowedAudience,
      );
    }
    return agentcore.RuntimeAuthorizerConfiguration.usingIAM();
  }
}
