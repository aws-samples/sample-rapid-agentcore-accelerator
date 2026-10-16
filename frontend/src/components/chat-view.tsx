"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type DynamicToolUIPart, type UIMessage } from "ai";
import { BotIcon, CheckIcon, CopyIcon, RefreshCcwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput } from "@/components/ai-elements/tool";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";

interface ChatViewProps {
  chatId: string;
  agent: string;
  initialMessages: UIMessage[];
  onMessagesChange: (messages: UIMessage[]) => void;
  onUnauthorized: () => void;
  toolbar?: React.ReactNode;
}

export function ChatView({ chatId, agent, initialMessages, onMessagesChange, onUnauthorized, toolbar }: ChatViewProps) {
  const [transport] = useState(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/chat",
        // The agent keeps the conversation in its AgentCore session, so only
        // the newest user message travels; the chat ID is the session ID.
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: { id, agent, message: messages.findLast((m) => m.role === "user") },
        }),
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          if (response.status === 401) onUnauthorized();
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `Request failed (${response.status})`);
          }
          return response;
        },
      }),
  );

  const { messages, sendMessage, status, stop, regenerate, error, clearError } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
  });

  useEffect(() => {
    // Persist once a turn settles, not on every streamed token.
    if (status === "ready" || status === "error") onMessagesChange(messages);
  }, [messages, status, onMessagesChange]);

  const busy = status === "submitted" || status === "streaming";
  const lastMessage = messages.at(-1);
  const working = busy ? workingLabel(lastMessage) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className={cn(COLUMN, "gap-6 pt-8 pb-10")}>
          {messages.length === 0 ? (
            <ConversationEmptyState className="min-h-[50vh] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-500">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/5 text-primary ring-1 ring-primary/10">
                <BotIcon className="size-7" />
              </div>
              <div className="space-y-1.5">
                <h2 className="font-semibold text-2xl tracking-tight">How can I help?</h2>
                <p className="text-muted-foreground text-sm">
                  You&apos;re chatting with <span className="font-medium text-foreground">{agent}</span>.
                </p>
              </div>
            </ConversationEmptyState>
          ) : (
            messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                streaming={busy && message.id === lastMessage?.id}
                working={message.id === lastMessage?.id ? working : null}
                isLast={message.id === lastMessage?.id}
                onRegenerate={busy ? undefined : () => regenerate()}
              />
            ))
          )}
          {working && lastMessage?.role === "user" && (
            <AssistantRow>
              <WorkingIndicator label={working} />
            </AssistantRow>
          )}
          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm motion-safe:animate-in motion-safe:fade-in">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="flex-1 whitespace-pre-wrap">{error.message}</div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  clearError();
                  regenerate();
                }}
              >
                Retry
              </Button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className={cn(COLUMN, "pb-4")}>
        <PromptInput
          className="[&_[data-slot=input-group]]:rounded-2xl [&_[data-slot=input-group]]:bg-background [&_[data-slot=input-group]]:shadow-sm [&_[data-slot=input-group]]:transition-shadow [&_[data-slot=input-group]]:focus-within:shadow-md"
          onSubmit={({ text }) => {
            if (!text.trim() || busy) return;
            sendMessage({ text });
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea className="min-h-12 px-4 pt-3.5" placeholder={`Message ${agent}…`} />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>{toolbar}</PromptInputTools>
            <PromptInputSubmit status={status} onStop={stop} />
          </PromptInputFooter>
        </PromptInput>
        <p className="mt-2 text-center text-muted-foreground text-xs">
          Agents can make mistakes. Check important information.
        </p>
      </div>
    </div>
  );
}

// One centred column for messages and the input, so their edges line up.
const COLUMN = "mx-auto w-full max-w-3xl px-4 sm:px-6";

const ENTER = "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300";

/**
 * What to show while a turn is in flight and nothing else on screen is moving:
 * before the first event, and between a finished tool call and the next part.
 * Streaming text, streaming reasoning, and running tools animate on their own.
 */
function workingLabel(last: UIMessage | undefined): string | null {
  if (!last || last.role === "user") return "Thinking";
  const part = last.parts.findLast((p) => p.type === "text" || p.type === "reasoning" || p.type === "dynamic-tool");
  if (!part) return "Thinking";
  if (part.type === "dynamic-tool") {
    return part.state === "output-available" || part.state === "output-error" ? "Working" : null;
  }
  return part.state === "done" ? "Working" : null;
}

