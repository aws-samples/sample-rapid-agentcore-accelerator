// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

/**
 * Configuration for the CodeCommit repository
 */
export interface MonorepoSourceRepositoryConfig {
  /**
   * Use an existing CodeCommit repository instead of creating a new one.
   * @default - Creates a new repository
   */
  readonly existingRepository?: codecommit.IRepository;

  /**
   * Name for the new CodeCommit repository (ignored if existingRepository is provided).
   * @default 'monorepo'
   */
  readonly repositoryName?: string;

  /**
   * Branch to monitor for changes.
   * @default 'main'
   */
  readonly branch?: string;
}

/**
 * Props for the MonorepoSource construct
 */
export interface MonorepoSourceProps {
  /**
   * Repository configuration.
   * @default - Creates new repository named 'monorepo' on 'main' branch
   */
  readonly repositoryConfig?: MonorepoSourceRepositoryConfig;

  /**
   * Lambda function timeout in seconds.
   * @default 60
   */
  readonly lambdaTimeoutSeconds?: number;

  /**
   * Description for the repository.
   * @default - No description
   */
  readonly description?: string;
}

/**
 * Pipeline registration entry
 */
export interface PipelineRegistration {
  /**
   * The CodePipeline to trigger
   */
  readonly pipeline: codepipeline.IPipeline;

  /**
   * Glob patterns that trigger this pipeline (relative to repo root).
   * A change in any file matching these patterns will trigger the pipeline.
   * Supports standard glob patterns: *, **, ?, [abc], etc.
   * 
   * @example 
   * ['agent/**']           // Any file in agent directory or subdirectories
   * ['shared/**\/*.py']     // Only Python files in shared directory
   * ['docs/**\/*.md']       // Only markdown files in docs
   * ['*.json', '*.yaml']   // Config files in root
   */
  readonly triggerPaths: string[];
}

/**
 * L3 construct that manages a monorepo source with selective pipeline triggering
 */
export class MonorepoSource extends Construct {
  /** The CodeCommit repository */
  public readonly repository: codecommit.IRepository;
  
  /** The Lambda function that handles triggers */
  public readonly triggerFunction: lambda.Function;
  
  /** The EventBridge rule that captures repository events */
  public readonly eventRule: events.Rule;
  
  /** The SSM parameter storing the last processed commit */
  public readonly lastCommitParameter: ssm.StringParameter;
  
  /** The branch being monitored */
  public readonly branch: string;

  /** Internal storage for pipeline registrations */
  private readonly pipelineRegistrations: Map<string, PipelineRegistration> = new Map();

