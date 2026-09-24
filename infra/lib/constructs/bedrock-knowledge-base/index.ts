// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as s3vectors from 'aws-cdk-lib/aws-s3vectors';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Names } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface BedrockKnowledgeBaseProps {
  /**
   * Name for the knowledge base
   */
  readonly knowledgeBaseName: string;

  /**
   * Description for the knowledge base
   * @default - No description
   */
  readonly description?: string;

  /**
   * Embedding model ID to use for the knowledge base
   * @default 'amazon.titan-embed-text-v2:0'
   */
  readonly embeddingModelId?: string;

  /**
   * Vector dimension for the embedding model
   * @default 1024 (for Titan Embed Text v2)
   */
  readonly vectorDimension?: number;

  /**
   * S3 bucket for storing supplemental data (extracted images, etc.)
   * Required when using BEDROCK_DATA_AUTOMATION parsing strategy.
   * @default - No supplemental data storage (BDA parsing not available)
   */
  readonly supplementalDataBucket?: s3.IBucket;
}

/**
 * Parsing strategy for document processing
 */
export enum ParsingStrategy {
  /**
   * Default parsing - no advanced parsing
   */
  NONE = 'NONE',

  /**
   * Use Bedrock Data Automation for parsing
   */
  BEDROCK_DATA_AUTOMATION = 'BEDROCK_DATA_AUTOMATION',

  /**
   * Use a Bedrock Foundation Model for parsing (good for complex documents like PDFs with tables)
   */
  BEDROCK_FOUNDATION_MODEL = 'BEDROCK_FOUNDATION_MODEL',
}

/**
 * Configuration for Foundation Model parsing
 */
export interface FoundationModelParsingConfig {
  /**
   * The model ARN to use for parsing (e.g., Claude)
   * @example 'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0'
   */
  readonly modelArn: string;

  /**
   * Custom prompt for parsing instructions
   * @default - Uses Bedrock's default parsing prompt
   */
  readonly parsingPromptText?: string;
}

/**
 * Parsing configuration for the data source
 */
export interface ParsingConfig {
  /**
   * The parsing strategy to use
   */
  readonly strategy: ParsingStrategy;

  /**
   * Configuration for Foundation Model parsing (required when strategy is BEDROCK_FOUNDATION_MODEL)
   */
  readonly foundationModelConfig?: FoundationModelParsingConfig;
}

/**
 * Chunking strategy for document processing
 */
export enum ChunkingStrategy {
  /**
   * Treat each file as one chunk (no splitting)
   */
  NONE = 'NONE',

  /**
   * Split into fixed-size chunks based on token count
   */
  FIXED_SIZE = 'FIXED_SIZE',

  /**
   * Two-layer chunking: large chunks containing smaller child chunks
   */
  HIERARCHICAL = 'HIERARCHICAL',

  /**
   * Split based on semantic similarity using NLP
   */
  SEMANTIC = 'SEMANTIC',
}

/**
 * Configuration for fixed-size chunking
 */
export interface FixedSizeChunkingConfig {
  /**
   * Maximum number of tokens per chunk
   * @default 300
   */
  readonly maxTokens?: number;

  /**
   * Percentage of overlap between chunks (0-100)
   * @default 20
   */
  readonly overlapPercentage?: number;
}

/**
 * Configuration for hierarchical chunking
 */
export interface HierarchicalChunkingConfig {
  /**
   * Max tokens for parent (large) chunks
   * @default 1500
   */
  readonly parentMaxTokens?: number;

  /**
   * Max tokens for child (small) chunks
   * @default 300
   */
  readonly childMaxTokens?: number;

  /**
   * Number of tokens to overlap between chunks
   * @default 60
   */
  readonly overlapTokens?: number;
}

/**
 * Configuration for semantic chunking
 */
export interface SemanticChunkingConfig {
  /**
   * Maximum number of tokens per chunk
   * @default 300
   */
  readonly maxTokens?: number;

  /**
   * Number of sentences to buffer for context
   * @default 1
   */
  readonly bufferSize?: number;

  /**
   * Percentile threshold for breakpoint detection (1-99)
   * @default 95
   */
  readonly breakpointPercentileThreshold?: number;
}

/**
 * Chunking configuration for the data source
 */
