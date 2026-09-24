// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import {
  BedrockKnowledgeBase,
  ChunkingStrategy,
  ParsingStrategy,
} from '../constructs/bedrock-knowledge-base';
import { AgentCoreAgent } from '../constructs/agentcore-agent';
import { AgentCoreMCPServer } from '../constructs/agentcore-mcp-server';
import { AgentCorePipeline } from '../constructs/agentcore-pipeline';
import { CdkDeployPipeline } from '../constructs/cdk-deploy-pipeline';
import { MonorepoSource } from '../constructs/monorepo-source';
import { StreamlitFrontend } from '../constructs/streamlit-frontend';
import { CognitoAuth } from '../constructs/cognito-auth';
import { CloudFrontFrontend } from '../constructs/cloudfront-frontend';
import { AcceleratorConfig } from '../config';

/**
 * Convert a kebab-case string to PascalCase.
 * E.g. "tools-server" → "ToolsServer"
 */
function toPascalCase(name: string): string {
  return name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}


export interface AgentCoreStackProps extends cdk.StackProps {
  readonly config: AcceleratorConfig;
}

export class AgentCoreStack extends cdk.Stack {
  public readonly vpc?: ec2.Vpc;
  public readonly agents: Map<string, AgentCoreAgent>;
  public readonly agentEcrRepositories: Map<string, ecr.Repository>;
  public readonly mcpServers: Map<string, AgentCoreMCPServer>;
  public readonly mcpEcrRepositories: Map<string, ecr.Repository>;
  public readonly knowledgeBases: Map<string, BedrockKnowledgeBase>;
  public readonly kbBuckets: Map<string, s3.Bucket>;
  public readonly monorepoSource?: MonorepoSource;
  public readonly pipeline?: AgentCorePipeline;
  public readonly mcpPipeline?: AgentCorePipeline;
  public readonly infraPipeline?: CdkDeployPipeline;
  public readonly cognito?: CognitoAuth;
  public readonly frontend?: StreamlitFrontend;

