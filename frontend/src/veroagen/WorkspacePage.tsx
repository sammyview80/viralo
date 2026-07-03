import { useState } from "react";
import { Shell } from "@/workspace/Shell";
import type { PageKey } from "@/workspace/types";
import { ChatPanel } from "./ChatPanel";
import { ScriptView } from "./ScriptView";
import { StoryboardView } from "./StoryboardView";
import { useProjectDoc } from "./useProjectDoc";

// "veroagen" is not part of the viralo Shell's `PageKey` union (frontend/src/workspace/types.ts).
// Per Task 10 instructions, we cast rather than widen that shared union — Shell falls back to
// showing "veroagen" as the page label since it isn't in PAGE_LABELS. See task-10-report.md.
const VEROAGEN_ACTIVE = "veroagen" as unknown as PageKey;

const TABS = ["Script", "Storyboard"] as const;

export function VeroagenWorkspacePage({ projectId }: { projectId: string }) {
  const { doc, sendMessage, saveScript, sending } = useProjectDoc(projectId);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Script");

  if (!doc) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <Shell active={VEROAGEN_ACTIVE}>
      <div className="grid h-[calc(100vh-0px)] grid-cols-[1fr_380px]">
        <div className="flex flex-col overflow-hidden">
          <div className="flex items-center gap-1 border-b px-4 py-2">
            <span className="mr-4 text-sm font-semibold">{doc.title}</span>
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 text-sm ${tab === t ? "bg-muted font-medium" : "text-muted-foreground"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {tab === "Script" && <ScriptView scenes={doc.script.scenes} onSave={saveScript} />}
            {tab === "Storyboard" && <StoryboardView shots={doc.storyboard.shots} />}
          </div>
        </div>
        <ChatPanel messages={doc.chat.messages} onSend={sendMessage} sending={sending} />
      </div>
    </Shell>
  );
}
