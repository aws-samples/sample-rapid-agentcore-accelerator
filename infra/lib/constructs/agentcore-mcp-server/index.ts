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
 * Network mode for the AgentCore MCP Server Runtime
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
 * Authentication mode for the AgentCore MCP Server Runtime
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
 * Cognito authentication configuration for the AgentCore MCP Server Runtime
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
 * VPC configuration for the MCP server runtime when using VPC network mode
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
 * ECR configuration for the MCP server runtime.
 * Use this as an alternative to mcpAssetPath for pre-built images from CI/CD pipelines.
 */
export interface EcrConfig {
  /**
   * The ECR repository containing the MCP server image
   */
  readonly repository: ecr.IRepository;

  /**
   * Image tag to use
   * @default 'latest'
   */
  readonly imageTag?: string;
}


/**
 * Properties for the AgentCoreMCPServer construct
 */
export interface AgentCoreMCPServerProps {
  /**
   * Name for the MCP server runtime
   */
  readonly runtimeName: string;

  /**
   * Path to the MCP server Docker context (mutually exclusive with ecrConfig)
   * @default - Not specified, must provide ecrConfig instead
   */
  readonly mcpAssetPath?: string;

  /**
   * ECR configuration for using pre-built images (mutually exclusive with mcpAssetPath)
   * @default - Not specified, must provide mcpAssetPath instead
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
   * Additional environment variables for the MCP server runtime
   */
  readonly environmentVariables?: Record<string, string>;
}

/**
 * L3 CDK construct that deploys an MCP server to AgentCore Runtime.
 * 
 * This construct creates an AgentCore Runtime configured with MCP protocol,
 * enabling deployment of Model Context Protocol servers that can expose tools
 * to AI agents.
 * 
 * @example
 * // Deploy MCP server from local Docker context
 * const mcpServer = new AgentCoreMCPServer(this, 'MCPServer', {
 *   runtimeName: 'my-mcp-server',
 *   mcpAssetPath: './mcp/src',
 *   description: 'Customer support MCP tools',
 * });
 * 
 * @example
 * // Deploy MCP server from ECR with VPC and Cognito auth
 * const mcpServer = new AgentCoreMCPServer(this, 'MCPServer', {
 *   runtimeName: 'my-mcp-server',
 *   ecrConfig: {
 *     repository: myEcrRepo,
 *     imageTag: 'v1.0.0',
 *   },
 *   networkMode: NetworkMode.VPC,
 *   vpcConfig: { vpc: myVpc },
 *   authMode: AuthMode.COGNITO,
 *   cognitoAuth: {
 *     userPool: myUserPool,
 *     userPoolClients: [myClient],
 *   },
 * });
 */
export class AgentCoreMCPServer extends Construct {
  /**
   * The AgentCore Runtime resource
   */
  public readonly runtime: agentcore.Runtime;

  /**
   * Security group created for VPC mode (undefined for PUBLIC mode)
   */
  public readonly securityGroup: ec2.SecurityGroup | undefined;

  /**
   * The network mode used by this MCP server
   */
  public readonly networkMode: NetworkMode;

  /**
   * The authentication mode used by this MCP server
   */
  public readonly authMode: AuthMode;

  /** The ARN of the execution role attached to the AgentCore Runtime. */
  public readonly runtimeRoleArn: string;

  constructor(scope: Construct, id: string, props: AgentCoreMCPServerProps) {
    super(scope, id);

    // Validate deployment method - exactly one of mcpAssetPath or ecrConfig must be provided
    if (props.mcpAssetPath && props.ecrConfig) {
      throw new Error('Cannot specify both mcpAssetPath and ecrConfig. Choose one deployment method.');
    }
    if (!props.mcpAssetPath && !props.ecrConfig) {
      throw new Error('Must specify either mcpAssetPath or ecrConfig for MCP server deployment.');
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

    // Build network configuration
    const { networkConfig, securityGroup } = this.buildNetworkConfig(props);
    this.securityGroup = securityGroup;

    // Build environment variables
    const envVars: Record<string, string> = {
      AWS_DEFAULT_REGION: cdk.Aws.REGION,
      ...props.environmentVariables,
    };

    // Create artifact for MCP server
    let artifact: agentcore.AgentRuntimeArtifact;
    if (props.ecrConfig) {
      const imageTag = props.ecrConfig.imageTag ?? 'latest';
      artifact = agentcore.AgentRuntimeArtifact.fromEcrRepository(props.ecrConfig.repository, imageTag);
    } else {
      // AgentCore Runtime requires ARM64, so force the platform here. On a
      // non-ARM host this is a cross-arch build that also needs QEMU emulation
      // (register with `docker run --privileged --rm tonistiigi/binfmt
      // --install arm64` before `cdk deploy`).
      artifact = agentcore.AgentRuntimeArtifact.fromAsset(props.mcpAssetPath!, {
        platform: Platform.LINUX_ARM64,
      });
    }

    // Build authorizer configuration
    const authorizerConfig = this.buildAuthorizerConfig(props);

    // Create Runtime with MCP protocol configuration
    this.runtime = new agentcore.Runtime(this, 'Runtime', {
      runtimeName: props.runtimeName,
      agentRuntimeArtifact: artifact,
      description: props.description,
      networkConfiguration: networkConfig,
      authorizerConfiguration: authorizerConfig,
      environmentVariables: envVars,
      protocolConfiguration: agentcore.ProtocolType.MCP,
    });

    // Capture the execution role ARN for downstream use (e.g. scoped iam:PassRole in CI/CD)
    this.runtimeRoleArn = (this.runtime.grantPrincipal as iam.IRole).roleArn;
  }

  private buildNetworkConfig(props: AgentCoreMCPServerProps): {
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
      description: `Security group for MCP server ${props.runtimeName}`,
      allowAllOutbound: true,
    });

    const networkConfig = agentcore.RuntimeNetworkConfiguration.usingVpc(this, {
      vpc,
      vpcSubnets,
      securityGroups: [...additionalSecurityGroups, securityGroup],
    });

    return { networkConfig, securityGroup };
  }

  private buildAuthorizerConfig(props: AgentCoreMCPServerProps): agentcore.RuntimeAuthorizerConfiguration {
    if (this.authMode === AuthMode.COGNITO && props.cognitoAuth) {
      return agentcore.RuntimeAuthorizerConfiguration.usingCognito(
        props.cognitoAuth.userPool,
        props.cognitoAuth.userPoolClients,
        props.cognitoAuth.allowedAudience,
      );
    }
    return agentcore.RuntimeAuthorizerConfiguration.usingIAM();
  }

  /**
   * The runtime's grant principal for adding permissions
   */
  public get grantPrincipal(): iam.IPrincipal {
    return this.runtime.grantPrincipal;
  }
}
