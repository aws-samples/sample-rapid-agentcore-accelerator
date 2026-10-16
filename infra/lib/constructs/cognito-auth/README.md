# CognitoAuth Construct

An L3 CDK construct for creating a Cognito User Pool with app client and a managed login domain for authentication.

## Features

- Email-based sign-in
- Managed login (the current Cognito sign-in pages, not the classic hosted UI) with OAuth flows
- Configurable password policy
- Token validity settings

## Resources Created

- Cognito User Pool (email sign-in, no self-registration)
- App Client with OAuth flows
- User Pool Domain (managed login version 2)
- Managed login branding with Cognito's default style

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
auth.domainUrl; // full managed login URL
```

## Props

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `userPoolName` | string | No | `agent-user-pool` | Name for the user pool |
| `callbackUrls` | string[] | No | `['http://localhost:3000/api/auth/callback']` | OAuth callback URLs |
| `logoutUrls` | string[] | No | `['http://localhost:3000/']` | OAuth logout URLs |
| `domainPrefix` | string | No | `agent-auth-{accountId}` | Domain prefix for managed login |

## Exposed Properties

| Property | Type | Description |
|----------|------|-------------|
| `userPool` | UserPool | The Cognito User Pool |
| `userPoolClient` | UserPoolClient | The app client |
| `userPoolDomain` | UserPoolDomain | The managed login domain |
| `domainUrl` | string | Full managed login URL |

## Password Policy

- Minimum 8 characters
- Requires lowercase, uppercase, and digits
- Symbols not required

## Token Validity

- Access token: 1 hour
- ID token: 1 hour
- Refresh token: 30 days
