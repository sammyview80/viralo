import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/workspace/Shell";
import type { PageKey } from "@/workspace/types";
import { veroagenApi } from "./api";
import { ChatPanel } from "./ChatPanel";
import { CharactersView } from "./CharactersView";
import { ScriptView } from "./ScriptView";
import { StoryboardView } from "./StoryboardView";
import { TimelineView } from "./TimelineView";
import { useModels } from "./useModels";
import { useProjectDoc } from "./useProjectDoc";

// "veroagen" is not part of the viralo Shell's `PageKey` union (frontend/src/workspace/types.ts).
// Per Task 10 instructions, we cast rather than widen that shared union — Shell falls back to
// showing "veroagen" as the page label since it isn't in PAGE_LABELS. See task-10-report.md.
const VEROAGEN_ACTIVE = "veroagen" as unknown as PageKey;

const TABS = ["Script", "Characters", "Storyboard", "Timeline"] as const;

export function VeroagenWorkspacePage({ projectId }: { projectId: string }) {
  const { doc, setDoc, sendMessage, saveScript, sending } = useProjectDoc(projectId);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Script");
  const models = useModels();
  const [credits, setCredits] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refreshCredits = useCallback(() => {
    veroagenApi.getCredits().then((c) => setCredits(c.balance)).catch(() => {});
  }, []);
  useEffect(() => { refreshCredits(); }, [refreshCredits]);

  const guard = (p: Promise<unknown>) =>
    p.then(refreshCredits).catch((e: Error) => {
      setToast(e.message);
      setTimeout(() => setToast(null), 4000);
    });

  if (!doc) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  const createCharacter = async (name: string, description: string) => {
    const r = await veroagenApi.createCharacter(projectId, name, description);
    setDoc(r.doc);
  };

  return (
    <Shell active={VEROAGEN_ACTIVE} fullBleed>
      <div className="grid h-full min-h-0 grid-cols-[1fr_380px]">
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center gap-1 border-b px-4 py-2">
            <span className="mr-4 truncate text-sm font-semibold">{doc.title}</span>
            <div className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-full px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a] ${
                    tab === t ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {credits !== null && (
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">⚡ {credits}</span>
            )}
          </div>
          {toast && <div className="border-b bg-red-500/10 px-4 py-1 text-xs text-red-400">⚠ {toast}</div>}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "Script" && <ScriptView scenes={doc.script.scenes} onSave={saveScript} />}
            {tab === "Characters" && (
              <CharactersView
                characters={doc.characters?.items ?? []}
                onCreate={createCharacter}
                onGenerateRef={(cid) => void guard(veroagenApi.generateRef(projectId, cid))}
              />
            )}
            {tab === "Storyboard" && (
              <StoryboardView
                shots={doc.storyboard.shots}
                models={models}
                onGenerateImage={(sid) => void guard(veroagenApi.generateShotImage(projectId, sid))}
                onGenerateVideo={(sid) => void guard(veroagenApi.generateShotVideo(projectId, sid))}
                onSaveShots={(shots) => void guard(veroagenApi.putStoryboard(projectId, shots))}
              />
            )}
            {tab === "Timeline" && (
              <TimelineView
                timeline={doc.timeline ?? { video: [], voice: [], music: [] }}
                render={doc.render ?? { status: "none", url: null, error: null }}
                onBuildDefault={async () => setDoc((await veroagenApi.buildDefaultTimeline(projectId)).doc)}
                onSave={async (video) => setDoc((await veroagenApi.putTimeline(projectId, { video })).doc)}
                onVoiceover={() => void guard(veroagenApi.queueVoiceover(projectId))}
                onMusic={(p) => void guard(veroagenApi.queueMusic(projectId, p))}
                onRender={() => void guard(veroagenApi.queueRender(projectId))}
                mediaUrl={veroagenApi.mediaUrl}
              />
            )}
          </div>
        </div>
        <ChatPanel messages={doc.chat.messages} onSend={sendMessage} sending={sending} />
      </div>
    </Shell>
  );
}
