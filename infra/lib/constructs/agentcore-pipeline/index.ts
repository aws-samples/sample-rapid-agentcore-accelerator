// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { MonorepoSource } from '../monorepo-source';

/**
 * Configuration for the source repository.
 */
export interface SourceRepositoryConfig {
  /**
   * Use an existing CodeCommit repository instead of creating a new one.
   * @default - Creates a new repository
   */
  readonly existingRepository?: codecommit.IRepository;

  /**
   * Name for the new CodeCommit repository (ignored if existingRepository is provided).
   * @default 'agentcore-monorepo'
   */
  readonly repositoryName?: string;

  /**
   * Branch to monitor for changes.
   * @default 'main'
   */
  readonly branch?: string;
}

/**
 * Monorepo configuration for the pipeline
 */
export interface MonorepoConfig {
  /**
   * The MonorepoSource to register with.
   */
  readonly source: MonorepoSource;

  /**
   * Glob patterns that trigger this pipeline when files matching them change.
   * Supports standard glob patterns: *, **, ?, [abc], etc.
   * @example ['agent/**', 'shared/**\/*.py']
   */
  readonly triggerPaths: string[];
}

/**
 * Configuration for the CodeBuild build environment.
 */
export interface BuildConfig {
  /**
   * Path to the source directory containing the Dockerfile (relative to repo root).
   */
  readonly sourceDirectory: string;

  /**
   * Path to the Dockerfile relative to sourceDirectory.
   * @default 'Dockerfile'
   */
  readonly dockerfilePath?: string;

  /**
   * Build timeout in minutes.
   * @default 30
   */
  readonly timeoutMinutes?: number;

  /**
   * Compute type for the build environment.
   * @default codebuild.ComputeType.LARGE
   */
  readonly computeType?: codebuild.ComputeType;
}

/**
 * Props for the AgentCorePipeline construct.
 */
export interface AgentCorePipelineProps {
  /**
   * Name for the pipeline and related resources.
   */
  readonly pipelineName: string;

  /**
   * ECR repository to push built images to.
   */
  readonly ecrRepository: ecr.IRepository;

  /**
   * Build configuration for the CodeBuild project.
   */
  readonly buildConfig: BuildConfig;

  /**
   * The AgentCore Runtime ID to update after build.
   */
  readonly agentRuntimeId: string;

  /**
   * The ARN of the execution role attached to the AgentCore Runtime.
   * Used to scope the iam:PassRole permission to this specific role.
   */
  readonly agentRuntimeRoleArn: string;

  /**
   * Monorepo configuration. When provided, the pipeline will:
   * - Use the MonorepoSource's repository instead of creating its own
   * - Disable native CodeCommit triggers (trigger: NONE)
   * - Auto-register with the MonorepoSource for selective triggering
   * 
   * Mutually exclusive with sourceConfig.
   * @default - Standalone mode with native triggers
   */
  readonly monorepoConfig?: MonorepoConfig;

  /**
   * Source repository configuration.
   * Mutually exclusive with monorepoConfig.
   * @default - Creates new repository with default settings
   */
  readonly sourceConfig?: SourceRepositoryConfig;

  /**
   * Parameter Store parameter to update after successful deployment.
   * When provided, the pipeline will set this to 'true' after first successful build.
   * @default - No parameter update
   */
  readonly cicdDeployedParameter?: ssm.IStringParameter;

  /**
   * Description for the pipeline.
   * @default - No description
   */
  readonly description?: string;

  /**
   * S3 bucket to receive server access logs from the artifact bucket.
   * @default - No access logging
   */
  readonly accessLogsBucket?: s3.IBucket;
}

/**
 * L3 construct that creates a CI/CD pipeline for building and pushing container images.
 */
