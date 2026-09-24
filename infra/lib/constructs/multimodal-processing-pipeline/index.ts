// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as path from 'path';
import { Construct } from 'constructs';


/**
 * Text representation formats for extracted content.
 * These determine how text is formatted in the BDA output JSON.
 * Note: CSV only applies to table content.
 */
export enum TextFormat {
  /** Plain text without formatting */
  PLAIN_TEXT = 'PLAIN_TEXT',
  /** Text with markdown formatting (recommended for RAG) */
  MARKDOWN = 'MARKDOWN',
  /** Text with HTML formatting */
  HTML = 'HTML',
  /** CSV format (tables only) */
  CSV = 'CSV',
}

/**
 * Output file format for BDA processing.
 */
export enum OutputFormat {
  /** JSON output only */
  JSON = 'JSON',
  /** JSON plus additional files (.md, .csv, .txt, extracted images) */
  JSON_AND_FILES = 'JSON_AND_FILES',
}

/**
 * Extraction granularity levels for BDA processing.
 */
export enum Granularity {
  /** Page-level extraction */
  PAGE = 'PAGE',
  /** Element-level extraction (paragraphs, tables, etc.) */
  ELEMENT = 'ELEMENT',
  /** Word-level extraction */
  WORD = 'WORD',
}

/**
 * BDA project configuration for document processing.
 */
export interface BdaProjectConfig {
  /**
   * Text representation formats to include in output.
   * Multiple formats can be selected - each will be included in the JSON response.
   * @default - ['MARKDOWN']
   */
  readonly textFormats?: TextFormat[];

  /**
   * Output file format - JSON only or JSON plus additional files.
   * JSON_AND_FILES generates .md, .csv, .txt files and extracted images.
   * @default - OutputFormat.JSON_AND_FILES
   */
  readonly outputFormat?: OutputFormat;

  /**
   * Extraction granularity levels
   * @default - ['ELEMENT', 'PAGE']
   */
  readonly granularity?: Granularity[];

  /**
   * Enable document summaries and figure captions
   * @default - true
   */
  readonly enableGenerativeFields?: boolean;

  /**
   * Include bounding box coordinates in output
   * @default - false
   */
  readonly enableBoundingBoxes?: boolean;

  /**
   * Enable document splitting for large documents.
   * When enabled, documents too large to process in one pass are automatically
   * split into smaller documents for processing.
   * @default - false
   */
  readonly enableDocumentSplitting?: boolean;
}

/**
 * Processing configuration for file filtering and output paths.
 */
export interface ProcessingConfig {
  /**
   * S3 prefix in the input bucket to watch for new documents.
   * Only files uploaded under this prefix will trigger processing.
   * @default - 'raw-documents/'
   */
  readonly inputPrefix?: string;

  /**
   * S3 prefix in the BDA output bucket where BDA writes its raw JSON output (standard-output.json).
   * This is where the Trigger Lambda tells BDA to store its processing results.
   * @default - 'bda-output/'
   */
  readonly bdaOutputPrefix?: string;

  /**
   * S3 prefix in the RAG-ready bucket where the BDA Output Parser writes clean markdown files.
   * Use this prefix when configuring a Knowledge Base data source.
   * @default - 'markdown/'
   */
  readonly ragReadyPrefix?: string;

  /**
   * File extensions to process. Only files with these extensions will trigger the pipeline.
   * @default - ['.pdf', '.docx', '.png', '.jpg', '.jpeg']
   */
  readonly supportedExtensions?: string[];
}


/**
 * Props for the MultimodalProcessingPipeline construct.
 */
export interface MultimodalProcessingPipelineProps {
  /**
   * Name for the pipeline resources
   */
  readonly pipelineName: string;

  /**
   * BDA document processing configuration
   * @default - MARKDOWN output, ELEMENT+PAGE granularity, generativeFields enabled
   */
  readonly bdaProjectConfig?: BdaProjectConfig;

  /**
   * Existing S3 bucket for raw document uploads
   * @default - A new bucket is created
   */
  readonly inputBucket?: s3.IBucket;

  /**
   * Existing S3 bucket for BDA raw output (standard-output.json)
   * @default - A new bucket is created
   */
  readonly bdaOutputBucket?: s3.IBucket;

