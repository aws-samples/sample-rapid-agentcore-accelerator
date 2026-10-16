import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import type { NextRequest } from "next/server";

import { invokeAgent } from "@/lib/agentcore";
import { findAgent } from "@/lib/registry";
import { getRequestUser } from "@/lib/request-user";
import { StrandsToUiMapper } from "@/lib/strands-to-ui";

// AgentCore requires runtime session IDs of at least 33 characters.
const SESSION_ID = /^[A-Za-z0-9_-]{33,128}$/;

interface ChatRequest {
  id: string;
  agent?: string;
  message?: UIMessage;
}

export async function POST(request: NextRequest) {
  // Cookie-authenticated POSTs must come from this app's own pages.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return Response.json({ error: "Cross-site request rejected" }, { status: 403 });
  }

  const user = await getRequestUser(request);
  if (!user) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id, agent: agentName, message } = (await request.json()) as ChatRequest;
  if (!SESSION_ID.test(id ?? "")) {
    return Response.json({ error: "Invalid chat id" }, { status: 400 });
  }
  const agent = findAgent(agentName);
  if (!agent) {
    return Response.json({ error: `Unknown agent "${agentName}"` }, { status: 400 });
  }
  const prompt = (message?.parts ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
  if (!prompt) {
    return Response.json({ error: "Empty message" }, { status: 400 });
  }

  // Conversation history lives in the AgentCore session (memory or the agent's
  // session manager), so only the newest user message is sent.
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      const mapper = new StrandsToUiMapper((chunk) => writer.write(chunk));
      for await (const event of invokeAgent({
        agent,
        prompt,
        sessionId: id,
        userId: user.id,
        signal: request.signal,
      })) {
        mapper.handle(event);
      }
      mapper.end();
      writer.write({ type: "finish" });
    },
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });

  // Keep-alive comments stop CloudFront and the ALB from closing the
  // connection while a long tool call produces no output.
  return createUIMessageStreamResponse({ stream, keepAliveMs: 15_000 });
}
