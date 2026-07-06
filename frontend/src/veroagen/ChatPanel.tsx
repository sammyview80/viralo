import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./types";

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
    <div className="flex h-full flex-col border-l">
      <div className="border-b p-3 text-sm font-semibold">Director</div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              m.role === "user"
                ? "ml-auto bg-[#ff3d6a] text-white"
                : m.role === "system"
                  ? "mx-auto bg-transparent text-xs text-muted-foreground"
                  : "bg-muted"
            }`}
          >
            {m.content}
          </div>
        ))}
        {sending && <div className="text-xs text-muted-foreground">Agent working…</div>}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2 border-t p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Direct your video…"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <button onClick={submit} disabled={sending} className="rounded-md bg-[#ff3d6a] px-3 py-2 text-sm text-white disabled:opacity-50">
          Send
        </button>
      </div>
    </div>
  );
}
