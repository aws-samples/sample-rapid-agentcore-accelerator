import "server-only";

import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTPayload } from "jose";

/**
 * How users authenticate to this frontend. Set by CDK per frontendMode:
 *
 *   none  internal mode and local dev. Every request is an anonymous user.
 *   alb   public mode, and cloudfront with a domain. The ALB runs the Cognito
 *         login and forwards a signed x-amzn-oidc-data header.
 *   app   cloudfront without a domain. This app runs the OAuth code flow itself
 *         (/api/auth/*) and keeps the Cognito ID token in an httpOnly cookie.
 */
export type AuthMode = "none" | "alb" | "app";

export interface User {
  /** Stable identifier, sent to AgentCore as the runtime user ID. */
  id: string;
  email?: string;
  name?: string;
}

export const ID_TOKEN_COOKIE = "rapid_id_token";
export const OAUTH_STATE_COOKIE = "rapid_oauth_state";

const region = () => process.env.AWS_REGION ?? "us-west-2";

export function getAuthMode(): AuthMode {
  const mode = process.env.AUTH_MODE;
  return mode === "alb" || mode === "app" ? mode : "none";
}

export interface CognitoSettings {
  domain: string;
  clientId: string;
  userPoolId: string;
  redirectUri: string;
}

/** The URL users reach this app at (CloudFront, custom domain, or ALB), set by CDK. */
export function getPublicUrl(): string {
  return (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function getCognitoSettings(): CognitoSettings {
  return {
    domain: process.env.COGNITO_DOMAIN ?? "",
    clientId: process.env.COGNITO_CLIENT_ID ?? "",
    userPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
    redirectUri: `${getPublicUrl()}/api/auth/callback`,
  };
}

/** Resolves the signed-in user for a request, or null when authentication is required and missing. */
export async function getUser(headers: Headers, cookie: (name: string) => string | undefined): Promise<User | null> {
  switch (getAuthMode()) {
    case "none":
      return process.env.LOCAL_AGENT_URL ? { id: "local-user", name: "Local user" } : { id: "internal-user", name: "Internal user" };
    case "alb":
      return userFromAlbHeader(headers.get("x-amzn-oidc-data"));
    case "app":
      return userFromIdToken(cookie(ID_TOKEN_COOKIE));
  }
}

function toUser(claims: JWTPayload): User | null {
  if (!claims.sub) return null;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    name:
      (typeof claims["cognito:username"] === "string" && claims["cognito:username"]) ||
      (typeof claims.username === "string" && claims.username) ||
      undefined,
  };
}

// ── ALB-signed header ─────────────────────────────────────────────────────────

const albKeys = new Map<string, CryptoKey>();

async function albPublicKey(kid: string): Promise<CryptoKey> {
  const cached = albKeys.get(kid);
  if (cached) return cached;
  // kid comes from the token header; constrain it before using it in a URL.
  if (!/^[A-Za-z0-9-]+$/.test(kid)) throw new Error("Unexpected kid in ALB token");
  const response = await fetch(`https://public-keys.auth.elb.${region()}.amazonaws.com/${kid}`);
  if (!response.ok) throw new Error(`Could not fetch ALB public key (${response.status})`);
  const key = await importSPKI(await response.text(), "ES256");
  albKeys.set(kid, key);
  return key;
}

/**
 * Verifies the ALB's x-amzn-oidc-data JWT (ES256, key published per region).
 * The ALB pads its base64url segments, which strict JWT libraries reject, so
 * padding is stripped first.
 */
async function userFromAlbHeader(token: string | null): Promise<User | null> {
  if (!token) return null;
  try {
    const unpadded = token
      .split(".")
      .map((segment) => segment.replace(/=+$/, ""))
      .join(".");
    const header = JSON.parse(Buffer.from(unpadded.split(".")[0], "base64url").toString("utf8")) as { kid?: string };
    if (!header.kid) return null;
    const { payload } = await jwtVerify(unpadded, await albPublicKey(header.kid), { algorithms: ["ES256"] });
    return toUser(payload);
  } catch (error) {
    console.error("Rejected ALB OIDC header:", error instanceof Error ? error.message : error);
    return null;
  }
}

// ── App-level OAuth (Cognito ID token) ────────────────────────────────────────

let cognitoJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function cognitoIssuer(): string {
  return `https://cognito-idp.${region()}.amazonaws.com/${getCognitoSettings().userPoolId}`;
}

/** Verifies a Cognito ID token against the user pool's JWKS, issuer, and client ID. */
export async function verifyIdToken(token: string): Promise<JWTPayload> {
  cognitoJwks ??= createRemoteJWKSet(new URL(`${cognitoIssuer()}/.well-known/jwks.json`));
  const { payload } = await jwtVerify(token, cognitoJwks, {
    issuer: cognitoIssuer(),
    audience: getCognitoSettings().clientId,
    algorithms: ["RS256"],
  });
  if (payload.token_use !== "id") throw new Error("Not an ID token");
  return payload;
}

async function userFromIdToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  try {
    return toUser(await verifyIdToken(token));
  } catch {
    return null;
  }
}

/** The Cognito hosted-UI logout URL, which returns the browser to `returnTo`. */
export function cognitoLogoutUrl(returnTo: string): string | null {
  const { domain, clientId } = getCognitoSettings();
  if (!domain || !clientId) return null;
  const params = new URLSearchParams({ client_id: clientId, logout_uri: returnTo });
  return `https://${domain}/logout?${params}`;
}
