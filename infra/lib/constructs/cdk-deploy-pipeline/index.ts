// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { MonorepoSource } from '../monorepo-source';

/**
 * Default trigger paths for infrastructure changes.
 */
export const DEFAULT_INFRA_TRIGGER_PATHS = [
  'infra/**',
  'config.yaml',
];

/**
 * Monorepo configuration for the CDK deploy pipeline.
 * Mirrors AgentCorePipeline.MonorepoConfig.
 */
export interface CdkDeployMonorepoConfig {
  /** The MonorepoSource to register with. */
  readonly source: MonorepoSource;

  /**
   * Glob patterns that trigger this pipeline when matching files change.
   * @default DEFAULT_INFRA_TRIGGER_PATHS (['infra/**', 'package.json', 'cdk.json', 'tsconfig.json'])
   */
  readonly triggerPaths?: string[];
}

/**
 * Props for the CdkDeployPipeline construct.
 */
export interface CdkDeployPipelineProps {
  /** Name for the pipeline and related resources. */
  readonly pipelineName: string;

  /**
   * Monorepo configuration. The pipeline uses the MonorepoSource's
   * repository as its source, disables native CodeCommit triggers,
   * and auto-registers for selective triggering.
   */
  readonly monorepoConfig: CdkDeployMonorepoConfig;

  /**
   * Build timeout in minutes for the synth + deploy step.
   * @default 30
   */
  readonly timeoutMinutes?: number;

  /**
   * Compute type for the CodeBuild environment. The environment is ARM64
   * (ARM_CONTAINER), which supports SMALL, LARGE, XLARGE, and X2_LARGE only —
   * MEDIUM is rejected at deploy time.
   * @default codebuild.ComputeType.SMALL
   */
  readonly computeType?: codebuild.ComputeType;

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
 * L3 construct that creates a self-mutating CDK infrastructure deployment pipeline.
 *
 * Mirrors AgentCorePipeline: same monorepo integration pattern, same resource
 * composition (S3 artifact bucket, CodeBuild project, two-stage CodePipeline),
 * and same CloudFormation output convention.
 */
export class CdkDeployPipeline extends Construct {
  /** The CodePipeline workflow. */
  public readonly pipeline: codepipeline.Pipeline;

  /** The CodeBuild project that runs synth + deploy. */
  public readonly deployProject: codebuild.PipelineProject;

  /** Encrypted S3 bucket used to store pipeline artifacts. */
  public readonly artifactBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: CdkDeployPipelineProps) {
    super(scope, id);

    // 1. Encrypted artifact bucket (RemovalPolicy.DESTROY for easy cleanup)
    this.artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      serverAccessLogsBucket: props.accessLogsBucket,
      serverAccessLogsPrefix: props.accessLogsBucket ? `cdk-pipeline-${props.pipelineName}/` : undefined,
    });

    // 2. CodeBuild project: synth + self-mutating deploy
    const computeType = props.computeType ?? codebuild.ComputeType.SMALL;
    const timeoutMinutes = props.timeoutMinutes ?? 30;

    this.deployProject = new codebuild.PipelineProject(this, 'DeployProject', {
      projectName: `${props.pipelineName}-deploy`,
      description: `CDK synth + deploy project for ${props.pipelineName}`,
      environment: {
        // ARM64 compute. `cdk deploy` builds the frontend Docker asset, and that
        // image is ARM64 (Fargate runs it on ARM64, AgentCore Runtime requires
        // ARM64). Building it on an x86 CodeBuild host without QEMU registered
        // fails with `exec /bin/sh: exec format error`, so build natively on ARM
        // instead. Matches AgentCorePipeline's build environment.
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0,
        computeType,
        // Required for Docker-in-Docker: `cdk deploy` shells out to `docker build`
        // for the frontend image asset.
        privileged: true,
      },
      timeout: cdk.Duration.minutes(timeoutMinutes),
      environmentVariables: {
        AWS_DEFAULT_REGION: { value: cdk.Aws.REGION },
        AWS_ACCOUNT_ID: { value: cdk.Aws.ACCOUNT_ID },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': { nodejs: '20' },
            commands: [
              'echo "Installing CDK dependencies..."',
              'cd infra',
              'npm install',
            ],
          },
          build: {
            commands: [
              'echo "Synthesizing CDK app..."',
              'npx cdk synth',
              'echo "Deploying CDK app (self-mutating)..."',
              'npx cdk deploy --require-approval never --all',
            ],
          },
        },
      }),
    });

    // 3. Deployment permissions — scoped to CDK bootstrap roles
    // CDK deploy works by assuming bootstrap roles (deploy-role calls CloudFormation,
    // file-publishing-role uploads assets, etc.). The CodeBuild role itself does NOT
    // need direct CloudFormation access — all CFN calls go through cfn-exec-role.
    //
    // The qualifier 'hnb659fds' is CDK's default bootstrap qualifier. If you customized
    // it during `cdk bootstrap`, update the qualifier below to match.
    const cdkQualifier = 'hnb659fds';
    const bootstrapRoleArns = [
      `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/cdk-${cdkQualifier}-deploy-role-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/cdk-${cdkQualifier}-cfn-exec-role-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/cdk-${cdkQualifier}-file-publishing-role-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/cdk-${cdkQualifier}-image-publishing-role-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/cdk-${cdkQualifier}-lookup-role-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
    ];

    this.deployProject.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      resources: bootstrapRoleArns,
    }));

    // Before assuming any bootstrap role, the CDK CLI reads the bootstrap
    // version parameter from SSM *as the CodeBuild role itself* to run its
    // version check. Without this, `cdk synth`/`cdk deploy` fails with
    // "not authorized to perform: ssm:GetParameter on .../cdk-bootstrap/<qualifier>/version".
    this.deployProject.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter', 'ssm:GetParameters'],
      resources: [
        `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/cdk-bootstrap/${cdkQualifier}/version`,
      ],
    }));

    // 4. Two-stage pipeline; native trigger disabled (monorepo controls triggering)
    // Req 2.3, 2.4, 3.5
    const triggerPaths = props.monorepoConfig.triggerPaths ?? DEFAULT_INFRA_TRIGGER_PATHS;
    const { repository, branch } = props.monorepoConfig.source;
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
              repository,
              branch,
              output: sourceOutput,
              trigger: codepipeline_actions.CodeCommitTrigger.NONE,
            }),
          ],
        },
        {
          stageName: 'Deploy',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'CDK_Deploy',
              project: this.deployProject,
              input: sourceOutput,
            }),
          ],
        },
      ],
    });

    // 5. Auto-register with MonorepoSource for selective triggering
    // Req 2.2, 2.5
    props.monorepoConfig.source.registerPipeline(props.pipelineName, {
      pipeline: this.pipeline,
      triggerPaths,
    });

    // 6. Output pipeline ARN for reference
    // Req 6.2
    new cdk.CfnOutput(cdk.Stack.of(this), `${id}PipelineArn`, {
      value: this.pipeline.pipelineArn,
      description: 'CodePipeline ARN',
    });
  }
}
