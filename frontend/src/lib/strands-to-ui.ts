import type { UIMessageChunk } from "ai";

/**
 * Translates the agent's Strands SSE events (see agent/{name}/src/utils/sse.py)
 * into AI SDK UI message stream chunks.
 *
 *   {"reasoning": true, "reasoningText": "..."}  → reasoning-start / reasoning-delta
 *   {"data": "..."}                              → text-start / text-delta
 *   {"current_tool_use": {...}}                  → tool-input-start / tool-input-delta
 *   {"message": {"role": "assistant", toolUse}}  → tool-input-available
 *   {"message": {"role": "user", toolResult}}    → tool-output-available / tool-output-error
 *   {"error": "..."}                             → error
 *
 * Tools are emitted as dynamic tools: the UI does not know the agent's tool set
 * in advance. Every other event (assistant text messages, the final result) is
 * already covered by the streamed deltas and is skipped.
 */
export class StrandsToUiMapper {
  private textId: string | null = null;
  private reasoningId: string | null = null;
  private partCount = 0;
  private readonly tools = new Map<string, { name: string; inputSoFar: string }>();

  constructor(private readonly write: (chunk: UIMessageChunk) => void) {}

  handle(event: unknown): void {
    if (!event || typeof event !== "object") return;
    const e = event as Record<string, unknown>;

    if (e.reasoning === true) {
      if (typeof e.reasoningText === "string" && e.reasoningText) {
        this.closeText();
        if (!this.reasoningId) {
          this.reasoningId = this.nextId("reasoning");
          this.write({ type: "reasoning-start", id: this.reasoningId });
        }
        this.write({ type: "reasoning-delta", id: this.reasoningId, delta: e.reasoningText });
      }
      return;
    }

    if (typeof e.data === "string") {
      if (!e.data) return;
      this.closeReasoning();
      if (!this.textId) {
        this.textId = this.nextId("text");
        this.write({ type: "text-start", id: this.textId });
      }
      this.write({ type: "text-delta", id: this.textId, delta: e.data });
      return;
    }

    if (e.current_tool_use && typeof e.current_tool_use === "object") {
      const tool = e.current_tool_use as { toolUseId?: string; name?: string; input?: unknown };
      if (!tool.toolUseId) return;
      this.startTool(tool.toolUseId, tool.name ?? "tool");
      if (typeof tool.input === "string") {
        const state = this.tools.get(tool.toolUseId)!;
        // Strands sends the accumulated input string; forward only the new suffix.
        if (tool.input.length > state.inputSoFar.length && tool.input.startsWith(state.inputSoFar)) {
          this.write({
            type: "tool-input-delta",
            toolCallId: tool.toolUseId,
            inputTextDelta: tool.input.slice(state.inputSoFar.length),
          });
          state.inputSoFar = tool.input;
        }
      }
      return;
    }

    if (e.message && typeof e.message === "object") {
      this.handleMessage(e.message as { role?: string; content?: unknown });
      return;
    }

    if (typeof e.error === "string") {
      this.closeOpenParts();
      this.write({ type: "error", errorText: e.error });
    }
  }

  /** Closes any open text or reasoning part. Call once the agent stream ends. */
  end(): void {
    this.closeOpenParts();
  }

  private handleMessage(message: { role?: string; content?: unknown }): void {
    if (!Array.isArray(message.content)) return;

    for (const item of message.content as Record<string, unknown>[]) {
      if (message.role === "assistant" && item?.toolUse) {
        const toolUse = item.toolUse as { toolUseId: string; name: string; input?: unknown };
        this.startTool(toolUse.toolUseId, toolUse.name);
        this.write({
          type: "tool-input-available",
          toolCallId: toolUse.toolUseId,
          toolName: toolUse.name,
          input: toolUse.input ?? {},
          dynamic: true,
        });
      }

      if (message.role === "user" && item?.toolResult) {
        const result = item.toolResult as { toolUseId: string; status?: string; content?: unknown };
        if (!this.tools.has(result.toolUseId)) continue;
        const output = Array.isArray(result.content)
          ? result.content
              .map((c: Record<string, unknown>) =>
                typeof c?.text === "string" ? c.text : c?.json !== undefined ? JSON.stringify(c.json, null, 2) : "",
              )
              .filter(Boolean)
              .join("\n")
          : "";
        if (result.status === "error") {
          this.write({
            type: "tool-output-error",
            toolCallId: result.toolUseId,
            errorText: output || "The tool reported an error.",
            dynamic: true,
          });
        } else {
          this.write({ type: "tool-output-available", toolCallId: result.toolUseId, output, dynamic: true });
        }
      }
    }
  }

  private startTool(toolCallId: string, toolName: string): void {
    if (this.tools.has(toolCallId)) return;
    this.closeOpenParts();
    this.tools.set(toolCallId, { name: toolName, inputSoFar: "" });
    this.write({ type: "tool-input-start", toolCallId, toolName, dynamic: true });
  }

  private closeOpenParts(): void {
    this.closeReasoning();
    this.closeText();
  }

  private closeText(): void {
    if (this.textId) {
      this.write({ type: "text-end", id: this.textId });
      this.textId = null;
    }
  }

  private closeReasoning(): void {
    if (this.reasoningId) {
      this.write({ type: "reasoning-end", id: this.reasoningId });
      this.reasoningId = null;
    }
  }

  private nextId(kind: string): string {
    this.partCount += 1;
    return `${kind}-${this.partCount}`;
  }
}
