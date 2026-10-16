import { NextResponse, type NextRequest } from "next/server";

import { getAuthMode, getCognitoSettings, getPublicUrl, ID_TOKEN_COOKIE, OAUTH_STATE_COOKIE, verifyIdToken } from "@/lib/auth";

/** Completes the Cognito code flow: checks state, exchanges the code, stores the ID token. */
export async function GET(request: NextRequest) {
  if (getAuthMode() !== "app") {
    return Response.json({ error: "App-level sign-in is not enabled" }, { status: 404 });
  }
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  let saved: { state?: string; verifier?: string } = {};
  try {
    saved = JSON.parse(request.cookies.get(OAUTH_STATE_COOKIE)?.value ?? "{}");
  } catch {
    // Treated as a missing state below.
  }
  if (!code || !state || state !== saved.state || !saved.verifier) {
    return new Response("Sign-in failed: invalid or expired state. Go back and try again.", { status: 400 });
  }

  const { domain, clientId, redirectUri } = getCognitoSettings();
  const tokenResponse = await fetch(`https://${domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: saved.verifier,
    }),
  });
  if (!tokenResponse.ok) {
    console.error("Cognito token exchange failed:", tokenResponse.status, await tokenResponse.text());
    return new Response("Sign-in failed: the token exchange was rejected.", { status: 502 });
  }
  const { id_token: idToken } = (await tokenResponse.json()) as { id_token?: string };
  if (!idToken) {
    return new Response("Sign-in failed: no ID token returned.", { status: 502 });
  }

  let expiresAt: number;
  try {
    expiresAt = (await verifyIdToken(idToken)).exp ?? 0;
  } catch {
    return new Response("Sign-in failed: the ID token did not verify.", { status: 502 });
  }

  // Redirect to the public URL, not the request's internal (ALB-facing) host.
  const response = NextResponse.redirect(`${getPublicUrl()}/`);
  response.cookies.set(ID_TOKEN_COOKIE, idToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
  });
  response.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/auth" });
  return response;
}
