#!/usr/bin/env node
// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import { execSync } from 'child_process';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { AgentCoreStack } from './lib/stacks/agentcore-cdk-stack';
import { loadAcceleratorConfig } from './lib/config';

// ─── Git metadata for resource tagging ──────────────────────────────────────────
function getGitInfo(): { repo: string; branch: string; commit: string } {
  try {
    const repo = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    return { repo, branch, commit };
  } catch {
    return { repo: 'unknown', branch: 'unknown', commit: 'unknown' };
  }
}

const gitInfo = getGitInfo();

const config = loadAcceleratorConfig(path.join(__dirname, '..'));
const app = new cdk.App();

const stack = new AgentCoreStack(app, `AgentCore-${config.deploymentPrefix}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: config.region,
  },
  config,
});

// ─── Resource Tagging ───────────────────────────────────────────────────────────
// Tags are applied at the app level so they propagate to ALL resources in ALL stacks.
cdk.Tags.of(app).add('project', 'RAPID');
cdk.Tags.of(app).add('deploymentPrefix', config.deploymentPrefix);
cdk.Tags.of(app).add('repo', gitInfo.repo);
cdk.Tags.of(app).add('branch', gitInfo.branch);
cdk.Tags.of(app).add('commit', gitInfo.commit);

// ─── cdk-nag: AWS Solutions Checks ──────────────────────────────────────────────
// This is a rapid-prototyping accelerator (workshops / POCs), not production software.
// Suppressions below reflect intentional trade-offs for development speed and easy cleanup.
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

NagSuppressions.addStackSuppressions(stack, [
  // ── S3 Buckets ──────────────────────────────────────────────────────────────
  {
    id: 'AwsSolutions-S1',
    reason: 'RAPID prototype — server access logs not required for workshop/POC buckets.',
  },
  {
    id: 'AwsSolutions-S10',
    reason: 'RAPID prototype — SSL-only enforcement not required for internal document buckets.',
  },

  // ── IAM ─────────────────────────────────────────────────────────────────────
  {
    id: 'AwsSolutions-IAM4',
    reason: 'AWS managed policies (e.g., AWSLambdaBasicExecutionRole) are acceptable for rapid prototyping.',
  },
  {
    id: 'AwsSolutions-IAM5',
    reason: 'Wildcard permissions are acceptable for prototype — resources are ephemeral and will be destroyed after workshop.',
  },

  // ── Lambda ──────────────────────────────────────────────────────────────────
  {
    id: 'AwsSolutions-L1',
    reason: 'Lambda runtime version management is not critical for short-lived prototype deployments.',
  },

  // ── CloudWatch Logs ─────────────────────────────────────────────────────────
  {
    id: 'AwsSolutions-CW1',
    reason: 'Log retention policies not set — prototype resources are short-lived and destroyed after use.',
  },

  // ── VPC / Networking ────────────────────────────────────────────────────────
  {
    id: 'AwsSolutions-VPC7',
    reason: 'VPC Flow Logs not enabled — prototype VPC is ephemeral and used only for demo traffic.',
  },

  // ── ECS / Fargate ───────────────────────────────────────────────────────────
  {
    id: 'AwsSolutions-ECS2',
    reason: 'Environment variables are non-sensitive config (ARNs, region, feature flags) — Secrets Manager not needed for prototype.',
  },
  {
    id: 'AwsSolutions-ECS4',
    reason: 'CloudWatch Container Insights not enabled — default CloudWatch metrics sufficient for prototype.',
  },
  {
    id: 'AwsSolutions-ECS7',
    reason: 'Container logging configuration uses default awslogs driver — sufficient for prototype debugging.',
  },

  // ── Elastic Load Balancing ──────────────────────────────────────────────────
  {
    id: 'AwsSolutions-ELB2',
    reason: 'ALB access logs not enabled — prototype ALB is short-lived and traffic is minimal.',
  },
  {
    id: 'AwsSolutions-EC23',
    reason: 'Public ALB with 0.0.0.0/0 ingress is intentional for workshop demo access.',
  },

  // ── CloudFront ──────────────────────────────────────────────────────────────
  {
    id: 'AwsSolutions-CFR1',
    reason: 'Geo restrictions not needed — prototype is accessible globally for workshop participants.',
  },
  {
    id: 'AwsSolutions-CFR2',
    reason: 'WAF not associated with CloudFront — acceptable for prototype/demo workloads.',
  },
  {
    id: 'AwsSolutions-CFR3',
    reason: 'CloudFront access logging not enabled — prototype distribution has minimal traffic.',
  },
  {
    id: 'AwsSolutions-CFR4',
    reason: 'Custom SSL certificate with minimum TLS 1.2 not enforced — using CloudFront default certificate for simplicity.',
  },

  // ── Cognito ─────────────────────────────────────────────────────────────────
  {
    id: 'AwsSolutions-COG1',
    reason: 'Cognito password policy uses defaults — acceptable for workshop demo users.',
  },
  {
    id: 'AwsSolutions-COG2',
    reason: 'MFA not required — prototype user pool is for demo purposes only.',
  },
  {
    id: 'AwsSolutions-COG3',
    reason: 'AdvancedSecurityMode not enabled — not required for prototype user pools.',
  },
  {
    id: 'AwsSolutions-COG8',
    reason: 'Cognito Plus tier not required — prototype user pool uses standard features only.',
  },

  // ── CodeBuild ───────────────────────────────────────────────────────────────
  {
    id: 'AwsSolutions-CB3',
    reason: 'Privileged mode is required for Docker-in-Docker builds (ARM64 container images).',
  },
  {
    id: 'AwsSolutions-CB4',
    reason: 'KMS encryption for CodeBuild artifacts not required for prototype — S3 SSE is sufficient.',
  },

  // ── ECR ─────────────────────────────────────────────────────────────────────
  {
    id: 'AwsSolutions-ECR1',
    reason: 'ECR image tag immutability not enforced — "latest" tag overwrite is intentional for rapid iteration.',
  },

  // ── KMS / Encryption ────────────────────────────────────────────────────────
  {
    id: 'AwsSolutions-KMS5',
    reason: 'KMS key rotation not configured — using AWS-managed keys (SSE-S3) for prototype simplicity.',
  },

  // ── SQS (if dead-letter queues trigger warnings) ────────────────────────────
  {
    id: 'AwsSolutions-SQS3',
    reason: 'Dead-letter queue not configured — acceptable for prototype Lambda event sources.',
  },
  {
    id: 'AwsSolutions-SQS4',
    reason: 'SQS queue SSE not using KMS CMK — SSE-SQS is sufficient for prototype.',
  },
], true);