export interface ChunkingConfig {
  /**
   * The chunking strategy to use
   */
  readonly strategy: ChunkingStrategy;

  /**
   * Configuration for fixed-size chunking (used when strategy is FIXED_SIZE)
   */
  readonly fixedSizeConfig?: FixedSizeChunkingConfig;

  /**
   * Configuration for hierarchical chunking (used when strategy is HIERARCHICAL)
   */
  readonly hierarchicalConfig?: HierarchicalChunkingConfig;

  /**
   * Configuration for semantic chunking (used when strategy is SEMANTIC)
   */
  readonly semanticConfig?: SemanticChunkingConfig;
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
   * Optional prefix to filter objects in the bucket
   * @default - No prefix filter
   */
  readonly inclusionPrefixes?: string[];

  /**
   * Parsing configuration for document processing
   * @default - No advanced parsing (NONE strategy)
   */
  readonly parsingConfig?: ParsingConfig;

  /**
   * Chunking configuration for document splitting
   * @default - Bedrock default chunking
   */
  readonly chunkingConfig?: ChunkingConfig;
}


export class BedrockKnowledgeBase extends Construct {
  public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  public readonly knowledgeBaseId: string;
  public readonly knowledgeBaseArn: string;
  public readonly vectorBucket: s3vectors.CfnVectorBucket;
  public readonly vectorIndex: s3vectors.CfnIndex;
  public readonly role: iam.Role;

  private readonly dataSources: bedrock.CfnDataSource[] = [];
  private readonly hasSupplementalDataStorage: boolean;

  constructor(scope: Construct, id: string, props: BedrockKnowledgeBaseProps) {
    super(scope, id);

    const embeddingModelId = props.embeddingModelId ?? 'amazon.titan-embed-text-v2:0';
    const vectorDimension = props.vectorDimension ?? 1024;

    // Generate unique suffix for resource names (lowercase, max 8 chars)
    const uniqueSuffix = Names.uniqueId(this).slice(-8).toLowerCase();

    // Create S3 Vector Bucket for storing embeddings
    this.vectorBucket = new s3vectors.CfnVectorBucket(this, 'VectorBucket', {
      vectorBucketName: `kb-vectors-${uniqueSuffix}`,
    });
    this.vectorBucket.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Create Vector Index within the bucket
    this.vectorIndex = new s3vectors.CfnIndex(this, 'VectorIndex', {
      vectorBucketArn: this.vectorBucket.attrVectorBucketArn,
      indexName: `kb-index-${uniqueSuffix}`,
      dataType: 'float32',
      dimension: vectorDimension,
      distanceMetric: 'cosine',
      metadataConfiguration: {
        nonFilterableMetadataKeys: ['AMAZON_BEDROCK_TEXT', 'AMAZON_BEDROCK_METADATA'],
      },
    });
    this.vectorIndex.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    this.vectorIndex.addDependency(this.vectorBucket);

    // IAM Role for Knowledge Base
    this.role = new iam.Role(this, 'KnowledgeBaseRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description: `Service role for Bedrock Knowledge Base ${props.knowledgeBaseName}`,
    });

