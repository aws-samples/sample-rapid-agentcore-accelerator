import { NextResponse } from "next/server";

import { cognitoLogoutUrl, getAuthMode, getPublicUrl, ID_TOKEN_COOKIE } from "@/lib/auth";

/**
 * Signs out: clears this app's session (the ID token cookie, or the ALB's auth
 * cookies) and sends the browser through the Cognito hosted-UI logout.
 */
export function GET() {
  const mode = getAuthMode();
  if (mode === "none") {
    return Response.json({ error: "Sign-in is not enabled" }, { status: 404 });
  }
  const home = `${getPublicUrl()}/`;
  const response = NextResponse.redirect(cognitoLogoutUrl(home) ?? home);
  if (mode === "app") {
    response.cookies.delete(ID_TOKEN_COOKIE);
  } else {
    // The ALB shards its session across up to four cookies.
    for (let i = 0; i < 4; i++) {
      response.cookies.set(`AWSELBAuthSessionCookie-${i}`, "", { path: "/", maxAge: 0, secure: true });
    }
  }
  return response;
}
