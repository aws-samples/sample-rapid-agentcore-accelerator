// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53_targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

/**
 * Custom domain configuration for the CloudFront distribution.
 * When provided, creates an ACM certificate, Route 53 alias record,
 * and configures the distribution with the custom domain as a CNAME.
 */
export interface CloudFrontFrontendDomainConfig {
  /** Custom domain name (e.g., 'app.example.com') */
  readonly domainName: string;
  /** Route 53 hosted zone for DNS and certificate validation */
  readonly hostedZone: route53.IHostedZone;
}

/**
 * Props for the CloudFrontFrontend construct.
 */
export interface CloudFrontFrontendProps {
  /** VPC containing the internal ALB (required) */
  readonly vpc: ec2.IVpc;
  /** The internal ALB from StreamlitFrontend (required) */
  readonly alb: elbv2.IApplicationLoadBalancer;
  /** Optional custom domain configuration */
  readonly domain?: CloudFrontFrontendDomainConfig;
}

/**
 * CloudFront Frontend Construct
 *
 * Creates a CloudFront distribution with a VPC Origin pointing to an internal
 * Application Load Balancer. This provides public internet access via CloudFront's
 * global CDN while keeping the ALB fully private within a VPC.
 *
 * Key features:
 * - VPC Origin for private ALB access (no public ALB needed)
 * - HTTPS termination at CloudFront edge
 * - Caching disabled (Streamlit is fully dynamic)
 * - Optional custom domain with ACM certificate and Route 53 alias
 * - RemovalPolicy.DESTROY for easy workshop cleanup
 */
export class CloudFrontFrontend extends Construct {
  /** The CloudFront distribution URL (https://domain or https://d1234.cloudfront.net) */
  public readonly distributionUrl: string;
  /** The CloudFront distribution ID */
  public readonly distributionId: string;
  /** The CloudFront Distribution construct */
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: CloudFrontFrontendProps) {
    super(scope, id);

    // Validate required props
    if (!props.vpc) {
      throw new Error('CloudFrontFrontend requires a VPC. Provide the \'vpc\' prop.');
    }
    if (!props.alb) {
      throw new Error('CloudFrontFrontend requires an ALB. Provide the \'alb\' prop.');
    }

    // Create VPC Origin targeting the internal ALB
    const vpcOrigin = origins.VpcOrigin.withApplicationLoadBalancer(props.alb, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      // Default read timeout (30s) is sufficient — once the WebSocket handshake
      // completes within 30s, CloudFront keeps the connection open indefinitely.
      keepaliveTimeout: cdk.Duration.seconds(30),
    });

    // Optional: Create ACM certificate for custom domain (must be in us-east-1 for CloudFront)
    let certificate: certificatemanager.ICertificate | undefined;
    if (props.domain) {
      certificate = new certificatemanager.Certificate(this, 'Certificate', {
        domainName: props.domain.domainName,
        validation: certificatemanager.CertificateValidation.fromDns(props.domain.hostedZone),
      });
    }

    // Create CloudFront Distribution with no caching (Streamlit is fully dynamic)
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: vpcOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      domainNames: props.domain ? [props.domain.domainName] : undefined,
      certificate,
    });
    this.distribution.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Optional: Create Route 53 A record alias pointing domain to CloudFront
    if (props.domain) {
      new route53.ARecord(this, 'AliasRecord', {
        zone: props.domain.hostedZone,
        recordName: props.domain.domainName,
        target: route53.RecordTarget.fromAlias(
          new route53_targets.CloudFrontTarget(this.distribution)
        ),
      });
    }

    // Set public properties
    this.distributionUrl = props.domain
      ? `https://${props.domain.domainName}`
      : `https://${this.distribution.distributionDomainName}`;
    this.distributionId = this.distribution.distributionId;
  }
}
