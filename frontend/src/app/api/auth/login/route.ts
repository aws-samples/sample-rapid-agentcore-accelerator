import { createHash, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { getAuthMode, getCognitoSettings, OAUTH_STATE_COOKIE } from "@/lib/auth";

/** Starts the Cognito authorization-code flow with PKCE (AUTH_MODE=app only). */
export function GET() {
  if (getAuthMode() !== "app") {
    return Response.json({ error: "App-level sign-in is not enabled" }, { status: 404 });
  }
  const { domain, clientId, redirectUri } = getCognitoSettings();
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const response = NextResponse.redirect(`https://${domain}/oauth2/authorize?${params}`);
  response.cookies.set(OAUTH_STATE_COOKIE, JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 600,
  });
  return response;
}
