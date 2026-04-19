/**
 * ConstructionAgentFAB
 * ----------------------------------------------------------------------------
 * Floating chat button + slide-up panel that talks to the `construction-agent`
 * Supabase Edge Function. The agent runs GPT-4o-mini with one tool
 * (search_database_for_kits → pgvector RPC) and answers in natural language.
 *
 * REMOVAL: this component is fully self-contained. Delete this file and the
 * `<ConstructionAgentFAB />` mount in `src/App.tsx` to remove the feature.
 */
import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Loader2, X, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type ChatRole = "user" | "assistant";
type ChatMsg = { role: ChatRole; content: string };

// Conversation seed shown the first time the user opens the chat. Helps
// nudge them toward the kinds of prompts the agent handles best.
const WELCOME: ChatMsg = {
  role: "assistant",
  content:
    "👋 Moin! Ich bin dein Bau-Assistent. Sag mir, was du baust — z.B. *„50 m² Trockenbau“* oder *„Elektro-Rohinstallation“* — und ich stelle dir das passende Material zusammen.",
};

export function ConstructionAgentFAB() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest message whenever the list grows.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setInput("");

    const next: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setBusy(true);

    try {
      if (!isSupabaseConfigured) {
        throw new Error("Supabase is not configured — cannot reach the agent.");
      }
      // Send the FULL conversation history so the agent has context for
      // multi-turn flows like "How many m²? → 50 → here's your kit".
      const payloadMessages = next
        .filter((m) => m !== WELCOME) // drop the local welcome bubble
        .map((m) => ({ role: m.role, content: m.content }));

      const { data, error: fnError } = await supabase.functions.invoke("construction-agent", {
        body: { messages: payloadMessages },
      });
      if (fnError) throw fnError;

      const reply = (data as { reply?: string } | null)?.reply?.trim();
      if (!reply) throw new Error("Empty response from agent");

      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      console.error("[ConstructionAgentFAB] agent error", e);
      const msg = e instanceof Error ? e.message : "Something went wrong";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const reset = () => {
    setMessages([WELCOME]);
    setError(null);
    setInput("");
  };

  return (
    <>
      {/* FAB — bottom-right, anchored to the phone-shell. */}
      <button
        type="button"
        aria-label="Open Construction Assistant"
        onClick={() => setOpen(true)}
        className="absolute bottom-20 right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105 active:scale-95"
      >
        <Sparkles className="h-5 w-5" />
        <span className="text-sm font-semibold">Bau-Assistent</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          // When the fake iOS keyboard inside DeviceFrame opens it sets
          // `--ios-kb-h` on the phone screen container. We shrink the
          // dialog and lift it above the keys so the composer stays
          // visible. On real mobile the variable is 0 and behavior is
          // unchanged.
          className="flex flex-col gap-0 p-0"
          style={{
            height: "min(85vh, calc(100dvh - var(--ios-kb-h, 0px) - 3rem))",
            maxHeight: "calc(100dvh - var(--ios-kb-h, 0px) - 3rem)",
            transform: "translate(-50%, calc(-50% - (var(--ios-kb-h, 0px) / 2)))",
          }}
        >
          <DialogHeader className="border-b border-border p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary">
                  <MessageCircle className="h-5 w-5" />
                </span>
                <div>
                  <DialogTitle className="text-base">Bau-Assistent</DialogTitle>
                  <DialogDescription className="text-xs">
                    AI agent · GPT-4o-mini · pgvector kit search
                  </DialogDescription>
                </div>
              </div>
              {messages.length > 1 && (
                <button
                  type="button"
                  onClick={reset}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Neu starten
                </button>
              )}
            </div>
          </DialogHeader>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-strong:text-foreground">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Agent denkt nach…</span>
                </div>
              </div>
            )}

            {error && (
              <div className="flex justify-start">
                <div className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={busy}
                placeholder="Was baust du? z.B. „50 m² Trockenbau“"
                className="flex-1"
                autoFocus
              />
              <Button
                type="button"
                size="icon"
                onClick={send}
                disabled={busy || !input.trim()}
                aria-label="Send message"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
