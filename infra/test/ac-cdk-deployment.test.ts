// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AgentCoreStack } from '../lib/stacks/agentcore-cdk-stack';
import { AcceleratorConfig } from '../lib/config';

const MODEL_ID = 'global.anthropic.claude-sonnet-5-5';

/** Builds a stack from a partial config; source directories are the real ones in the repo. */
function buildStack(overrides: Partial<AcceleratorConfig>): cdk.Stack {
  const config: AcceleratorConfig = {
    region: 'us-west-2',
    deploymentPrefix: 'testprefix',
    modelId: MODEL_ID,
    showReasoning: true,
    deploymentMode: 'local',
    frontendMode: 'none',
    domainName: null,
    hostedZoneName: null,
    agents: [],
    mcpServers: [{ name: 'testprefix', sourceDir: 'mcp/support-tools/src' }],
    knowledgeBases: [],
    ...overrides,
  };
  return new AgentCoreStack(new cdk.App(), 'TestStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    config,
  });
}

type Json = Record<string, any>;

/** Every IAM statement in the template: AWS::IAM::Policy, AWS::IAM::ManagedPolicy, and inline role policies. */
function allPolicyStatements(template: Template): Json[] {
  const documents: Json[] = [];
  for (const type of ['AWS::IAM::Policy', 'AWS::IAM::ManagedPolicy']) {
    for (const res of Object.values(template.findResources(type))) {
      documents.push(res.Properties.PolicyDocument);
    }
  }
  for (const res of Object.values(template.findResources('AWS::IAM::Role'))) {
    for (const inline of res.Properties.Policies ?? []) {
      documents.push(inline.PolicyDocument);
    }
  }
  return documents.flatMap((doc) => [doc.Statement].flat());
}

const actionsOf = (statement: Json): string[] => [statement.Action].flat();

/** IAM statements attached to the execution role of the AgentCore Runtime with the given name. */
function agentRoleStatements(template: Template, runtimeName: string): Json[] {
  const runtimes = Object.values(template.findResources('AWS::BedrockAgentCore::Runtime'));
  const runtime = runtimes.find((r) => r.Properties.AgentRuntimeName === runtimeName);
  if (!runtime) throw new Error(`Runtime ${runtimeName} not found in template`);
  const roleId: string = runtime.Properties.RoleArn['Fn::GetAtt'][0];
  return Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((p) => (p.Properties.Roles ?? []).some((r: Json) => r.Ref === roleId))
    .flatMap((p) => [p.Properties.PolicyDocument.Statement].flat());
}

function runtimeEnv(template: Template, runtimeName: string): Json {
  const runtimes = Object.values(template.findResources('AWS::BedrockAgentCore::Runtime'));
  const runtime = runtimes.find((r) => r.Properties.AgentRuntimeName === runtimeName);
  if (!runtime) throw new Error(`Runtime ${runtimeName} not found in template`);
  return runtime.Properties.EnvironmentVariables;
}

/** Logical ID of the Managed KB with the given resolved name. */
function kbLogicalId(template: Template, name: string): string {
  const [id] = Object.entries(template.findResources('AWS::Bedrock::KnowledgeBase'))
    .find(([, r]) => r.Properties.Name === name) ?? [];
  if (!id) throw new Error(`Knowledge base ${name} not found in template`);
  return id;
}

