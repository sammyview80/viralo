import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./types";

function isWarning(content: string) {
  return /failed|not enough credits/i.test(content);
}

export function ChatPanel({
  messages, onSend, sending,
}: { messages: ChatMessage[]; onSend: (t: string) => void; sending: boolean }) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const submit = () => {
    if (!text.trim() || sending) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-l">
      <div className="flex items-center gap-2 border-b p-3">
        <span className="text-sm font-semibold">Director</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          {sending ? (
            <>
              <span className="motion-safe:animate-pulse motion-reduce:animate-none h-1.5 w-1.5 rounded-full bg-[#ff3d6a]" />
              Working…
            </>
          ) : (
            "Ready"
          )}
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.map((m, i) => {
          if (m.role === "system") {
            const warn = isWarning(m.content);
            return (
              <div
                key={i}
                className={`text-center text-xs ${warn ? "text-red-400" : "text-muted-foreground"}`}
              >
                {warn ? `⚠ ${m.content}` : m.content}
              </div>
            );
          }
          return (
            <div
              key={i}
              className={`w-fit max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                m.role === "user"
                  ? "ml-auto bg-[#ff3d6a] text-white"
                  : "bg-muted"
              }`}
            >
              {m.content}
            </div>
          );
        })}
        {sending && <div className="text-xs text-muted-foreground">Agent working…</div>}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2 border-t p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Direct your video…"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a]"
        />
        <button
          onClick={submit}
          disabled={sending}
          className="rounded-md bg-[#ff3d6a] px-3 py-2 text-sm text-white outline-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#ff3d6a] focus-visible:ring-offset-2"
        >
          Send
        </button>
      </div>
    </div>
  );
}