  /**
   * Existing S3 bucket for RAG-ready markdown files
   * @default - A new bucket is created
   */
  readonly ragReadyBucket?: s3.IBucket;

  /**
   * Existing S3 bucket for extracted assets (images, tables)
   * @default - A new bucket is created
   */
  readonly supplementalBucket?: s3.IBucket;

  /**
   * Processing configuration for file filtering and output paths
   * @default - See ProcessingConfig defaults
   */
  readonly processingConfig?: ProcessingConfig;

  /**
   * Enable CloudWatch alarms for pipeline monitoring.
   * Creates alarms for DLQ messages and Lambda errors.
   * @default - true
   */
  readonly enableMonitoring?: boolean;

  /**
   * S3 bucket to receive server access logs from pipeline buckets.
   * @default - No access logging
   */
  readonly accessLogsBucket?: s3.IBucket;
}

/**
 * L3 CDK construct that creates an event-driven document processing pipeline
 * using Amazon Bedrock Data Automation (BDA).
 *
 * The pipeline automates the transformation of multimodal documents (PDFs, DOCX, images)
 * into markdown format suitable for vector database ingestion and RAG applications.
 *
 * Architecture:
 * 1. Documents uploaded to S3 trigger processing via S3 event notifications
 * 2. SQS queues buffer requests and provide retry/DLQ capabilities
 * 3. Trigger Lambda invokes BDA async processing
 * 4. BDA writes raw JSON output and extracted assets to output buckets
 * 5. EventBridge detects BDA job completion and triggers the BDA Output Parser
 * 6. BDA Output Parser extracts markdown from JSON and writes to RAG-ready bucket
 *
 * To integrate with a Bedrock Knowledge Base, use the ragReadyBucket and ragReadyPrefix
 * properties to configure a data source on your knowledge base with full control
 * over chunking, parsing, and other settings.
 */
export class MultimodalProcessingPipeline extends Construct {
  /** S3 bucket for uploading raw documents */
  public readonly inputBucket: s3.IBucket;

  /** S3 bucket containing BDA raw output (standard-output.json) */
  public readonly bdaOutputBucket: s3.IBucket;

  /** S3 bucket containing RAG-ready markdown files */
  public readonly ragReadyBucket: s3.IBucket;

  /** S3 bucket containing extracted assets */
  public readonly supplementalBucket: s3.IBucket;

  /** ARN of the BDA project */
  public readonly bdaProjectArn: string;

  /** SQS queue for processing requests */
  public readonly processingQueue: sqs.IQueue;

  /** Dead letter queue for failed processing */
  public readonly deadLetterQueue: sqs.IQueue;

  /** Trigger Lambda function that invokes BDA */
  public readonly triggerFunction: lambda.IFunction;

  /** BDA Output Parser Lambda function */
  public readonly bdaOutputParserFunction: lambda.IFunction;

  /** Output prefix where RAG-ready documents are stored (useful for KB data source configuration) */
  public readonly ragReadyPrefix: string;

  /** CloudWatch alarm for DLQ messages (only created if monitoring enabled) */
  public readonly dlqAlarm?: cloudwatch.IAlarm;

  /** CloudWatch alarm for Lambda errors (only created if monitoring enabled) */
  public readonly lambdaErrorAlarm?: cloudwatch.IAlarm;

