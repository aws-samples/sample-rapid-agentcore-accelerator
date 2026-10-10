# BedrockKnowledgeBase Construct

An L3 CDK construct that creates an Amazon Bedrock managed knowledge base (type `MANAGED`) with a service role and one S3 data source. Amazon Bedrock owns the datastore, embedding, reranking, parsing, and chunking, so the construct has no options for them.

## Resources Created

- `AWS::Bedrock::KnowledgeBase` of type `MANAGED` with the service-managed embedding model
- IAM service role and one policy that Amazon Bedrock uses to read the documents bucket
- `AWS::Bedrock::DataSource` on an S3 bucket, created by `addS3DataSource`

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
| `knowledgeBaseName` | string | Yes | - | Name for the knowledge base. Must match `^([0-9a-zA-Z][_-]?){1,100}$`; the construct throws otherwise |
| `description` | string | No | - | Description for the knowledge base |

## addS3DataSource

Adds the S3 data source and appends the bucket read permissions to the service role policy. A knowledge base supports one data source: a second call throws an error.

`S3DataSourceConfig`:

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `dataSourceName` | string | Yes | - | Name for the data source |
| `bucket` | IBucket | Yes | - | S3 bucket containing the source documents |
| `inclusionPrefixes` | string[] | No | Whole bucket | Key prefixes in scope for ingestion |

## grantRetrieve

```typescript
kb.grantRetrieve(myLambda);
```

Accepts any `IGrantable`. It grants `bedrock:Retrieve` on this knowledge base's ARN only.

## Service Role Permissions

Amazon Bedrock assumes the role for `bedrock.amazonaws.com`, restricted to the stack account and to knowledge bases in the stack Region. The role's single policy contains:

| Action | Resource | Added by |
|--------|----------|----------|
| `cloudwatch:PutMetricData` (namespace `AWS/Bedrock/KnowledgeBases`) | `*` | Constructor |
| `s3:ListBucket` | The data source bucket | `addS3DataSource` |
| `s3:GetObject` | Objects in the data source bucket | `addS3DataSource` |

The S3 statements require the bucket to belong to the stack account (`aws:ResourceAccount`). The knowledge base and the data source depend on the policy, so the permissions exist when Amazon Bedrock validates them.

## Exposed Properties

| Property | Type | Description |
|----------|------|-------------|
| `knowledgeBase` | CfnKnowledgeBase | The underlying CFN resource |
| `knowledgeBaseId` | string | Knowledge base ID |
| `knowledgeBaseArn` | string | Knowledge base ARN |
| `role` | Role | IAM service role for the knowledge base |

## Region Support

Managed knowledge bases are available only in the Regions listed in `SUPPORTED_MANAGED_KB_REGIONS` in [infra/lib/config.ts](../../config.ts): `us-east-1`, `us-west-2`, `eu-west-1`, `eu-west-2`, `eu-central-1`, `ap-northeast-1`, and `ap-southeast-2`. The config loader rejects any other `region` when `knowledgeBases` is non-empty.
