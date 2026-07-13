import { useEffect, useState } from "react";
import type { RenderState, Timeline, TimelineClip } from "./types";

export function TimelineView({
  timeline, render, onBuildDefault, onSave, onVoiceover, onMusic, onRender, mediaUrl,
}: {
  timeline: Timeline;
  render: RenderState;
  onBuildDefault: () => void;
  onSave: (video: TimelineClip[]) => void;
  onVoiceover: () => void;
  onMusic: (prompt: string) => void;
  onRender: () => void;
  mediaUrl: (path: string) => string;
}) {
  const [clips, setClips] = useState(timeline.video);
  const [musicPrompt, setMusicPrompt] = useState("");
  useEffect(() => setClips(timeline.video), [timeline.video]);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= clips.length) return;
    const next = [...clips];
    [next[i], next[j]] = [next[j], next[i]];
    setClips(next.map((c, idx) => ({ ...c, order: idx })));
  };
  const trim = (i: number, patch: Partial<TimelineClip>) =>
    setClips(clips.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap gap-2">
        <button onClick={onBuildDefault} className="rounded-md border px-3 py-1.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-[#ff3d6a]">
          Build from ready shots
        </button>
        <button onClick={() => onSave(clips)} disabled={!clips.length}
                className="rounded-md border px-3 py-1.5 text-sm outline-none transition-colors hover:bg-muted disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#ff3d6a]">
          Save timeline
        </button>
        <button onClick={onVoiceover} className="rounded-md border px-3 py-1.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-[#ff3d6a]">
          Generate voiceover
        </button>
        <input value={musicPrompt} onChange={(e) => setMusicPrompt(e.target.value)}
               placeholder="Music prompt…"
               className="w-44 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a]" />
        <button onClick={() => musicPrompt.trim() && onMusic(musicPrompt.trim())}
                className="rounded-md border px-3 py-1.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-[#ff3d6a]">
          Generate music
        </button>
        <button onClick={onRender} disabled={render.status === "rendering" || !clips.length}
                className="rounded-md bg-[#ff3d6a] px-3 py-1.5 text-sm text-white outline-none transition-opacity disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#ff3d6a] focus-visible:ring-offset-2">
          {render.status === "rendering" ? "Rendering…" : "Render mp4"}
        </button>
      </div>

      {render.status === "ready" && render.url && (
        <a href={mediaUrl(render.url)} download
           className="inline-block rounded-md border border-green-600 px-3 py-1.5 text-sm text-green-600 outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a]">
          Download final video
        </a>
      )}
      {render.status === "failed" && (
        <p className="text-sm text-red-400">⚠ Render failed: {render.error}</p>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Video track</h3>
        {clips.map((c, i) => (
          <div key={c.id} className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <span className="w-20 truncate text-xs text-muted-foreground">{c.shot_id}</span>
            <label className="text-xs">in</label>
            <input type="number" min={0} step={0.5} value={c.in_s}
                   onChange={(e) => trim(i, { in_s: Number(e.target.value) })}
                   className="w-16 rounded border bg-background px-1 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a]" />
            <label className="text-xs">out</label>
            <input type="number" min={0} step={0.5} value={c.out_s}
                   onChange={(e) => trim(i, { out_s: Number(e.target.value) })}
                   className="w-16 rounded border bg-background px-1 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a]" />
            <div className="ml-auto flex gap-1">
              <button onClick={() => move(i, -1)} disabled={i === 0}
                      className="rounded border px-2 text-xs outline-none transition-colors hover:bg-muted disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-[#ff3d6a]">↑</button>
              <button onClick={() => move(i, 1)} disabled={i === clips.length - 1}
                      className="rounded border px-2 text-xs outline-none transition-colors hover:bg-muted disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-[#ff3d6a]">↓</button>
            </div>
          </div>
        ))}
        {!clips.length && (
          <p className="text-sm text-muted-foreground">
            No clips yet — generate shot videos in Storyboard, then build the timeline.
          </p>
        )}
      </div>

      {(timeline.voice.length > 0 || timeline.music.length > 0) && (
        <div className="space-y-1 text-sm">
          <h3 className="font-semibold">Audio</h3>
          {timeline.voice.map((a) => <p key={a.id} className="text-xs text-muted-foreground">🎙 {a.label}</p>)}
          {timeline.music.map((a) => <p key={a.id} className="text-xs text-muted-foreground">🎵 {a.label}</p>)}
        </div>
      )}
    </div>
  );
}
