import type { NextRequest } from "next/server";

import { getAuthMode } from "@/lib/auth";
import { getAgents } from "@/lib/registry";
import { getRequestUser } from "@/lib/request-user";

/** What the chat UI needs at load time: who is signed in, and which agents exist. */
export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  return Response.json({
    user,
    authMode: getAuthMode(),
    agents: getAgents().map((a) => a.name),
  });
}