  constructor(scope: Construct, id: string, props: AgentCoreStackProps) {
    super(scope, id, props);

    const config = props.config;
    const prefix = config.deploymentPrefix;
    // Runtime names use underscores (AgentCore naming convention)
    const runtimePrefix = prefix.replace(/-/g, '_');

    // S3 bucket for server access logging
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: `${prefix}-access-logs-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        { expiration: cdk.Duration.days(90) },
      ],
    });

    // Knowledge Bases (one per definition)
    this.knowledgeBases = new Map<string, BedrockKnowledgeBase>();
    this.kbBuckets = new Map<string, s3.Bucket>();

    for (const kbDef of config.knowledgeBases) {
      const pascalName = toPascalCase(kbDef.name);

      // S3 bucket for this KB's documents
      const docsBucket = new s3.Bucket(this, `${pascalName}DocumentsBucket`, {
        bucketName: `${prefix}-kb-${kbDef.name}-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        serverAccessLogsBucket: accessLogsBucket,
        serverAccessLogsPrefix: `kb-${kbDef.name}/`,
      });
      this.kbBuckets.set(kbDef.name, docsBucket);

      // S3 bucket for supplemental data
      const supplementalBucket = new s3.Bucket(this, `${pascalName}SupplementalBucket`, {
        bucketName: `${prefix}-kb-${kbDef.name}-supplemental-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        serverAccessLogsBucket: accessLogsBucket,
        serverAccessLogsPrefix: `kb-${kbDef.name}-supplemental/`,
      });

      // Bedrock Knowledge Base
      const kb = new BedrockKnowledgeBase(this, `${pascalName}KnowledgeBase`, {
        knowledgeBaseName: `${prefix}-kb-${kbDef.name}`,
        description: `Knowledge base: ${kbDef.name}`,
        supplementalDataBucket: supplementalBucket,
      });

      kb.addS3DataSource({
        dataSourceName: 'managed-ingestion',
        bucket: docsBucket,
        inclusionPrefixes: ['kb-source-docs/'],
        parsingConfig: {
          strategy: ParsingStrategy.NONE,
        },
        chunkingConfig: {
          strategy: ChunkingStrategy.HIERARCHICAL,
          hierarchicalConfig: {
            parentMaxTokens: 1500,
            childMaxTokens: 300,
            overlapTokens: 60,
          },
        },
      });

      kb.knowledgeBase.node.addDependency(docsBucket);
      this.knowledgeBases.set(kbDef.name, kb);
    }

    // ECR repositories for agent images (one per agent definition)
    this.agents = new Map<string, AgentCoreAgent>();
    this.agentEcrRepositories = new Map<string, ecr.Repository>();

    for (const agentDef of config.agents) {
      const pascalName = toPascalCase(agentDef.name);
      const ecrRepo = new ecr.Repository(this, `${pascalName}AgentEcrRepository`, {
        repositoryName: `${prefix}-agent-${agentDef.name}`,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        emptyOnDelete: true,
        imageScanOnPush: true,
      });
      this.agentEcrRepositories.set(agentDef.name, ecrRepo);
    }

    // ECR repository for MCP server images (one per MCP definition)
    this.mcpServers = new Map<string, AgentCoreMCPServer>();
    this.mcpEcrRepositories = new Map<string, ecr.Repository>();

    for (const mcpDef of config.mcpServers) {
      const pascalName = toPascalCase(mcpDef.name);
      const ecrRepo = new ecr.Repository(this, `${pascalName}McpEcrRepository`, {
        repositoryName: `${prefix}-mcp-${mcpDef.name}`,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        emptyOnDelete: true,
        imageScanOnPush: true,
      });
      this.mcpEcrRepositories.set(mcpDef.name, ecrRepo);
    }

    // MonorepoSource and pipelines are only created in pipeline mode (Req 2.1, 2.2, 2.5, 2.7)
    if (config.deploymentMode === 'pipeline') {
      this.monorepoSource = new MonorepoSource(this, 'MonorepoSource', {
        repositoryConfig: {
          repositoryName: `${prefix}-monorepo`,
          branch: 'main',
        },
        description: 'Monorepo source repository for RAPID',
        lambdaTimeoutSeconds: 60,
      });
    }

    // Deployment mode: determined solely from config.deploymentMode (no SSM lookups)
    const useEcr = config.deploymentMode === 'pipeline';

    // In pipeline mode, validate that ECR repositories can be referenced
    if (useEcr) {
      for (const [agentName, ecrRepo] of this.agentEcrRepositories) {
        if (!ecrRepo) {
          throw new Error(
            `deploymentMode is "pipeline" but the agent ECR repository (${prefix}-agent-${agentName}) could not be created. ` +
            'Ensure ECR is available in the target region before deploying in pipeline mode.'
          );
        }
      }
      for (const [mcpName, ecrRepo] of this.mcpEcrRepositories) {
        if (!ecrRepo) {
          throw new Error(
            `deploymentMode is "pipeline" but the MCP ECR repository (${prefix}-mcp-${mcpName}) could not be created. ` +
            'Ensure ECR is available in the target region before deploying in pipeline mode.'
          );
        }
      }
    }

    // AgentCore MCP Servers (created before agents so we can pass their ARNs)
    // Image source determined by config.deploymentMode
    for (const mcpDef of config.mcpServers) {
      const pascalName = toPascalCase(mcpDef.name);
      const runtimeName = `${runtimePrefix}_mcp_${mcpDef.name.replace(/-/g, '_')}`;
      const ecrRepo = this.mcpEcrRepositories.get(mcpDef.name)!;

      let mcpServer: AgentCoreMCPServer;
      if (useEcr) {
        mcpServer = new AgentCoreMCPServer(this, `${pascalName}McpServer`, {
          runtimeName,
          ecrConfig: {
            repository: ecrRepo,
            imageTag: 'latest',
          },
          description: `MCP server: ${mcpDef.name}`,
        });
      } else {
        mcpServer = new AgentCoreMCPServer(this, `${pascalName}McpServer`, {
          runtimeName,
          mcpAssetPath: `../${mcpDef.sourceDir}`,
          description: `MCP server: ${mcpDef.name}`,
        });
      }
      this.mcpServers.set(mcpDef.name, mcpServer);
    }

    // Get the first MCP server for single-agent backwards compatibility
    const firstMcpServer = this.mcpServers.values().next().value!;
    const isSingleAgentMode = config.agents.length === 1;

    // AgentCore Agents with Memory and Knowledge Base (one per agent definition)
    // Image source determined by config.deploymentMode
    for (const agentDef of config.agents) {
      const pascalName = toPascalCase(agentDef.name);
      const runtimeName = `${runtimePrefix}_agent_${agentDef.name.replace(/-/g, '_')}`;
      const ecrRepo = this.agentEcrRepositories.get(agentDef.name)!;

      // Resolve MCP ARNs for this agent
      const referencedMcpNames = agentDef.mcpServers ?? [...this.mcpServers.keys()];
      const referencedMcpServers = referencedMcpNames
        .map(name => this.mcpServers.get(name)!)
        .filter(Boolean);
      const mcpArns = referencedMcpServers.map(mcp => mcp.runtime.agentRuntimeArn);

      // Build environment variables for this agent
      const envVars: Record<string, string> = {
        MODEL_ID: agentDef.modelId,
      };

      // Set MCP environment variable(s) based on mode
      if (isSingleAgentMode) {
        // Single-agent mode: use singular MCP_RUNTIME_ARN for backwards compat
        if (mcpArns.length > 0) {
          envVars.MCP_RUNTIME_ARN = mcpArns[0];
        }
      } else {
        // Multi-agent mode: use comma-separated MCP_RUNTIME_ARNS
        if (mcpArns.length > 0) {
          envVars.MCP_RUNTIME_ARNS = mcpArns.join(',');
        }
      }

      // Add KNOWLEDGE_BASE_ID if this agent references a knowledge base
      if (agentDef.knowledgeBase) {
        const kb = this.knowledgeBases.get(agentDef.knowledgeBase);
        if (kb) {
          envVars.KNOWLEDGE_BASE_ID = kb.knowledgeBaseId;
        }
      }

      let agent: AgentCoreAgent;
      if (useEcr) {
        agent = new AgentCoreAgent(this, `${pascalName}Agent`, {
          runtimeName,
          ecrConfig: {
            repository: ecrRepo,
            imageTag: 'latest',
          },
          description: `Strands agent: ${agentDef.name}`,
          modelId: agentDef.modelId,
          environmentVariables: envVars,
        });
      } else {
        agent = new AgentCoreAgent(this, `${pascalName}Agent`, {
          runtimeName,
          agentAssetPath: `../${agentDef.sourceDir}`,
          description: `Strands agent: ${agentDef.name}`,
          modelId: agentDef.modelId,
          environmentVariables: envVars,
        });
      }

      // Grant invoke permissions only on referenced MCP server runtimes
      for (const mcpServer of referencedMcpServers) {
        mcpServer.runtime.grantInvoke(agent.grantPrincipal);
      }

      // Grant knowledge base retrieve access
      if (agentDef.knowledgeBase) {
        const kb = this.knowledgeBases.get(agentDef.knowledgeBase);
        if (kb) {
          kb.grantRetrieve(agent.runtime);
        }
      }

      // Grant ECR permissions to the agent execution role
      ecrRepo.grantPull(agent.grantPrincipal);
      agent.grantPrincipal.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ecr:GetAuthorizationToken'],
          resources: ['*'],
        }),
      );

      this.agents.set(agentDef.name, agent);
    }

    // First agent reference for frontend and backwards-compat outputs
    const firstAgent = this.agents.values().next().value!;

    // CI/CD pipelines only created in pipeline mode (Req 2.1, 2.2, 2.5, 2.7)
    if (config.deploymentMode === 'pipeline') {
      // CI/CD pipeline for agent deployments (one per agent)
      for (const agentDef of config.agents) {
        const pascalName = toPascalCase(agentDef.name);
        const agent = this.agents.get(agentDef.name)!;
        const ecrRepo = this.agentEcrRepositories.get(agentDef.name)!;

        new AgentCorePipeline(this, `${pascalName}AgentPipeline`, {
          pipelineName: `${prefix}-agent-${agentDef.name}-pipeline`,
          ecrRepository: ecrRepo,
          buildConfig: {
            sourceDirectory: agentDef.sourceDir,
          },
          agentRuntimeId: agent.runtime.agentRuntimeId,
          agentRuntimeRoleArn: agent.runtimeRoleArn,
          monorepoConfig: {
            source: this.monorepoSource!,
            triggerPaths: [`${agentDef.sourceDir}/**`],
          },
        });
      }

      // CI/CD pipeline for MCP server deployments (one per MCP definition)
      for (const mcpDef of config.mcpServers) {
        const pascalName = toPascalCase(mcpDef.name);
        const mcpServer = this.mcpServers.get(mcpDef.name)!;
        const ecrRepo = this.mcpEcrRepositories.get(mcpDef.name)!;

        new AgentCorePipeline(this, `${pascalName}McpPipeline`, {
          pipelineName: `${prefix}-mcp-${mcpDef.name}-pipeline`,
          ecrRepository: ecrRepo,
          buildConfig: {
            sourceDirectory: mcpDef.sourceDir,
          },
          agentRuntimeId: mcpServer.runtime.agentRuntimeId,
          agentRuntimeRoleArn: mcpServer.runtimeRoleArn,
          monorepoConfig: {
            source: this.monorepoSource!,
            triggerPaths: [`${mcpDef.sourceDir}/**`],
          },
        });
      }

      // CI/CD pipeline for infrastructure (self-mutating CDK deploy)
      this.infraPipeline = new CdkDeployPipeline(this, 'InfraPipeline', {
        pipelineName: `${prefix}-infra-pipeline`,
        description: 'Self-mutating CDK deploy pipeline for infrastructure changes',
        monorepoConfig: {
          source: this.monorepoSource!,
          triggerPaths: ['infra/**', 'config.yaml'],
        },
      });
    }

    // Grant ECR permissions to each MCP server execution role
    for (const [mcpName, mcpServer] of this.mcpServers) {
      const ecrRepo = this.mcpEcrRepositories.get(mcpName)!;
      ecrRepo.grantPull(mcpServer.grantPrincipal);
      mcpServer.grantPrincipal.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ecr:GetAuthorizationToken'],
          resources: ['*'],
        }),
      );
    }

    // Stack outputs — agent runtime ARNs
    if (isSingleAgentMode) {
      // Single-agent mode: preserve legacy output names for backwards compatibility
      new cdk.CfnOutput(this, 'AgentRuntimeArn', {
        value: firstAgent.runtime.agentRuntimeArn,
        description: 'AgentCore Runtime ARN',
      });

      new cdk.CfnOutput(this, 'AgentRuntimeId', {
        value: firstAgent.runtime.agentRuntimeId,
        description: 'AgentCore Runtime ID',
      });
    } else {
      // Multi-agent mode: emit per-agent outputs with PascalCase names
      for (const [agentName, agent] of this.agents) {
        const pascalName = toPascalCase(agentName);
        new cdk.CfnOutput(this, `${pascalName}RuntimeArn`, {
          value: agent.runtime.agentRuntimeArn,
          description: `AgentCore Runtime ARN: ${agentName}`,
        });
      }
    }

    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: this.kbBuckets.size > 0 ? this.kbBuckets.values().next().value!.bucketName : '',
      description: 'S3 Bucket for Knowledge Base documents',
    });

    // Knowledge base outputs
    for (const [kbName, kb] of this.knowledgeBases) {
      const pascalName = toPascalCase(kbName);
      new cdk.CfnOutput(this, `${pascalName}KnowledgeBaseId`, {
        value: kb.knowledgeBaseId,
        description: `Knowledge Base ID: ${kbName}`,
      });
      new cdk.CfnOutput(this, `${pascalName}DocumentsBucketName`, {
        value: this.kbBuckets.get(kbName)!.bucketName,
        description: `Documents bucket: ${kbName}`,
      });
    }

    // MonorepoSource outputs only emitted in pipeline mode
    if (this.monorepoSource) {
      new cdk.CfnOutput(this, 'MonorepoRepositoryName', {
        value: this.monorepoSource.repository.repositoryName,
        description: 'CodeCommit monorepo repository name',
      });

      new cdk.CfnOutput(this, 'MonorepoRepositoryArn', {
        value: this.monorepoSource.repository.repositoryArn,
        description: 'CodeCommit monorepo repository ARN',
      });
    }

    // MCP Server outputs
    if (config.mcpServers.length === 1) {
      // Single-MCP mode: preserve legacy output names for backwards compatibility
      new cdk.CfnOutput(this, 'McpServerRuntimeArn', {
        value: firstMcpServer.runtime.agentRuntimeArn,
        description: 'MCP Server Runtime ARN',
      });

      new cdk.CfnOutput(this, 'McpServerRuntimeId', {
        value: firstMcpServer.runtime.agentRuntimeId,
        description: 'MCP Server Runtime ID',
      });

      const firstEcrRepo = this.mcpEcrRepositories.values().next().value!;
      new cdk.CfnOutput(this, 'McpEcrRepositoryUri', {
        value: firstEcrRepo.repositoryUri,
        description: 'ECR Repository URI for MCP server images',
      });
    } else {
      // Multi-MCP mode: emit per-MCP outputs with PascalCase names
      for (const [mcpName, mcpServer] of this.mcpServers) {
        const pascalName = toPascalCase(mcpName);
        new cdk.CfnOutput(this, `${pascalName}McpRuntimeArn`, {
          value: mcpServer.runtime.agentRuntimeArn,
          description: `MCP Server Runtime ARN: ${mcpName}`,
        });
      }
    }

    // ─── Frontend Mode Composition ───────────────────────────────────────────────
    // frontendMode: 'none' → no VPC, no frontend (Req 4.12)
    // frontendMode: 'internal' → VPC + StreamlitFrontend (internal ALB, no Cognito)
    // frontendMode: 'public' → VPC + CognitoAuth + StreamlitFrontend (public ALB, HTTPS, Route 53)
    if (config.frontendMode === 'internal') {
      // Create VPC with public and private subnets
      this.vpc = new ec2.Vpc(this, 'Vpc', {
        vpcName: `${prefix}-internal`,
        maxAzs: 2,
        natGateways: 1,
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
          },
        ],
      });

      // Streamlit frontend with internal ALB (no Cognito, no HTTPS)
      this.frontend = new StreamlitFrontend(this, 'Frontend', {
        vpc: this.vpc,
        agentRuntimeArn: firstAgent.runtime.agentRuntimeArn,
        dockerContextPath: '../frontend/src',
        agentCoreSecurityGroup: firstAgent.securityGroup,
        publicLoadBalancer: false,
        enableStreaming: true,
      });

      // Wire agent runtime info to the frontend container
      const frontendContainerInternal = this.frontend.service.taskDefinition.defaultContainer!;
      if (isSingleAgentMode) {
        frontendContainerInternal.addEnvironment('AGENTCORE_RUNTIME_ARN', firstAgent.runtime.agentRuntimeArn);
      } else {
        const agentRegistry: Record<string, string> = {};
        for (const [name, agent] of this.agents) {
          agentRegistry[name] = agent.runtime.agentRuntimeArn;
        }
        frontendContainerInternal.addEnvironment('AGENT_REGISTRY', JSON.stringify(agentRegistry));
      }

      // Grant frontend permission to invoke all agent runtimes
      for (const agent of this.agents.values()) {
        agent.runtime.grantInvoke(this.frontend.service.taskDefinition.taskRole);
      }

      new cdk.CfnOutput(this, 'FrontendUrl', {
        value: this.frontend.loadBalancerUrl,
        description: 'Internal ALB URL (accessible only from within VPC)',
      });

      new cdk.CfnOutput(this, 'VpcId', {
        value: this.vpc.vpcId,
        description: 'VPC ID',
      });
    } else if (config.frontendMode === 'public') {
      // Create VPC with public and private subnets
      this.vpc = new ec2.Vpc(this, 'Vpc', {
        vpcName: `${prefix}-public`,
        maxAzs: 2,
        natGateways: 1,
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
          },
        ],
      });

      // Look up the hosted zone from the derived hostedZoneName
      const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
        domainName: config.hostedZoneName!,
      });

      // Cognito User Pool for authentication
      this.cognito = new CognitoAuth(this, 'Auth', {
        userPoolName: `${prefix}-public-users`,
      });

      // Streamlit frontend with public ALB, HTTPS, and Cognito
      this.frontend = new StreamlitFrontend(this, 'Frontend', {
        vpc: this.vpc,
        agentRuntimeArn: firstAgent.runtime.agentRuntimeArn,
        dockerContextPath: '../frontend/src',
        publicLoadBalancer: true,
        enableStreaming: true,
        agentCoreSecurityGroup: firstAgent.securityGroup,
        domain: {
          domainName: config.domainName!,
          hostedZone: hostedZone,
        },
        cognito: {
          userPool: this.cognito.userPool,
          userPoolClient: this.cognito.userPoolClient,
          userPoolDomain: this.cognito.userPoolDomain,
          cognitoAuthConstruct: this.cognito,
        },
      });

      // Wire agent runtime info to the frontend container
      const frontendContainerPublic = this.frontend.service.taskDefinition.defaultContainer!;
      if (isSingleAgentMode) {
        frontendContainerPublic.addEnvironment('AGENTCORE_RUNTIME_ARN', firstAgent.runtime.agentRuntimeArn);
      } else {
        const agentRegistry: Record<string, string> = {};
        for (const [name, agent] of this.agents) {
          agentRegistry[name] = agent.runtime.agentRuntimeArn;
        }
        frontendContainerPublic.addEnvironment('AGENT_REGISTRY', JSON.stringify(agentRegistry));
      }

      // Grant frontend permission to invoke all agent runtimes
      for (const agent of this.agents.values()) {
        agent.runtime.grantInvoke(this.frontend.service.taskDefinition.taskRole);
      }

      new cdk.CfnOutput(this, 'FrontendUrl', {
        value: this.frontend.loadBalancerUrl,
        description: 'Public HTTPS URL for the Streamlit frontend',
      });

      new cdk.CfnOutput(this, 'CognitoUserPoolId', {
        value: this.cognito.userPool.userPoolId,
        description: 'Cognito User Pool ID - create users here',
      });

      new cdk.CfnOutput(this, 'CognitoHostedUiUrl', {
        value: this.cognito.domainUrl,
        description: 'Cognito Hosted UI URL',
      });

      new cdk.CfnOutput(this, 'VpcId', {
        value: this.vpc.vpcId,
        description: 'VPC ID',
      });
    } else if (config.frontendMode === 'cloudfront') {
      // Create VPC with public and private subnets
      this.vpc = new ec2.Vpc(this, 'Vpc', {
        vpcName: `${prefix}-cloudfront`,
        maxAzs: 2,
        natGateways: 1,
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
          },
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
          },
        ],
      });

      // Look up hosted zone (when custom domain is configured)
      const hostedZone = config.domainName
        ? route53.HostedZone.fromLookup(this, 'HostedZone', {
            domainName: config.hostedZoneName!,
          })
        : undefined;

      // Cognito is always enabled for CloudFront mode
      this.cognito = new CognitoAuth(this, 'Auth', {
        userPoolName: `${prefix}-cloudfront-users`,
        // With domain: ALB-level Cognito auth (needs client secret for ALB action)
        // Without domain: App-level OAuth (public client, no secret)
        generateClientSecret: !!config.domainName,
      });

      if (config.domainName && hostedZone) {
        // ─── With custom domain: ALB gets HTTPS + Cognito auth action ───────────
        // CloudFront → ALB (HTTPS, port 443) → Cognito authenticate action → Streamlit
        this.frontend = new StreamlitFrontend(this, 'Frontend', {
          vpc: this.vpc,
          agentRuntimeArn: firstAgent.runtime.agentRuntimeArn,
          dockerContextPath: '../frontend/src',
          publicLoadBalancer: false,
          enableStreaming: true,
          agentCoreSecurityGroup: firstAgent.securityGroup,
          domain: {
            domainName: config.domainName,
            hostedZone,
          },
          cognito: {
            userPool: this.cognito.userPool,
            userPoolClient: this.cognito.userPoolClient,
            userPoolDomain: this.cognito.userPoolDomain,
            cognitoAuthConstruct: this.cognito,
          },
        });
      } else {
        // ─── Without domain: ALB stays HTTP, app-level Cognito OAuth ────────────
        // CloudFront → ALB (HTTP, port 80) → Streamlit (handles OAuth redirect itself)
        // The ALB is private (restricted to the CloudFront managed prefix list), so an
        // HTTP listener is an acceptable trade-off for the no-domain quickstart.
        this.frontend = new StreamlitFrontend(this, 'Frontend', {
          vpc: this.vpc,
          agentRuntimeArn: firstAgent.runtime.agentRuntimeArn,
          dockerContextPath: '../frontend/src',
          publicLoadBalancer: false,
          enableStreaming: true,
          agentCoreSecurityGroup: firstAgent.securityGroup,
        });
      }

      // CloudFront distribution with VPC Origin pointing to the ALB
      const cloudfrontFrontend = new CloudFrontFrontend(this, 'CloudFrontFrontend', {
        vpc: this.vpc,
        alb: this.frontend.service.loadBalancer,
        domain: config.domainName && hostedZone ? {
          domainName: config.domainName,
          hostedZone,
        } : undefined,
      });

      // Increase ALB idle timeout for WebSocket connections (Streamlit uses WebSockets
      // at /_stcore/stream for real-time updates). Default 60s is too short.
      this.frontend.service.loadBalancer.setAttribute('idle_timeout.timeout_seconds', '3600');

      // Configure Streamlit for running behind CloudFront (proxy-compatible flags)
      // SECURITY NOTE: XSRF protection is disabled because CloudFront proxying causes
      // hostname mismatch that breaks Streamlit's built-in XSRF validation.
      // See docs/frontend.md for the trade-off and compensating controls.
      this.frontend.service.taskDefinition.defaultContainer!.addEnvironment(
        'STREAMLIT_SERVER_EXTRA_FLAGS',
        '--server.enableXsrfProtection=false --server.enableWebsocketCompression=false',
      );

      // For the no-domain path: pass Cognito config as env vars for app-level OAuth
      if (!config.domainName) {
        const redirectUri = `https://${cloudfrontFrontend.distribution.distributionDomainName}/`;
        const taskDef = this.frontend.service.taskDefinition.defaultContainer!;
        taskDef.addEnvironment('COGNITO_AUTH_ENABLED', 'true');
        taskDef.addEnvironment('COGNITO_USER_POOL_ID', this.cognito.userPool.userPoolId);
        taskDef.addEnvironment('COGNITO_CLIENT_ID', this.cognito.userPoolClient.userPoolClientId);
        taskDef.addEnvironment('COGNITO_DOMAIN', `${this.cognito.userPoolDomain.domainName}.auth.${cdk.Aws.REGION}.amazoncognito.com`);
        taskDef.addEnvironment('COGNITO_REDIRECT_URI', redirectUri);

        // Register CloudFront domain as Cognito OAuth callback (app-level OAuth uses / as redirect)
        this.cognito.addAppCallbackUrls(cloudfrontFrontend.distribution.distributionDomainName);
      }

      // Restrict ALB security group: allow inbound only from CloudFront managed prefix list.
      // Use AwsCustomResource to resolve the prefix list ID at deploy time (avoids requiring
      // CDK_DEFAULT_ACCOUNT to be set at synth time, which PrefixList.fromLookup needs).
      const cfPrefixListLookup = new cdk.custom_resources.AwsCustomResource(this, 'CloudFrontPrefixListLookup', {
        onCreate: {
          service: 'EC2',
          action: 'describeManagedPrefixLists',
          parameters: {
            Filters: [{ Name: 'prefix-list-name', Values: ['com.amazonaws.global.cloudfront.origin-facing'] }],
          },
          physicalResourceId: cdk.custom_resources.PhysicalResourceId.of('cloudfront-prefix-list'),
        },
        policy: cdk.custom_resources.AwsCustomResourcePolicy.fromSdkCalls({
          resources: cdk.custom_resources.AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
      });
      const cfPrefixListId = cfPrefixListLookup.getResponseField('PrefixLists.0.PrefixListId');

      const albPort = config.domainName ? 443 : 80;
      this.frontend.service.loadBalancer.connections.allowFrom(
        ec2.Peer.prefixList(cfPrefixListId),
        ec2.Port.tcp(albPort),
        `Allow traffic from CloudFront managed prefix list (port ${albPort})`,
      );

      // Remove the default VPC CIDR inbound rule that StreamlitFrontend adds for internal ALBs.
      // The ALB should only be reachable from CloudFront's managed prefix list.
      const albSgConstruct = this.frontend.node.findChild('AlbSecurityGroup') as ec2.SecurityGroup;
      const cfnAlbSg = albSgConstruct.node.defaultChild as ec2.CfnSecurityGroup;
      cfnAlbSg.addPropertyOverride('SecurityGroupIngress', []);

      // Grant frontend permission to invoke all agent runtimes
      for (const agent of this.agents.values()) {
        agent.runtime.grantInvoke(this.frontend.service.taskDefinition.taskRole);
      }

      // Wire agent runtime info to the frontend container
      const frontendContainerCf = this.frontend.service.taskDefinition.defaultContainer!;
      if (isSingleAgentMode) {
        frontendContainerCf.addEnvironment('AGENTCORE_RUNTIME_ARN', firstAgent.runtime.agentRuntimeArn);
      } else {
        const agentRegistry: Record<string, string> = {};
        for (const [name, agent] of this.agents) {
          agentRegistry[name] = agent.runtime.agentRuntimeArn;
        }
        frontendContainerCf.addEnvironment('AGENT_REGISTRY', JSON.stringify(agentRegistry));
      }

      // Stack outputs
      new cdk.CfnOutput(this, 'FrontendUrl', {
        value: cloudfrontFrontend.distributionUrl,
        description: 'CloudFront distribution URL for the Streamlit frontend',
      });

      new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
        value: cloudfrontFrontend.distributionId,
        description: 'CloudFront Distribution ID',
      });

      new cdk.CfnOutput(this, 'VpcId', {
        value: this.vpc.vpcId,
        description: 'VPC ID',
      });

      new cdk.CfnOutput(this, 'CognitoUserPoolId', {
        value: this.cognito.userPool.userPoolId,
        description: 'Cognito User Pool ID - create users here',
      });

      new cdk.CfnOutput(this, 'CognitoHostedUiUrl', {
        value: this.cognito.domainUrl,
        description: 'Cognito Hosted UI URL',
      });
    }
    // frontendMode === 'none' → no VPC, no frontend resources created
  }
}
