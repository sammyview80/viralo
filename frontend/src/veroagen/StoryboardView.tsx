import type { Shot } from "./types";

export function StoryboardView({ shots }: { shots: Shot[] }) {
  if (!shots.length) return <div className="p-6 text-sm text-muted-foreground">No storyboard yet.</div>;
  return (
    <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-3">
      {shots.map((s) => (
        <div key={s.id} className="rounded-md border p-3">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{s.id}</span>
            <span>{s.duration_s}s · {s.camera || "auto"}</span>
          </div>
          <div className="mb-2 flex aspect-video items-center justify-center rounded bg-muted text-xs text-muted-foreground">
            {s.status}
          </div>
          <p className="text-sm">{s.prompt}</p>
        </div>
      ))}
    </div>
  );
}
