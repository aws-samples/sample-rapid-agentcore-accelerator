# CognitoAuth Construct

An L3 CDK construct for creating a Cognito User Pool with app client and hosted UI domain for authentication.

## Features

- Email-based sign-in
- Hosted UI with OAuth flows
- Configurable password policy
- Token validity settings

## Resources Created

- Cognito User Pool (email sign-in, no self-registration)
- App Client with OAuth flows
- Hosted UI Domain

## Usage

```typescript
import { CognitoAuth } from './constructs/cognito-auth';

const auth = new CognitoAuth(this, 'Auth', {
  userPoolName: 'my-app-users',        // optional
  callbackUrls: ['https://myapp.com'], // optional
  logoutUrls: ['https://myapp.com'],   // optional
  domainPrefix: 'my-app-auth',         // optional
});

// Access resources
auth.userPool;
auth.userPoolClient;
auth.userPoolDomain;
auth.domainUrl; // full hosted UI URL
```

## Props

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `userPoolName` | string | No | `agent-user-pool` | Name for the user pool |
| `callbackUrls` | string[] | No | `['http://localhost:8501/']` | OAuth callback URLs |
| `logoutUrls` | string[] | No | `['http://localhost:8501/']` | OAuth logout URLs |
| `domainPrefix` | string | No | `agent-auth-{accountId}` | Domain prefix for hosted UI |

## Exposed Properties

| Property | Type | Description |
|----------|------|-------------|
| `userPool` | UserPool | The Cognito User Pool |
| `userPoolClient` | UserPoolClient | The app client |
| `userPoolDomain` | UserPoolDomain | The hosted UI domain |
| `domainUrl` | string | Full hosted UI URL |

## Password Policy

- Minimum 8 characters
- Requires lowercase, uppercase, and digits
- Symbols not required

## Token Validity

- Access token: 1 hour
- ID token: 1 hour
- Refresh token: 30 days
