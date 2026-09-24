// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AgentCoreStack } from '../lib/stacks/agentcore-cdk-stack';
import { AcceleratorConfig } from '../lib/config';

describe('AgentCoreStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();

    const config: AcceleratorConfig = {
      region: 'us-west-2',
      deploymentPrefix: 'testprefix',
      modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      deploymentMode: 'local',
      frontendMode: 'none',
      domainName: null,
      hostedZoneName: null,
      agents: [{ name: 'testprefix', sourceDir: 'agent/customer-support/src', modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0', knowledgeBase: 'test-kb' }],
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

  test('S3 buckets are created for documents, supplemental data, and access logs', () => {
    // 3 = per-KB documents bucket + per-KB supplemental bucket + the stack-level
    // AccessLogsBucket. The count rose from 2 to 3 when server access logging was
    // added to agentcore-cdk-stack.ts: the stack now creates a dedicated
    // AccessLogsBucket (90-day expiry) and points serverAccessLogsBucket on both
    // KB buckets at it.
    template.resourceCountIs('AWS::S3::Bucket', 3);
  });

  test('Bedrock Knowledge Base is created', () => {
    template.resourceCountIs('AWS::Bedrock::KnowledgeBase', 1);
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
