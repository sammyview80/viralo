import { useEffect, useState } from "react";
import type { Scene } from "./types";

export function ScriptView({ scenes, onSave }: { scenes: Scene[]; onSave: (s: Scene[]) => void }) {
  const [local, setLocal] = useState(scenes);
  useEffect(() => setLocal(scenes), [scenes]);

  const update = (i: number, patch: Partial<Scene>) =>
    setLocal(local.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  if (!local.length) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No script yet — ask the Director or write one to get started.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {local.map((s, i) => (
          <div key={s.id} className="rounded-md border p-2.5">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Scene {i + 1}
            </div>
            <input
              value={s.title}
              onChange={(e) => update(i, { title: e.target.value })}
              className="mb-2 w-full bg-transparent text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a]"
            />
            <textarea
              value={s.narration}
              onChange={(e) => update(i, { narration: e.target.value })}
              className="w-full resize-y rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a]"
              rows={3}
            />
          </div>
        ))}
      </div>
      <div className="sticky bottom-0 border-t bg-background p-3">
        <button
          onClick={() => onSave(local)}
          className="rounded-md border px-3 py-1.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-[#ff3d6a]"
        >
          Save script
        </button>
      </div>
    </div>
  );
}
