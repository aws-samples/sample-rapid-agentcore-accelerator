# MultimodalProcessingPipeline

An L3 CDK construct that creates an event-driven multimodal processing pipeline using Amazon Bedrock Data Automation (BDA). The pipeline automates the transformation of multimodal documents (PDFs, DOCX, images) into clean markdown format optimized for vector database ingestion and RAG applications.

**Status: opt-in.** This construct is not instantiated by the default deployment. `AgentCoreStack` never creates it, and no `config.yaml` key switches it on. To use it, instantiate it yourself in a stack — see [Basic Usage](#basic-usage) — and read [Limitations](#limitations) first, since it has not been exercised by the default deployment path.

## Features

- **Event-driven processing**: Documents uploaded to S3 automatically trigger processing
- **BDA integration**: Uses Bedrock Data Automation for high-quality document extraction
- **Automatic markdown extraction**: BDA Output Parser converts complex JSON output to clean markdown
- **RAG-ready output**: Processed documents are ready for direct Knowledge Base ingestion
- **Configurable output**: Support for markdown, plain text, HTML, and CSV formats
- **Large document support**: Optional document splitting for files too large to process in one pass
- **Retry handling**: SQS-based queue with dead letter queue for failed processing
- **Cross-region inference**: Automatic BDA profile selection based on deployment region (US/EU/APAC)
- **Optional monitoring**: CloudWatch alarms for DLQ messages and Lambda errors
- **Sensible defaults**: Works out of the box with minimal configuration

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                           MultimodalProcessingPipeline                                    │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                           │
│  ┌──────────────┐     ┌─────────────┐     ┌──────────────────┐                           │
│  │ Input Bucket │────▶│  SQS Queue  │────▶│ Trigger Lambda   │                           │
│  │ (S3)         │     │ + DLQ       │     │ (invoke BDA)     │                           │
│  └──────────────┘     └─────────────┘     └────────┬─────────┘                           │
│                                                    │                                      │
│                                                    ▼                                      │
│                                           ┌──────────────────┐                           │
│                                           │   BDA Project    │                           │
│                                           │ (Async API)      │                           │
│                                           └────────┬─────────┘                           │
│                                                    │                                      │
│                    ┌───────────────────────────────┼───────────────────────────┐         │
│                    │                               │                           │         │
│                    ▼                               ▼                           ▼         │
│  ┌─────────────────────────┐     ┌──────────────────────────┐    ┌──────────────────┐   │
│  │ BDA Output Bucket       │     │ Supplemental Bucket      │    │ EventBridge      │   │
│  │ (standard-output.json)  │     │ (images, table crops)    │    │ (Job Succeeded)  │   │
│  └───────────┬─────────────┘     └──────────────────────────┘    └────────┬─────────┘   │
│              │                                                             │             │
│              │                                                             ▼             │
│              │                                                 ┌──────────────────────┐ │
│              └────────────────────────────────────────────────▶│ BDA Output Parser    │ │
│                                                                │ Lambda               │ │
│                                                                └────────┬─────────────┘ │
│                                                                         │               │
│                                                                         ▼               │
│                                                          ┌──────────────────────────┐   │
│                                                          │ RAG-Ready Bucket         │   │
│                                                          │ (clean markdown files)   │   │
│                                                          └────────────┬─────────────┘   │
│                                                                       │                 │
│                                                                       ▼                 │
│                                                          ┌──────────────────────────┐   │
│                                                          │ Knowledge Base           │   │
│                                                          │ Data Source (optional)   │   │
│                                                          └──────────────────────────┘   │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## Processing Flow

1. **Upload**: Documents are uploaded to the input bucket under the configured prefix
2. **Queue**: S3 event notification sends a message to the SQS processing queue
3. **Trigger**: Trigger Lambda receives the message and invokes BDA async API
4. **Process**: BDA extracts content and writes `standard-output.json` to the BDA output bucket
5. **Event**: EventBridge detects BDA job completion and triggers the BDA Output Parser
6. **Parse**: BDA Output Parser extracts markdown from the JSON and writes to the RAG-ready bucket
7. **Index** (optional): Connect the RAG-ready bucket to a Knowledge Base for RAG queries

## Installation

The construct is part of this CDK project. Import it from the constructs directory:

```typescript
import { MultimodalProcessingPipeline } from '../constructs/document-processing-pipeline';
```

## Basic Usage

Create a document processing pipeline with minimal configuration:

```typescript
import { MultimodalProcessingPipeline } from '../constructs/document-processing-pipeline';

const pipeline = new MultimodalProcessingPipeline(this, 'DocPipeline', {
  pipelineName: 'my-doc-processor',
});

// Access created resources
console.log('Input bucket:', pipeline.inputBucket.bucketName);
console.log('RAG-ready bucket:', pipeline.ragReadyBucket.bucketName);
console.log('BDA Project ARN:', pipeline.bdaProjectArn);
```

This creates:
- Input S3 bucket for uploading documents
- BDA output S3 bucket for raw BDA JSON output
- RAG-ready S3 bucket for clean markdown files
- Supplemental S3 bucket for extracted assets (images, tables)
- SQS processing queue with dead letter queue
- Trigger Lambda function for BDA orchestration
- BDA Output Parser Lambda for markdown extraction
- EventBridge rule for BDA job completion events
- BDA project with default configuration

## Advanced Usage

### Custom BDA Configuration

Configure BDA extraction behavior:

```typescript
import { 
  MultimodalProcessingPipeline,
  TextFormat,
  OutputFormat,
  Granularity 
} from '../constructs/document-processing-pipeline';

const pipeline = new MultimodalProcessingPipeline(this, 'DocPipeline', {
  pipelineName: 'advanced-processor',
  bdaProjectConfig: {
    // Output formats - can specify multiple
    textFormats: [TextFormat.MARKDOWN, TextFormat.PLAIN_TEXT],
    
    // Generate .md, .csv, .txt files in addition to JSON
    outputFormat: OutputFormat.JSON_AND_FILES,
    
    // Extraction granularity levels
    granularity: [Granularity.PAGE, Granularity.ELEMENT, Granularity.WORD],
    
    // Enable AI-generated summaries and figure captions
    enableGenerativeFields: true,
    
    // Include bounding box coordinates for extracted elements
    enableBoundingBoxes: true,
    
    // Enable automatic splitting for large documents
    enableDocumentSplitting: true,
  },
});
```

### Custom Processing Configuration

Control which files are processed and where outputs are stored:

```typescript
const pipeline = new MultimodalProcessingPipeline(this, 'DocPipeline', {
  pipelineName: 'custom-paths',
  processingConfig: {
    // Only process files uploaded under this prefix in the input bucket
    inputPrefix: 'uploads/',
    
    // Store BDA raw JSON output under this prefix in the BDA output bucket
    bdaOutputPrefix: 'bda-results/',
    
    // Store clean markdown files under this prefix in the RAG-ready bucket
    ragReadyPrefix: 'markdown/',
    
    // Only process these file types
    supportedExtensions: ['.pdf', '.docx'],
  },
});
```


### Using Existing Buckets

Integrate with your existing S3 infrastructure:

```typescript
import * as s3 from 'aws-cdk-lib/aws-s3';

// Reference existing buckets
const existingInputBucket = s3.Bucket.fromBucketName(
  this, 'ExistingInput', 'my-existing-input-bucket'
);
const existingRagReadyBucket = s3.Bucket.fromBucketName(
  this, 'ExistingRagReady', 'my-existing-rag-ready-bucket'
);

const pipeline = new MultimodalProcessingPipeline(this, 'DocPipeline', {
  pipelineName: 'existing-buckets',
  inputBucket: existingInputBucket,
  ragReadyBucket: existingRagReadyBucket,
  // bdaOutputBucket and supplementalBucket will be created automatically
});
```

**Note**: When using existing buckets imported via `fromBucketName`, S3 event notifications cannot be automatically configured. You'll need to set up event notifications manually.

### Knowledge Base Integration

Connect processed documents to a Bedrock Knowledge Base for RAG queries. The integration is done outside the construct, giving you full control over chunking, parsing, and other data source settings:

```typescript
import { 
  BedrockKnowledgeBase, 
  ChunkingStrategy 
} from '../constructs/bedrock-knowledge-base';

// Create a knowledge base
const knowledgeBase = new BedrockKnowledgeBase(this, 'KB', {
  knowledgeBaseName: 'my-knowledge-base',
});

// Create the multimodal processing pipeline
const pipeline = new MultimodalProcessingPipeline(this, 'DocPipeline', {
  pipelineName: 'kb-integrated',
  processingConfig: {
    outputPrefix: 'processed/',
  },
});

// Wire the pipeline RAG-ready output to the knowledge base
// You have full control over chunking, parsing, and other settings
knowledgeBase.addS3DataSource({
  dataSourceName: 'processed-documents',
  bucket: pipeline.ragReadyBucket,
  inclusionPrefixes: [pipeline.ragReadyPrefix],
  chunkingConfig: {
    strategy: ChunkingStrategy.HIERARCHICAL,
    hierarchicalConfig: {
      parentMaxTokens: 1500,
      childMaxTokens: 300,
      overlapTokens: 60,
    },
  },
});
```

The construct exposes `ragReadyBucket` and `ragReadyPrefix` properties to make this integration straightforward.

## Props Reference

### MultimodalProcessingPipelineProps

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `pipelineName` | `string` | Yes | - | Name for the pipeline resources |
| `bdaProjectConfig` | `BdaProjectConfig` | No | See below | BDA document processing configuration |
| `inputBucket` | `s3.IBucket` | No | New bucket | Existing S3 bucket for raw document uploads |
| `bdaOutputBucket` | `s3.IBucket` | No | New bucket | Existing S3 bucket for BDA raw JSON output |
| `ragReadyBucket` | `s3.IBucket` | No | New bucket | Existing S3 bucket for RAG-ready markdown files |
| `supplementalBucket` | `s3.IBucket` | No | New bucket | Existing S3 bucket for extracted assets |
| `processingConfig` | `ProcessingConfig` | No | See below | Processing configuration for file filtering |
| `enableMonitoring` | `boolean` | No | `true` | Enable CloudWatch alarms for DLQ and Lambda errors |

### BdaProjectConfig

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `textFormats` | `TextFormat[]` | `['MARKDOWN']` | Text representation formats to include |
| `outputFormat` | `OutputFormat` | `JSON_AND_FILES` | Output file format |
| `granularity` | `Granularity[]` | `['ELEMENT', 'PAGE']` | Extraction granularity levels |
| `enableGenerativeFields` | `boolean` | `true` | Enable document summaries and figure captions |
| `enableBoundingBoxes` | `boolean` | `false` | Include bounding box coordinates |
| `enableDocumentSplitting` | `boolean` | `false` | Enable automatic splitting for large documents |

### ProcessingConfig

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `inputPrefix` | `string` | `'raw-documents/'` | S3 prefix in the input bucket to watch for new documents |
| `bdaOutputPrefix` | `string` | `'bda-output/'` | S3 prefix in the BDA output bucket where BDA writes raw JSON output |
| `ragReadyPrefix` | `string` | `'markdown/'` | S3 prefix in the RAG-ready bucket where clean markdown files are written |
| `supportedExtensions` | `string[]` | `['.pdf', '.docx', '.png', '.jpg', '.jpeg']` | File extensions to process |

## Enums

### TextFormat

| Value | Description |
|-------|-------------|
| `PLAIN_TEXT` | Plain text without formatting |
| `MARKDOWN` | Text with markdown formatting (recommended for RAG) |
| `HTML` | Text with HTML formatting |
| `CSV` | CSV format (tables only) |

### OutputFormat

| Value | Description |
|-------|-------------|
| `JSON` | JSON output only |
| `JSON_AND_FILES` | JSON plus additional files (.md, .csv, .txt, extracted images) |

### Granularity

| Value | Description |
|-------|-------------|
| `PAGE` | Page-level extraction |
| `ELEMENT` | Element-level extraction (paragraphs, tables, etc.) |
| `WORD` | Word-level extraction |

## Construct Outputs

The construct exposes the following public properties:

| Property | Type | Description |
|----------|------|-------------|
| `inputBucket` | `s3.IBucket` | S3 bucket for uploading raw documents |
| `bdaOutputBucket` | `s3.IBucket` | S3 bucket containing BDA raw JSON output |
| `ragReadyBucket` | `s3.IBucket` | S3 bucket containing RAG-ready markdown files |
| `supplementalBucket` | `s3.IBucket` | S3 bucket containing extracted assets |
| `bdaProjectArn` | `string` | ARN of the BDA project |
| `processingQueue` | `sqs.IQueue` | SQS queue for processing requests |
| `deadLetterQueue` | `sqs.IQueue` | Dead letter queue for failed processing |
| `triggerFunction` | `lambda.IFunction` | Trigger Lambda function that invokes BDA |
| `bdaOutputParserFunction` | `lambda.IFunction` | BDA Output Parser Lambda function |
| `ragReadyPrefix` | `string` | Output prefix where RAG-ready documents are stored |
| `dlqAlarm` | `cloudwatch.IAlarm` | CloudWatch alarm for DLQ messages (if monitoring enabled) |
| `lambdaErrorAlarm` | `cloudwatch.IAlarm` | CloudWatch alarm for Lambda errors (if monitoring enabled) |

## BDA Output Parsing

The BDA Output Parser Lambda automatically extracts clean markdown from BDA's complex JSON output:

- **Document-level markdown**: Extracts the main document content in markdown format
- **Table handling**: Includes markdown representations of extracted tables
- **Figure captions**: Includes AI-generated captions for figures (when `enableGenerativeFields` is true)
- **Fallback behavior**: Falls back to plain text if markdown representation is unavailable

The parser reads `standard-output.json` from the BDA output bucket and writes a consolidated `.md` file to the RAG-ready bucket, preserving the original filename.

## Error Handling

- **Retry**: Failed processing attempts are retried up to 3 times via SQS
- **DLQ**: After 3 failures, messages are moved to the dead letter queue
- **Logging**: All processing activity is logged to CloudWatch Logs (7-day retention)
- **EventBridge retries**: BDA Output Parser invocations are retried up to 2 times on failure

## Monitoring

The construct creates CloudWatch alarms by default to help monitor pipeline health:

- **DLQ Alarm**: Triggers when messages land in the dead letter queue (indicates failed document processing)
- **Lambda Error Alarm**: Triggers when Lambda functions experience 3+ errors in a 5-minute window

To disable monitoring:

```typescript
const pipeline = new MultimodalProcessingPipeline(this, 'DocPipeline', {
  pipelineName: 'my-processor',
  enableMonitoring: false,
});
```

To add SNS notifications to alarms:

```typescript
import * as sns from 'aws-cdk-lib/aws-sns';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';

const alertTopic = new sns.Topic(this, 'AlertTopic');

if (pipeline.dlqAlarm) {
  pipeline.dlqAlarm.addAlarmAction(new actions.SnsAction(alertTopic));
}

if (pipeline.lambdaErrorAlarm) {
  pipeline.lambdaErrorAlarm.addAlarmAction(new actions.SnsAction(alertTopic));
}
```

## Cross-Region Inference

The construct automatically selects the appropriate BDA data automation profile based on the deployment region, using [Cross-Region Inference Support (CRIS)](https://docs.aws.amazon.com/bedrock/latest/userguide/bda-cris.html):

| Deployment Region | Profile Geography |
|-------------------|-------------------|
| `us-*` (US regions) | `us.data-automation-v1` |
| `eu-*` (EU regions) | `eu.data-automation-v1` |
| `ap-*` (APAC regions) | `apac.data-automation-v1` |

This ensures optimal routing of BDA requests within your geography without any additional configuration.

## Security

- **Encryption**: All created S3 buckets use S3-managed encryption (SSE-S3)
- **IAM**: Lambda functions have least-privilege permissions for BDA, S3, and SQS
- **Removal Policy**: Buckets are set to DESTROY for easy cleanup during prototyping

## Supported File Types

By default, the pipeline processes:
- PDF documents (`.pdf`)
- Word documents (`.docx`)
- Images (`.png`, `.jpg`, `.jpeg`)

Configure `processingConfig.supportedExtensions` to customize.

## Limitations

This construct is opt-in and is not instantiated by the default deployment, so the behaviours below have not been validated against the deployed stack. Treat them as the known boundaries of a starting point rather than as a supported feature set.

### Operational

- BDA async processing is eventually consistent; there may be a delay before output appears
- When using existing buckets imported via `fromBucketName`, S3 event notifications must be configured manually
- The construct creates resources with `RemovalPolicy.DESTROY` — not recommended for production data

### Output quality

The BDA Output Parser produces usable markdown for text-heavy documents. It has not been tuned for the following, so verify against your own documents before relying on it for retrieval quality:

- Markdown formatting fidelity is not verified beyond the document-level text representation. If retrieval quality matters for your corpus, inspect the generated `.md` files and adjust the parser.
- Extracted images and table crops are written to the supplemental bucket, but the markdown output contains no references or links back to them. If your use case needs figure-aware retrieval, the parser must be extended to emit those references.
- Document structure — heading levels, list nesting, and table layout — is carried through as BDA emits it and is not post-processed. If chunking depends on heading hierarchy, verify the structure survives.

### Unimplemented BDA capabilities

The construct wires the BDA document modality with the standard output configuration only. Each of the following requires extending the construct:

- **Custom blueprints.** `customOutputConfiguration` is not exposed. Needed when you require structured field extraction against a schema rather than a text representation.
- **Audio processing.** Transcription and speaker labelling are not configured. Needed when the input corpus includes audio.
- **Video processing.** Frame extraction and scene detection are not configured. Needed when the input corpus includes video.
- **PII detection and redaction.** Not configured. Needed when the input corpus may contain personal data that must not reach the knowledge base.

### Pipeline shape

- **Async only.** The pipeline invokes the BDA async API and reacts to the job-completion event. A synchronous mode (`projectType: SYNC`) is not implemented; it becomes necessary only if a caller needs an inline response rather than an eventual S3 write.
- **No orchestration layer.** Processing is a two-Lambda chain joined by an EventBridge rule. A Step Functions workflow becomes necessary once you need conditional routing, fan-out across modalities, or per-document retry state that outlives the SQS redrive policy.