export class AgentCorePipeline extends Construct {
  public readonly repository: codecommit.IRepository;
  public readonly pipeline: codepipeline.Pipeline;
  public readonly buildProject: codebuild.PipelineProject;
  public readonly artifactBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: AgentCorePipelineProps) {
    super(scope, id);

    // Validate mutual exclusivity of monorepoConfig and sourceConfig
    if (props.monorepoConfig && props.sourceConfig) {
      throw new Error('monorepoConfig and sourceConfig are mutually exclusive. Provide only one.');
    }

    const sourceConfig = props.sourceConfig ?? {};
    const buildConfig = props.buildConfig;
    const branch = props.monorepoConfig ? props.monorepoConfig.source.branch : (sourceConfig.branch ?? 'main');
    const sourceDirectory = buildConfig.sourceDirectory;
    const dockerfilePath = buildConfig.dockerfilePath ?? 'Dockerfile';
    const timeoutMinutes = buildConfig.timeoutMinutes ?? 30;
    const computeType = buildConfig.computeType ?? codebuild.ComputeType.LARGE;

    // CodeCommit repository - use MonorepoSource's repository in monorepo mode
    if (props.monorepoConfig) {
      this.repository = props.monorepoConfig.source.repository;
    } else if (sourceConfig.existingRepository) {
      this.repository = sourceConfig.existingRepository;
    } else {
      const repoName = sourceConfig.repositoryName ?? 'agentcore-monorepo';
      this.repository = new codecommit.Repository(this, 'Repository', {
        repositoryName: repoName,
        description: props.description ?? `Source repository for ${props.pipelineName}`,
      });
    }

    // S3 artifact bucket
    this.artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      serverAccessLogsBucket: props.accessLogsBucket,
      serverAccessLogsPrefix: props.accessLogsBucket ? `pipeline-${props.pipelineName}/` : undefined,
    });

    // Build post_build commands
    const postBuildCommands = [
      'echo Build completed on `date`',
      'echo Pushing Docker images...',
      'docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
      'docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$COMMIT_HASH',
      'echo "Updating AgentCore Runtime with new image..."',
      // Build the new container URI
      'CONTAINER_URI="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG"',
      'echo "New container URI: $CONTAINER_URI"',
      // List versions to get the latest version number
      'echo "Listing runtime versions to find the latest..."',
      'aws bedrock-agentcore-control list-agent-runtime-versions --agent-runtime-id "$AGENT_RUNTIME_ID" --region $AWS_DEFAULT_REGION --no-cli-pager > /tmp/runtime-versions.json',
      'cat /tmp/runtime-versions.json | jq \'.agentRuntimes[] | {version: .agentRuntimeVersion, status: .status}\'',
      'LATEST_VERSION=$(jq -r \'.agentRuntimes | map(.agentRuntimeVersion | tonumber) | max\' /tmp/runtime-versions.json)',
      'echo "Latest version: $LATEST_VERSION"',
      // Fetch the latest version's configuration
      'echo "Fetching configuration for version $LATEST_VERSION..."',
      'aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$AGENT_RUNTIME_ID" --agent-runtime-version "$LATEST_VERSION" --region $AWS_DEFAULT_REGION --no-cli-pager > /tmp/current-runtime.json',
      'echo "Current runtime config:"',
      'cat /tmp/current-runtime.json | jq .',
      // Build the update payload JSON file using jq - replace only the container URI, preserve everything else
      'echo "Building update payload..."',
      'jq --arg uri "$CONTAINER_URI" \'{ agentRuntimeArtifact: { containerConfiguration: { containerUri: $uri } }, roleArn: .roleArn, networkConfiguration: .networkConfiguration } + (if .environmentVariables and (.environmentVariables | length > 0) then { environmentVariables: .environmentVariables } else {} end) + (if .description then { description: .description } else {} end) + (if .authorizerConfiguration then { authorizerConfiguration: .authorizerConfiguration } else {} end) + (if .protocolConfiguration then { protocolConfiguration: .protocolConfiguration } else {} end) + (if .lifecycleConfiguration then { lifecycleConfiguration: .lifecycleConfiguration } else {} end) + (if .requestHeaderConfiguration then { requestHeaderConfiguration: .requestHeaderConfiguration } else {} end)\' /tmp/current-runtime.json > /tmp/update-runtime.json',
      'echo "Update payload:"',
      'cat /tmp/update-runtime.json | jq .',
      // Execute the update using the JSON file
      'aws bedrock-agentcore-control update-agent-runtime --agent-runtime-id "$AGENT_RUNTIME_ID" --cli-input-json file:///tmp/update-runtime.json --region $AWS_DEFAULT_REGION --no-cli-pager',
      'echo "AgentCore Runtime update initiated"',
    ];

    if (props.cicdDeployedParameter) {
      postBuildCommands.push(
        'echo "Updating CI/CD deployed flag in Parameter Store..."',
        'aws ssm put-parameter --name "$CICD_DEPLOYED_PARAM" --value "true" --type String --overwrite --region $AWS_DEFAULT_REGION',
        'echo "CI/CD deployment tracking flag set to true"',
      );
    }

    // Build environment variables
    const environmentVariables: Record<string, codebuild.BuildEnvironmentVariable> = {
      AWS_DEFAULT_REGION: { value: cdk.Aws.REGION },
      AWS_ACCOUNT_ID: { value: cdk.Aws.ACCOUNT_ID },
      IMAGE_REPO_NAME: { value: props.ecrRepository.repositoryName },
      IMAGE_TAG: { value: 'latest' },
      SOURCE_DIRECTORY: { value: sourceDirectory },
      DOCKERFILE_PATH: { value: dockerfilePath },
      AGENT_RUNTIME_ID: { value: props.agentRuntimeId },
    };

    if (props.cicdDeployedParameter) {
      environmentVariables.CICD_DEPLOYED_PARAM = { value: props.cicdDeployedParameter.parameterName };
    }

    // CodeBuild project with ARM64 environment
    this.buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      projectName: `${props.pipelineName}-build`,
      description: `Build project for ${props.pipelineName}`,
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
        computeType: computeType,
        privileged: true,
      },
      timeout: cdk.Duration.minutes(timeoutMinutes),
      environmentVariables,
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
              'COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)',
              'echo "Changing to source directory: $SOURCE_DIRECTORY"',
              'cd $SOURCE_DIRECTORY',
              'ls -la',
              '# Pull previous image for Docker layer cache',
              'docker pull $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG || true',
            ],
          },
          build: {
            commands: [
              'echo Build started on `date`',
              'echo "Building ARM64 Docker image from $(pwd)"',
              'docker build --cache-from $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG -f $DOCKERFILE_PATH -t $IMAGE_REPO_NAME:$IMAGE_TAG -t $IMAGE_REPO_NAME:$COMMIT_HASH .',
              'docker tag $IMAGE_REPO_NAME:$IMAGE_TAG $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
              'docker tag $IMAGE_REPO_NAME:$COMMIT_HASH $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$COMMIT_HASH',
            ],
          },
          post_build: {
            commands: postBuildCommands,
          },
        },
      }),
    });

    // Grant ECR push permissions to CodeBuild
    props.ecrRepository.grantPullPush(this.buildProject);

    // Grant permission to get and update AgentCore Runtime — scoped to the specific runtime
    const runtimeArn = `arn:aws:bedrock-agentcore:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:runtime/${props.agentRuntimeId}`;
    this.buildProject.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-agentcore:ListAgentRuntimeVersions',
        'bedrock-agentcore:GetAgentRuntime',
        'bedrock-agentcore:UpdateAgentRuntime',
      ],
      resources: [runtimeArn],
    }));
    
    // Need iam:PassRole to pass the execution role to the runtime during update.
    // Scoped to the runtime's execution role ARN when provided, otherwise wildcard.
    this.buildProject.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [props.agentRuntimeRoleArn],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'bedrock-agentcore.amazonaws.com',
        },
      },
    }));

    // Grant SSM parameter write permission to CodeBuild (only if parameter provided)
    if (props.cicdDeployedParameter) {
      this.buildProject.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:PutParameter'],
        resources: [props.cicdDeployedParameter.parameterArn],
      }));
    }

    // CodePipeline
    const sourceOutput = new codepipeline.Artifact('SourceOutput');

    this.pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: props.pipelineName,
      artifactBucket: this.artifactBucket,
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.CodeCommitSourceAction({
              actionName: 'CodeCommit_Source',
              repository: this.repository,
              branch: branch,
              output: sourceOutput,
              trigger: props.monorepoConfig ? codepipeline_actions.CodeCommitTrigger.NONE : codepipeline_actions.CodeCommitTrigger.EVENTS,
            }),
          ],
        },
        {
          stageName: 'Build',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'Docker_Build',
              project: this.buildProject,
              input: sourceOutput,
            }),
          ],
        },
      ],
    });

    // Auto-register with MonorepoSource if in monorepo mode
    if (props.monorepoConfig) {
      props.monorepoConfig.source.registerPipeline(props.pipelineName, {
        pipeline: this.pipeline,
        triggerPaths: props.monorepoConfig.triggerPaths,
      });
    }

    // Stack outputs
    const stack = cdk.Stack.of(this);

    // Only output repository URLs if we created a new repository (not in monorepo mode and not using existing)
    if (!props.monorepoConfig && !sourceConfig.existingRepository && this.repository instanceof codecommit.Repository) {
      new cdk.CfnOutput(stack, `${id}RepoCloneUrlHttp`, {
        value: this.repository.repositoryCloneUrlHttp,
        description: 'CodeCommit repository HTTPS clone URL',
      });

      new cdk.CfnOutput(stack, `${id}RepoCloneUrlSsh`, {
        value: this.repository.repositoryCloneUrlSsh,
        description: 'CodeCommit repository SSH clone URL',
      });
    }

    new cdk.CfnOutput(stack, `${id}PipelineArn`, {
      value: this.pipeline.pipelineArn,
      description: 'CodePipeline ARN',
    });
  }
}
