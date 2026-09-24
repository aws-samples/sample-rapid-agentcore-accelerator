// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { AgentCoreMCPServer, NetworkMode, AuthMode } from '../lib/constructs/agentcore-mcp-server';

describe('AgentCoreMCPServer', () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-west-2',
      },
    });
  });

  describe('Construct Creation', () => {
    test('creates AgentCore Runtime with ECR config', () => {
      // Arrange
      const repository = new ecr.Repository(stack, 'TestRepo');

      // Act
      new AgentCoreMCPServer(stack, 'MCPServer', {
        runtimeName: 'test_mcp_server',
        ecrConfig: {
          repository,
          imageTag: 'v1.0.0',
        },
      });

      // Assert
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::BedrockAgentCore::Runtime', 1);
    });

    test('defaults to IAM auth mode', () => {
      // Arrange
      const repository = new ecr.Repository(stack, 'TestRepo');

      // Act
      const mcpServer = new AgentCoreMCPServer(stack, 'MCPServer', {
        runtimeName: 'test_mcp_server',
        ecrConfig: { repository },
      });

      // Assert
      expect(mcpServer.authMode).toBe(AuthMode.IAM);
    });

    test('defaults to PUBLIC network mode', () => {
      // Arrange
      const repository = new ecr.Repository(stack, 'TestRepo');

      // Act
      const mcpServer = new AgentCoreMCPServer(stack, 'MCPServer', {
        runtimeName: 'test_mcp_server',
        ecrConfig: { repository },
      });

      // Assert
      expect(mcpServer.networkMode).toBe(NetworkMode.PUBLIC);
    });
  });

  describe('Validation Errors', () => {
    test('throws error when both mcpAssetPath and ecrConfig are provided', () => {
      // Arrange
      const repository = new ecr.Repository(stack, 'TestRepo');

      // Act & Assert
      expect(() => {
        new AgentCoreMCPServer(stack, 'MCPServer', {
          runtimeName: 'test_mcp_server',
          mcpAssetPath: './mcp/src',
          ecrConfig: { repository },
        });
      }).toThrow('Cannot specify both mcpAssetPath and ecrConfig. Choose one deployment method.');
    });

    test('throws error when neither mcpAssetPath nor ecrConfig are provided', () => {
      // Act & Assert
      expect(() => {
        new AgentCoreMCPServer(stack, 'MCPServer', {
          runtimeName: 'test_mcp_server',
        });
      }).toThrow('Must specify either mcpAssetPath or ecrConfig for MCP server deployment.');
    });

    test('throws error when networkMode is VPC but vpcConfig is not provided', () => {
      // Arrange
      const repository = new ecr.Repository(stack, 'TestRepo');

      // Act & Assert
      expect(() => {
        new AgentCoreMCPServer(stack, 'MCPServer', {
          runtimeName: 'test_mcp_server',
          ecrConfig: { repository },
          networkMode: NetworkMode.VPC,
        });
      }).toThrow('vpcConfig is required when networkMode is VPC');
    });

    test('throws error when authMode is COGNITO but cognitoAuth is not provided', () => {
      // Arrange
      const repository = new ecr.Repository(stack, 'TestRepo');

      // Act & Assert
      expect(() => {
        new AgentCoreMCPServer(stack, 'MCPServer', {
          runtimeName: 'test_mcp_server',
          ecrConfig: { repository },
          authMode: AuthMode.COGNITO,
        });
      }).toThrow('cognitoAuth is required when authMode is COGNITO');
    });
  });

  describe('VPC Configuration', () => {
    test('creates security group when networkMode is VPC', () => {
      // Arrange
      const repository = new ecr.Repository(stack, 'TestRepo');
      const vpc = new ec2.Vpc(stack, 'TestVpc');

      // Act
      const mcpServer = new AgentCoreMCPServer(stack, 'MCPServer', {
        runtimeName: 'test_mcp_server',
        ecrConfig: { repository },
        networkMode: NetworkMode.VPC,
        vpcConfig: { vpc },
      });

      // Assert
      expect(mcpServer.securityGroup).toBeDefined();
      expect(mcpServer.networkMode).toBe(NetworkMode.VPC);
      
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::EC2::SecurityGroup', 1);
    });
  });

  describe('Cognito Authentication', () => {
    test('configures Cognito auth when authMode is COGNITO', () => {
      // Arrange
      const repository = new ecr.Repository(stack, 'TestRepo');
      const userPool = new cognito.UserPool(stack, 'TestUserPool');
      const userPoolClient = userPool.addClient('TestClient');

      // Act
      const mcpServer = new AgentCoreMCPServer(stack, 'MCPServer', {
        runtimeName: 'test_mcp_server',
        ecrConfig: { repository },
        authMode: AuthMode.COGNITO,
        cognitoAuth: {
          userPool,
          userPoolClients: [userPoolClient],
        },
      });

      // Assert
      expect(mcpServer.authMode).toBe(AuthMode.COGNITO);
      
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::Cognito::UserPool', 1);
      template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    });
  });
});
