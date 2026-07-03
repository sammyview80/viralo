import { useState } from "react";
import { agentApi, type LyricVideoPlanResponse, type LyricVideoSource } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SOURCE_TYPES: LyricVideoSource["type"][] = ["upload", "youtube", "spotify", "metadata"];
const RATIOS = ["9:16", "16:9", "1:1", "4:5"] as const;
const TEMPLATES = [
  { id: "neon-karaoke", label: "Neon Karaoke" },
  { id: "minimal-black", label: "Minimal Black" },
  { id: "album-motion", label: "Album Art Motion" },
] as const;

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function LyricVideoPlanner() {
  const [sourceType, setSourceType] = useState<LyricVideoSource["type"]>("upload");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<(typeof RATIOS)[number]>("9:16");
  const [templateHint, setTemplateHint] = useState<(typeof TEMPLATES)[number]["id"]>("neon-karaoke");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<LyricVideoPlanResponse | null>(null);

  async function createPlan() {
    setLoading(true);
    setError("");
    try {
      const next = await agentApi.planLyricVideo({
        source: {
          type: sourceType,
          title: title.trim() || null,
          artist: artist.trim() || null,
          url: sourceUrl.trim() || null,
        },
        rights_confirmed: rightsConfirmed,
        transcript_text: lyrics.trim() || null,
        aspect_ratio: aspectRatio,
        template_hint: templateHint,
      });
      setPlan(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create lyric plan");
    } finally {
      setLoading(false);
    }
  }

  const templateName = plan ? textValue(plan.template.label) || textValue(plan.template.id) : "";
  const captionStyle = plan ? textValue(plan.template.caption_style) : "";

  return (
    <section id="lyric-video" className="mt-5 rounded-[16px] border border-c-border bg-surface-1 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#ff7a9a]">Lyric Video</p>
          <h3 className="mt-1 font-display text-[18px] font-black text-c-text">Create a synced lyric video plan</h3>
          <p className="mt-1 max-w-[620px] text-[12.5px] leading-5 text-c-text-muted">
            Use your song audio or metadata, paste lyrics or transcript, then preview timed lyric lines before rendering.
          </p>
        </div>
        <span className="w-fit rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 px-3 py-1 text-[11px] font-bold text-[#ff7a9a]">
          Plan first
        </span>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-c-text-muted">Source</span>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as LyricVideoSource["type"])}
              className="h-11 w-full rounded-[11px] border border-c-border bg-surface-2 px-3 text-[13px] font-semibold text-c-text outline-none focus:border-[#ff3d6a]/60"
            >
              {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-c-text-muted">Source URL</span>
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="YouTube or Spotify link"
              className="h-11 w-full rounded-[11px] border border-c-border bg-surface-2 px-3 text-[13px] text-c-text outline-none placeholder:text-c-text-muted focus:border-[#ff3d6a]/60"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-c-text-muted">Song title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Optional"
              className="h-11 w-full rounded-[11px] border border-c-border bg-surface-2 px-3 text-[13px] text-c-text outline-none placeholder:text-c-text-muted focus:border-[#ff3d6a]/60"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-c-text-muted">Artist</span>
            <input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Optional"
              className="h-11 w-full rounded-[11px] border border-c-border bg-surface-2 px-3 text-[13px] text-c-text outline-none placeholder:text-c-text-muted focus:border-[#ff3d6a]/60"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-c-text-muted">Template</span>
            <select
              value={templateHint}
              onChange={(e) => setTemplateHint(e.target.value as (typeof TEMPLATES)[number]["id"])}
              className="h-11 w-full rounded-[11px] border border-c-border bg-surface-2 px-3 text-[13px] font-semibold text-c-text outline-none focus:border-[#ff3d6a]/60"
            >
              {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-c-text-muted">Ratio</span>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as (typeof RATIOS)[number])}
              className="h-11 w-full rounded-[11px] border border-c-border bg-surface-2 px-3 text-[13px] font-semibold text-c-text outline-none focus:border-[#ff3d6a]/60"
            >
              {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-c-text-muted">Lyrics or transcript</span>
            <textarea
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              rows={6}
              placeholder={"Paste lyrics line by line.\nLeave empty to mark this plan as needing transcription."}
              className="w-full resize-y rounded-[11px] border border-c-border bg-surface-2 px-3 py-3 text-[13px] leading-5 text-c-text outline-none placeholder:text-c-text-muted focus:border-[#ff3d6a]/60"
            />
          </label>
          <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={() => setRightsConfirmed((v) => !v)} className="flex items-center gap-2 text-left">
              <span className={cn("grid h-5 w-5 place-items-center rounded-[6px] border", rightsConfirmed ? "border-[#ff3d6a] bg-[#ff3d6a]" : "border-c-border bg-surface-2")}>
                {rightsConfirmed && <span className="text-[12px] font-black text-white">OK</span>}
              </span>
              <span className="text-[12.5px] font-semibold text-c-text-secondary">I have rights to use this song/audio.</span>
            </button>
            <Button onClick={createPlan} disabled={loading} className="h-11 rounded-[11px] bg-[#ff3d6a] px-5 text-white hover:bg-[#ff537b] disabled:opacity-50">
              {loading ? "Creating..." : "Create lyric plan"}
            </Button>
          </div>
          {error && <p className="sm:col-span-2 text-[12px] font-semibold text-red-400">{error}</p>}
        </div>

        <div className="rounded-[14px] border border-c-border bg-surface-0 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[.16em] text-c-text-muted">Preview</p>
          {!plan ? (
            <div className="mt-5 rounded-[12px] border border-dashed border-c-border bg-surface-1 px-4 py-8 text-center">
              <p className="text-[13px] font-semibold text-c-text-muted">No lyric plan yet</p>
              <p className="mt-1 text-[12px] text-c-text-muted">Create a plan to inspect timing and template choice.</p>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="rounded-[12px] border border-c-border bg-surface-1 p-3">
                <p className="text-[13px] font-bold text-c-text">{templateName}</p>
                <p className="mt-1 text-[12px] text-c-text-muted">
                  {captionStyle || "caption style"} - {textValue(plan.template.aspect_ratio)}
                </p>
                <p className="mt-2 text-[11.5px] font-semibold text-c-text-muted">
                  {plan.needs_transcription ? "Needs transcription before render" : `${plan.lyrics.length} timed lyric lines`}
                </p>
              </div>
              {plan.warnings.length > 0 && (
                <div className="rounded-[12px] border border-amber-400/25 bg-amber-400/[.07] p-3">
                  <p className="text-[12px] font-bold text-amber-300">Warnings</p>
                  <ul className="mt-2 space-y-1 text-[11.5px] font-medium text-amber-200/90">
                    {plan.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                </div>
              )}
              <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
                {plan.lyrics.length === 0 ? (
                  <p className="rounded-[12px] border border-c-border bg-surface-1 p-3 text-[12px] text-c-text-muted">
                    Add lyrics or transcript to preview timed lines.
                  </p>
                ) : plan.lyrics.map((line, idx) => (
                  <div key={`${line.start_sec}-${idx}`} className="rounded-[10px] border border-c-border bg-surface-1 p-3">
                    <p className="text-[12px] font-bold text-c-text">{line.text}</p>
                    <p className="mt-1 text-[11px] text-c-text-muted">
                      {line.start_sec.toFixed(2)}s - {line.end_sec.toFixed(2)}s - confidence {Math.round(line.confidence * 100)}%
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