describe('AgentCoreStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();

    const config: AcceleratorConfig = {
      region: 'us-west-2',
      deploymentPrefix: 'testprefix',
      modelId: 'global.anthropic.claude-sonnet-5-5',
      showReasoning: true,
      deploymentMode: 'local',
      frontendMode: 'none',
      domainName: null,
      hostedZoneName: null,
      agents: [{ name: 'testprefix', sourceDir: 'agent/customer-support/src', modelId: 'global.anthropic.claude-sonnet-5-5', showReasoning: true, knowledgeBase: 'test-kb' }],
      mcpServers: [{ name: 'testprefix', sourceDir: 'mcp/support-tools/src' }],
      knowledgeBases: [{ name: 'test-kb', sourceDir: 'knowledge-bases/test-kb' }],
    };

    const stack = new AgentCoreStack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-west-2',
      },
      config,
    });
    template = Template.fromStack(stack);
  });

  // The snapshot records the AgentCore Runtime ContainerUri values, which are
  // Docker asset fingerprints over agent/customer-support/src and
  // mcp/support-tools/src. Those fingerprints are only reproducible because each
  // agent, MCP, and frontend source directory carries a .dockerignore: CDK
  // appends every line of it to the asset `exclude` list, so local-only content
  // (.venv/, __pycache__/, .python-version, .DS_Store, cache dirs) stays out of
  // the hash. Without those files, creating a single scratch file inside
  // agent/customer-support/src/.venv/ changes the ContainerUri and the snapshot
  // becomes machine-local.
  //
  // So: an unexplained ContainerUri diff here is not noise. It means something
  // entered a build context — either a genuine source change, or a new kind of
  // local artifact that the relevant .dockerignore does not yet exclude. Find
  // out which before re-recording with `npm test -- ac-cdk-deployment.test.ts -u`.
  test('snapshot matches for default local/none config', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });

  test('S3 buckets are created for documents and access logs', () => {
    // Expected count = N knowledge base buckets + 1 access logs bucket, where N is
    // the number of configured knowledge bases. This config has N = 1, so 2.
    // Each Docs_Bucket logs to the stack-level AccessLogsBucket (90-day expiry).
    // There is no supplemental-data bucket: the managed knowledge base needs none.
    template.resourceCountIs('AWS::S3::Bucket', 2);
  });

  test('Bedrock Knowledge Base is a managed knowledge base with a managed embedding model', () => {
    template.resourceCountIs('AWS::Bedrock::KnowledgeBase', 1);
    const [kb] = Object.values(template.findResources('AWS::Bedrock::KnowledgeBase'));
    const kbConfig = kb.Properties.KnowledgeBaseConfiguration;
    expect(kbConfig.Type).toBe('MANAGED');
    expect(kbConfig.ManagedKnowledgeBaseConfiguration.EmbeddingModelType).toBe('MANAGED');
    expect(kbConfig.ManagedKnowledgeBaseConfiguration).not.toHaveProperty('EmbeddingModelArn');
    expect(kbConfig.ManagedKnowledgeBaseConfiguration).not.toHaveProperty('EmbeddingModelConfiguration');
    expect(kb.Properties).not.toHaveProperty('StorageConfiguration');
    expect(kb.DeletionPolicy).toBe('Delete');
  });

  test('one S3 connector data source covers the kb-source-docs/ prefix', () => {
    template.resourceCountIs('AWS::Bedrock::DataSource', 1);
    template.hasResourceProperties('AWS::Bedrock::DataSource', {
      DataSourceConfiguration: {
        Type: 'MANAGED_KNOWLEDGE_BASE_CONNECTOR',
        ManagedKnowledgeBaseConnectorConfiguration: {
          ConnectorParameters: {
            type: 'S3',
            filterConfiguration: { inclusionPrefixes: ['kb-source-docs/'] },
          },
        },
      },
    });
  });

  test('no S3 Vectors resources and no s3vectors: IAM actions', () => {
    template.resourceCountIs('AWS::S3Vectors::VectorBucket', 0);
    template.resourceCountIs('AWS::S3Vectors::Index', 0);
    const types = Object.values(template.toJSON().Resources as Json).map((r) => r.Type as string);
    expect(types.filter((t) => t.startsWith('AWS::S3Vectors::'))).toEqual([]);

    const statements = allPolicyStatements(template);
    expect(statements.length).toBeGreaterThan(0);
    const s3vectorsActions = statements.flatMap(actionsOf).filter((a) => a.toLowerCase().startsWith('s3vectors:'));
    expect(s3vectorsActions).toEqual([]);
  });

  test('Docs_Bucket is encrypted, private, TLS-only, logged, and deleted with the stack', () => {
    const buckets = template.findResources('AWS::S3::Bucket');
    const docsEntry = Object.entries(buckets).find(([, b]) => b.Properties.LoggingConfiguration);
    if (!docsEntry) throw new Error('No bucket with server access logging found');
    const [docsId, docs] = docsEntry;
    const accessLogsId = Object.keys(buckets).find((id) => id !== docsId);

    expect(docs.Properties.BucketEncryption.ServerSideEncryptionConfiguration).toEqual([
      { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
    ]);
    expect(docs.Properties.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(docs.Properties.LoggingConfiguration.DestinationBucketName).toEqual({ Ref: accessLogsId });
    expect(docs.DeletionPolicy).toBe('Delete');
    expect(docs.UpdateReplacePolicy).toBe('Delete');
    expect(docs.Properties.Tags).toContainEqual({ Key: 'aws-cdk:auto-delete-objects', Value: 'true' });

    const policies = Object.values(template.findResources('AWS::S3::BucketPolicy'))
      .filter((p) => p.Properties.Bucket.Ref === docsId);
    expect(policies).toHaveLength(1);
    const tlsDeny = [policies[0].Properties.PolicyDocument.Statement].flat().find(
      (st: Json) => st.Effect === 'Deny' && st.Condition?.Bool?.['aws:SecureTransport'] === 'false',
    );
    expect(tlsDeny).toBeDefined();
  });

  test('AgentCore Runtimes are created for agent and MCP server', () => {
    template.resourceCountIs('AWS::BedrockAgentCore::Runtime', 2);
  });

  test('ECR repositories are created for agent and MCP', () => {
    template.resourceCountIs('AWS::ECR::Repository', 2);
  });

  test('no CodeCommit repository in local mode', () => {
    template.resourceCountIs('AWS::CodeCommit::Repository', 0);
  });

  test('no CodePipeline in local mode', () => {
    template.resourceCountIs('AWS::CodePipeline::Pipeline', 0);
  });

  // Requirement 5.4: deploying the shipped config.yaml unmodified must create no
  // VPC, no NAT gateway, no load balancer, no CloudFront distribution, and no
  // Cognito user pool. config.yaml ships frontendMode: none, which the config
  // above mirrors.
  test('no VPC or frontend resources when frontendMode is none', () => {
    template.resourceCountIs('AWS::EC2::VPC', 0);
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
    template.resourceCountIs('AWS::ECS::Service', 0);
    template.resourceCountIs('AWS::CloudFront::Distribution', 0);
    template.resourceCountIs('AWS::Cognito::UserPool', 0);
  });

  test('stack outputs include agent and MCP runtime ARNs', () => {
    template.hasOutput('AgentRuntimeArn', {});
    template.hasOutput('McpServerRuntimeArn', {});
  });

  test('stack outputs include knowledge base resources', () => {
    template.hasOutput('TestKbKnowledgeBaseId', {});
    template.hasOutput('DocumentsBucketName', {});
    template.hasOutput('TestKbDocumentsBucketName', {});
  });
});