  constructor(scope: Construct, id: string, props: MonorepoSourceProps = {}) {
    super(scope, id);

    const repositoryConfig = props.repositoryConfig ?? {};
    this.branch = repositoryConfig.branch ?? 'main';
    
    // CodeCommit repository - create new or use existing
    let repoName: string;
    if (repositoryConfig.existingRepository) {
      this.repository = repositoryConfig.existingRepository;
      // For existing repositories, we need a concrete name for the SSM parameter
      // If repositoryName is provided in config, use it; otherwise use a default
      repoName = repositoryConfig.repositoryName ?? 'existing-repo';
    } else {
      repoName = repositoryConfig.repositoryName ?? 'monorepo';
      this.repository = new codecommit.Repository(this, 'Repository', {
        repositoryName: repoName,
        description: props.description ?? `Monorepo source repository`,
      });

      // Add stack outputs for clone URLs when creating new repository
      const stack = cdk.Stack.of(this);
      new cdk.CfnOutput(stack, `${id}RepoCloneUrlHttp`, {
        value: this.repository.repositoryCloneUrlHttp,
        description: 'CodeCommit repository HTTPS clone URL',
      });

      new cdk.CfnOutput(stack, `${id}RepoCloneUrlSsh`, {
        value: this.repository.repositoryCloneUrlSsh,
        description: 'CodeCommit repository SSH clone URL',
      });
    }

    // SSM parameter for tracking last processed commit
    // Use the concrete repository name (not a token) and add stack name for uniqueness
    const stackName = cdk.Stack.of(this).stackName;
    this.lastCommitParameter = new ssm.StringParameter(this, 'LastCommitParameter', {
      parameterName: `/MonoRepoTrigger/${stackName}/${repoName}/${this.branch}/LastCommit`,
      stringValue: 'none', // Initial value - 'none' indicates no commits processed yet
      description: `Last processed commit ID for ${repoName}/${this.branch} in stack ${stackName}`,
      simpleName: false, // Allow full parameter name
    });

    // Lambda trigger function
    const lambdaTimeout = props.lambdaTimeoutSeconds ?? 60;
    
    this.triggerFunction = new lambda.Function(this, 'TriggerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/monorepo-trigger'),
      timeout: cdk.Duration.seconds(lambdaTimeout),
      description: 'Monorepo pipeline trigger function',
      environment: {
        PIPELINE_MAPPINGS: '{}', // Will be updated when pipelines are registered
        STACK_NAME: stackName,
        REPOSITORY_NAME: repoName,
        BRANCH_NAME: this.branch,
      },
    });

    // Grant CodeCommit read permissions to Lambda
    this.repository.grantRead(this.triggerFunction);

    // Grant SSM read/write permissions for the parameter
    this.lastCommitParameter.grantRead(this.triggerFunction);
    this.lastCommitParameter.grantWrite(this.triggerFunction);

    // EventBridge rule for CodeCommit repository state change events
    this.eventRule = new events.Rule(this, 'EventRule', {
      description: `Trigger monorepo pipeline processing for ${repoName}/${this.branch}`,
      eventPattern: {
        source: ['aws.codecommit'],
        detailType: ['CodeCommit Repository State Change'],
        detail: {
          repositoryName: [repoName],
          referenceType: ['branch'],
          referenceName: [this.branch],
        },
      },
      targets: [new events_targets.LambdaFunction(this.triggerFunction)],
    });

    // Construction ends here by design. Pipelines are attached after the fact by
    // registerPipeline(), which rewrites the trigger Lambda's PIPELINE_MAPPINGS
    // environment variable, so no per-pipeline resource is created in the constructor.
    //
    // TODO: add a second source binding. Becomes necessary only if a repository other
    // than CodeCommit is supported — the EventBridge rule above matches
    // `aws.codecommit` repository state changes exclusively, so a GitHub or S3 source
    // would need its own rule and its own last-commit tracking.
  }

  /**
   * Register a pipeline to be triggered when changes occur in files matching specified glob patterns.
   * @param id Unique identifier for this registration
   * @param registration Pipeline and trigger pattern configuration
   */
  public registerPipeline(id: string, registration: PipelineRegistration): void {
    // Validate trigger patterns
    if (!registration.triggerPaths || registration.triggerPaths.length === 0) {
      throw new Error('triggerPaths must contain at least one pattern');
    }

    for (const pattern of registration.triggerPaths) {
      if (pattern.startsWith('/')) {
        throw new Error('triggerPaths must be relative patterns (no leading /)');
      }
      if (pattern.includes('..')) {
        throw new Error('triggerPaths cannot contain parent directory references (..)');
      }
    }

    // Check for duplicate registration
    if (this.pipelineRegistrations.has(id)) {
      throw new Error(`Pipeline ${id} is already registered`);
    }

    // Store the registration
    this.pipelineRegistrations.set(id, registration);

    // Grant Lambda permission to start this pipeline
    this.triggerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['codepipeline:StartPipelineExecution'],
      resources: [registration.pipeline.pipelineArn],
    }));

    // Update Lambda environment variable with current mappings
    this.updateLambdaEnvironment();
  }

  /**
   * Update the Lambda function's environment variable with current pipeline mappings
   */
  private updateLambdaEnvironment(): void {
    const pipelineMappings: Record<string, string[]> = {};
    
    for (const [id, registration] of this.pipelineRegistrations) {
      pipelineMappings[registration.pipeline.pipelineName] = registration.triggerPaths;
    }

    // Update the Lambda function's environment variable
    this.triggerFunction.addEnvironment('PIPELINE_MAPPINGS', JSON.stringify(pipelineMappings));
  }
}
