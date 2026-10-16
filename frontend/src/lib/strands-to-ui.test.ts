import type { UIMessageChunk } from "ai";
import { describe, expect, test } from "vitest";

import { StrandsToUiMapper } from "@/lib/strands-to-ui";

/** Runs agent SSE events (as emitted by agent/{name}/src/utils/sse.py) through the mapper. */
function map(events: unknown[]): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [];
  const mapper = new StrandsToUiMapper((chunk) => chunks.push(chunk));
  events.forEach((event) => mapper.handle(event));
  mapper.end();
  return chunks;
}

describe("StrandsToUiMapper", () => {
  test("streams reasoning, then text, as separate parts", () => {
    expect(
      map([
        { reasoning: true, reasoningText: "The user wants " },
        { reasoning: true, reasoningText: "an order status." },
        { data: "Let me " },
        { data: "check." },
      ]),
    ).toEqual([
      { type: "reasoning-start", id: "reasoning-1" },
      { type: "reasoning-delta", id: "reasoning-1", delta: "The user wants " },
      { type: "reasoning-delta", id: "reasoning-1", delta: "an order status." },
      { type: "reasoning-end", id: "reasoning-1" },
      { type: "text-start", id: "text-2" },
      { type: "text-delta", id: "text-2", delta: "Let me " },
      { type: "text-delta", id: "text-2", delta: "check." },
      { type: "text-end", id: "text-2" },
    ]);
  });

  test("maps a successful tool call from input streaming through result", () => {
    const tool = { toolUseId: "t1", name: "lookup_order" };
    expect(
      map([
        { data: "Checking." },
        { current_tool_use: { ...tool, input: "" } },
        { current_tool_use: { ...tool, input: '{"order_id"' } },
        { current_tool_use: { ...tool, input: '{"order_id": "123"}' } },
        {
          message: {
            role: "assistant",
            content: [{ text: "Checking." }, { toolUse: { ...tool, input: { order_id: "123" } } }],
          },
        },
        {
          message: {
            role: "user",
            content: [{ toolResult: { toolUseId: "t1", status: "success", content: [{ text: "Order 123: shipped" }] } }],
          },
        },
        { data: "It shipped." },
      ]),
    ).toEqual([
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Checking." },
      { type: "text-end", id: "text-1" },
      { type: "tool-input-start", toolCallId: "t1", toolName: "lookup_order", dynamic: true },
      { type: "tool-input-delta", toolCallId: "t1", inputTextDelta: '{"order_id"' },
      { type: "tool-input-delta", toolCallId: "t1", inputTextDelta: ': "123"}' },
      { type: "tool-input-available", toolCallId: "t1", toolName: "lookup_order", input: { order_id: "123" }, dynamic: true },
      { type: "tool-output-available", toolCallId: "t1", output: "Order 123: shipped", dynamic: true },
      { type: "text-start", id: "text-2" },
      { type: "text-delta", id: "text-2", delta: "It shipped." },
      { type: "text-end", id: "text-2" },
    ]);
  });

  test("maps a failed tool result to tool-output-error", () => {
    const chunks = map([
      { message: { role: "assistant", content: [{ toolUse: { toolUseId: "t2", name: "create_ticket", input: {} } }] } },
      {
        message: {
          role: "user",
          content: [{ toolResult: { toolUseId: "t2", status: "error", content: [{ text: "Service unavailable" }] } }],
        },
      },
    ]);
    expect(chunks.at(-1)).toEqual({
      type: "tool-output-error",
      toolCallId: "t2",
      errorText: "Service unavailable",
      dynamic: true,
    });
  });

  test("skips events the deltas already cover, and surfaces agent errors", () => {
    expect(
      map([
        { reasoning: true, reasoning_signature: "abc" },
        { message: { role: "assistant", content: [{ text: "duplicate of streamed text" }] } },
        { result: { message: {} } },
        { init_event_loop: true },
        { error: "Model access denied" },
      ]),
    ).toEqual([{ type: "error", errorText: "Model access denied" }]);
  });
});
