# BedrockKnowledgeBase Construct

An L3 CDK construct for creating Amazon Bedrock Knowledge Bases with S3 Vectors storage, supporting advanced parsing and chunking strategies.

## Features

- S3 Vectors storage for embeddings (no OpenSearch/Aurora required)
- Multiple parsing strategies (default, BDA multimodal, Foundation Model)
- Flexible chunking options (fixed-size, hierarchical, semantic)
- Automatic IAM role and policy management
- Grant helpers for access control

## Resources Created

- S3 Vector Bucket and Index for embeddings
- Bedrock Knowledge Base
- IAM Role with least-privilege permissions
- Data sources with configurable parsing/chunking

## Basic Usage

```typescript
import { BedrockKnowledgeBase } from './constructs/bedrock-knowledge-base';

const kb = new BedrockKnowledgeBase(this, 'DocsKB', {
  knowledgeBaseName: 'my-docs-kb',
  description: 'Documentation knowledge base',
});

kb.addS3DataSource({
  dataSourceName: 'docs',
  bucket: myBucket,
  inclusionPrefixes: ['documents/'],
});

kb.grantRetrieve(myRole);
```

## Props

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `knowledgeBaseName` | string | Yes | - | Name for the knowledge base |
| `description` | string | No | - | Description for the knowledge base |
| `embeddingModelId` | string | No | `amazon.titan-embed-text-v2:0` | Embedding model ID |
| `vectorDimension` | number | No | `1024` | Vector dimension for embeddings |
| `supplementalDataBucket` | IBucket | No | - | Required for BDA parsing |

## Parsing Strategies

### Default (No Advanced Parsing)
```typescript
kb.addS3DataSource({
  dataSourceName: 'docs',
  bucket: myBucket,
});
```

### Bedrock Data Automation (Multimodal)
Extracts text, tables, and images from documents. Requires `supplementalDataBucket`.

```typescript
// Create KB with supplemental bucket for BDA
const supplementalBucket = new s3.Bucket(this, 'SupplementalBucket', {
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});

const kb = new BedrockKnowledgeBase(this, 'KB', {
  knowledgeBaseName: 'my-kb',
  supplementalDataBucket: supplementalBucket,
});

kb.addS3DataSource({
  dataSourceName: 'docs',
  bucket: myBucket,
  parsingConfig: {
    strategy: ParsingStrategy.BEDROCK_DATA_AUTOMATION,
  },
});
```

### Foundation Model Parsing
Uses Claude or other models for complex document parsing.

```typescript
kb.addS3DataSource({
  dataSourceName: 'reports',
  bucket: myBucket,
  parsingConfig: {
    strategy: ParsingStrategy.BEDROCK_FOUNDATION_MODEL,
    foundationModelConfig: {
      modelArn: `arn:aws:bedrock:${region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
      parsingPromptText: 'Extract all text including tables...', // optional
    },
  },
});
```

## Chunking Strategies

### Fixed-Size Chunking
Splits documents into fixed token-size chunks with overlap.

```typescript
kb.addS3DataSource({
  dataSourceName: 'docs',
  bucket: myBucket,
  chunkingConfig: {
    strategy: ChunkingStrategy.FIXED_SIZE,
    fixedSizeConfig: {
      maxTokens: 500,        // default: 300
      overlapPercentage: 15, // default: 20
    },
  },
});
```

### Hierarchical Chunking
Creates parent/child chunk relationships for better context.

```typescript
kb.addS3DataSource({
  dataSourceName: 'books',
  bucket: myBucket,
  chunkingConfig: {
    strategy: ChunkingStrategy.HIERARCHICAL,
    hierarchicalConfig: {
      parentMaxTokens: 1500, // default: 1500
      childMaxTokens: 300,   // default: 300
      overlapTokens: 60,     // default: 60
    },
  },
});
```

### Semantic Chunking
Uses NLP to split at natural boundaries.

```typescript
kb.addS3DataSource({
  dataSourceName: 'articles',
  bucket: myBucket,
  chunkingConfig: {
    strategy: ChunkingStrategy.SEMANTIC,
    semanticConfig: {
      maxTokens: 300,                    // default: 300
      bufferSize: 1,                     // default: 1
      breakpointPercentileThreshold: 95, // default: 95
    },
  },
});
```

### No Chunking
Treats each file as a single chunk.

```typescript
kb.addS3DataSource({
  dataSourceName: 'small-docs',
  bucket: myBucket,
  chunkingConfig: {
    strategy: ChunkingStrategy.NONE,
  },
});
```

## Combining Parsing and Chunking

```typescript
kb.addS3DataSource({
  dataSourceName: 'complex-reports',
  bucket: myBucket,
  parsingConfig: {
    strategy: ParsingStrategy.BEDROCK_DATA_AUTOMATION,
  },
  chunkingConfig: {
    strategy: ChunkingStrategy.HIERARCHICAL,
  },
});
```

## Access Control

```typescript
// Grant retrieve access
kb.grantRetrieve(myLambda);

// Grant retrieve and generate access
kb.grantRetrieveAndGenerate(myAgent);
```

## Exposed Properties

| Property | Type | Description |
|----------|------|-------------|
| `knowledgeBase` | CfnKnowledgeBase | The underlying CFN resource |
| `knowledgeBaseId` | string | Knowledge base ID |
| `knowledgeBaseArn` | string | Knowledge base ARN |
| `vectorBucket` | CfnVectorBucket | S3 Vector Bucket |
| `vectorIndex` | CfnIndex | Vector Index |
| `role` | Role | IAM role for the knowledge base |

## Strategy Selection Guide

| Use Case | Parsing | Chunking |
|----------|---------|----------|
| Simple text docs | Default | Fixed-size |
| PDFs with tables/images | BDA or FM | Hierarchical |
| Long-form content | Default | Semantic |
| Pre-chunked files | Default | None |
| Technical manuals | FM | Hierarchical |
