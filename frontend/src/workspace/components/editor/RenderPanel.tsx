import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { renderApi, type RenderStatus } from "@/lib/api";
import type { Caption } from "./CaptionEditor";
import type { EffectMarker } from "./Timeline";

type Quality = "draft" | "720p" | "1080p";

const QUALITY_OPTS: { value: Quality; label: string; desc: string }[] = [
  { value: "draft",  label: "Draft",  desc: "Fast preview, lower quality" },
  { value: "720p",   label: "720p",   desc: "Good quality, smaller file" },
  { value: "1080p",  label: "1080p",  desc: "Full quality, recommended" },
];

interface RenderPanelProps {
  clipId: string;
  trimStart: number;
  trimEnd: number;
  captions: Caption[];
  markers: EffectMarker[];
}

export function RenderPanel({ clipId, trimStart, trimEnd, captions, markers }: RenderPanelProps) {
  const [quality, setQuality] = useState<Quality>("1080p");
  const [renderId, setRenderId] = useState<string | null>(null);
  const [status, setStatus] = useState<RenderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function startPolling(rid: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await renderApi.getStatus(clipId, rid);
        setStatus(s);
        if (s.status === "done" || s.status === "error") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
        }
      } catch { /* ignore transient poll errors */ }
    }, 2000);
  }

  async function handleRender() {
    setSubmitting(true);
    setError(null);
    setStatus(null);
    setRenderId(null);
    try {
      const { render_id } = await renderApi.startRender(clipId, {
        trim_start_sec: trimStart,
        trim_end_sec: trimEnd || null,
        captions: captions.map((c) => ({
          id: c.id, text: c.text, start_sec: c.startSec, end_sec: c.endSec,
          position: c.position, color: c.color, font_size: c.fontSize, template: c.template,
        })),
        markers: markers.map((m) => ({
          id: m.id, time_ms: m.timeMs, sound: m.sound, emoji: m.emoji, label: m.label,
        })),
        quality,
      });
      setRenderId(render_id);
      startPolling(render_id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Render failed");
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || (status && status.status === "processing") || (status && status.status === "queued");

  return (
    <div className="space-y-4">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Export Quality</h3>

      <div className="grid grid-cols-3 gap-2">
        {QUALITY_OPTS.map((q) => (
          <button
            key={q.value}
            onClick={() => setQuality(q.value)}
            disabled={!!busy}
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-[11px] font-semibold transition cursor-pointer disabled:opacity-50",
              quality === q.value
                ? "border-[#ff3d6a]/50 bg-[#ff3d6a]/10 text-rose-200"
                : "border-white/[.06] bg-white/[.02] text-zinc-400 hover:bg-white/[.05] hover:text-zinc-200"
            )}
          >
            <span className="text-[15px] font-bold">{q.label}</span>
            <span className="text-[9px] text-center leading-tight opacity-70">{q.desc}</span>
          </button>
        ))}
      </div>

      <button
        onClick={handleRender}
        disabled={!!busy}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#ff3d6a] px-4 py-3 text-[13px] font-bold text-white hover:bg-[#e8304f] disabled:opacity-50 transition cursor-pointer"
      >
        {submitting
          ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />Starting…</>
          : busy
          ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />Rendering…</>
          : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Render &amp; Export</>}
      </button>

      {/* Progress */}
      {status && status.status !== "done" && status.status !== "error" && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-[10px] text-zinc-500">
            <span className="capitalize">{status.status}…</span>
            <span>{status.progress_pct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/[.06]">
            <div
              className="h-full rounded-full bg-[#ff3d6a] transition-all duration-500"
              style={{ width: `${status.progress_pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Done */}
      {status?.status === "done" && status.download_url && (
        <a
          href={status.download_url}
          download
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[13px] font-bold text-emerald-300 hover:bg-emerald-500/15 transition"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download {quality} MP4
        </a>
      )}

      {/* Error */}
      {(error || status?.status === "error") && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
          {error || status?.error_message || "Render failed — try again"}
        </p>
      )}
    </div>
  );
}
