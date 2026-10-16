import { NextResponse, type NextRequest } from "next/server";

import { getPublicUrl, ID_TOKEN_COOKIE } from "@/lib/auth";

/**
 * With app-level OAuth (AUTH_MODE=app), sends visitors without a session cookie
 * straight to the Cognito login. This is only an optimistic check: every API
 * route verifies the token itself, and the UI redirects again on a 401.
 */
export function proxy(request: NextRequest) {
  if (process.env.AUTH_MODE === "app" && !request.cookies.has(ID_TOKEN_COOKIE)) {
    // Behind CloudFront the Host header is the ALB's, so build the URL from PUBLIC_URL.
    return NextResponse.redirect(`${getPublicUrl()}/api/auth/login`);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/",
};
