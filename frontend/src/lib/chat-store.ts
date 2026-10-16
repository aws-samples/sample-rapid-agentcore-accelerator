import type { UIMessage } from "ai";

/**
 * Chat history kept in the browser's localStorage. The agent's own memory
 * lives in the AgentCore session; this copy only re-displays past chats.
 */
export interface ChatSummary {
  id: string;
  title: string;
  agent: string;
  updatedAt: number;
}

const INDEX_KEY = "rapid.chats";
const messagesKey = (id: string) => `rapid.chat.${id}`;

export function newChatId(): string {
  // Doubles as the AgentCore runtime session ID, which must be 33+ characters.
  return `chat-${crypto.randomUUID()}`;
}

export function loadChats(): ChatSummary[] {
  try {
    return (JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]") as ChatSummary[]).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  } catch {
    return [];
  }
}

export function saveChats(chats: ChatSummary[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(chats));
}

export function loadMessages(id: string): UIMessage[] {
  try {
    return JSON.parse(localStorage.getItem(messagesKey(id)) ?? "[]") as UIMessage[];
  } catch {
    return [];
  }
}

export function saveMessages(id: string, messages: UIMessage[]): void {
  localStorage.setItem(messagesKey(id), JSON.stringify(messages));
}

export function deleteMessages(id: string): void {
  localStorage.removeItem(messagesKey(id));
}

/** A short title from the first user message. */
export function titleFrom(messages: UIMessage[]): string | null {
  const first = messages.find((m) => m.role === "user");
  const text = first?.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();
  if (!text) return null;
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}