    // Create policy with all required permissions
    const policyStatements = [
      // Bedrock model invocation
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/${embeddingModelId}`,
        ],
      }),
      // S3 Vectors index operations
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3vectors:GetIndex',
          's3vectors:QueryVectors',
          's3vectors:PutVectors',
          's3vectors:GetVectors',
          's3vectors:DeleteVectors',
        ],
        resources: [
          this.vectorIndex.attrIndexArn,
          this.vectorIndex.attrIndexArn + '/*',
        ],
      }),
    ];

    // Add BDA permissions if supplemental data bucket is provided (required for BDA parsing)
    // Note: bedrock:InvokeDataAutomationAsync requires wildcard resource here because the
    // BDA project ARN is not available in this construct — it's created separately.
    // For production, pass the specific BDA project ARN via props and scope this down.
    if (props.supplementalDataBucket) {
      policyStatements.push(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['bedrock:InvokeDataAutomationAsync', 'bedrock:GetDataAutomationStatus'],
          // TODO: narrow to the BDA project ARN. Becomes necessary as soon as a caller
          // needs least-privilege IAM — the wildcard is only tenable because the BDA
          // project is created outside this construct and its ARN is not reachable here.
          // Unblocked by adding a `bdaProjectArn` prop and passing it from the caller
          // that owns the MultimodalProcessingPipeline.
          resources: ['*'],
        }),
      );
    }

    const policy = new iam.Policy(this, 'KnowledgeBasePolicy', {
      statements: policyStatements,
    });
    policy.attachToRole(this.role);

    // Build supplemental data storage configuration if bucket provided
    const supplementalDataStorageConfiguration = props.supplementalDataBucket
      ? {
          supplementalDataStorageLocations: [
            {
              supplementalDataStorageLocationType: 'S3',
              s3Location: {
                uri: `s3://${props.supplementalDataBucket.bucketName}/`,
              },
            },
          ],
        }
      : undefined;

    // Grant write access to supplemental data bucket if provided
    if (props.supplementalDataBucket) {
      props.supplementalDataBucket.grantReadWrite(this.role);
    }

    // Create Knowledge Base with S3Vectors storage
    this.knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: props.knowledgeBaseName,
      description: props.description,
      roleArn: this.role.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/${embeddingModelId}`,
          supplementalDataStorageConfiguration,
        },
      },
      storageConfiguration: {
        type: 'S3_VECTORS',
        s3VectorsConfiguration: {
          vectorBucketArn: this.vectorBucket.attrVectorBucketArn,
          indexArn: this.vectorIndex.attrIndexArn,
        },
      },
    });
    this.knowledgeBase.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    this.knowledgeBase.addDependency(this.vectorIndex);
    this.knowledgeBase.node.addDependency(policy);
    // Ensure the role's DefaultPolicy (containing S3 grants from grantReadWrite)
    // is fully created before the KB, so Bedrock's validation sees the permissions.
    const defaultPolicy = this.role.node.tryFindChild('DefaultPolicy') as iam.Policy | undefined;
    if (defaultPolicy) {
      this.knowledgeBase.node.addDependency(defaultPolicy);
    }
    // Ensure supplemental data bucket exists before KB (if provided)
    if (props.supplementalDataBucket) {
      this.knowledgeBase.node.addDependency(props.supplementalDataBucket);
    }

    this.knowledgeBaseId = this.knowledgeBase.attrKnowledgeBaseId;
    this.knowledgeBaseArn = this.knowledgeBase.attrKnowledgeBaseArn;
    this.hasSupplementalDataStorage = !!props.supplementalDataBucket;
  }


  /**
   * Add an S3 data source to the knowledge base
   */
  public addS3DataSource(config: S3DataSourceConfig): bedrock.CfnDataSource {
    // Validate BDA parsing requires supplemental data storage
    if (
      config.parsingConfig?.strategy === ParsingStrategy.BEDROCK_DATA_AUTOMATION &&
      !this.hasSupplementalDataStorage
    ) {
      throw new Error(
        'BEDROCK_DATA_AUTOMATION parsing requires supplementalDataBucket to be configured on the knowledge base',
      );
    }

    // Grant read access to the source bucket
    config.bucket.grantRead(this.role);

    // Build parsing configuration if specified
    let parsingConfiguration: bedrock.CfnDataSource.ParsingConfigurationProperty | undefined;
    if (config.parsingConfig && config.parsingConfig.strategy !== ParsingStrategy.NONE) {
      parsingConfiguration = this.buildParsingConfiguration(config.parsingConfig);
    }

    // Build chunking configuration if specified
    let chunkingConfiguration: bedrock.CfnDataSource.ChunkingConfigurationProperty | undefined;
    if (config.chunkingConfig) {
      chunkingConfiguration = this.buildChunkingConfiguration(config.chunkingConfig);
    }

    // Build vectorIngestionConfiguration only if we have parsing or chunking config
    const hasIngestionConfig = parsingConfiguration || chunkingConfiguration;
    const vectorIngestionConfiguration = hasIngestionConfig
      ? {
          parsingConfiguration,
          chunkingConfiguration,
        }
      : undefined;

    const dataSource = new bedrock.CfnDataSource(this, `DataSource${this.dataSources.length}`, {
      name: config.dataSourceName,
      knowledgeBaseId: this.knowledgeBaseId,
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: config.bucket.bucketArn,
          inclusionPrefixes: config.inclusionPrefixes,
        },
      },
      vectorIngestionConfiguration,
      dataDeletionPolicy: 'DELETE',
    });
    dataSource.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    dataSource.addDependency(this.knowledgeBase);
    // Ensure the IAM role policy (with bucket read access) is created before the data source,
    // so Bedrock's validation can see the permissions at creation time.
    dataSource.node.addDependency(this.role);
    // Also depend on the inline policy that was mutated by grantRead above.
    // Without this, CloudFormation may create the data source before the S3 policy
    // statement propagates, causing Bedrock's permission validation to fail.
    const roleDefaultPolicy = this.role.node.tryFindChild('DefaultPolicy') as iam.Policy | undefined;
    if (roleDefaultPolicy) {
      dataSource.node.addDependency(roleDefaultPolicy);
    }

    this.dataSources.push(dataSource);
    return dataSource;
  }

  /**
   * Build the parsing configuration based on the strategy
   */
  private buildParsingConfiguration(
    config: ParsingConfig,
  ): bedrock.CfnDataSource.ParsingConfigurationProperty {
    switch (config.strategy) {
      case ParsingStrategy.BEDROCK_DATA_AUTOMATION:
        return {
          parsingStrategy: 'BEDROCK_DATA_AUTOMATION',
          bedrockDataAutomationConfiguration: {
            parsingModality: 'MULTIMODAL',
          },
        };

      case ParsingStrategy.BEDROCK_FOUNDATION_MODEL:
        if (!config.foundationModelConfig) {
          throw new Error(
            'foundationModelConfig is required when using BEDROCK_FOUNDATION_MODEL strategy',
          );
        }
        return {
          parsingStrategy: 'BEDROCK_FOUNDATION_MODEL',
          bedrockFoundationModelConfiguration: {
            modelArn: config.foundationModelConfig.modelArn,
            parsingPrompt: config.foundationModelConfig.parsingPromptText
              ? { parsingPromptText: config.foundationModelConfig.parsingPromptText }
              : undefined,
          },
        };

      default:
        throw new Error(`Unknown parsing strategy: ${config.strategy}`);
    }
  }

  /**
   * Build the chunking configuration based on the strategy
   */
  private buildChunkingConfiguration(
    config: ChunkingConfig,
  ): bedrock.CfnDataSource.ChunkingConfigurationProperty {
    switch (config.strategy) {
      case ChunkingStrategy.NONE:
        return { chunkingStrategy: 'NONE' };

      case ChunkingStrategy.FIXED_SIZE:
        return {
          chunkingStrategy: 'FIXED_SIZE',
          fixedSizeChunkingConfiguration: {
            maxTokens: config.fixedSizeConfig?.maxTokens ?? 300,
            overlapPercentage: config.fixedSizeConfig?.overlapPercentage ?? 20,
          },
        };

      case ChunkingStrategy.HIERARCHICAL:
        return {
          chunkingStrategy: 'HIERARCHICAL',
          hierarchicalChunkingConfiguration: {
            levelConfigurations: [
              { maxTokens: config.hierarchicalConfig?.parentMaxTokens ?? 1500 },
              { maxTokens: config.hierarchicalConfig?.childMaxTokens ?? 300 },
            ],
            overlapTokens: config.hierarchicalConfig?.overlapTokens ?? 60,
          },
        };

      case ChunkingStrategy.SEMANTIC:
        return {
          chunkingStrategy: 'SEMANTIC',
          semanticChunkingConfiguration: {
            maxTokens: config.semanticConfig?.maxTokens ?? 300,
            bufferSize: config.semanticConfig?.bufferSize ?? 1,
            breakpointPercentileThreshold:
              config.semanticConfig?.breakpointPercentileThreshold ?? 95,
          },
        };

      default:
        throw new Error(`Unknown chunking strategy: ${config.strategy}`);
    }
  }

  /**
   * Grant retrieve permissions to a principal
   */
  public grantRetrieve(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ['bedrock:Retrieve'],
      resourceArns: [this.knowledgeBaseArn],
    });
  }

  /**
   * Grant retrieve and generate permissions to a principal
   */
  public grantRetrieveAndGenerate(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ['bedrock:Retrieve', 'bedrock:RetrieveAndGenerate'],
      resourceArns: [this.knowledgeBaseArn],
    });
  }
}