describe('AgentCoreStack Cognito sign-in', () => {
  const template = Template.fromStack(
    buildStack({
      frontendMode: 'cloudfront',
      agents: [{ name: 'test-agent', sourceDir: 'agent/it-helpdesk/src', modelId: MODEL_ID, showReasoning: true, mcpServers: [] }],
    }),
  );

  // Without managedLoginVersion, Cognito serves the classic hosted UI.
  test('the user pool domain uses managed login', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', { ManagedLoginVersion: 2 });
  });

  // Managed login renders an error page for an app client with no branding.
  test('the app client has managed login branding', () => {
    template.hasResourceProperties('AWS::Cognito::ManagedLoginBranding', {
      UseCognitoProvidedValues: true,
      ClientId: Match.anyValue(),
    });
  });
});

// Wiring test: its own stack, deliberately not snapshotted. Two knowledge bases and
// three agents (one per knowledge base, one with none) show that each agent is
// wired to exactly its own knowledge base.
describe('AgentCoreStack knowledge base wiring', () => {
  let template: Template;

  beforeAll(() => {
    template = Template.fromStack(buildStack({
      deploymentPrefix: 'wiring',
      agents: [
        { name: 'agent-a', sourceDir: 'agent/customer-support/src', modelId: MODEL_ID, showReasoning: true, knowledgeBase: 'kb-a' },
        { name: 'agent-b', sourceDir: 'agent/customer-support/src', modelId: MODEL_ID, showReasoning: true, knowledgeBase: 'kb-b' },
        { name: 'plain', sourceDir: 'agent/customer-support/src', modelId: MODEL_ID, showReasoning: true },
      ],
      knowledgeBases: [
        { name: 'kb-a', sourceDir: 'knowledge-bases/kb-a' },
        { name: 'kb-b', sourceDir: 'knowledge-bases/kb-b' },
      ],
    }));
  });

  test('creates one managed knowledge base, data source, and bucket per entry plus the logs bucket', () => {
    template.resourceCountIs('AWS::Bedrock::KnowledgeBase', 2);
    template.resourceCountIs('AWS::Bedrock::DataSource', 2);
    template.resourceCountIs('AWS::S3::Bucket', 3);
    template.resourceCountIs('AWS::S3Vectors::VectorBucket', 0);
    template.resourceCountIs('AWS::S3Vectors::Index', 0);
    for (const kb of Object.values(template.findResources('AWS::Bedrock::KnowledgeBase'))) {
      expect(kb.Properties.KnowledgeBaseConfiguration.Type).toBe('MANAGED');
    }
    for (const ds of Object.values(template.findResources('AWS::Bedrock::DataSource'))) {
      const cfg = ds.Properties.DataSourceConfiguration;
      expect(cfg.Type).toBe('MANAGED_KNOWLEDGE_BASE_CONNECTOR');
      expect(cfg.ManagedKnowledgeBaseConnectorConfiguration.ConnectorParameters.filterConfiguration.inclusionPrefixes)
        .toEqual(['kb-source-docs/']);
    }
  });

  test.each([
    ['agent-a', 'wiring_agent_agent_a', 'wiring-kb-kb-a', 'wiring-kb-kb-b'],
    ['agent-b', 'wiring_agent_agent_b', 'wiring-kb-kb-b', 'wiring-kb-kb-a'],
  ])('%s gets KNOWLEDGE_BASE_ID and bedrock:Retrieve for its own knowledge base only', (_agent, runtimeName, ownKb, otherKb) => {
    const ownId = kbLogicalId(template, ownKb);
    const otherId = kbLogicalId(template, otherKb);

    expect(runtimeEnv(template, runtimeName).KNOWLEDGE_BASE_ID).toEqual({
      'Fn::GetAtt': [ownId, 'KnowledgeBaseId'],
    });

    const retrieve = agentRoleStatements(template, runtimeName)
      .filter((st) => actionsOf(st).some((a) => a.toLowerCase().startsWith('bedrock:retrieve')));
    expect(retrieve).toHaveLength(1);
    expect(actionsOf(retrieve[0])).toEqual(['bedrock:Retrieve']);
    expect(retrieve[0].Resource).toEqual({ 'Fn::GetAtt': [ownId, 'KnowledgeBaseArn'] });
    expect(JSON.stringify(retrieve[0])).not.toContain(otherId);
  });

  test('an agent without knowledgeBase has no KNOWLEDGE_BASE_ID and no retrieve permission', () => {
    expect(runtimeEnv(template, 'wiring_agent_plain')).not.toHaveProperty('KNOWLEDGE_BASE_ID');
    const retrieve = agentRoleStatements(template, 'wiring_agent_plain')
      .filter((st) => actionsOf(st).some((a) => a.toLowerCase().startsWith('bedrock:retrieve')));
    expect(retrieve).toEqual([]);
  });
});

