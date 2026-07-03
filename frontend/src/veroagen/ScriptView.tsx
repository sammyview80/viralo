import { useEffect, useState } from "react";
import type { Scene } from "./types";

export function ScriptView({ scenes, onSave }: { scenes: Scene[]; onSave: (s: Scene[]) => void }) {
  const [local, setLocal] = useState(scenes);
  useEffect(() => setLocal(scenes), [scenes]);

  const update = (i: number, patch: Partial<Scene>) =>
    setLocal(local.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  if (!local.length) return <div className="p-6 text-sm text-muted-foreground">No script yet — ask the director to write one.</div>;

  return (
    <div className="space-y-4 p-4">
      {local.map((s, i) => (
        <div key={s.id} className="rounded-md border p-3">
          <input
            value={s.title}
            onChange={(e) => update(i, { title: e.target.value })}
            className="mb-2 w-full bg-transparent text-sm font-semibold outline-none"
          />
          <textarea
            value={s.narration}
            onChange={(e) => update(i, { narration: e.target.value })}
            className="w-full resize-y rounded-md border bg-background p-2 text-sm"
            rows={3}
          />
        </div>
      ))}
      <button onClick={() => onSave(local)} className="rounded-md border px-3 py-1.5 text-sm">Save script</button>
    </div>
  );
}
