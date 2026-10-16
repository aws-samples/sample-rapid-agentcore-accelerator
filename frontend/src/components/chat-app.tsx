"use client";

import type { UIMessage } from "ai";
import {
  BotIcon,
  LogOutIcon,
  MessageSquareIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftIcon,
  PlusIcon,
  SunIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";

import { ChatView } from "@/components/chat-view";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  type ChatSummary,
  deleteMessages,
  loadChats,
  loadMessages,
  newChatId,
  saveChats,
  saveMessages,
  titleFrom,
} from "@/lib/chat-store";
import { cn } from "@/lib/utils";

interface Session {
  user: { id: string; email?: string; name?: string };
  authMode: "none" | "alb" | "app";
  agents: string[];
}

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; session: Session };

export function ChatApp() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [current, setCurrent] = useState<{ id: string; agent: string; messages: UIMessage[] } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const signIn = useCallback(() => {
    // A full navigation: the login route redirects off-site to Cognito.
    window.location.assign(new URL("/api/auth/login", window.location.origin));
  }, []);

  useEffect(() => {
    fetch("/api/session")
      .then(async (response) => {
        if (response.status === 401) {
          // App-level OAuth: go to Cognito. Behind the ALB a 401 means the header is missing.
          signIn();
          return;
        }
        if (!response.ok) throw new Error(`Could not load session (${response.status})`);
        const session = (await response.json()) as Session;
        if (session.agents.length === 0) {
          setState({ kind: "error", message: "No agents configured. Set AGENT_REGISTRY, AGENTCORE_RUNTIME_ARN, or LOCAL_AGENT_URL." });
          return;
        }
        // Drop history for agents that no longer exist in this deployment.
        const stored = loadChats().filter((c) => session.agents.includes(c.agent));
        setChats(stored);
        setCurrent({ id: newChatId(), agent: session.agents[0], messages: [] });
        setState({ kind: "ready", session });
      })
      .catch((error: Error) => setState({ kind: "error", message: error.message }));
  }, [signIn]);

  const startChat = useCallback((agent: string) => {
    setCurrent({ id: newChatId(), agent, messages: [] });
    setSidebarOpen(false);
  }, []);

  const openChat = useCallback((chat: ChatSummary) => {
    setCurrent({ id: chat.id, agent: chat.agent, messages: loadMessages(chat.id) });
    setSidebarOpen(false);
  }, []);

  const removeChat = useCallback(
    (id: string) => {
      deleteMessages(id);
      setChats((prev) => {
        const next = prev.filter((c) => c.id !== id);
        saveChats(next);
        return next;
      });
      if (current?.id === id) startChat(current.agent);
    },
    [current, startChat],
  );

  const handleMessagesChange = useCallback(
    (messages: UIMessage[]) => {
      if (!current || messages.length === 0) return;
      saveMessages(current.id, messages);
      setChats((prev) => {
        const existing = prev.find((c) => c.id === current.id);
        const summary: ChatSummary = {
          id: current.id,
          agent: current.agent,
          title: existing?.title ?? titleFrom(messages) ?? "New chat",
          updatedAt: Date.now(),
        };
        const next = [summary, ...prev.filter((c) => c.id !== current.id)];
        saveChats(next);
        return next;
      });
    },
    [current],
  );

  if (state.kind === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (state.kind === "error") {
    return <div className="flex flex-1 items-center justify-center p-8 text-center text-destructive text-sm">{state.message}</div>;
  }
  if (!current) return null;

  const { session } = state;
  const isEmpty = !chats.some((c) => c.id === current.id);

  const agentPicker =
    session.agents.length > 1 ? (
      <Select
        value={current.agent}
        onValueChange={(agent) => {
          if (!agent || agent === current.agent) return;
          // A chat is bound to one agent's session; switching starts a new chat.
          if (isEmpty) setCurrent({ ...current, agent });
          else startChat(agent);
        }}
      >
        <SelectTrigger id="agent-picker" size="sm" className="h-8 min-w-44 gap-2 font-medium">
          <BotIcon className="text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {session.agents.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : null;

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar: always visible on desktop, a drawer on mobile */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-sidebar text-sidebar-foreground transition-transform md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between p-3">
          <span className="flex items-center gap-2 px-2 font-semibold text-sm">
            <Image src="/icon.svg" alt="" width={20} height={20} unoptimized />
            AgentCore Chat UI
          </span>
          <Button size="icon-sm" variant="ghost" aria-label="New chat" onClick={() => startChat(current.agent)}>
            <PlusIcon />
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {chats.length === 0 && <p className="px-2 py-4 text-muted-foreground text-xs">No chats yet.</p>}
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={cn(
                "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent",
                chat.id === current.id && "bg-sidebar-accent font-medium",
              )}
            >
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => openChat(chat)}>
                <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{chat.title}</span>
              </button>
              <button
                aria-label="Delete chat"
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => removeChat(chat.id)}
              >
                <Trash2Icon className="size-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
        </nav>
        <div className="border-t p-2">
          <UserMenu session={session} />
        </div>
      </aside>
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur sm:px-4">
          <Button size="icon-sm" variant="ghost" className="md:hidden" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}>
            <PanelLeftIcon />
          </Button>
          <div className="flex items-center gap-2">
            <label htmlFor="agent-picker" className="font-medium text-muted-foreground text-xs">
              Agent
            </label>
            {agentPicker ?? (
              <span className="flex h-8 items-center gap-2 rounded-lg border px-2.5 font-medium text-sm">
                <BotIcon className="size-4 text-muted-foreground" />
                {current.agent}
              </span>
            )}
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <ChatView
          key={`${current.id}:${current.agent}`}
          chatId={current.id}
          agent={current.agent}
          initialMessages={current.messages}
          onMessagesChange={handleMessagesChange}
          onUnauthorized={session.authMode === "app" ? signIn : () => undefined}
        />
      </main>
    </div>
  );
}

function UserMenu({ session }: { session: Session }) {
  const label = session.user.email ?? session.user.name ?? session.user.id;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="w-full justify-start gap-2 px-2">
          <UserIcon />
          <span className="truncate">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="truncate">{label}</DropdownMenuLabel>
        {session.authMode !== "none" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/api/auth/logout">
                <LogOutIcon />
                Sign out
              </a>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = theme === "light" ? SunIcon : theme === "dark" ? MoonIcon : MonitorIcon;
  return (
    <Button size="icon-sm" variant="ghost" aria-label={`Theme: ${theme}`} onClick={() => setTheme(next)}>
      <Icon />
    </Button>
  );
}