describe('AgentCoreStack edge cases', () => {
  test('zero knowledge bases synthesizes with zero knowledge base resources', () => {
    const template = Template.fromStack(buildStack({
      agents: [{ name: 'plain', sourceDir: 'agent/customer-support/src', modelId: MODEL_ID, showReasoning: true }],
      knowledgeBases: [],
    }));
    template.resourceCountIs('AWS::Bedrock::KnowledgeBase', 0);
    template.resourceCountIs('AWS::Bedrock::DataSource', 0);
    template.resourceCountIs('AWS::S3Vectors::VectorBucket', 0);
    template.resourceCountIs('AWS::S3Vectors::Index', 0);
    // N = 0 knowledge base buckets + 1 access logs bucket
    template.resourceCountIs('AWS::S3::Bucket', 1);
  });

  test('an agent referencing an unknown knowledge base fails naming the agent and the knowledge base', () => {
    expect(() => buildStack({
      agents: [{ name: 'lost-agent', sourceDir: 'agent/customer-support/src', modelId: MODEL_ID, showReasoning: true, knowledgeBase: 'missing-kb' }],
      knowledgeBases: [{ name: 'other-kb', sourceDir: 'knowledge-bases/other-kb' }],
    })).toThrow(/lost-agent.*missing-kb/);
  });
});
