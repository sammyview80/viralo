import { useEffect, useState } from "react";
import type { ModelCatalog, Shot } from "./types";

const BUSY: Shot["status"][] = ["image_generating", "video_generating"];

export function StoryboardView({
  shots, models, onGenerateImage, onGenerateVideo, onSaveShots,
}: {
  shots: Shot[];
  models: ModelCatalog;
  onGenerateImage: (id: string) => void;
  onGenerateVideo: (id: string) => void;
  onSaveShots: (shots: Shot[]) => void;
}) {
  const [local, setLocal] = useState(shots);
  useEffect(() => setLocal(shots), [shots]);

  const patch = (i: number, p: Partial<Shot>) =>
    setLocal(local.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const commit = () => onSaveShots(local);

  if (!local.length) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No storyboard yet — ask the Director or write a script first.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {local.map((s, i) => {
        const busy = BUSY.includes(s.status);
        return (
          <div key={s.id} className="rounded-md border p-3">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{s.id}</span>
              <span>{s.duration_s}s</span>
            </div>
            <div className="mb-2 flex aspect-video items-center justify-center overflow-hidden rounded bg-muted">
              {s.video_url ? (
                <video src={s.video_url} controls className="h-full w-full object-cover" />
              ) : s.image_url ? (
                <img src={s.image_url} alt={s.prompt} className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground">{busy ? "Generating…" : s.status}</span>
              )}
            </div>
            <textarea
              value={s.prompt}
              onChange={(e) => patch(i, { prompt: e.target.value })}
              onBlur={commit}
              rows={2}
              className="mb-2 w-full resize-y rounded-md border bg-background p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a]"
            />
            <div className="mb-2 grid grid-cols-1 gap-1">
              <select value={s.camera || "static"} onBlur={commit}
                      onChange={(e) => patch(i, { camera: e.target.value })}
                      className="min-h-[44px] rounded border bg-background px-1 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a]">
                {models.camera_presets.map((c) => <option key={c} value={c}>📷 {c}</option>)}
              </select>
              <select value={s.image_model ?? ""} onBlur={commit}
                      onChange={(e) => patch(i, { image_model: e.target.value || null })}
                      className="min-h-[44px] rounded border bg-background px-1 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a]">
                <option value="">🖼 default model</option>
                {models.image_models.map((m) => <option key={m.id} value={m.id}>🖼 {m.label}</option>)}
              </select>
              <select value={s.video_model ?? ""} onBlur={commit}
                      onChange={(e) => patch(i, { video_model: e.target.value || null })}
                      className="min-h-[44px] rounded border bg-background px-1 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a]">
                <option value="">🎬 default model</option>
                {models.video_models.map((m) => <option key={m.id} value={m.id}>🎬 {m.label}</option>)}
              </select>
            </div>
            <div className="mb-2">
              <span className={`rounded-full px-2 py-0.5 text-xs ${s.status === "failed" ? "bg-red-500/10 text-red-400" : "bg-muted text-muted-foreground"}`}>
                {s.status}{s.status === "failed" && s.error ? ` — ${s.error}` : ""}
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onGenerateImage(s.id)} disabled={busy}
                      className="min-h-[44px] flex-1 rounded-md border px-2 py-1 text-xs outline-none transition-colors hover:bg-muted disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#ff3d6a]">
                {s.image_url ? "Redo image" : "Generate image"}
              </button>
              <button onClick={() => onGenerateVideo(s.id)} disabled={busy || !s.image_url}
                      className="min-h-[44px] flex-1 rounded-md bg-[#ff3d6a] px-2 py-1 text-xs text-white outline-none transition-opacity disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#ff3d6a] focus-visible:ring-offset-2">
                {s.video_url ? "Redo video" : "Animate"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
