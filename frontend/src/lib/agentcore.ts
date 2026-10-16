import "server-only";

import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";

import type { AgentEntry } from "@/lib/registry";

export interface InvokeOptions {
  agent: AgentEntry;
  prompt: string;
  sessionId: string;
  userId: string;
  signal?: AbortSignal;
}

let client: BedrockAgentCoreClient | undefined;

function getClient(): BedrockAgentCoreClient {
  // Region comes from AWS_REGION; credentials from the default provider chain
  // (the ECS task role when deployed, your AWS profile when run locally).
  client ??= new BedrockAgentCoreClient({});
  return client;
}

/**
 * Invokes the agent and yields each parsed JSON event from its SSE stream.
 *
 * Talks to LOCAL_AGENT_URL over plain HTTP when it is set, otherwise to the
 * AgentCore Runtime with SigV4. A JSON (non-streaming) response is converted
 * into a single text event, or thrown as an error when it carries one.
 */
export async function* invokeAgent(options: InvokeOptions): AsyncGenerator<unknown> {
  const localUrl = process.env.LOCAL_AGENT_URL;
  const { body, contentType } = localUrl
    ? await invokeLocal(localUrl, options)
    : await invokeRuntime(options);

  if (!contentType.includes("text/event-stream")) {
    yield* fromJsonBody(await new Response(body).text());
    return;
  }

  yield* readSse(body);
}

async function invokeLocal(
  baseUrl: string,
  { prompt, sessionId, userId, signal }: InvokeOptions,
): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }> {
  const url = baseUrl.replace(/\/+$/, "").replace(/(\/invocations)?$/, "/invocations");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
        "X-Amzn-Bedrock-AgentCore-Runtime-User-Id": userId,
      },
      body: JSON.stringify({ prompt }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`Cannot connect to local agent at ${url}. Is the agent running?`);
  }
  if (!response.ok || !response.body) {
    throw new Error(`Local agent returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return { body: response.body, contentType: response.headers.get("content-type") ?? "" };
}

async function invokeRuntime({
  agent,
  prompt,
  sessionId,
  userId,
  signal,
}: InvokeOptions): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }> {
  try {
    const response = await getClient().send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn: agent.runtimeArn,
        runtimeSessionId: sessionId,
        runtimeUserId: userId,
        qualifier: "DEFAULT",
        contentType: "application/json",
        accept: "text/event-stream",
        payload: new TextEncoder().encode(JSON.stringify({ prompt })),
      }),
      { abortSignal: signal },
    );
    if (!response.response) {
      throw new Error("AgentCore Runtime returned an empty response");
    }
    return {
      body: response.response.transformToWebStream(),
      contentType: response.contentType ?? "",
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(describeRuntimeError(error));
  }
}

function describeRuntimeError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name.includes("AccessDenied")) {
    return "Access denied invoking the agent. Check the AWS credentials and their bedrock-agentcore:InvokeAgentRuntime permission.";
  }
  if (name.includes("ResourceNotFound")) {
    return "Agent runtime not found. Check that the stack is deployed and the runtime ARN is current.";
  }
  if (name.includes("CredentialsProviderError")) {
    return "No AWS credentials found. Configure a profile or environment credentials and retry.";
  }
  return `Failed to invoke agent: ${message}`;
}

/** Splits an SSE byte stream into events and yields each `data:` payload parsed as JSON. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
        const event = parseSseBlock(block);
        if (event !== undefined) yield event;
      }
    }
    const event = parseSseBlock(buffer);
    if (event !== undefined) yield event;
  } finally {
    reader.releaseLock();
  }
}

function parseSseBlock(block: string): unknown {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data) return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

function* fromJsonBody(text: string): Generator<unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    yield { data: text };
    return;
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const error = record.error ?? record.message ?? record.Message;
    if (typeof error === "string" && !("result" in record)) {
      throw new Error(`Agent returned an error: ${error}`);
    }
    yield { data: extractText(record.result ?? record) };
    return;
  }
  yield { data: String(parsed) };
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.content)) {
      return record.content
        .map((item) => (item && typeof item === "object" ? String((item as { text?: unknown }).text ?? "") : ""))
        .join("\n");
    }
    if (typeof record.content === "string") return record.content;
    if (typeof record.text === "string") return record.text;
  }
  return JSON.stringify(value);
}
