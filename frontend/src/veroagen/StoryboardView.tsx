import type { Shot } from "./types";

const BUSY: Shot["status"][] = ["image_generating", "video_generating"];

export function StoryboardView({
  shots, onGenerateImage, onGenerateVideo,
}: {
  shots: Shot[];
  onGenerateImage: (id: string) => void;
  onGenerateVideo: (id: string) => void;
}) {
  if (!shots.length) return <div className="p-6 text-sm text-muted-foreground">No storyboard yet.</div>;
  return (
    <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-3">
      {shots.map((s) => {
        const busy = BUSY.includes(s.status);
        return (
          <div key={s.id} className="rounded-md border p-3">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{s.id}</span>
              <span>{s.duration_s}s · {s.camera || "auto"}</span>
            </div>
            <div className="mb-2 flex aspect-video items-center justify-center overflow-hidden rounded bg-muted">
              {s.video_url ? (
                <video src={s.video_url} controls className="h-full w-full object-cover" />
              ) : s.image_url ? (
                <img src={s.image_url} alt={s.prompt} className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {busy ? "Generating…" : s.status}
                </span>
              )}
            </div>
            <p className="mb-2 text-sm">{s.prompt}</p>
            <div className="mb-1 text-xs">
              <span className={s.status === "failed" ? "text-red-500" : "text-muted-foreground"}>
                {s.status}{s.status === "failed" && s.error ? ` — ${s.error}` : ""}
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onGenerateImage(s.id)} disabled={busy}
                      className="flex-1 rounded-md border px-2 py-1 text-xs disabled:opacity-50">
                {s.image_url ? "Redo image" : "Generate image"}
              </button>
              <button onClick={() => onGenerateVideo(s.id)} disabled={busy || !s.image_url}
                      className="flex-1 rounded-md border px-2 py-1 text-xs disabled:opacity-50">
                {s.video_url ? "Redo video" : "Animate"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