  constructor(scope: Construct, id: string, props: MultimodalProcessingPipelineProps) {
    super(scope, id);

    // Apply default configurations
    const bdaConfig: Required<BdaProjectConfig> = {
      textFormats: props.bdaProjectConfig?.textFormats ?? [TextFormat.MARKDOWN],
      outputFormat: props.bdaProjectConfig?.outputFormat ?? OutputFormat.JSON_AND_FILES,
      granularity: props.bdaProjectConfig?.granularity ?? [Granularity.ELEMENT, Granularity.PAGE],
      enableGenerativeFields: props.bdaProjectConfig?.enableGenerativeFields ?? true,
      enableBoundingBoxes: props.bdaProjectConfig?.enableBoundingBoxes ?? false,
      enableDocumentSplitting: props.bdaProjectConfig?.enableDocumentSplitting ?? false,
    };

    const processingConfig: Required<ProcessingConfig> = {
      inputPrefix: props.processingConfig?.inputPrefix ?? 'raw-documents/',
      bdaOutputPrefix: props.processingConfig?.bdaOutputPrefix ?? 'bda-output/',
      ragReadyPrefix: props.processingConfig?.ragReadyPrefix ?? 'markdown/',
      supportedExtensions: props.processingConfig?.supportedExtensions ?? ['.pdf', '.docx', '.png', '.jpg', '.jpeg'],
    };



    // Task 2 - Implement S3 bucket creation
    // Use existing buckets if provided, otherwise create new ones with encryption and removal policy
    this.inputBucket = props.inputBucket ?? new s3.Bucket(this, 'InputBucket', {
      bucketName: `${props.pipelineName}-input-${cdk.Aws.ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      serverAccessLogsBucket: props.accessLogsBucket,
      serverAccessLogsPrefix: props.accessLogsBucket ? `${props.pipelineName}-input/` : undefined,
    });

    // BDA output bucket for raw BDA output (standard-output.json)
    this.bdaOutputBucket = props.bdaOutputBucket ?? new s3.Bucket(this, 'BdaOutputBucket', {
      bucketName: `${props.pipelineName}-bda-output-${cdk.Aws.ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      serverAccessLogsBucket: props.accessLogsBucket,
      serverAccessLogsPrefix: props.accessLogsBucket ? `${props.pipelineName}-bda-output/` : undefined,
    });

    // RAG-ready bucket for parsed markdown files ready for Knowledge Base ingestion
    this.ragReadyBucket = props.ragReadyBucket ?? new s3.Bucket(this, 'RagReadyBucket', {
      bucketName: `${props.pipelineName}-rag-ready-${cdk.Aws.ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      serverAccessLogsBucket: props.accessLogsBucket,
      serverAccessLogsPrefix: props.accessLogsBucket ? `${props.pipelineName}-rag-ready/` : undefined,
    });

    this.supplementalBucket = props.supplementalBucket ?? new s3.Bucket(this, 'SupplementalBucket', {
      bucketName: `${props.pipelineName}-supplemental-${cdk.Aws.ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      serverAccessLogsBucket: props.accessLogsBucket,
      serverAccessLogsPrefix: props.accessLogsBucket ? `${props.pipelineName}-supplemental/` : undefined,
    });

    // Task 3 - Implement SQS queues with DLQ configuration
    // Create dead letter queue for failed messages
    this.deadLetterQueue = new sqs.Queue(this, 'DeadLetterQueue', {
      queueName: `${props.pipelineName}-dlq`,
      retentionPeriod: cdk.Duration.days(14),
    });

    // Create main processing queue with visibility timeout for Lambda processing
    // Visibility timeout should be at least 6x the Lambda timeout (default 30s * 6 = 180s)
    this.processingQueue = new sqs.Queue(this, 'ProcessingQueue', {
      queueName: `${props.pipelineName}-processing`,
      visibilityTimeout: cdk.Duration.minutes(5),
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    // Task 4 - Implement BDA project creation
    const bdaProject = new bedrock.CfnDataAutomationProject(this, 'BdaProject', {
      projectName: `${props.pipelineName}-bda-project`,
      projectDescription: `Document processing project for ${props.pipelineName}`,
      standardOutputConfiguration: {
        document: {
          extraction: {
            granularity: {
              types: bdaConfig.granularity,
            },
            boundingBox: {
              state: bdaConfig.enableBoundingBoxes ? 'ENABLED' : 'DISABLED',
            },
          },
          generativeField: {
            state: bdaConfig.enableGenerativeFields ? 'ENABLED' : 'DISABLED',
          },
          outputFormat: {
            textFormat: {
              types: bdaConfig.textFormats,
            },
            additionalFileFormat: {
              state: bdaConfig.outputFormat === OutputFormat.JSON_AND_FILES ? 'ENABLED' : 'DISABLED',
            },
          },
        },
      },
      // Document splitter is configured via overrideConfiguration
      overrideConfiguration: bdaConfig.enableDocumentSplitting ? {
        document: {
          splitter: {
            state: 'ENABLED',
          },
        },
      } : undefined,
    });

    this.bdaProjectArn = bdaProject.attrProjectArn;

    // Task 5 - Implement trigger Lambda function
    // Create CloudWatch log group with 7-day retention
    const logGroup = new logs.LogGroup(this, 'TriggerFunctionLogGroup', {
      logGroupName: `/aws/lambda/${props.pipelineName}-trigger`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Determine the data automation profile ARN based on deployment region
    // BDA requires cross-region inference support (CRIS) via a profile ARN
    // Profile pattern: arn:aws:bedrock:{region}:{account}:data-automation-profile/{geo}.data-automation-v1
    // See: https://docs.aws.amazon.com/bedrock/latest/userguide/bda-cris.html
    const dataAutomationProfileArn = this.getDataAutomationProfileArn();

    // Create Lambda function for triggering BDA processing
    const triggerFunction = new lambda.Function(this, 'TriggerFunction', {
      functionName: `${props.pipelineName}-trigger`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambda/document-processor')),
      timeout: cdk.Duration.minutes(1),
      memorySize: 256,
      environment: {
        BDA_PROJECT_ARN: this.bdaProjectArn,
        BDA_OUTPUT_BUCKET: this.bdaOutputBucket.bucketName,
        BDA_OUTPUT_PREFIX: processingConfig.bdaOutputPrefix,
        SUPPLEMENTAL_BUCKET: this.supplementalBucket.bucketName,
        DATA_AUTOMATION_PROFILE_ARN: dataAutomationProfileArn,
      },
      logGroup: logGroup,
    });

    // Grant least-privilege IAM permissions
    // Permission to read from input bucket
    this.inputBucket.grantRead(triggerFunction);

    // Permission to write to BDA output and supplemental buckets
    this.bdaOutputBucket.grantWrite(triggerFunction);
    this.supplementalBucket.grantWrite(triggerFunction);

    // Permission to invoke BDA APIs - scoped to this pipeline's BDA project
    triggerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeDataAutomationAsync',
        'bedrock:GetDataAutomationStatus',
        'bedrock:GetDataAutomationProject',
      ],
      resources: [this.bdaProjectArn],
    }));

    // BDA needs permission to read from input bucket and write to output/supplemental buckets
    // Grant BDA service principal access to buckets
    const bdaServicePrincipal = new iam.ServicePrincipal('bedrock.amazonaws.com');
    
    this.inputBucket.grantRead(bdaServicePrincipal);
    this.bdaOutputBucket.grantWrite(bdaServicePrincipal);
    this.supplementalBucket.grantWrite(bdaServicePrincipal);

    this.triggerFunction = triggerFunction;

    // Task 6 - Implement S3 event notifications
    // Add SQS event source to Lambda so it processes messages from the queue
    triggerFunction.addEventSource(new lambdaEventSources.SqsEventSource(this.processingQueue, {
      batchSize: 1, // Process one document at a time
    }));

    // Configure S3 event notifications to SQS for ObjectCreated events
    // Filter by input prefix and supported file extensions
    // Note: S3 event notifications require the bucket to be an L2 Bucket, not IBucket
    // If an existing bucket is provided, we need to check if we can add notifications
    if (this.inputBucket instanceof s3.Bucket) {
      // Create suffix filters for each supported extension
      for (const extension of processingConfig.supportedExtensions) {
        this.inputBucket.addEventNotification(
          s3.EventType.OBJECT_CREATED,
          new s3n.SqsDestination(this.processingQueue),
          {
            prefix: processingConfig.inputPrefix,
            suffix: extension,
          }
        );
      }
    }

    // Task 7 - Implement BDA Output Parser Lambda
    // Create CloudWatch log group with 7-day retention for parser function
    const parserLogGroup = new logs.LogGroup(this, 'BdaOutputParserLogGroup', {
      logGroupName: `/aws/lambda/${props.pipelineName}-bda-output-parser`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create BDA Output Parser Lambda function
    const bdaOutputParserFunction = new lambda.Function(this, 'BdaOutputParserFunction', {
      functionName: `${props.pipelineName}-bda-output-parser`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../lambda/bda-output-parser')),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        RAG_READY_BUCKET: this.ragReadyBucket.bucketName,
        RAG_READY_PREFIX: processingConfig.ragReadyPrefix,
      },
      logGroup: parserLogGroup,
    });

    // Grant read permissions on BDA output bucket
    this.bdaOutputBucket.grantRead(bdaOutputParserFunction);

    // Grant write permissions on RAG-ready bucket
    this.ragReadyBucket.grantWrite(bdaOutputParserFunction);

    this.bdaOutputParserFunction = bdaOutputParserFunction;

    // Task 8 - Implement EventBridge integration for BDA job completion
    // Create EventBridge rule matching "Bedrock Data Automation Job Succeeded" events
    const bdaJobSucceededRule = new events.Rule(this, 'BdaJobSucceededRule', {
      ruleName: `${props.pipelineName}-bda-job-succeeded`,
      description: 'Triggers BDA Output Parser when a BDA job completes successfully',
      eventPattern: {
        source: ['aws.bedrock'],
        detailType: ['Bedrock Data Automation Job Succeeded'],
      },
    });

    // Configure rule to target BDA Output Parser Lambda
    // EventBridge permission to invoke Lambda is automatically granted by addTarget
    bdaJobSucceededRule.addTarget(new targets.LambdaFunction(bdaOutputParserFunction, {
      retryAttempts: 2,
    }));

    // Expose RAG-ready prefix for easy KB data source configuration
    this.ragReadyPrefix = processingConfig.ragReadyPrefix;

    // Task 9 - Lightweight CloudWatch monitoring (optional)
    if (props.enableMonitoring !== false) {
      // Alarm when messages land in DLQ (indicates processing failures)
      this.dlqAlarm = new cloudwatch.Alarm(this, 'DlqAlarm', {
        alarmName: `${props.pipelineName}-dlq-messages`,
        alarmDescription: 'Documents failed processing and landed in DLQ',
        metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
          period: cdk.Duration.minutes(5),
          statistic: 'Sum',
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      // Alarm when Lambda functions have errors
      this.lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
        alarmName: `${props.pipelineName}-lambda-errors`,
        alarmDescription: 'Pipeline Lambda functions are experiencing errors',
        metric: new cloudwatch.MathExpression({
          expression: 'triggerErrors + parserErrors',
          usingMetrics: {
            triggerErrors: triggerFunction.metricErrors({ period: cdk.Duration.minutes(5) }),
            parserErrors: bdaOutputParserFunction.metricErrors({ period: cdk.Duration.minutes(5) }),
          },
        }),
        threshold: 3,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    }
  }

  /**
   * Determines the BDA data automation profile ARN based on the deployment region.
   * BDA requires Cross-Region Inference Support (CRIS) which routes requests to
   * optimal regions within the same geography.
   * 
   * Geography mapping:
   * - US regions (us-*) → us.data-automation-v1
   * - EU regions (eu-*) → eu.data-automation-v1
   * - APAC regions (ap-*) → apac.data-automation-v1
   * - GovCloud (us-gov-*) → us-gov.data-automation-v1
   * 
   * @see https://docs.aws.amazon.com/bedrock/latest/userguide/bda-cris.html
   */
  private getDataAutomationProfileArn(): string {
    // Use CDK's Fn.conditionIf to handle region resolution at deploy time
    // Since cdk.Aws.REGION is a token, we need to use CloudFormation intrinsic functions
    
    // Create conditions for each geography
    const isEuRegion = new cdk.CfnCondition(this, 'IsEuRegion', {
      expression: cdk.Fn.conditionEquals(cdk.Fn.select(0, cdk.Fn.split('-', cdk.Aws.REGION)), 'eu'),
    });

    const isApacRegion = new cdk.CfnCondition(this, 'IsApacRegion', {
      expression: cdk.Fn.conditionEquals(cdk.Fn.select(0, cdk.Fn.split('-', cdk.Aws.REGION)), 'ap'),
    });

    // Build the profile identifier using nested conditionals
    // Default to 'us' if no match (safest fallback for most deployments)
    const profileGeo = cdk.Fn.conditionIf(
      isEuRegion.logicalId,
      'eu',
      cdk.Fn.conditionIf(
        isApacRegion.logicalId,
        'apac',
        'us', // Default to US for us-* regions and any unmatched regions
      ),
    ).toString();

    return `arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:data-automation-profile/${profileGeo}.data-automation-v1`;
  }
}
