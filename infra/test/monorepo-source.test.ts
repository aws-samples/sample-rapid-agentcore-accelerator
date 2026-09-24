// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import { MonorepoSource } from '../lib/constructs/monorepo-source';

describe('MonorepoSource', () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, 'TestStack');
  });

  describe('Repository Management', () => {
    test('creates repository with default settings', () => {
      // Arrange & Act
      new MonorepoSource(stack, 'MonorepoSource');

      // Assert
      const template = Template.fromStack(stack);
      
      // Verify CodeCommit repository is created
      template.hasResourceProperties('AWS::CodeCommit::Repository', {
        RepositoryName: 'monorepo',
        RepositoryDescription: 'Monorepo source repository'
      });

      // Verify stack outputs for clone URLs are created
      template.hasOutput('MonorepoSourceRepoCloneUrlHttp', {
        Description: 'CodeCommit repository HTTPS clone URL'
      });

      template.hasOutput('MonorepoSourceRepoCloneUrlSsh', {
        Description: 'CodeCommit repository SSH clone URL'
      });
    });

    test('uses existing repository when provided', () => {
      // Arrange
      const existingRepo = codecommit.Repository.fromRepositoryName(
        stack, 
        'ExistingRepo', 
        'existing-repo'
      );

      // Act
      new MonorepoSource(stack, 'MonorepoSource', {
        repositoryConfig: {
          existingRepository: existingRepo
        }
      });

      // Assert
      const template = Template.fromStack(stack);
      
      // Verify no new repository is created
      template.resourceCountIs('AWS::CodeCommit::Repository', 0);
      
      // Verify no stack outputs are created for existing repository
      expect(() => {
        template.hasOutput('MonorepoSourceRepoCloneUrlHttp', Match.anyValue());
      }).toThrow();
    });

    test('creates repository with custom name and description', () => {
      // Arrange & Act
      new MonorepoSource(stack, 'MonorepoSource', {
        repositoryConfig: {
          repositoryName: 'custom-repo'
        },
        description: 'Custom description'
      });

      // Assert
      const template = Template.fromStack(stack);
      
      template.hasResourceProperties('AWS::CodeCommit::Repository', {
        RepositoryName: 'custom-repo',
        RepositoryDescription: 'Custom description'
      });
    });
  });

  describe('SSM Parameter', () => {
    test('creates SSM parameter with correct naming convention', () => {
      // Arrange & Act
      new MonorepoSource(stack, 'MonorepoSource', {
        repositoryConfig: {
          repositoryName: 'test-repo',
          branch: 'develop'
        }
      });

      // Assert
      const template = Template.fromStack(stack);
      
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: '/MonoRepoTrigger/TestStack/test-repo/develop/LastCommit',
        Type: 'String',
        Value: 'none',
        Description: 'Last processed commit ID for test-repo/develop in stack TestStack'
      });
    });

    test('uses default branch name when not specified', () => {
      // Arrange & Act
      new MonorepoSource(stack, 'MonorepoSource', {
        repositoryConfig: {
          repositoryName: 'test-repo'
        }
      });

      // Assert
      const template = Template.fromStack(stack);
      
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: '/MonoRepoTrigger/TestStack/test-repo/main/LastCommit'
      });
    });
  });

  describe('Lambda Function', () => {
    test('creates Lambda function with correct configuration', () => {
      // Arrange & Act
      new MonorepoSource(stack, 'MonorepoSource', {
        lambdaTimeoutSeconds: 120
      });

      // Assert
      const template = Template.fromStack(stack);
      
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'python3.12',
        Handler: 'index.handler',
        Timeout: 120,
        Description: 'Monorepo pipeline trigger function',
        Environment: {
          Variables: {
            PIPELINE_MAPPINGS: '{}'
          }
        }
      });
    });

    test('uses default timeout when not specified', () => {
      // Arrange & Act
      new MonorepoSource(stack, 'MonorepoSource');

      // Assert
      const template = Template.fromStack(stack);
      
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 60
      });
    });

    test('has correct IAM permissions for CodeCommit and SSM', () => {
      // Arrange & Act
      new MonorepoSource(stack, 'MonorepoSource');

      // Assert
      const template = Template.fromStack(stack);
      
      // Verify Lambda has IAM policy with correct permissions
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            // CodeCommit permissions
            Match.objectLike({
              Effect: 'Allow',
              Action: Match.arrayWith(['codecommit:Get*']),
              Resource: Match.anyValue()
            }),
            // SSM read permissions (CDK grants broader permissions)
            Match.objectLike({
              Effect: 'Allow',
              Action: Match.arrayWith(['ssm:GetParameter']),
              Resource: Match.anyValue()
            }),
            // SSM write permission
            Match.objectLike({
              Effect: 'Allow',
              Action: 'ssm:PutParameter',
              Resource: Match.anyValue()
            })
          ])
        }
      });
    });
  });

  describe('EventBridge Rule', () => {
    test('creates EventBridge rule with correct event pattern', () => {
      // Arrange & Act
      new MonorepoSource(stack, 'MonorepoSource', {
        repositoryConfig: {
          repositoryName: 'test-repo',
          branch: 'develop'
        }
      });

      // Assert
      const template = Template.fromStack(stack);
      
      template.hasResourceProperties('AWS::Events::Rule', {
        Description: 'Trigger monorepo pipeline processing for test-repo/develop',
        EventPattern: {
          source: ['aws.codecommit'],
          'detail-type': ['CodeCommit Repository State Change'],
          detail: {
            repositoryName: ['test-repo'],
            referenceType: ['branch'],
            referenceName: ['develop']
          }
        }
      });
    });

    test('targets Lambda function', () => {
      // Arrange & Act
      new MonorepoSource(stack, 'MonorepoSource');

      // Assert
      const template = Template.fromStack(stack);
      
      // Verify EventBridge rule has Lambda target
      template.hasResourceProperties('AWS::Events::Rule', {
        Targets: Match.arrayWith([
          Match.objectLike({
            Arn: Match.anyValue(),
            Id: Match.anyValue()
          })
        ])
      });

      // Verify Lambda permission for EventBridge
      template.hasResourceProperties('AWS::Lambda::Permission', {
        Action: 'lambda:InvokeFunction',
        Principal: 'events.amazonaws.com'
      });
    });
  });

  describe('Pipeline Registration', () => {
    let monorepoSource: MonorepoSource;
    let mockPipeline: codepipeline.IPipeline;

    beforeEach(() => {
      monorepoSource = new MonorepoSource(stack, 'MonorepoSource');
      
      // Create a mock pipeline
      mockPipeline = {
        pipelineName: 'test-pipeline',
        pipelineArn: 'arn:aws:codepipeline:us-east-1:123456789012:test-pipeline'
      } as codepipeline.IPipeline;
    });

    test('registers pipeline and updates environment variable', () => {
      // Arrange & Act
      monorepoSource.registerPipeline('test-registration', {
        pipeline: mockPipeline,
        triggerPaths: ['agent/**', 'shared/**']
      });

      // Assert
      const template = Template.fromStack(stack);
      
      // Verify Lambda environment variable is updated
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            PIPELINE_MAPPINGS: JSON.stringify({
              'test-pipeline': ['agent/**', 'shared/**']
            })
          }
        }
      });
    });

    test('grants Lambda permission to start registered pipeline', () => {
      // Arrange & Act
      monorepoSource.registerPipeline('test-registration', {
        pipeline: mockPipeline,
        triggerPaths: ['agent/**']
      });

      // Assert
      const template = Template.fromStack(stack);
      
      // Verify Lambda has permission to start the pipeline
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: 'codepipeline:StartPipelineExecution',
              Resource: 'arn:aws:codepipeline:us-east-1:123456789012:test-pipeline'
            })
          ])
        }
      });
    });

    test('supports multiple pipeline registrations', () => {
      // Arrange
      const mockPipeline2 = {
        pipelineName: 'test-pipeline-2',
        pipelineArn: 'arn:aws:codepipeline:us-east-1:123456789012:test-pipeline-2'
      } as codepipeline.IPipeline;

      // Act
      monorepoSource.registerPipeline('registration-1', {
        pipeline: mockPipeline,
        triggerPaths: ['agent/**']
      });

      monorepoSource.registerPipeline('registration-2', {
        pipeline: mockPipeline2,
        triggerPaths: ['frontend/**', 'shared/**']
      });

      // Assert
      const template = Template.fromStack(stack);
      
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            PIPELINE_MAPPINGS: JSON.stringify({
              'test-pipeline': ['agent/**'],
              'test-pipeline-2': ['frontend/**', 'shared/**']
            })
          }
        }
      });
    });

    test('throws error for empty trigger paths', () => {
      // Arrange & Act & Assert
      expect(() => {
        monorepoSource.registerPipeline('test-registration', {
          pipeline: mockPipeline,
          triggerPaths: []
        });
      }).toThrow('triggerPaths must contain at least one pattern');
    });

    test('throws error for invalid pattern format', () => {
      // Arrange & Act & Assert
      expect(() => {
        monorepoSource.registerPipeline('test-registration', {
          pipeline: mockPipeline,
          triggerPaths: ['/agent/**']
        });
      }).toThrow('triggerPaths must be relative patterns (no leading /)');
    });

    test('throws error for duplicate pipeline registration', () => {
      // Arrange
      monorepoSource.registerPipeline('test-registration', {
        pipeline: mockPipeline,
        triggerPaths: ['agent/**']
      });

      // Act & Assert
      expect(() => {
        monorepoSource.registerPipeline('test-registration', {
          pipeline: mockPipeline,
          triggerPaths: ['frontend/**']
        });
      }).toThrow('Pipeline test-registration is already registered');
    });
  });
});