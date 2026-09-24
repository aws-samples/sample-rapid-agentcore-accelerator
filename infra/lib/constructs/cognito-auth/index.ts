// ============================================================================
// SAMPLE CODE - NOT FOR PRODUCTION USE
// This is sample code intended for demonstration and prototyping purposes only.
// It should be reviewed, tested, and validated before any production deployment.
// ============================================================================

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface CognitoAuthProps {
  /**
   * Name for the user pool
   * @default 'agent-user-pool'
   */
  readonly userPoolName?: string;

  /**
   * OAuth callback URLs (for local development)
   * @default ['http://localhost:8501/']
   */
  readonly callbackUrls?: string[];

  /**
   * OAuth logout URLs (for local development)
   * @default ['http://localhost:8501/']
   */
  readonly logoutUrls?: string[];

  /**
   * Domain prefix for hosted UI
   * @default '{userPoolName}-{accountId}'
   */
  readonly domainPrefix?: string;

  /**
   * Whether to generate a client secret.
   * Set to true for ALB-level Cognito authentication.
   * Set to false for application-level OAuth (public client).
   * @default true
   */
  readonly generateClientSecret?: boolean;
}

export class CognitoAuth extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props?: CognitoAuthProps) {
    super(scope, id);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: props?.userPoolName ?? 'agent-user-pool',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.userPoolClient = this.userPool.addClient('AppClient', {
      userPoolClientName: 'app-client',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: props?.generateClientSecret !== false, // Default true for ALB auth
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: props?.callbackUrls ?? ['http://localhost:8501/'],
        logoutUrls: props?.logoutUrls ?? ['http://localhost:8501/'],
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    this.userPoolDomain = this.userPool.addDomain('Domain', {
      cognitoDomain: {
        domainPrefix: props?.domainPrefix ?? `${(props?.userPoolName ?? 'agent-user-pool').slice(0, 49)}-${cdk.Aws.ACCOUNT_ID}`,
      },
    });
  }

  /**
   * Get the hosted UI domain URL
   */
  public get domainUrl(): string {
    return `https://${this.userPoolDomain.domainName}.auth.${cdk.Aws.REGION}.amazoncognito.com`;
  }

  /**
   * Add ALB callback URLs to the Cognito client.
   * Call this after creating the ALB to register its URLs for OAuth redirects.
   * Used for ALB-level Cognito authentication (with custom domain).
   * 
   * @param albDnsName The ALB DNS name (e.g., from loadBalancer.loadBalancerDnsName)
   * @param useHttps Whether to use HTTPS (default: true)
   */
  public addAlbCallbackUrls(albDnsName: string, useHttps: boolean = true): void {
    const protocol = useHttps ? 'https' : 'http';
    const callbackUrl = `${protocol}://${albDnsName}/oauth2/idpresponse`;
    const logoutUrl = `${protocol}://${albDnsName}/`;

    // Use AwsCustomResource to update the user pool client with ALB URLs
    new cr.AwsCustomResource(this, 'UpdateCallbackUrls', {
      onCreate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'updateUserPoolClient',
        parameters: {
          UserPoolId: this.userPool.userPoolId,
          ClientId: this.userPoolClient.userPoolClientId,
          CallbackURLs: [callbackUrl, 'http://localhost:8501/'],
          LogoutURLs: [logoutUrl, 'http://localhost:8501/'],
          AllowedOAuthFlows: ['code'],
          AllowedOAuthScopes: ['email', 'openid', 'profile'],
          AllowedOAuthFlowsUserPoolClient: true,
          SupportedIdentityProviders: ['COGNITO'],
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${this.userPoolClient.userPoolClientId}-callback-urls`),
      },
      onUpdate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'updateUserPoolClient',
        parameters: {
          UserPoolId: this.userPool.userPoolId,
          ClientId: this.userPoolClient.userPoolClientId,
          CallbackURLs: [callbackUrl, 'http://localhost:8501/'],
          LogoutURLs: [logoutUrl, 'http://localhost:8501/'],
          AllowedOAuthFlows: ['code'],
          AllowedOAuthScopes: ['email', 'openid', 'profile'],
          AllowedOAuthFlowsUserPoolClient: true,
          SupportedIdentityProviders: ['COGNITO'],
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${this.userPoolClient.userPoolClientId}-callback-urls`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['cognito-idp:UpdateUserPoolClient'],
          resources: [this.userPool.userPoolArn],
        }),
      ]),
    });
  }

  /**
   * Add app-level OAuth callback URLs to the Cognito client.
   * Used for application-level OAuth (CloudFront without custom domain).
   * The redirect_uri is the root path (/) since the Streamlit app handles the callback.
   * 
   * @param domainName The CloudFront distribution domain (e.g., d1234.cloudfront.net)
   */
  public addAppCallbackUrls(domainName: string): void {
    const callbackUrl = `https://${domainName}/`;
    const logoutUrl = `https://${domainName}/`;

    new cr.AwsCustomResource(this, 'UpdateAppCallbackUrls', {
      onCreate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'updateUserPoolClient',
        parameters: {
          UserPoolId: this.userPool.userPoolId,
          ClientId: this.userPoolClient.userPoolClientId,
          CallbackURLs: [callbackUrl, 'http://localhost:8501/'],
          LogoutURLs: [logoutUrl, 'http://localhost:8501/'],
          AllowedOAuthFlows: ['code'],
          AllowedOAuthScopes: ['email', 'openid', 'profile'],
          AllowedOAuthFlowsUserPoolClient: true,
          SupportedIdentityProviders: ['COGNITO'],
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${this.userPoolClient.userPoolClientId}-app-callback-urls`),
      },
      onUpdate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'updateUserPoolClient',
        parameters: {
          UserPoolId: this.userPool.userPoolId,
          ClientId: this.userPoolClient.userPoolClientId,
          CallbackURLs: [callbackUrl, 'http://localhost:8501/'],
          LogoutURLs: [logoutUrl, 'http://localhost:8501/'],
          AllowedOAuthFlows: ['code'],
          AllowedOAuthScopes: ['email', 'openid', 'profile'],
          AllowedOAuthFlowsUserPoolClient: true,
          SupportedIdentityProviders: ['COGNITO'],
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${this.userPoolClient.userPoolClientId}-app-callback-urls`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['cognito-idp:UpdateUserPoolClient'],
          resources: [this.userPool.userPoolArn],
        }),
      ]),
    });
  }
}
