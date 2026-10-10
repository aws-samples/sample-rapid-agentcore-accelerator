// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/** CloudFormation name pattern for AWS::Bedrock::KnowledgeBase. */
const KB_NAME_PATTERN = /^([0-9a-zA-Z][_-]?){1,100}$/;

export interface BedrockKnowledgeBaseProps {
  /**
   * Resolved knowledge base name, e.g. `{deploymentPrefix}-kb-{name}`.
   */
  readonly knowledgeBaseName: string;

  /**
   * Description for the knowledge base
   * @default - No description
   */
  readonly description?: string;
}

export interface S3DataSourceConfig {
  /**
   * Name for the data source
   */
  readonly dataSourceName: string;

  /**
   * S3 bucket containing the source documents
   */
  readonly bucket: s3.IBucket;

  /**
   * Key prefixes in scope for ingestion
   * @default - The whole bucket
   */
  readonly inclusionPrefixes?: string[];
}

/**
 * Amazon Bedrock Managed Knowledge Base (type MANAGED) with a service role,
 * a single permissions policy, and an optional S3 connector data source.
 * Amazon Bedrock owns the datastore, embedding, reranking, parsing, and chunking.
 */
export class BedrockKnowledgeBase extends Construct {
  public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  public readonly knowledgeBaseId: string;
  public readonly knowledgeBaseArn: string;
  public readonly role: iam.Role;

  private readonly policy: iam.Policy;
  private dataSource?: bedrock.CfnDataSource;

  constructor(scope: Construct, id: string, props: BedrockKnowledgeBaseProps) {
    super(scope, id);

    if (!KB_NAME_PATTERN.test(props.knowledgeBaseName)) {
      throw new Error(
        `Invalid knowledge base name "${props.knowledgeBaseName}": names must match ` +
        `${KB_NAME_PATTERN.source} (letters, digits, hyphens and underscores, with at most ` +
        `one separator in a row, up to 100 groups). Rename the knowledgeBases[] entry or deploymentPrefix.`,
      );
    }

    this.role = new iam.Role(this, 'KnowledgeBaseRole', {
      assumedBy: new iam.PrincipalWithConditions(new iam.ServicePrincipal('bedrock.amazonaws.com'), {
        StringEquals: { 'aws:SourceAccount': cdk.Aws.ACCOUNT_ID },
        ArnLike: {
          'aws:SourceArn': `arn:${cdk.Aws.PARTITION}:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:knowledge-base/*`,
        },
      }),
      description: `Service role for Bedrock Knowledge Base ${props.knowledgeBaseName}`,
    });

    // One policy holds every permission statement; addS3DataSource appends to it.
    this.policy = new iam.Policy(this, 'KnowledgeBasePolicy', {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['cloudwatch:PutMetricData'],
          resources: ['*'],
          conditions: {
            StringEquals: { 'cloudwatch:namespace': 'AWS/Bedrock/KnowledgeBases' },
          },
        }),
      ],
    });
    this.policy.attachToRole(this.role);

    this.knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: props.knowledgeBaseName,
      description: props.description,
      roleArn: this.role.roleArn,
      knowledgeBaseConfiguration: {
        type: 'MANAGED',
        managedKnowledgeBaseConfiguration: {
          embeddingModelType: 'MANAGED',
        },
      },
    });
    this.knowledgeBase.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    // Bedrock validates permissions at creation time, so the policy must exist first.
    this.knowledgeBase.node.addDependency(this.policy);

    this.knowledgeBaseId = this.knowledgeBase.attrKnowledgeBaseId;
    this.knowledgeBaseArn = this.knowledgeBase.attrKnowledgeBaseArn;
  }

  /**
   * Add the S3 data source to the knowledge base. Only one data source is supported;
   * a second call throws.
   */
  public addS3DataSource(config: S3DataSourceConfig): bedrock.CfnDataSource {
    if (this.dataSource) {
      throw new Error(
        `Knowledge base "${this.knowledgeBase.name}" already has a data source; only one S3 data source is supported`,
      );
    }

    const sameAccount = { StringEquals: { 'aws:ResourceAccount': cdk.Aws.ACCOUNT_ID } };
    this.policy.addStatements(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:ListBucket'],
        resources: [config.bucket.bucketArn],
        conditions: sameAccount,
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject'],
        resources: [config.bucket.arnForObjects('*')],
        conditions: sameAccount,
      }),
    );

    const dataSource = new bedrock.CfnDataSource(this, 'DataSource0', {
      name: config.dataSourceName,
      knowledgeBaseId: this.knowledgeBaseId,
      dataDeletionPolicy: 'DELETE',
      dataSourceConfiguration: {
        type: 'MANAGED_KNOWLEDGE_BASE_CONNECTOR',
        managedKnowledgeBaseConnectorConfiguration: {
          connectorParameters: {
            type: 'S3',
            version: '1',
            connectionConfiguration: {
              bucketName: config.bucket.bucketName,
              bucketOwnerAccountId: cdk.Aws.ACCOUNT_ID,
            },
            filterConfiguration: {
              inclusionPrefixes: config.inclusionPrefixes,
            },
          },
        },
      },
    });
    dataSource.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    dataSource.addDependency(this.knowledgeBase);
    dataSource.node.addDependency(this.policy);

    this.dataSource = dataSource;
    return dataSource;
  }

  /**
   * Grant bedrock:Retrieve on this knowledge base's ARN only
   */
  public grantRetrieve(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ['bedrock:Retrieve'],
      resourceArns: [this.knowledgeBaseArn],
    });
  }
}