function AssistantRow({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn("flex w-full gap-3", ENTER)}>
      <div className="hidden size-8 shrink-0 items-center justify-center rounded-full bg-primary/5 sm:flex text-primary ring-1 ring-primary/10">
        <BotIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 pt-1">{children}</div>
    </div>
  );
}

function WorkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex h-6 items-center gap-2.5 text-sm motion-safe:animate-in motion-safe:fade-in" role="status">
      <span className="flex items-center gap-1" aria-hidden>
        {[0, 160, 320].map((delay) => (
          <span
            key={delay}
            className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-typing-dot"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <Shimmer>{`${label}…`}</Shimmer>
    </div>
  );
}

function ChatMessage({
  message,
  streaming,
  working,
  isLast,
  onRegenerate,
}: {
  message: UIMessage;
  streaming: boolean;
  working: string | null;
  isLast: boolean;
  onRegenerate?: () => void;
}) {
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

  if (message.role === "user") {
    return (
      <Message from="user" className={cn("max-w-[85%]", ENTER)}>
        <MessageContent className="group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-md">
          <p className="whitespace-pre-wrap">{text}</p>
        </MessageContent>
      </Message>
    );
  }

  return (
    <AssistantRow>
      <Message from="assistant" className="max-w-full">
        <MessageContent className="w-full">
          {message.parts.map((part, i) => {
            const key = `${message.id}-${i}`;
            const lastPart = i === message.parts.length - 1;
            switch (part.type) {
              case "text":
                return <MessageResponse key={key} isAnimating={streaming && lastPart}>{part.text}</MessageResponse>;
              case "reasoning":
                return (
                  <Reasoning key={key} className="w-full" isStreaming={streaming && lastPart}>
                    <ReasoningTrigger getThinkingMessage={thinkingMessage} />
                    <ReasoningContent>{part.text}</ReasoningContent>
                  </Reasoning>
                );
              case "dynamic-tool":
                return <ToolCall key={key} part={part} />;
              default:
                return null;
            }
          })}
          {working && <WorkingIndicator label={working} />}
        </MessageContent>
        {!streaming && text && (
          <MessageActions>
            <CopyAction text={text} />
            {isLast && onRegenerate && (
              <MessageAction tooltip="Regenerate" label="Regenerate" onClick={onRegenerate}>
                <RefreshCcwIcon className="size-3.5" />
              </MessageAction>
            )}
          </MessageActions>
        )}
      </Message>
    </AssistantRow>
  );
}

function ToolCall({ part }: { part: DynamicToolUIPart }) {
  return (
    <Tool>
      <ToolHeader type="dynamic-tool" state={part.state} toolName={part.toolName} title={humanize(part.toolName)} />
      <ToolContent>
        {part.input !== undefined && <ToolInput input={part.input} />}
        {part.state === "output-available" && (
          <ToolSection label="Result">
            <MessageResponse>{typeof part.output === "string" ? part.output : JSON.stringify(part.output, null, 2)}</MessageResponse>
          </ToolSection>
        )}
        {part.state === "output-error" && (
          <ToolSection label="Error" error>
            <p className="whitespace-pre-wrap">{part.errorText}</p>
          </ToolSection>
        )}
      </ToolContent>
    </Tool>
  );
}

function ToolSection({ label, error, children }: { label: string; error?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{label}</h4>
      <div
        className={
          error
            ? "rounded-md bg-destructive/10 p-3 text-destructive text-sm"
            : "max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-sm"
        }
      >
        {children}
      </div>
    </div>
  );
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <MessageAction
      tooltip={copied ? "Copied" : "Copy"}
      label="Copy"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </MessageAction>
  );
}

function thinkingMessage(isStreaming: boolean, duration?: number) {
  if (isStreaming || duration === 0) return <Shimmer>Thinking…</Shimmer>;
  if (duration === undefined) return <p>Thought for a few seconds</p>;
  return <p>Thought for {duration} {duration === 1 ? "second" : "seconds"}</p>;
}

/** lookup_order → Lookup order */
function humanize(name: string): string {
  const spaced = name.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
