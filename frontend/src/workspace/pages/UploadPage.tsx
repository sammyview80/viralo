import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn, safeFilename, downloadBlob, downloadUrl, stripSrtTimecodes } from "@/lib/utils";
import { navigate } from "@/lib/router";
import { UniversalClipCard, type ClipCardAction } from "../components/UniversalClipCard";
import { VirtualizedGrid } from "../components/VirtualizedCollection";
import { videoApi, platformApi, token as authToken, API_BASES, type VideoResponse, type ClipApiResponse, type ClipConfig, type SocialAccount, type ScheduledPost } from "@/lib/api";

const VIDEO_SSE_BASE = API_BASES.video;

/* ─── Types ─── */
type Source = "file" | "yt";
type View = "upload" | "processing" | "results";

/* ─── Clip config panel ─── */
export const PLATFORM_OPTIONS = [
  { id:"tiktok",    label:"TikTok",    ltr:"♪" },
  { id:"reels",     label:"Reels",     ltr:"◎" },
  { id:"shorts",    label:"Shorts",    ltr:"▶" },
  { id:"youtube",   label:"YouTube",   ltr:"▶" },
  { id:"instagram", label:"Instagram", ltr:"⊙" },
  { id:"twitter",   label:"Twitter/X", ltr:"𝕏" },
];

export const ASPECT_OPTIONS = ["9:16","1:1","16:9"];
export const LANG_OPTIONS   = ["en","es","fr","de","pt","ja","ko","zh","ar","hi"];

export const DEFAULT_CONFIG: ClipConfig = {
  language: "en",
  max_clips: 3,
  min_score: 0.5,
  platforms: ["tiktok","reels","shorts"],
  topic_focus: null,
  add_captions: false,
  caption_style: "capcut",
  aspect_ratio: "9:16",
  duration_min: 20,
  duration_max: 60,
  output_quality: "1080p",
  music: true,
  voiceover: false,
  template_id: null,
  music_track: null,
  occasion: null,
};

export const CAPTION_STYLES = [
  { id:"capcut",      label:"CapCut",       desc:"Bold word-by-word, colored highlight" },
  { id:"capcut-bold", label:"CapCut Bold",  desc:"Thicker strokes, high contrast" },
  { id:"classic",     label:"Classic",      desc:"White subtitles, black outline" },
  { id:"minimal",     label:"Minimal",      desc:"Clean lower-third, no outline" },
];

export function ClipConfigPanel({ config, onChange, step }: { config: ClipConfig; onChange: (c: ClipConfig) => void; step?: 1 | 2 | 3 }) {
  const set = (patch: Partial<ClipConfig>) => onChange({ ...config, ...patch });
  const togglePlat = (id: string) => {
    const cur = config.platforms ?? [];
    set({ platforms: cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id] });
  };

  const selectedPlatforms = config.platforms ?? [];
  const virality = Math.round((config.min_score ?? 0.5) * 10);
  const durationLabel = `${config.duration_min ?? 20}-${config.duration_max ?? 60}s`;
  const labelCls = "mb-2 block text-[10.5px] font-bold uppercase tracking-[.14em] text-zinc-500";
  const inputCls = "w-full rounded-[11px] border border-white/[.08] bg-[#0a0f18] px-3.5 py-3 text-[13px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-[#ff3d6a]/55 focus:shadow-[0_0_0_3px_rgba(255,61,106,.09)]";
  const chipBase = "rounded-[10px] border px-3 py-2 text-[12px] font-semibold transition cursor-pointer";
  const chipOn  = "border-[#ff3d6a]/45 bg-[#ff3d6a]/[.13] text-[#ff5f86] shadow-[inset_0_1px_0_rgba(255,255,255,.05)]";
  const chipOff = "border-white/[.08] bg-white/[.035] text-zinc-400 hover:border-white/[.15] hover:bg-white/[.06] hover:text-zinc-200";

  const showAll = !step;
  const s1 = showAll || step === 1;
  const s2 = showAll || step === 2;
  const s3 = showAll || step === 3;

  return (
    <div>
      {/* Header row with summary chips — only in full (non-stepped) mode */}
      {showAll && (
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-[15px] font-bold text-white">Clip recipe</h3>
            <p className="mt-0.5 text-[12px] text-zinc-500">Tune output once. Viralo uses these rules for every generated clip.</p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold text-zinc-300">
            <span className="rounded-full border border-white/[.08] bg-white/[.04] px-2.5 py-1">{selectedPlatforms.length} platforms</span>
            <span className="rounded-full border border-white/[.08] bg-white/[.04] px-2.5 py-1">{durationLabel}</span>
            <span className="rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 px-2.5 py-1 text-[#ff6c90]">≥ {virality}/10</span>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Step 1: Destinations */}
        {s1 && <div>
          <label className={labelCls}>Destinations</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {PLATFORM_OPTIONS.map((p) => {
              const active = selectedPlatforms.includes(p.id);
              return (
                <button key={p.id} type="button" onClick={() => togglePlat(p.id)}
                  className={cn("flex items-center justify-center gap-2", chipBase, active ? chipOn : chipOff)}>
                  <span className={cn("text-[13px]", active ? "text-[#ff7a9a]" : "text-zinc-500")}>{p.ltr}</span>
                  {p.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11.5px] text-zinc-600">Select every platform you plan to publish on so framing and captions stay safe.</p>
        </div>}

        {/* Step 1 continued: Aspect ratio + Language + Target length */}
        {s1 && <div className={showAll ? "border-t border-white/[.06] pt-5" : ""}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr_1.2fr]">
            <div>
              <label className={labelCls}>Aspect ratio</label>
              <div className="grid grid-cols-3 gap-1.5">
                {ASPECT_OPTIONS.map((r) => (
                  <button key={r} type="button" onClick={() => set({ aspect_ratio: r })}
                    className={cn(chipBase, "px-2 text-center", config.aspect_ratio === r ? chipOn : chipOff)}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>Language</label>
              <select value={config.language ?? "en"} onChange={(e) => set({ language: e.target.value })}
                className={inputCls}>
                {LANG_OPTIONS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Target length</label>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <input type="number" min={5} max={config.duration_max} value={config.duration_min}
                  onChange={(e) => set({ duration_min: Number(e.target.value) })}
                  className={inputCls} />
                <span className="text-zinc-600 text-sm">to</span>
                <input type="number" min={config.duration_min} max={300} value={config.duration_max}
                  onChange={(e) => set({ duration_max: Number(e.target.value) })}
                  className={inputCls} />
              </div>
            </div>
          </div>
        </div>}

        {/* Step 2: Max clips + Viral score */}
        {s2 && <div className={cn("grid grid-cols-1 gap-4 lg:grid-cols-2", showAll && "border-t border-white/[.06] pt-5")}>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className={cn(labelCls, "mb-0")}>Max clips</label>
              <span className="rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 px-2.5 py-1 text-[12px] font-bold text-[#ff5f86]">{config.max_clips}</span>
            </div>
            <input type="range" min={1} max={20} value={config.max_clips}
              onChange={(e) => set({ max_clips: Number(e.target.value) })}
              className="w-full accent-[#ff3d6a]" />
            <div className="mt-1 flex justify-between text-[10px] text-zinc-600"><span>1 focused clip</span><span>20 batch clips</span></div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className={cn(labelCls, "mb-0")}>Minimum viral score</label>
              <span className="rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 px-2.5 py-1 text-[12px] font-bold text-[#ff5f86]">{virality}/10</span>
            </div>
            <input type="range" min={0} max={10} step={1} value={virality}
              onChange={(e) => set({ min_score: Number(e.target.value) / 10 })}
              className="w-full accent-[#ff3d6a]" />
            <div className="mt-1 flex justify-between text-[10px] text-zinc-600"><span>Any usable</span><span>Balanced</span><span>Viral only</span></div>
          </div>
        </div>}

        {/* Step 2 continued: Topic focus + Auto captions */}
        {s2 && <div className={cn("grid grid-cols-1 gap-4 lg:grid-cols-[1fr_.9fr]", showAll && "border-t border-white/[.06] pt-5")}>
          <div>
            <label className={labelCls}>Topic focus <span className="normal-case tracking-normal text-zinc-600">optional</span></label>
            <input type="text" placeholder="e.g. controversial moment, product demo, founder story…"
              value={config.topic_focus ?? ""}
              onChange={(e) => set({ topic_focus: e.target.value || null })}
              className={inputCls} />
            <p className="mt-2 text-[11.5px] text-zinc-600">Use this to bias clip selection without changing the source video.</p>
          </div>

          <div className="flex items-start justify-between gap-3 pt-[22px]">
            <div>
              <div className="text-[13px] font-bold text-zinc-100">Auto captions</div>
              <div className="mt-0.5 text-[11.5px] text-zinc-500">Burn readable subtitles into every clip.</div>
            </div>
            <button type="button" onClick={() => set({ add_captions: !config.add_captions })}
              aria-pressed={!!config.add_captions}
              className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200",
                config.add_captions ? "bg-[#ff3d6a]" : "bg-white/[.13]")}>
              <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-200",
                config.add_captions ? "left-[calc(100%-24px)]" : "left-1")} />
            </button>
          </div>
        </div>}

        {s2 && config.add_captions && (
          <div className="border-t border-[#ff3d6a]/15 pt-5">
            <label className={labelCls}>Caption style</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {CAPTION_STYLES.map((s) => (
                <button key={s.id} type="button" onClick={() => set({ caption_style: s.id })}
                  className={cn("rounded-[11px] border px-3 py-2.5 text-left transition",
                    config.caption_style === s.id ? "border-[#ff3d6a]/45 bg-[#ff3d6a]/10" : "border-white/[.07] bg-white/[.03] hover:border-white/[.12]")}>
                  <div className={cn("text-[12px] font-bold", config.caption_style === s.id ? "text-[#ff5f86]" : "text-zinc-200")}>{s.label}</div>
                  <div className="mt-0.5 text-[10.5px] leading-4 text-zinc-500">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: AI enhancements */}
        {s3 && <div className={cn("space-y-3", showAll && "border-t border-white/[.06] pt-5")}>
          <label className={labelCls}>AI enhancements</label>

          {/* Occasion + Style side by side when stepped */}
          <div className={cn(!showAll && "grid grid-cols-2 gap-4")}>
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="text-[12px] font-bold text-zinc-100">Content type</div>
                {!config.occasion && <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">AUTO</span>}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { id: null,        label: "Auto" },
                  { id: "football",  label: "Football" },
                  { id: "cricket",   label: "Cricket" },
                  { id: "ufc",       label: "UFC/MMA" },
                  { id: "gaming",    label: "Gaming" },
                  { id: "concert",   label: "Concert" },
                  { id: "podcast",   label: "Podcast" },
                  { id: "wedding",   label: "Wedding" },
                  { id: "general",   label: "Other" },
                ].map((o) => (
                  <button key={String(o.id)} type="button"
                    onClick={() => set({ occasion: o.id })}
                    className={cn("rounded-[7px] border px-1.5 py-1 text-[10.5px] font-medium transition-colors text-center cursor-pointer",
                      (config.occasion ?? null) === o.id
                        ? "border-[#ff3d6a]/45 bg-[#ff3d6a]/10 text-[#ff5f86]"
                        : "border-white/[.07] bg-white/[.03] text-zinc-400 hover:border-white/[.12]")}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Style picker */}
            <div className={cn(showAll && "border-t border-white/[.05] pt-3")}>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="text-[12px] font-bold text-zinc-100">Style</div>
                {!config.template_id && <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">AUTO</span>}
              </div>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {[
                  { id: null,             label: "Auto",      desc: "Matched to content" },
                  { id: "sports-hype",    label: "Hype",      desc: "Bold hook + blur bg" },
                  { id: "cinematic",      label: "Cinematic", desc: "Dramatic + overlay" },
                  { id: "gaming-clutch",  label: "Clutch",    desc: "Gaming captions" },
                  { id: "talking-head",   label: "Talk",      desc: "Clean + chill music" },
                  { id: "generic",        label: "Minimal",   desc: "No extras, clean cut" },
                ].map((t) => (
                  <button key={String(t.id)} type="button"
                    onClick={() => set({ template_id: t.id })}
                    className={cn("rounded-[7px] border px-1.5 py-1 text-left transition-colors cursor-pointer",
                      (config.template_id ?? null) === t.id
                        ? "border-[#ff3d6a]/45 bg-[#ff3d6a]/10"
                        : "border-white/[.07] bg-white/[.03] hover:border-white/[.12]")}>
                    <div className={cn("text-[10.5px] font-bold", (config.template_id ?? null) === t.id ? "text-[#ff5f86]" : "text-zinc-200")}>{t.label}</div>
                    <div className="text-[9.5px] text-zinc-500 mt-0.5 leading-tight">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Music + Voiceover side by side */}
          <div className={cn("border-t border-white/[.05] pt-3 grid gap-3", !showAll ? "grid-cols-2" : "grid-cols-1")}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[12px] font-bold text-zinc-100">Background music</div>
                <div className="mt-0.5 text-[11px] text-zinc-500">Royalty-free hype/chill track.</div>
              </div>
              <button type="button" onClick={() => set({ music: !(config.music ?? true) })}
                aria-pressed={config.music ?? true}
                className={cn("relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
                  (config.music ?? true) ? "bg-[#ff3d6a]" : "bg-white/[.13]")}>
                <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-200",
                  (config.music ?? true) ? "left-[calc(100%-22px)]" : "left-0.5")} />
              </button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <div className="text-[12px] font-bold text-zinc-100">AI voiceover</div>
                  <span className="rounded-full border border-[#ff3d6a]/30 bg-[#ff3d6a]/10 px-1.5 py-0.5 text-[9.5px] font-bold text-[#ff6c90]">NEW</span>
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500">Narrator script over clip.</div>
              </div>
              <button type="button" onClick={() => set({ voiceover: !config.voiceover })}
                aria-pressed={!!config.voiceover}
                className={cn("relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
                  config.voiceover ? "bg-[#ff3d6a]" : "bg-white/[.13]")}>
                <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-200",
                  config.voiceover ? "left-[calc(100%-22px)]" : "left-0.5")} />
              </button>
            </div>
          </div>

          {/* Output quality */}
          <div className="border-t border-white/[.05] pt-3">
            <label className={labelCls}>Output quality</label>
            <div className="grid grid-cols-4 gap-1.5">
              {(["source","1080p","720p","480p"] as const).map((q) => (
                <button key={q} type="button" onClick={() => set({ output_quality: q })}
                  className={cn(chipBase, "text-center py-1.5", config.output_quality === q ? chipOn : chipOff)}>
                  {q === "source" ? "Full res" : q}
                </button>
              ))}
            </div>
          </div>
        </div>}
      </div>
    </div>
  );
}

/* ─── Delete confirm modal ─── */
function BrowserCaptureModal({
  video,
  onDone,
  onCancel,
}: {
  video: VideoResponse;
  onDone: (updated: VideoResponse) => void;
  onCancel: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [chunks, setChunks] = useState<Blob[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const ytId = video.source_url
    ? (video.source_url.match(/(?:v=|youtu\.be\/)([A-Za-z9_-]{11})/)?.[1] ?? "")
    : "";

  const startRecording = async () => {
    setError("");
    setChunks([]);
    try {
      const stream = await (navigator.mediaDevices as MediaDevices & {
        getDisplayMedia: (opts: MediaStreamConstraints) => Promise<MediaStream>;
      }).getDisplayMedia({ video: true, audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm; codecs=vp9,opus" });
      const localChunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) localChunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setChunks(localChunks);
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecording(true);
    } catch (e) {
      setError("Could not start recording. Allow screen capture permission.");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  const uploadCapture = async () => {
    if (!chunks.length) return;
    setUploading(true);
    setError("");
    try {
      const blob = new Blob(chunks, { type: "video/webm" });
      const updated = await videoApi.browserUpload(video.id, blob);
      onDone(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0e1420] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-white">Record YouTube Video</h2>
          <button onClick={onCancel} className="text-zinc-500 hover:text-white">✕</button>
        </div>
        <p className="mb-4 text-[13px] text-zinc-400">
          Play the video below, then click <strong className="text-white">Start Recording</strong> and select this tab/window. Stop when done, then upload.
        </p>
        {ytId && (
          <div className="mb-4 aspect-video w-full overflow-hidden rounded-xl bg-black">
            <iframe
              ref={iframeRef}
              src={`https://www.youtube.com/embed/${ytId}?autoplay=1`}
              allow="autoplay; fullscreen"
              className="h-full w-full"
            />
          </div>
        )}
        {error && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-[13px] text-red-400">{error}</p>}
        <div className="flex gap-3">
          {!recording && !chunks.length && (
            <button onClick={startRecording}
              className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500">
              Start Recording
            </button>
          )}
          {recording && (
            <button onClick={stopRecording}
              className="flex-1 rounded-xl bg-zinc-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-600">
              ⏹ Stop Recording
            </button>
          )}
          {chunks.length > 0 && !recording && (
            <button onClick={uploadCapture} disabled={uploading}
              className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
              {uploading ? "Uploading…" : "Upload & Process"}
            </button>
          )}
          {chunks.length > 0 && !recording && (
            <button onClick={() => setChunks([])}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-zinc-400 hover:text-white">
              Re-record
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DeleteModal({
  video,
  onConfirm,
  onCancel,
}: {
  video: VideoResponse;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center p-4"
      style={{ background: "rgba(4,7,15,.7)", backdropFilter: "blur(6px)", animation: "fadeUp .15s ease" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[380px] overflow-hidden rounded-[18px] border border-white/[.12] bg-[#0e1420] shadow-[0_32px_80px_rgba(0,0,0,.7)]"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "fadeUp .18s cubic-bezier(.22,.8,.4,1)" }}
      >
        <div className="p-6">
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-[12px] border border-red-400/20 bg-red-400/10">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </div>
          <h3 className="font-display text-[16px] font-bold text-white">Delete video?</h3>
          <p className="mt-1.5 text-[13px] leading-[1.55] text-zinc-400">
            <span className="font-semibold text-zinc-200">"{video.title ?? "Untitled"}"</span> and all its generated clips will be permanently deleted. This cannot be undone.
          </p>
        </div>
        <div className="flex gap-2 border-t border-white/[.07] px-6 py-4">
          <button
            onClick={onCancel}
            className="flex-1 rounded-[9px] border border-white/[.08] bg-white/[.04] py-2 text-[13px] font-semibold text-zinc-300 transition hover:bg-white/[.08] hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-[9px] bg-red-500 py-2 text-[13px] font-semibold text-white shadow-[0_2px_12px_rgba(239,68,68,.3)] transition hover:bg-red-400 hover:shadow-[0_4px_18px_rgba(239,68,68,.4)]"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Helpers ─── */
function fmtSec(s: number) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtDur(sec: number | null) {
  if (sec == null) return "—:--";
  return fmtSec(sec);
}

function gradFromId(id: string) {
  const GRADS = [
    "from-[#FF3D6A] to-[#FF7A3D]", "from-[#3DAAFF] to-[#7B66FF]",
    "from-[#22C55E] to-[#3DAAFF]", "from-[#A855F7] to-[#FF3D6A]",
    "from-[#FF7A3D] to-[#FFB347]",
  ];
  const n = id.charCodeAt(0) + id.charCodeAt(id.length - 1);
  return GRADS[n % GRADS.length];
}

const PLAT_DISPLAY: Record<string, [string, string]> = {
  tt:              ["♪", "bg-zinc-950 text-white"],
  tiktok:          ["♪", "bg-zinc-950 text-white"],
  ig:              ["◎", "bg-gradient-to-br from-fuchsia-500 to-orange-400 text-white"],
  instagram:       ["◎", "bg-gradient-to-br from-fuchsia-500 to-orange-400 text-white"],
  yt:              ["▶", "bg-red-500 text-white"],
  youtube:         ["▶", "bg-red-500 text-white"],
  youtube_shorts:  ["▶", "bg-red-500 text-white"],
  tw:              ["𝕏", "bg-zinc-100 text-zinc-950"],
  twitter:         ["𝕏", "bg-zinc-100 text-zinc-950"],
  li:              ["in", "bg-blue-700 text-white"],
  linkedin:        ["in", "bg-blue-700 text-white"],
  fb:              ["f",  "bg-blue-600 text-white"],
  facebook:        ["f",  "bg-blue-600 text-white"],
};

function PlatPill({ p }: { p: string }) {
  const [lbl, cls] = PLAT_DISPLAY[p] ?? ["?", "bg-zinc-700 text-white"];
  return <span className={cn("inline-grid h-5 w-5 place-items-center rounded-[4px] border border-white/10 text-[9px] font-black", cls)}>{lbl}</span>;
}

function VirChip({ score }: { score: number | null }) {
  if (score == null) return null;
  const color = score >= 75 ? "text-emerald-300 border-emerald-300/30 bg-emerald-400/15"
              : score >= 55 ? "text-yellow-300 border-yellow-300/30 bg-yellow-400/[.12]"
              : "text-zinc-400 border-white/10 bg-white/[.07]";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-[7px] border px-2 py-0.5 text-[11px] font-bold", color)}>
      ⚡ {score}
    </span>
  );
}

/* ─── Waveform ─── */
function Waveform({ bars = 80, selStart, selEnd }: { bars?: number; selStart: number; selEnd: number }) {
  const heights = Array.from({ length: bars }, (_, i) => {
    const base = 0.2 + 0.6 * Math.sin(i * 0.3) * Math.sin(i * 0.07);
    return Math.max(0.1, Math.abs(base + Math.sin(i * 1.7) * 0.3));
  });
  return (
    <div className="flex h-full w-full items-end gap-[1.5px]">
      {heights.map((h, i) => {
        const pct = i / bars;
        const inSel = pct >= selStart && pct <= selEnd;
        return (
          <div key={i} className="flex-1 rounded-[1px]" style={{
            height: `${h * 100}%`,
            background: inSel
              ? `rgba(255,61,106,${0.4 + h * 0.5})`
              : `rgba(255,255,255,${0.08 + h * 0.15})`,
          }} />
        );
      })}
    </div>
  );
}

/* ─── Timeline editor modal ─── */
interface TimelineClip {
  id: string;
  title: string | null;
  startSec: number;
  endSec: number;
  storage_url?: string | null;
}

function TimelineEditor({
  clip, totalDur = 600, onClose, onSave,
}: {
  clip: TimelineClip;
  totalDur?: number;
  onClose: () => void;
  onSave: (c: TimelineClip) => void;
}) {
  const [startSec, setStartSec] = useState(clip.startSec);
  const [endSec,   setEndSec]   = useState(clip.endSec);
  const [playing,  setPlaying]  = useState(false);
  const [pos,      setPos]      = useState(0);
  const trackRef  = useRef<HTMLDivElement>(null);
  const videoRef  = useRef<HTMLVideoElement>(null);
  const dragging  = useRef<"start" | "end" | null>(null);
  const rafRef    = useRef<number | null>(null);
  const pStart = startSec / totalDur;
  const pEnd   = endSec   / totalDur;
  const dur    = endSec - startSec;

  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return; }
    const spd = 1 / (dur * 60);
    const tick = () => {
      setPos((p) => { if (p >= 1) { setPlaying(false); return 0; } return p + spd; });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, dur]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const sec = Math.round(p * totalDur);
      if (dragging.current === "start") setStartSec(Math.min(sec, endSec - 3));
      else setEndSec(Math.max(sec, startSec + 3));
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [startSec, endSec, totalDur]);

  const fmtInput = (s: number) => {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };
  const parseInput = (v: string) => {
    const [m, s] = v.split(":").map(Number);
    return (m || 0) * 60 + (s || 0);
  };

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center p-3 sm:p-6"
      style={{ background: "rgba(4,7,15,.82)", backdropFilter: "blur(8px)", animation: "fadeUp .15s ease" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex w-full max-w-[700px] flex-col overflow-hidden rounded-[22px] border border-white/[.14] bg-[#0e1420] shadow-[0_40px_100px_rgba(0,0,0,.7)]"
        style={{ maxHeight: "90vh", animation: "fadeUp .2s cubic-bezier(.22,.8,.4,1)" }}
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex flex-none items-center gap-3 border-b border-white/[.07] px-5 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-[#ff3d6a]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>
            </svg>
          </div>
          <div>
            <h3 className="font-display text-[15px] font-bold">Clip Editor</h3>
            <p className="text-[11.5px] text-zinc-500">{clip.title ?? "Untitled clip"}</p>
          </div>
          <button onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-[7px] border border-white/[.08] bg-white/[.03] text-[13px] text-zinc-500 transition hover:text-white">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-6 pt-5 space-y-5">
          {/* Video preview */}
          <div className="relative aspect-video w-full overflow-hidden rounded-[13px] bg-black">
            {clip.storage_url ? (
              <video ref={videoRef} src={clip.storage_url} className="h-full w-full object-cover"
                playsInline preload="metadata"
                onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-[#ff3d6a]/20 to-[#ff7a3d]/20" />
            )}
            <div className="absolute inset-0 grid place-items-center" onClick={() => {
              if (videoRef.current) {
                if (videoRef.current.paused) { videoRef.current.play(); setPlaying(true); }
                else { videoRef.current.pause(); setPlaying(false); }
              } else { setPlaying((p) => !p); }
            }}>
              {!playing && (
                <div className="grid h-12 w-12 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm">▶</div>
              )}
            </div>
            {/* Playhead */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
              <div className="h-full bg-white transition-[width_.1s_linear]" style={{ width: `${pos * 100}%` }} />
            </div>
            <div className="absolute bottom-3 right-3 rounded bg-black/70 px-2 py-0.5 font-mono text-[11px] font-semibold text-white">
              {fmtSec(startSec + pos * dur)} / {fmtSec(dur)}
            </div>
          </div>

          {/* Timeline track */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[.1em] text-zinc-600">Timeline — drag handles to trim</div>
            <div ref={trackRef} className="relative h-14 w-full cursor-crosshair overflow-hidden rounded-[9px] bg-white/[.04]"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const p = (e.clientX - rect.left) / rect.width;
                const sec = Math.round(p * totalDur);
                if (Math.abs(p - pStart) < Math.abs(p - pEnd)) setStartSec(Math.min(sec, endSec - 3));
                else setEndSec(Math.max(sec, startSec + 3));
              }}>
              <Waveform bars={90} selStart={pStart} selEnd={pEnd} />
              {/* Selection highlight */}
              <div className="absolute inset-y-0 bg-[#ff3d6a]/10 border-x border-[#ff3d6a]/40 pointer-events-none"
                style={{ left: `${pStart * 100}%`, width: `${(pEnd - pStart) * 100}%` }} />
              {/* Start handle */}
              <div className="absolute inset-y-0 flex cursor-ew-resize flex-col items-center"
                style={{ left: `calc(${pStart * 100}% - 2px)` }}
                onMouseDown={(e) => { e.preventDefault(); dragging.current = "start"; }}>
                <div className="h-full w-[3px] bg-[#ff3d6a]" />
                <div className="absolute -bottom-5 whitespace-nowrap rounded bg-[#ff3d6a] px-1.5 py-0.5 text-[10px] font-bold text-white">{fmtSec(startSec)}</div>
              </div>
              {/* End handle */}
              <div className="absolute inset-y-0 flex cursor-ew-resize flex-col items-center"
                style={{ left: `calc(${pEnd * 100}% - 2px)` }}
                onMouseDown={(e) => { e.preventDefault(); dragging.current = "end"; }}>
                <div className="h-full w-[3px] bg-[#ff3d6a]" />
                <div className="absolute -bottom-5 whitespace-nowrap rounded bg-[#ff3d6a] px-1.5 py-0.5 text-[10px] font-bold text-white">{fmtSec(endSec)}</div>
              </div>
            </div>

            {/* Time inputs */}
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { label:"Start", val:fmtInput(startSec), set:(v:string)=>{ const n=parseInput(v); if(!isNaN(n)) setStartSec(Math.min(n,endSec-3)); } },
                { label:"Duration", val:fmtSec(dur), set:null, accent:true },
                { label:"End",   val:fmtInput(endSec),   set:(v:string)=>{ const n=parseInput(v); if(!isNaN(n)) setEndSec(Math.max(n,startSec+3)); } },
              ].map(({ label, val, set, accent }) => (
                <div key={label} className={cn("rounded-[10px] border p-3 text-center", accent ? "border-[#ff3d6a]/25 bg-[#ff3d6a]/[.06]" : "border-white/[.08] bg-white/[.03]")}>
                  <div className={cn("mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.08em]", accent ? "text-[#ff3d6a]" : "text-zinc-500")}>{label}</div>
                  {set
                    ? <input defaultValue={val} key={val}
                        onBlur={(e) => set(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && set((e.target as HTMLInputElement).value)}
                        className="w-full bg-transparent text-center font-mono text-[15px] font-bold text-zinc-200 outline-none" />
                    : <div className={cn("font-mono text-[15px] font-bold", accent ? "text-[#ff3d6a]" : "text-zinc-200")}>{val}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Quick trim */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[.1em] text-zinc-600">Quick trim</div>
            <div className="flex flex-wrap gap-2">
              {([
                ["−5s start", () => setStartSec((s) => Math.max(0, s - 5))],
                ["+5s start", () => setStartSec((s) => Math.min(s + 5, endSec - 3))],
                ["−5s end",   () => setEndSec((s) => Math.max(startSec + 3, s - 5))],
                ["+5s end",   () => setEndSec((s) => Math.min(s + 5, totalDur))],
              ] as [string, () => void][]).map(([l, fn]) => (
                <button key={l} onClick={fn}
                  className="rounded-[8px] border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition hover:border-[#ff3d6a]/35 hover:text-white">
                  {l}
                </button>
              ))}
              <button onClick={() => { setStartSec(clip.startSec); setEndSec(clip.endSec); }}
                className="ml-auto rounded-[8px] border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-[12px] font-medium text-zinc-500 transition hover:text-white">
                ↺ Reset
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-none gap-2.5 border-t border-white/[.07] px-5 py-4">
          <button onClick={onClose}
            className="rounded-[9px] border border-white/[.08] bg-white/[.03] px-4 py-2 text-[13px] font-semibold text-zinc-300 transition hover:text-white">
            Cancel
          </button>
          <button onClick={() => { onSave({ ...clip, startSec, endSec }); onClose(); }}
            className="ml-auto flex items-center gap-1.5 rounded-[9px] bg-[#ff3d6a] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_2px_12px_rgba(255,61,106,.3)] transition hover:shadow-[0_4px_18px_rgba(255,61,106,.4)]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18"/></svg>
            Save & re-render
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Zip download modal ─── */
type ZipPhase = "zipping" | "done" | "error";

function ZipDownloadModal({ clips, videoTitle, onClose }: {
  clips: ClipApiResponse[];
  videoTitle: string;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<ZipPhase>("zipping");
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    async function run() {
      const ids = clips.filter((c) => c.storage_url).map((c) => c.id);
      if (!ids.length) { setError("No downloadable clips."); setPhase("error"); return; }

      try {
        const blob = await videoApi.downloadZip(ids, videoTitle);
        if (cancelledRef.current) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = safeFilename(videoTitle, "zip");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setPhase("done");
        setTimeout(onClose, 1200);
      } catch (e: unknown) {
        if (cancelledRef.current) return;
        setError(e instanceof Error ? e.message : "Unknown error");
        setPhase("error");
      }
    }

    void run();
    return () => { cancelledRef.current = true; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[340px] rounded-[16px] border border-white/[.10] bg-[#0f1520] p-6 shadow-[0_24px_60px_rgba(0,0,0,.7)]"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[14px] font-semibold text-white">
            {phase === "zipping" && "Preparing ZIP…"}
            {phase === "done" && "Done!"}
            {phase === "error" && "Error"}
          </span>
          {(phase === "done" || phase === "error") && (
            <button onClick={onClose} className="text-[12px] text-zinc-500 hover:text-zinc-300">Close</button>
          )}
        </div>

        {phase === "zipping" && (
          <div className="flex items-center gap-2.5 text-[12px] text-zinc-400">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
            Server is fetching and zipping {clips.filter((c) => c.storage_url).length} clips…
          </div>
        )}

        {phase === "done" && (
          <div className="text-[12px] text-emerald-400">✓ ZIP downloaded successfully</div>
        )}

        {phase === "error" && (
          <div className="text-[12px] text-red-400">{error}</div>
        )}

        {phase === "zipping" && (
          <button onClick={() => { cancelledRef.current = true; onClose(); }}
            className="mt-4 text-[11.5px] text-zinc-600 hover:text-zinc-400">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Download menu ─── */
function DownloadMenu({ clip, onClose }: { clip: ClipApiResponse; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    setTimeout(() => document.addEventListener("click", fn), 50);
    return () => document.removeEventListener("click", fn);
  }, []);

  const title = clip.title ?? "clip";

  const items: { label: string; icon: string; onClick?: () => void; disabled?: boolean }[] = [
    {
      label: "Download MP4", icon: "🎬",
      disabled: !clip.storage_url,
      onClick: () => { void downloadUrl(clip.storage_url!, safeFilename(title, "mp4")); onClose(); },
    },
    {
      label: "Download SRT", icon: "💬",
      disabled: !clip.caption_srt,
      onClick: () => { downloadBlob(clip.caption_srt!, safeFilename(title, "srt"), "text/plain"); onClose(); },
    },
    {
      label: "Download thumbnail", icon: "🖼",
      disabled: !clip.thumbnail_url,
      onClick: () => { void downloadUrl(clip.thumbnail_url!, safeFilename(title, "jpg")); onClose(); },
    },
    {
      label: copied ? "Copied!" : "Copy transcript", icon: "📝",
      disabled: !clip.caption_srt,
      onClick: () => {
        navigator.clipboard.writeText(stripSrtTimecodes(clip.caption_srt!))
          .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
      },
    },
    {
      label: "Share link", icon: "🔗",
      onClick: () => { navigator.clipboard.writeText(window.location.href); onClose(); },
    },
  ];

  return (
    <div ref={ref} className="absolute bottom-[calc(100%+6px)] right-0 z-50 w-48 overflow-hidden rounded-[11px] border border-white/[.10] bg-[#141926] shadow-[0_16px_40px_rgba(0,0,0,.5)]"
      onClick={(e) => e.stopPropagation()}>
      {items.map((item, i) => {
        const cls = `flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] transition ${item.disabled ? "cursor-not-allowed opacity-40 text-zinc-500" : "text-zinc-300 hover:bg-white/[.05] hover:text-white"}`;
        return (
          <div key={item.label}>
            {i === 3 && <div className="mx-3 border-t border-white/[.07]" />}
            <button onClick={item.disabled ? undefined : item.onClick} disabled={item.disabled} className={cls}>
              <span>{item.icon}</span>{item.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Pipeline step label mapping ─── */
const PROC_STEPS = [
  { keys: ["queued","queue","waiting"],    emoji:"⏳", label:"Queued",                  sub:"Waiting for a worker to become available" },
  { keys: ["download"],                    emoji:"⬇",  label:"Downloading video",       sub:"Fetching from source" },
  { keys: ["upload","uploading"],          emoji:"⬆",  label:"Uploading file",          sub:"Transferring to secure storage" },
  { keys: ["metadata","probe"],            emoji:"🔎", label:"Probing video",           sub:"Reading resolution, duration, codec" },
  { keys: ["transcribe","speech"],         emoji:"📝", label:"Transcribing speech",     sub:"AI speech-to-text in progress" },
  { keys: ["scoring","analyze","signal"],  emoji:"⚡", label:"Finding viral moments",   sub:"Step 1: detecting viral signals in transcript" },
  { keys: ["captions","caption"],          emoji:"💬", label:"Generating captions",     sub:"Building word-level caption timeline" },
  { keys: ["export","render","encode"],    emoji:"🎬", label:"Rendering clips",         sub:"Cutting, cropping, burning captions" },
  { keys: ["complete","done"],             emoji:"✅", label:"Done",                    sub:"All clips ready" },
];

function pipelineStepIdx(step: string | null): number {
  if (!step) return 0;
  const s = step.toLowerCase();
  const idx = PROC_STEPS.findIndex((p) => p.keys.some((k) => s.includes(k)));
  return idx >= 0 ? idx : 0;
}

function formatElapsedSince(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "unknown";
  const start = new Date(iso).getTime();
  if (!Number.isFinite(start)) return "unknown";
  const total = Math.max(0, Math.floor((now - start) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/* ─── Social connect banner shown during processing ─── */
const SOCIAL_PLATFORMS = [
  { id: "youtube",   label: "YouTube",   icon: "▶", color: "bg-red-500" },
  { id: "instagram", label: "Instagram", icon: "◎", color: "bg-gradient-to-br from-fuchsia-500 to-orange-400" },
  { id: "tiktok",    label: "TikTok",    icon: "♪", color: "bg-zinc-900" },
  { id: "twitter",   label: "Twitter/X", icon: "𝕏", color: "bg-zinc-100 text-zinc-900" },
  { id: "linkedin",  label: "LinkedIn",  icon: "in", color: "bg-blue-700" },
  { id: "facebook",  label: "Facebook",  icon: "f",  color: "bg-blue-600" },
];

function SocialConnectBanner() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    platformApi.listAccounts()
      .then(setAccounts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  const connectedIds = new Set(accounts.filter((a) => a.is_active).map((a) => a.platform));
  const unconnected = SOCIAL_PLATFORMS.filter((p) => !connectedIds.has(p.id));

  if (unconnected.length === 0) {
    return (
      <div className="mt-6 rounded-[13px] border border-emerald-300/15 bg-emerald-400/[.04] p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 flex-none place-items-center rounded-[8px] border border-emerald-300/25 bg-emerald-400/10 text-emerald-300 text-sm">✓</div>
          <div>
            <div className="text-[13px] font-semibold text-emerald-300">All platforms connected</div>
            <div className="text-[11.5px] text-zinc-500">Clips will be ready to publish when processing completes.</div>
          </div>
          <a href="/integrations" className="ml-auto text-[11.5px] font-semibold text-zinc-400 transition hover:text-white">Manage →</a>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {accounts.filter((a) => a.is_active).map((a) => {
            const plat = SOCIAL_PLATFORMS.find((p) => p.id === a.platform);
            return (
              <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-white/[.08] bg-white/[.04] px-2.5 py-1 text-[11px] font-semibold text-zinc-300">
                <span className={cn("inline-grid h-4 w-4 place-items-center rounded-[3px] text-[8px] font-black text-white", plat?.color ?? "bg-zinc-700")}>{plat?.icon}</span>
                {a.platform_username ?? a.platform}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-[13px] border border-[#ff3d6a]/15 bg-[#ff3d6a]/[.04] p-4" style={{ animation: "fadeUp .3s .4s cubic-bezier(.22,.8,.4,1) both" }}>
      <div className="flex items-start gap-3">
        <div className="grid h-8 w-8 flex-none place-items-center rounded-[8px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-[#ff3d6a] text-sm">↗</div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold">Connect social accounts while you wait</div>
          <div className="mt-0.5 text-[11.5px] text-zinc-500">
            {connectedIds.size > 0
              ? `${connectedIds.size} connected · connect more to publish clips instantly`
              : "Your clips will be ready soon — connect accounts to publish with one click"}
          </div>
        </div>
        <a href="/integrations"
          className="ml-auto flex-none rounded-[8px] border border-[#ff3d6a]/30 bg-[#ff3d6a]/10 px-3 py-1.5 text-[12px] font-semibold text-[#ff3d6a] transition hover:bg-[#ff3d6a]/20">
          Connect →
        </a>
      </div>

      {connectedIds.size > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {accounts.filter((a) => a.is_active).map((a) => {
            const plat = SOCIAL_PLATFORMS.find((p) => p.id === a.platform);
            return (
              <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                <span className={cn("inline-grid h-3.5 w-3.5 place-items-center rounded-[2px] text-[7px] font-black text-white", plat?.color ?? "bg-zinc-700")}>{plat?.icon}</span>
                {a.platform_username ?? a.platform}
              </span>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {unconnected.map((p) => (
          <a key={p.id} href="/integrations"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[11px] font-semibold text-zinc-400 transition hover:border-white/[.12] hover:text-zinc-200">
            <span className={cn("inline-grid h-3.5 w-3.5 place-items-center rounded-[2px] text-[7px] font-black", p.color, p.id === "twitter" ? "" : "text-white")}>{p.icon}</span>
            + {p.label}
          </a>
        ))}
      </div>
    </div>
  );
}

/* ─── Processing view (SSE + polling fallback) ─── */
type LiveEvent = {
  id: string;
  kind: "clip_ready" | "clip_uploading" | "clips_ready" | "info";
  label: string;
  sub?: string;
  pct?: number;
  step?: string;
  thumbnail?: string;
  ts: number;
};

const STEP_ICONS: Record<string, string> = {
  download: "⬇", upload: "⬆", transcribe: "🎙", scoring: "🧠",
  ai_content: "✍", export: "🎞", captions: "💬", saving: "💾",
  complete: "✅", failed: "✗",
};
const STEP_COLORS: Record<string, string> = {
  download: "border-blue-400/20 bg-blue-400/10 text-blue-300",
  upload: "border-purple-400/20 bg-purple-400/10 text-purple-300",
  transcribe: "border-cyan-400/20 bg-cyan-400/10 text-cyan-300",
  scoring: "border-yellow-400/20 bg-yellow-400/10 text-yellow-300",
  ai_content: "border-pink-400/20 bg-pink-400/10 text-pink-300",
  export: "border-orange-400/20 bg-orange-400/10 text-orange-300",
  captions: "border-indigo-400/20 bg-indigo-400/10 text-indigo-300",
  saving: "border-teal-400/20 bg-teal-400/10 text-teal-300",
  complete: "border-emerald-300/20 bg-emerald-400/10 text-emerald-300",
};

function ProcessingView({
  video,
  onDone,
  onCancel,
}: {
  video: VideoResponse;
  onDone: (updated: VideoResponse) => void;
  onCancel?: () => void;
}) {
  const [current, setCurrent] = useState(video);
  const [liveMsg, setLiveMsg] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>(video.error_message ?? "");
  const [now, setNow] = useState(Date.now());
  const [retrying, setRetrying] = useState(false);

  const sanitize = (s: string) => {
    if (!s) return s;
    // Replace absolute paths (esp. /tmp/viralo-video/UUID/) with [internal-path]
    return s.replace(/\/tmp\/viralo-video\/[a-f0-9-]+\//gi, "[internal-path]/")
            .replace(/\/app\/[^\s)]+/gi, "[app-path]");
  };

  const STORAGE_KEY = `viralo_live_${video.celery_task_id ?? video.id}`;
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as LiveEvent[]) : [];
    } catch { return []; }
  });

  const doneRef = useRef(false);
  const sseActiveRef = useRef(false);
  const clipCountRef = useRef(0);

  const isTerminal = (v: VideoResponse) =>
    v.status === "done" || v.status === "ready" || v.status === "failed" || v.pipeline_step === "complete";

  const lastStepRef = useRef<string>("");
  const pushEvent = (ev: Omit<LiveEvent, "id" | "ts">) =>
    setLiveEvents((prev) => {
      const sanitizedEv = { ...ev, label: sanitize(ev.label), sub: ev.sub ? sanitize(ev.sub) : undefined };
      const next = [{ ...sanitizedEv, id: Math.random().toString(36).slice(2), ts: Date.now() }, ...prev].slice(0, 30);
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });

  useEffect(() => {
    setCurrent(video);
    setErrorMsg(sanitize(video.error_message ?? ""));
    doneRef.current = false;
  }, [video.id, video.status, video.pipeline_step, video.pipeline_pct, video.error_message]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  // SSE — primary real-time progress channel with exponential backoff reconnect
  const retryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!current.celery_task_id || doneRef.current) return;

    const isRanking = current.source_type === "ranking";

    const clippingStepLabels: Record<string, string> = {
      download: "Downloading video…", upload: "Uploading to storage…",
      transcribe: "Transcribing speech…", scoring: "Finding viral moments…",
      ai_content: "Generating titles & hashtags…", export: "Rendering clips…",
      captions: "Burning captions…", saving: "Saving clips…", complete: "All done!",
      template: "Applying template…", render: "Rendering with effects…",
      voiceover: "Generating AI voiceover…", audio_mix: "Mixing audio tracks…",
      enhance: "Enhancing quality…",
    };
    const rankingStepLabels: Record<string, string> = {
      starting: "Preparing ranking video…",
      downloading: "Resolving & downloading sources…",
      rendering: "Rendering segments…",
      concatenating: "Joining segments into final video…",
      upload: "Uploading to cloud…",
      complete: "Ranking video ready!",
    };
    const stepLabels = isRanking ? rankingStepLabels : clippingStepLabels;

    function connect() {
      if (doneRef.current) return;
      const t = authToken.get() || "";
      if (!t) return;
      const url = `${VIDEO_SSE_BASE}/progress/${current.celery_task_id}`;
      const es = new EventSource(`${url}?token=${encodeURIComponent(t)}`);
      esRef.current = es;

      es.onopen = () => { sseActiveRef.current = true; retryRef.current = 0; };

      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === "keepalive") return;

          if (d.message) setLiveMsg(sanitize(d.message));
          if (d.pct != null) setCurrent((prev) => ({ ...prev, pipeline_pct: d.pct, pipeline_step: d.step ?? prev.pipeline_step }));
          if (d.status === "failed" && d.message) setErrorMsg(sanitize(d.message));

          if (!isRanking) {
            if (d.event === "clip_upload_complete") {
              clipCountRef.current += 1;
              pushEvent({ kind: "clip_ready", label: `Clip ${clipCountRef.current} ready`, sub: d.title ?? undefined, thumbnail: d.thumbnail_url ?? undefined });
            }
            if (d.event === "clips_ready") {
              pushEvent({ kind: "clips_ready", label: `${d.count ?? ""} clips found`, sub: "Uploading to cloud…" });
            }
          }

          if (d.message && d.step && d.step !== "keepalive") {
            const isNewStep = d.step !== lastStepRef.current;
            if (isNewStep) lastStepRef.current = d.step;
            pushEvent({ kind: "info", label: d.message, pct: d.pct ?? undefined, step: d.step });
          } else if (d.step && d.step !== "keepalive" && d.step !== lastStepRef.current) {
            lastStepRef.current = d.step;
            if (stepLabels[d.step]) pushEvent({ kind: "info", label: stepLabels[d.step], step: d.step });
          }

          if (d.status === "complete" || d.status === "failed") {
            es.close();
            esRef.current = null;
            sseActiveRef.current = false;
            if (!doneRef.current) {
              doneRef.current = true;
              try { localStorage.removeItem(STORAGE_KEY); } catch { /* ok */ }
              videoApi.get(current.id).then(onDone).catch(() => onDone(current));
            }
          }
        } catch { /* ignore malformed */ }
      };

      es.onerror = () => {
        sseActiveRef.current = false;
        es.close();
        esRef.current = null;
        if (doneRef.current) return;
        // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
        const delay = Math.min(1000 * Math.pow(2, retryRef.current), 30_000);
        retryRef.current += 1;
        retryTimerRef.current = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      esRef.current?.close();
      esRef.current = null;
      sseActiveRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [current.celery_task_id]);

  // Queued-only timeout check — SSE handles all progress once the worker starts.
  // Only poll while queued (no SSE events until worker picks up the task).
  useEffect(() => {
    if (doneRef.current || isTerminal(current)) return;
    const isQueued = current.status === "queued" || (!current.pipeline_step && (current.pipeline_pct ?? 0) === 0);
    if (!isQueued) return; // SSE active — no polling needed
    const id = window.setInterval(async () => {
      if (doneRef.current) return;
      try {
        const updated = await videoApi.get(current.id);
        const stillQueued = updated.status === "queued" || (!updated.pipeline_step && (updated.pipeline_pct ?? 0) === 0);
        if (stillQueued && updated.created_at) {
          const queuedMs = Date.now() - new Date(updated.created_at).getTime();
          if (queuedMs > 5 * 60 * 1000) {
            setErrorMsg("No video worker picked up this job within 5 minutes. The worker may be down — please try again or contact support.");
            return;
          }
        }
        setCurrent(updated);
        if (updated.error_message) setErrorMsg(updated.error_message);
        if (isTerminal(updated) && !doneRef.current) {
          doneRef.current = true;
          setTimeout(() => onDone(updated), 400);
        }
      } catch { /* retry next tick */ }
    }, 2500);
    return () => window.clearInterval(id);
  }, [current.id, current.status, current.pipeline_step, current.pipeline_pct, onDone]);

  const overallPct = Math.min(Math.max(current.pipeline_pct ?? 0, 0), 100);
  const stepIdx = pipelineStepIdx(current.pipeline_step);
  const grad = gradFromId(current.id);
  const queuedFor = formatElapsedSince(current.created_at, now);
  const isQueued = current.status === "queued" || (!current.pipeline_step && overallPct === 0);
  const isRankingVideo = current.source_type === "ranking";
  const sourceLabel = isRankingVideo ? "Ranking video" : current.source_type === "youtube_url" ? "YouTube" : "Uploaded file";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3.5 rounded-[13px] border border-white/[.07] bg-[#0e1420] p-4">
        <div className={cn("grid h-12 w-16 flex-none place-items-center overflow-hidden rounded-[9px] bg-gradient-to-br", grad)}>
          <span className="text-xl">{isRankingVideo ? "🏆" : "🎬"}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold">{current.title ?? "Untitled"}</div>
          <div className="mt-0.5 flex gap-1.5 text-[11.5px] text-zinc-500">
            <span>{sourceLabel}</span>
            {current.duration_sec && <><span>·</span><span>{fmtDur(current.duration_sec)}</span></>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {current.status === "failed"
            ? <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/20 bg-red-400/10 px-2.5 py-1 text-[11px] font-semibold text-red-400"><span className="h-1.5 w-1.5 rounded-full bg-red-400" />Failed</span>
            : <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-300/20 bg-yellow-400/10 px-2.5 py-1 text-[11px] font-semibold text-yellow-300"><span className="h-1.5 w-1.5 rounded-full bg-yellow-300 animate-pulse" />{isQueued ? "Queued" : "Processing"}</span>}
          {current.created_at && (
            <span className="text-[10.5px] font-mono text-zinc-500">{formatElapsedSince(current.created_at, now)}</span>
          )}
        </div>
      </div>
      {isQueued && current.status !== "failed" && (
        <div className="rounded-[12px] border border-yellow-300/15 bg-yellow-400/[.045] p-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[12.5px] font-semibold text-yellow-200">{isRankingVideo ? "Waiting for a ranking worker" : "Waiting for a video worker"}</div>
              <div className="mt-0.5 text-[11.5px] text-zinc-500">
                This {isRankingVideo ? "ranking" : "clipping"} job has been queued for <span className="font-mono text-zinc-300">{queuedFor}</span>.
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10.5px] font-mono text-zinc-500">
              <span className="rounded-[7px] border border-white/[.07] bg-white/[.035] px-2 py-1">video {current.id.slice(0, 8)}</span>
              {current.celery_task_id && (
                <span className="rounded-[7px] border border-white/[.07] bg-white/[.035] px-2 py-1">task {current.celery_task_id.slice(0, 8)}</span>
              )}
            </div>
          </div>
        </div>
      )}
      {(current.status === "failed" || errorMsg) && errorMsg && (
        <div className="rounded-[8px] border border-red-500/20 bg-red-500/[.07] px-3 py-2 text-[11.5px] text-red-400 font-mono leading-snug break-all">
          <div className="flex items-start justify-between gap-3">
            <span>{errorMsg}</span>
            <button
              type="button"
              disabled={retrying}
              onClick={async () => {
                setRetrying(true);
                try {
                  const updated = await videoApi.retry(current.id);
                  setErrorMsg("");
                  setCurrent(updated);
                } catch {
                  // keep error visible
                } finally {
                  setRetrying(false);
                }
              }}
              className="shrink-0 rounded-[7px] border border-red-400/30 bg-red-400/10 px-2.5 py-1 text-[10.5px] font-semibold text-red-300 hover:bg-red-400/20 disabled:opacity-50 transition cursor-pointer"
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 flex justify-between text-[12px] font-medium">
          <span className="text-zinc-500">Overall progress</span>
          <span className="font-mono font-semibold text-zinc-200">{overallPct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[.06]">
          <div className="h-full rounded-full bg-gradient-to-r from-[#ff3d6a] to-[#ff7a3d] transition-[width_.3s_linear]" style={{ width: `${overallPct}%` }} />
        </div>
      </div>

      <SocialConnectBanner />

      {onCancel && current.status !== "failed" && !isTerminal(current) && (
        <div className="flex justify-end">
          <button
            onClick={() => {
              if (window.confirm("Are you sure you want to cancel processing? This cannot be undone.")) {
                onCancel();
              }
            }}
            className="rounded-[10px] border border-white/[.08] bg-white/[.03] px-4 py-2 text-[12px] font-semibold text-zinc-400 transition hover:border-red-500/30 hover:bg-red-500/[.07] hover:text-red-400"
          >
            Cancel processing
          </button>
        </div>
      )}

      <div className="flex gap-4 items-start">
      <div className="flex-1 space-y-2">
        {PROC_STEPS.map((step, i) => {
          const done = overallPct === 100 ? true : i < stepIdx;
          const active = !done && i === stepIdx;
          const state = done ? "done" : active ? "active" : "wait";
          return (
            <div key={step.keys[0]} 
              role="status"
              aria-label={`${step.label}: ${state === "done" ? "Completed" : state === "active" ? "In progress" : "Waiting"}`}
              className={cn(
              "flex items-start gap-3.5 rounded-[11px] border p-3.5 transition",
              state === "done"   ? "border-white/[.05] bg-white/[.015] opacity-70"
            : state === "active" ? "border-[#ff3d6a]/20 bg-[#ff3d6a]/[.04]"
            : "border-white/[.04] bg-transparent opacity-40"
            )}>
              <div className={cn(
                "mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-[8px] border text-sm",
                state === "done"   ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-300"
              : state === "active" ? "border-[#ff3d6a]/25 bg-[#ff3d6a]/10"
              : "border-white/[.07] bg-white/[.03] text-zinc-600"
              )}>
                {state === "done"   ? "✓"
               : state === "active" ? <span className="block h-4 w-4 rounded-full border-2 border-[#ff3d6a] border-t-transparent animate-spin" />
               : <span className="opacity-50">{step.emoji}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className={cn("text-[13px] font-semibold", state === "done" ? "text-zinc-400" : state === "active" ? "text-white" : "text-zinc-600")}>{step.label}</div>
                <div className="mt-0.5 text-[11.5px] text-zinc-500">{state === "done" ? "Completed" : state === "active" && step.keys.includes("queued") ? `Queued for ${queuedFor}` : step.sub}</div>
                {state === "active" && liveMsg && (
                  <div className="mt-1.5 text-[11px] text-zinc-400 leading-snug">{liveMsg}</div>
                )}
                {state === "active" && !liveMsg && current.pipeline_step && (
                  <div className="mt-1 text-[10.5px] font-mono text-zinc-600">{current.pipeline_step}</div>
                )}
              </div>
              {state === "done" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Done
                </span>
              )}
              {state === "active" && (
                <span 
                  role="progressbar"
                  aria-valuenow={overallPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="inline-flex items-center gap-1 rounded-full border border-yellow-300/20 bg-yellow-400/10 px-2 py-0.5 text-[10px] font-semibold text-yellow-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-yellow-300" />{overallPct}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Live SSE event feed */}
      {liveEvents.length > 0 && (
      <div className="w-72 shrink-0">
        <div className="overflow-hidden rounded-[12px] border border-white/[.07] bg-[#0a0f1a]">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-white/[.06] px-3.5 py-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ff3d6a] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#ff3d6a]" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-zinc-500">Live</span>
          </div>

          {/* Events list */}
          <div className="divide-y divide-white/[.04]">
            {liveEvents.map((ev) => {
              const stepColor = ev.kind === "clip_ready" ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-300"
                : ev.kind === "clips_ready" ? "border-[#ff3d6a]/20 bg-[#ff3d6a]/10 text-[#ff3d6a]"
                : ev.step ? (STEP_COLORS[ev.step] ?? "border-white/[.07] bg-white/[.04] text-zinc-400")
                : "border-white/[.07] bg-white/[.03] text-zinc-500";
              const icon = ev.kind === "clip_ready" ? "✓"
                : ev.kind === "clips_ready" ? "✦"
                : ev.step ? (STEP_ICONS[ev.step] ?? "›") : "›";
              const elapsed = Math.round((Date.now() - ev.ts) / 1000);
              return (
                <div
                  key={ev.id}
                  className="flex items-start gap-3 px-3.5 py-2.5"
                  style={{ animation: "fadeUp .2s ease" }}
                >
                  {/* Icon or thumbnail */}
                  {ev.thumbnail ? (
                    <img src={ev.thumbnail} alt="" className="h-8 w-[46px] flex-none rounded-[5px] object-cover" />
                  ) : (
                    <div className={cn("mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-[5px] border text-[10px]", stepColor)}>
                      {icon}
                    </div>
                  )}

                  {/* Label + sub */}
                  <div className="min-w-0 flex-1">
                    <div className={cn(
                      "text-[11.5px] leading-snug",
                      ev.kind === "clip_ready" ? "font-medium text-emerald-300"
                      : ev.kind === "clips_ready" ? "font-semibold text-white"
                      : "text-zinc-300"
                    )}>
                      {ev.label}
                    </div>
                    {ev.sub && <div className="mt-0.5 text-[10.5px] text-zinc-500">{ev.sub}</div>}
                  </div>

                  {/* Right: pct badge + time */}
                  <div className="flex flex-none flex-col items-end gap-1">
                    {ev.pct != null && (
                      <span className="rounded-[4px] bg-white/[.05] px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
                        {ev.pct}%
                      </span>
                    )}
                    <span className="font-mono text-[9.5px] text-zinc-700">
                      {elapsed < 5 ? "just now" : `${elapsed}s ago`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}
      </div>
    </div>
  );
}

/* ─── Clip detail modal ─── */
const DETAIL_PLAT_CFG: Record<string, { color: string; icon: string }> = {
  youtube:{color:"#FF0000",icon:"▶"},shorts:{color:"#FF0000",icon:"▶"},
  tiktok:{color:"#69C9D0",icon:"♪"},reels:{color:"#E1306C",icon:"◈"},
  instagram:{color:"#E1306C",icon:"◈"},twitter:{color:"#1DA1F2",icon:"𝕏"},
  facebook:{color:"#1877F2",icon:"f"},linkedin:{color:"#0A66C2",icon:"in"},
};

type DetailTab = "info" | "copy" | "assets";

function ClipDetailModal({ clip, isPosted, isScheduled, posts = [], onClose, onPublish }: {
  clip: ClipApiResponse;
  isPosted?: boolean;
  isScheduled?: boolean;
  posts?: ScheduledPost[];
  onClose: () => void;
  onPublish?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(clip.duration_ms ? clip.duration_ms / 1000 : 0);
  const [tab, setTab] = useState<DetailTab>("info");
  const [activePlatIdx, setActivePlatIdx] = useState(0);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    const onTime = () => { setCurrentTime(v.currentTime); setProgress(v.duration ? v.currentTime / v.duration : 0); };
    const onMeta = () => setDuration(v.duration);
    const onEnd = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime); v.addEventListener("loadedmetadata", onMeta); v.addEventListener("ended", onEnd);
    return () => { v.removeEventListener("timeupdate", onTime); v.removeEventListener("loadedmetadata", onMeta); v.removeEventListener("ended", onEnd); };
  }, []);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  const togglePlay = () => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  };
  const seekFromEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
    const v = videoRef.current;
    if (!barRef.current || !v || !v.duration) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = ratio * v.duration; setProgress(ratio);
  }, []);
  const onBarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); seekFromEvent(e);
    const onMove = (ev: MouseEvent) => seekFromEvent(ev);
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };

  const platformKey = clip.platform ?? "shorts";
  const platformContent = clip.clip_metadata?.platforms?.[platformKey] ?? null;
  const allPlatformEntries = Object.entries(clip.clip_metadata?.platforms ?? {});
  const primaryDescription = platformContent?.description ?? clip.clip_metadata?.ai_title ?? clip.title ?? "";
  const primaryTags = platformContent?.tags ?? [];
  const scoreValue = clip.score ?? 0;
  const scoreColor = scoreValue >= 7 ? "#34d399" : scoreValue >= 4 ? "#fbbf24" : "#f87171";
  const scorePct = Math.min(100, Math.round(scoreValue * 10));
  const clipStart = clip.start_ms != null ? fmt(clip.start_ms / 1000) : "--:--";
  const clipEnd = clip.end_ms != null ? fmt(clip.end_ms / 1000) : "--:--";
  const durMs = clip.duration_ms ?? 0;
  const cleanCaptionPreview = clip.caption_srt
    ? clip.caption_srt.split("\n").filter((l) => l && !/^\d+$/.test(l) && !l.includes("-->")).join(" ").replace(/\s+/g, " ").slice(0, 320)
    : "";
  const captionLineCount = clip.caption_srt ? clip.caption_srt.split(/\n\n+/).filter(Boolean).length : 0;

  const activePlat = allPlatformEntries[activePlatIdx];
  const activePlatContent = activePlat?.[1] as { description: string; tags: string[] } | undefined;
  const activePlatCfg = activePlat ? (DETAIL_PLAT_CFG[activePlat[0].toLowerCase()] ?? { color: "#ff3d6a", icon: "↗" }) : null;

  const TABS: { id: DetailTab; label: string; count?: number }[] = [
    { id: "info", label: "Info" },
    { id: "copy", label: "Copy", count: allPlatformEntries.length },
    { id: "assets", label: "Assets", count: posts.length > 0 ? posts.length : undefined },
  ];

  return (
    <div
      className="fixed inset-0 z-[500] grid place-items-center p-3 sm:p-5"
      style={{ background: "rgba(3,6,14,.82)", backdropFilter: "blur(12px)", animation: "fadeUp .14s ease" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Shell: 2-col grid, fixed height */}
      <div
        className="w-full overflow-hidden rounded-[22px] border border-white/[.09] bg-[#090d16] shadow-[0_48px_120px_rgba(0,0,0,.85)]"
        style={{
          maxWidth: 860,
          height: "min(88vh, 580px)",
          display: "grid",
          gridTemplateColumns: "300px 1fr",
          gridTemplateRows: "1fr",
          animation: "fadeUp .22s cubic-bezier(.22,.8,.4,1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Left: video player ── */}
        <div className="flex items-center justify-center border-r border-white/[.06] bg-black overflow-hidden">
          {/* video fills full left column height */}
          <div
            className="relative h-full w-full overflow-hidden"
          >
            {clip.storage_url
              ? <video ref={videoRef} src={clip.storage_url} className="absolute inset-0 h-full w-full object-cover" playsInline preload="metadata" poster={clip.thumbnail_url ?? undefined} />
              : clip.thumbnail_url
              ? <img src={clip.thumbnail_url} alt={clip.title ?? "clip"} className="absolute inset-0 h-full w-full object-cover" />
              : <div className="absolute inset-0 bg-gradient-to-b from-rose-700/50 to-violet-900/60" />}

            {/* gradient overlay */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />

            {/* social sidebar */}
            <div className="absolute right-1.5 bottom-16 z-10 flex flex-col items-center gap-2.5">
              {([["👍","4.2K"],["💬","312"],["↗","1.1K"]] as [string,string][]).map(([icon, val], i) => (
                <div key={i} className="flex flex-col items-center gap-0.5">
                  <div className="grid h-7 w-7 place-items-center rounded-full bg-white/15 text-xs backdrop-blur-md">{icon}</div>
                  <span className="text-[7px] font-bold text-white/80">{val}</span>
                </div>
              ))}
            </div>

            {/* caption overlay */}
            <div className="absolute bottom-8 left-2 right-9 z-10">
              <p className="text-[7.5px] font-bold text-white/90 drop-shadow">@viralo</p>
              {primaryDescription && <p className="mt-0.5 line-clamp-2 text-[7px] leading-[1.35] text-white/80 drop-shadow">{primaryDescription}</p>}
              {primaryTags.length > 0 && (
                <div className="mt-0.5 flex flex-wrap gap-0.5">
                  {primaryTags.slice(0, 3).map((t) => <span key={t} className="text-[6.5px] font-bold text-[#ff6b8a] drop-shadow">#{t}</span>)}
                </div>
              )}
            </div>

            {/* play button */}
            <button className="absolute inset-0 z-20 flex items-center justify-center cursor-pointer" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              {!playing && (
                <div className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white shadow-[0_4px_20px_rgba(0,0,0,.6)] backdrop-blur-sm transition hover:scale-105">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </div>
              )}
            </button>

            {/* seek bar */}
            <div className="absolute bottom-0 left-0 right-0 z-30 px-2 pb-1.5">
              <div className="flex items-center gap-1">
                <span className="font-mono text-[6.5px] text-white/60">{fmt(currentTime)}</span>
                <div ref={barRef} className="relative h-[3px] flex-1 cursor-pointer rounded-full bg-white/25" onMouseDown={onBarMouseDown}>
                  <div className="h-full rounded-full bg-white" style={{ width: `${progress * 100}%` }} />
                  <div className="absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-white shadow" style={{ left: `calc(${progress * 100}% - 5px)` }} />
                </div>
                <span className="font-mono text-[6.5px] text-white/60">{fmt(duration)}</span>
              </div>
            </div>

            {/* status badge */}
            {(isPosted || isScheduled) && (
              <div className={cn("absolute left-2 top-2 z-20 flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold text-white backdrop-blur-sm", isPosted ? "bg-amber-500/90" : "bg-blue-500/80")}>
                <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>{isPosted ? <path d="M20 6 9 17l-5-5"/> : <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>}</svg>
                {isPosted ? "Live" : "Queued"}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: header + tabs + content + footer ── */}
        <div className="flex min-w-0 flex-col overflow-hidden">
          {/* Header */}
          <div className="flex shrink-0 items-start gap-3 border-b border-white/[.06] bg-white/[.015] px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[16px] font-bold leading-tight tracking-[-0.01em] text-white">
                {clip.clip_metadata?.ai_title ?? clip.title ?? "Untitled clip"}
              </h2>
              {primaryDescription && (
                <p className="mt-0.5 line-clamp-1 text-[12px] text-zinc-500">{primaryDescription}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                clip.status === "ready" ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-white/[.07] text-zinc-500"
              )}>{clip.status}</span>
              <button
                onClick={onClose}
                aria-label="Close"
                className="grid h-7 w-7 place-items-center rounded-full border border-white/[.08] text-zinc-500 transition hover:border-white/[.15] hover:text-white cursor-pointer"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex shrink-0 items-center gap-1 border-b border-white/[.06] px-4 py-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-semibold transition cursor-pointer",
                  tab === t.id
                    ? "bg-white/[.07] text-white"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {t.label}
                {t.count != null && t.count > 0 && (
                  <span className={cn("rounded-full px-1.5 py-px text-[10px] font-bold", tab === t.id ? "bg-[#ff3d6a]/20 text-[#ff6a8a]" : "bg-white/[.04] text-zinc-600")}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content — fills remaining space, no overflow */}
          <div className="min-h-0 flex-1 overflow-hidden">

            {/* ── INFO tab ── */}
            {tab === "info" && (
              <div className="flex h-full flex-col gap-3 p-4">
                {/* Score + Duration */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-[12px] border border-white/[.06] bg-white/[.025] p-3">
                    <p className="text-[9px] font-bold uppercase tracking-[.13em] text-zinc-600">Score</p>
                    <div className="mt-2 flex items-end gap-2">
                      <span className="font-mono text-[26px] font-black leading-none" style={{ color: scoreColor }}>
                        {clip.score != null ? clip.score.toFixed(1) : "--"}
                      </span>
                      <div className="mb-1 h-1.5 flex-1 overflow-hidden rounded-full bg-white/[.06]">
                        <div className="h-full rounded-full transition-all" style={{ width: `${scorePct}%`, background: scoreColor }} />
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-white/[.06] bg-white/[.025] p-3">
                    <p className="text-[9px] font-bold uppercase tracking-[.13em] text-zinc-600">Duration</p>
                    <p className="mt-2 font-mono text-[26px] font-black leading-none text-white">{fmt(durMs / 1000)}</p>
                  </div>
                </div>

                {/* 4-cell meta */}
                <div className="grid grid-cols-2 gap-2">
                  {([["Platform", clip.platform ?? "—"], ["Format", "9:16"], ["Timeline", `${clipStart}–${clipEnd}`], ["Created", new Date(clip.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })]] as [string,string][]).map(([label, value]) => (
                    <div key={label} className="rounded-[10px] border border-white/[.05] bg-white/[.018] px-3 py-2">
                      <p className="text-[9px] font-bold uppercase tracking-[.1em] text-zinc-600">{label}</p>
                      <p className="mt-0.5 truncate text-[13px] font-semibold text-zinc-200 capitalize">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Primary hashtags */}
                {primaryTags.length > 0 && (
                  <div className="min-h-0 flex-1 rounded-[12px] border border-white/[.06] bg-white/[.018] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[9px] font-bold uppercase tracking-[.13em] text-zinc-600">Primary hashtags</p>
                      <span className="text-[10px] text-zinc-600">{primaryTags.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {primaryTags.map((tag) => (
                        <span key={tag} className="rounded-full border border-[#ff3d6a]/20 bg-[#ff3d6a]/[.08] px-2.5 py-1 text-[11px] font-semibold text-rose-300">#{tag}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Posts status (if any) */}
                {posts.length > 0 && (
                  <div className="shrink-0 flex flex-wrap gap-1.5">
                    {posts.slice(0, 4).map((p) => {
                      const pcfg = DETAIL_PLAT_CFG[p.platform?.toLowerCase() ?? ""] ?? { color: "#ff3d6a", icon: "↗" };
                      const isLive = p.status === "posted";
                      const isQ = ["scheduled","pending","processing"].includes(p.status);
                      return (
                        <span key={p.id} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                          style={{ borderColor: `${pcfg.color}30`, background: `${pcfg.color}10`, color: pcfg.color }}>
                          <span>{pcfg.icon}</span>
                          <span className="capitalize">{p.platform}</span>
                          {isLive && <span className="text-amber-400">✓</span>}
                          {isQ && <span className="text-blue-400">⏱</span>}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── COPY tab ── */}
            {tab === "copy" && (
              <div className="flex h-full flex-col overflow-hidden">
                {allPlatformEntries.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">No platform copy generated yet.</div>
                ) : (
                  <>
                    {/* Platform pill selector */}
                    <div className="shrink-0 flex gap-1.5 overflow-x-auto px-4 py-3 [scrollbar-width:none]">
                      {allPlatformEntries.map(([plat], i) => {
                        const pcfg = DETAIL_PLAT_CFG[plat.toLowerCase()] ?? { color: "#ff3d6a", icon: "↗" };
                        return (
                          <button
                            key={plat}
                            onClick={() => setActivePlatIdx(i)}
                            className={cn(
                              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition cursor-pointer whitespace-nowrap",
                              activePlatIdx === i
                                ? "border-transparent text-white"
                                : "border-white/[.07] bg-transparent text-zinc-500 hover:text-zinc-300"
                            )}
                            style={activePlatIdx === i ? { background: `${pcfg.color}20`, borderColor: `${pcfg.color}40`, color: pcfg.color } : {}}
                          >
                            <span className="grid h-4 w-4 place-items-center rounded-[3px] text-[9px] font-black text-white" style={{ background: pcfg.color }}>{pcfg.icon}</span>
                            <span className="capitalize">{plat}</span>
                            <span className="rounded-full bg-white/[.06] px-1 text-[10px] text-zinc-600">{(allPlatformEntries[i][1] as { tags: string[] }).tags?.length ?? 0}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Content for selected platform */}
                    {activePlatContent && activePlatCfg && (
                      <div className="flex flex-1 flex-col gap-3 overflow-hidden px-4 pb-4">
                        {/* Description */}
                        <div className="rounded-[12px] border border-white/[.06] bg-white/[.018] p-3.5">
                          <p className="mb-2 text-[9px] font-bold uppercase tracking-[.13em] text-zinc-600">Description</p>
                          <p className="text-[13px] leading-[1.6] text-zinc-200">{activePlatContent.description}</p>
                        </div>

                        {/* Tags */}
                        {activePlatContent.tags?.length > 0 && (
                          <div className="rounded-[12px] border border-white/[.06] bg-white/[.018] p-3.5">
                            <p className="mb-2 text-[9px] font-bold uppercase tracking-[.13em] text-zinc-600">Tags · {activePlatContent.tags.length}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {activePlatContent.tags.map((tag) => (
                                <span key={tag} className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                                  style={{ borderColor: `${activePlatCfg.color}35`, background: `${activePlatCfg.color}12`, color: activePlatCfg.color }}>
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── ASSETS tab ── */}
            {tab === "assets" && (
              <div className="flex h-full flex-col gap-3 overflow-hidden p-4">
                {/* Caption preview */}
                {cleanCaptionPreview && (
                  <div className="rounded-[12px] border border-white/[.06] bg-white/[.018] p-3.5">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[9px] font-bold uppercase tracking-[.13em] text-zinc-600">Transcript preview</p>
                      {captionLineCount > 0 && <span className="text-[10px] text-zinc-600">{captionLineCount} captions</span>}
                    </div>
                    <p className="line-clamp-4 text-[12px] leading-[1.6] text-zinc-400">{cleanCaptionPreview}…</p>
                  </div>
                )}

                {/* Quick links */}
                <div className="grid grid-cols-2 gap-2">
                  {clip.storage_url && (
                    <a href={clip.storage_url} target="_blank" rel="noreferrer"
                      className="flex items-center justify-center gap-2 rounded-[10px] border border-white/[.07] bg-white/[.025] py-3 text-[12px] font-semibold text-zinc-300 transition hover:border-white/[.12] hover:bg-white/[.04] hover:text-white cursor-pointer">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                      Open video
                    </a>
                  )}
                  {clip.thumbnail_url && (
                    <a href={clip.thumbnail_url} target="_blank" rel="noreferrer"
                      className="flex items-center justify-center gap-2 rounded-[10px] border border-white/[.07] bg-white/[.025] py-3 text-[12px] font-semibold text-zinc-300 transition hover:border-white/[.12] hover:bg-white/[.04] hover:text-white cursor-pointer">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                      Thumbnail
                    </a>
                  )}
                </div>

                {/* Published posts in assets tab */}
                {posts.length > 0 && (
                  <div className="rounded-[12px] border border-white/[.06] bg-white/[.018] p-3.5">
                    <p className="mb-2.5 text-[9px] font-bold uppercase tracking-[.13em] text-zinc-600">Published / Scheduled</p>
                    <div className="space-y-2">
                      {posts.map((p) => {
                        const pcfg = DETAIL_PLAT_CFG[p.platform?.toLowerCase() ?? ""] ?? { color: "#ff3d6a", icon: "↗" };
                        const isLive = p.status === "posted", isQ = ["scheduled","pending","processing"].includes(p.status), isFail = p.status === "failed";
                        return (
                          <div key={p.id} className="flex items-center gap-2.5 rounded-[9px] border px-2.5 py-2"
                            style={{ borderColor: isLive ? "rgba(52,211,153,.2)" : isQ ? "rgba(96,165,250,.18)" : isFail ? "rgba(248,113,113,.18)" : "rgba(255,255,255,.06)", background: isLive ? "rgba(52,211,153,.04)" : isQ ? "rgba(96,165,250,.04)" : "rgba(255,255,255,.01)" }}>
                            <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-black text-white" style={{ background: pcfg.color }}>{pcfg.icon}</div>
                            <span className="flex-1 text-[12px] font-semibold capitalize" style={{ color: pcfg.color }}>{p.platform}</span>
                            {isLive && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">✓ Live</span>}
                            {isQ && <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-bold text-blue-400">Queued</span>}
                            {isFail && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400">Failed</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* IDs */}
                <div className="mt-auto space-y-1 text-[9px] text-zinc-700">
                  <p className="truncate font-mono">Clip · {clip.id}</p>
                  <p className="truncate font-mono">Video · {clip.video_id}</p>
                </div>
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="shrink-0 border-t border-white/[.06] bg-white/[.01] px-4 py-3">
            <div className="flex items-center gap-2">
              <button
                className="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-[#ff3d6a] py-2.5 text-[13px] font-semibold text-white shadow-[0_2px_16px_rgba(255,61,106,.3)] transition hover:bg-[#e8304f] hover:shadow-[0_4px_24px_rgba(255,61,106,.4)] cursor-pointer"
                onClick={() => { onPublish?.(); onClose(); }}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
                {isPosted ? "Publish again" : isScheduled ? "Reschedule" : "Publish"}
              </button>
              <button
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-white/[.07] bg-white/[.025] text-zinc-400 transition hover:border-white/[.12] hover:bg-white/[.04] hover:text-white cursor-pointer"
                aria-label="Edit clip"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-white/[.07] bg-white/[.025] text-zinc-400 transition hover:border-white/[.12] hover:bg-white/[.04] hover:text-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={!clip.storage_url}
                aria-label="Download"
                onClick={() => { if (clip.storage_url) void downloadUrl(clip.storage_url, safeFilename(clip.title, "mp4")); }}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Clip card ─── */
function ClipCard({ clip, idx, selected = false, onToggleSelect, isPosted = false, isScheduled = false, posts = [], onOpen }: {
  clip: ClipApiResponse;
  idx: number;
  selected?: boolean;
  onToggleSelect?: () => void;
  isPosted?: boolean;
  isScheduled?: boolean;
  posts?: ScheduledPost[];
  onOpen?: () => void;
}) {
  const [showEditor,     setShowEditor]     = useState(false);
  const [showDl,         setShowDl]         = useState(false);
  const [showPublish,    setShowPublish]    = useState(false);
  const [regenerating,   setRegenerating]   = useState(false);
  const [localClip,      setLocalClip]      = useState(clip);

  const durMs = localClip.duration_ms ?? ((localClip.end_ms ?? 0) - (localClip.start_ms ?? 0));
  const startSec = (localClip.start_ms ?? 0) / 1000;
  const endSec = (localClip.end_ms ?? durMs) / 1000;

  const handleRegen = () => {
    setRegenerating(true);
    setTimeout(() => setRegenerating(false), 2200);
  };

  const actions: Array<{
    id: ClipCardAction;
    label?: string;
    icon?: string;
    primary?: boolean;
    disabled?: boolean;
    onClick?: (clip: ClipApiResponse) => void;
  }> = [
    { id: "publish", label: "Publish", icon: "↗", primary: true, onClick: () => setShowPublish(true) },
    { id: "trim", label: "Trim", icon: "✂", onClick: () => setShowEditor(true) },
    { id: "edit", label: "Edit", icon: "✎", onClick: () => setShowEditor(true) },
    ...(localClip.caption_srt ? [{ id: "transcript" as ClipCardAction, label: "Transcript", icon: "☷" }] : []),
    { id: "regenerate", label: regenerating ? "Regenerating" : "Regenerate", icon: "✦", disabled: regenerating, onClick: handleRegen },
    { id: "download", label: "Download", icon: "↓", onClick: () => setShowDl(true) },
  ];

  return (
    <>
      <div className="relative">
        <UniversalClipCard
          clip={localClip}
          delay={idx * 60}
          selected={selected}
          selectable={Boolean(onToggleSelect)}
          onSelect={() => onToggleSelect?.()}
          onClick={() => onOpen?.()}
          actions={actions}
          density="compact"
          isPosted={isPosted}
          isScheduled={isScheduled}
          posts={posts}
        />
        {regenerating && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-[16px] bg-black/45 backdrop-blur-[1px]">
            <span className="block h-10 w-10 rounded-full border-[3px] border-white/20 border-t-white animate-spin" />
          </div>
        )}
        {showDl && <DownloadMenu clip={localClip} onClose={() => setShowDl(false)} />}
      </div>

      {showEditor && (
        <TimelineEditor
          clip={{ id: localClip.id, title: localClip.title, startSec, endSec, storage_url: localClip.storage_url }}
          totalDur={Math.max(endSec + 60, 600)}
          onClose={() => setShowEditor(false)}
          onSave={(c) => setLocalClip((prev) => ({
            ...prev,
            start_ms: c.startSec * 1000,
            end_ms: c.endSec * 1000,
            duration_ms: (c.endSec - c.startSec) * 1000,
          }))}
        />
      )}

      {showPublish && (
        <BulkPublishModal
          clips={[localClip]}
          onClose={() => setShowPublish(false)}
        />
      )}
    </>
  );
}

const REGEN_OPTS = [
  { id:"hook",        label:"Optimize hooks"    },
  { id:"top-moments", label:"More top moments"  },
  { id:"captions",    label:"Recaption"          },
  { id:"short",       label:"Shorten to 30s"    },
  { id:"vertical",    label:"Reformat vertical" },
];

/* ─── Bulk publish modal ─── */
function BulkPublishModal({ clips, onClose }: { clips: ClipApiResponse[]; onClose: () => void }) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [groups, setGroups] = useState<Array<{ id: string; clipIds: string[]; accountId: string; scheduledAt: string }>>(() => {
    const base = new Date(Date.now() + 60 * 60 * 1000);
    const localIso = new Date(base.getTime() - base.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    return [{ id: crypto.randomUUID(), clipIds: clips.map((c) => c.id), accountId: "", scheduledAt: localIso }];
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    platformApi.listAccounts()
      .then((accs) => {
        const active = accs.filter((a) => a.is_active);
        setAccounts(active);
        setGroups((prev) => prev.map((g) => ({ ...g, accountId: active[0]?.id ?? "" })));
      })
      .catch(() => setAccounts([]))
      .finally(() => setLoadingAccounts(false));
  }, []);

  const addGroup = () => {
    const last = groups[groups.length - 1];
    const nextTime = new Date(new Date(last.scheduledAt).getTime() + 2 * 60 * 60 * 1000);
    const localIso = new Date(nextTime.getTime() - nextTime.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setGroups((prev) => [...prev, { id: crypto.randomUUID(), clipIds: [], accountId: accounts[0]?.id ?? "", scheduledAt: localIso }]);
  };

  const removeGroup = (gid: string) => setGroups((prev) => prev.filter((g) => g.id !== gid));

  const toggleClipInGroup = (gid: string, clipId: string) => {
    setGroups((prev) => prev.map((g) => {
      if (g.id !== gid) return g;
      return { ...g, clipIds: g.clipIds.includes(clipId) ? g.clipIds.filter((id) => id !== clipId) : [...g.clipIds, clipId] };
    }));
  };

  const updateGroup = (gid: string, patch: Partial<typeof groups[0]>) =>
    setGroups((prev) => prev.map((g) => g.id === gid ? { ...g, ...patch } : g));

  const BULK_KEY_MAP: Record<string, string> = {
    instagram: "reels", reels: "reels", tiktok: "tiktok", tt: "tiktok",
    shorts: "shorts", youtube: "youtube", yt: "youtube",
    twitter: "twitter", tw: "twitter", facebook: "facebook",
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      for (const g of groups) {
        const account = accounts.find((a) => a.id === g.accountId);
        if (!account || g.clipIds.length === 0) continue;
        const platformKey = BULK_KEY_MAP[account.platform.toLowerCase()] ?? account.platform.toLowerCase();
        for (const clipId of g.clipIds) {
          const clip = clips.find((c) => c.id === clipId);
          const content = clip?.clip_metadata?.platforms?.[platformKey];
          const caption = content?.description ?? clip?.clip_metadata?.ai_title ?? clip?.title ?? undefined;
          const hashtags = content?.tags ?? undefined;
          await platformApi.schedulePost({
            clip_id: clipId,
            social_account_id: g.accountId,
            platform: account.platform,
            scheduled_at: new Date(g.scheduledAt).toISOString(),
            caption,
            hashtags,
          });
        }
      }
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const totalScheduled = groups.reduce((n, g) => n + g.clipIds.length, 0);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{ background: "rgba(4,7,15,.85)", backdropFilter: "blur(6px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex w-full max-w-[560px] flex-col rounded-[20px] border border-white/[.1] bg-[#0e1420] shadow-[0_40px_100px_rgba(0,0,0,.7)]"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/[.07] px-5 py-4 shrink-0">
          <div className="grid h-10 w-10 place-items-center rounded-[12px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-[#ff3d6a] text-lg font-black">↗</div>
          <div>
            <h3 className="font-display text-[16px] font-bold">Bulk Schedule</h3>
            <p className="text-[11.5px] text-zinc-500">Assign clips to time slots across accounts</p>
          </div>
          <button onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-[7px] border border-white/[.08] text-zinc-500 hover:text-white transition">✕</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-4">
          {success ? (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-green-500/10 text-3xl">✓</div>
              <p className="font-display text-lg font-bold text-white">Scheduled!</p>
              <p className="text-sm text-zinc-500">{totalScheduled} clip{totalScheduled !== 1 ? "s" : ""} queued for publishing.</p>
            </div>
          ) : loadingAccounts ? (
            <div className="space-y-3">{[1,2].map((i) => <div key={i} className="h-28 animate-pulse rounded-[12px] bg-white/[.04]" />)}</div>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-[12px] border border-[#ff3d6a]/20 bg-[#ff3d6a]/5 px-4 py-8 text-center">
              <div className="grid h-10 w-10 place-items-center rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-lg">⚡</div>
              <p className="text-sm font-semibold text-white">No social accounts connected</p>
              <a href="/integrations" className="rounded-[9px] bg-[#ff3d6a] px-4 py-2 text-xs font-semibold text-white hover:bg-[#ff3d6a]/85 transition">Connect social media →</a>
            </div>
          ) : (
            <>
              {groups.map((g, gi) => {
                const slotAccount = accounts.find((a) => a.id === g.accountId);
                const slotPlatform = slotAccount?.platform?.toLowerCase() ?? "";
                const slotKey = ({ instagram:"reels", reels:"reels", tiktok:"tiktok", tt:"tiktok", shorts:"shorts", youtube:"youtube", yt:"youtube", twitter:"twitter", tw:"twitter", facebook:"facebook" } as Record<string,string>)[slotPlatform] ?? slotPlatform;
                const slotCfg = ({ youtube:{color:"#FF0000",icon:"▶",label:"YouTube"}, shorts:{color:"#FF0000",icon:"▶",label:"Shorts"}, tiktok:{color:"#69C9D0",icon:"♪",label:"TikTok"}, reels:{color:"#E1306C",icon:"◈",label:"Reels"}, instagram:{color:"#E1306C",icon:"◈",label:"Instagram"}, twitter:{color:"#1DA1F2",icon:"𝕏",label:"Twitter"}, facebook:{color:"#1877F2",icon:"f",label:"Facebook"} } as Record<string,{color:string;icon:string;label:string}>)[slotKey] ?? {color:"#ff3d6a",icon:"↗",label:"Platform"};

                return (
                  <div key={g.id} className="overflow-hidden rounded-[14px] border bg-[#0a0f1a]" style={{ borderColor: `${slotCfg.color}40` }}>
                    {/* Slot header strip */}
                    <div className="flex items-center gap-2.5 px-4 py-2.5" style={{ background: `${slotCfg.color}12`, borderBottom: `1px solid ${slotCfg.color}25` }}>
                      <div className="grid h-6 w-6 place-items-center rounded-full text-[11px] font-black text-white" style={{ background: slotCfg.color }}>{slotCfg.icon}</div>
                      <span className="text-[12px] font-bold" style={{ color: slotCfg.color }}>{slotCfg.label}</span>
                      <span className="text-[11px] font-semibold text-zinc-500">· Slot {gi + 1}</span>
                      {groups.length > 1 && (
                        <button onClick={() => removeGroup(g.id)} className="ml-auto text-[11px] text-zinc-600 hover:text-red-400 transition">Remove</button>
                      )}
                    </div>

                    <div className="p-4 space-y-3">
                      {/* Account + time */}
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[.08em] text-zinc-500">Account</label>
                          <select value={g.accountId} onChange={(e) => updateGroup(g.id, { accountId: e.target.value })}
                            className="w-full rounded-[9px] border bg-[#111827] px-2.5 py-2 text-[12px] text-white focus:outline-none transition"
                            style={{ borderColor: `${slotCfg.color}40` }}>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.platform.charAt(0).toUpperCase() + a.platform.slice(1)} — @{a.platform_username ?? "?"}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[.08em] text-zinc-500">Scheduled at</label>
                          <input type="datetime-local" value={g.scheduledAt}
                            onChange={(e) => updateGroup(g.id, { scheduledAt: e.target.value })}
                            className="w-full rounded-[9px] border border-white/[.08] bg-[#111827] px-2.5 py-2 text-[12px] text-white focus:outline-none [color-scheme:dark]" />
                        </div>
                      </div>

                      {/* Clip chips */}
                      <div>
                        <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[.08em] text-zinc-500">Clips ({g.clipIds.length})</label>
                        <div className="flex flex-wrap gap-1.5">
                          {clips.map((c) => (
                            <button key={c.id} onClick={() => toggleClipInGroup(g.id, c.id)}
                              className="rounded-[8px] border px-2.5 py-1.5 text-[11px] font-semibold transition"
                              style={g.clipIds.includes(c.id)
                                ? { borderColor: `${slotCfg.color}50`, background: `${slotCfg.color}15`, color: slotCfg.color }
                                : { borderColor: "rgba(255,255,255,.07)", background: "rgba(255,255,255,.03)", color: "#71717a" }
                              }>
                              {(c as any).clip_metadata?.ai_title ?? c.title ?? `Clip ${clips.indexOf(c) + 1}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <button onClick={addGroup}
                className="w-full rounded-[12px] border border-dashed border-white/[.1] py-3 text-[12px] font-semibold text-zinc-500 transition hover:border-white/20 hover:text-zinc-300">
                + Add time slot
              </button>

              {error && <p className="rounded-[8px] bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
            </>
          )}
        </div>

        {/* Footer */}
        {!success && accounts.length > 0 && (
          <div className="flex gap-3 border-t border-white/[.07] px-5 py-4 shrink-0">
            <button onClick={onClose} className="rounded-[10px] border border-white/[.08] bg-white/[.03] px-5 py-2.5 text-[13px] font-semibold text-zinc-300 hover:text-white transition">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={submitting || totalScheduled === 0}
              className="ml-auto flex items-center gap-2 rounded-[10px] bg-[#ff3d6a] px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-50 transition hover:bg-[#ff3d6a]/85">
              {submitting ? "Scheduling…" : `↗ Schedule ${totalScheduled} clip${totalScheduled !== 1 ? "s" : ""}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Inline retry button for header ─── */
function RetryVideoButton({ videoId, onRetried }: { videoId: string; onRetried: () => void }) {
  const [retrying, setRetrying] = useState(false);
  return (
    <button
      type="button"
      disabled={retrying}
      onClick={async () => {
        setRetrying(true);
        try { await videoApi.retry(videoId); onRetried(); }
        catch { setRetrying(false); }
      }}
      className="inline-flex items-center gap-1 rounded-full border border-red-400/30 bg-red-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-red-300 hover:bg-red-400/20 disabled:opacity-50 transition cursor-pointer"
    >
      {retrying ? "Retrying…" : "↻ Retry"}
    </button>
  );
}

/* ─── Failed error card ─── */
function FailedErrorCard({ errorMessage, videoId, onRetried }: { errorMessage: string; videoId: string; onRetried: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  type ErrorKind = { label: string; msg: string; hint: string };
  const kind: ErrorKind = (() => {
    if (/429|Too Many Requests/i.test(errorMessage))
      return { label: "Rate limited", msg: "YouTube throttled this request (HTTP 429).", hint: "Wait a few minutes before retrying — YouTube limits how often a server can fetch the same video." };
    if (/403|Forbidden/i.test(errorMessage))
      return { label: "Access denied", msg: "YouTube refused access to this video (HTTP 403).", hint: "The video may be age-restricted, region-locked, or require sign-in. Try a different video." };
    if (/unavailable|removed|private/i.test(errorMessage))
      return { label: "Unavailable", msg: "This video is unavailable or private.", hint: "Check that the link is correct and the video is publicly accessible." };
    const firstLine = errorMessage.split("\n")[0].replace(/^(ERROR|WARNING|CRITICAL):\s*/i, "");
    const msg = firstLine.length > 160 ? firstLine.slice(0, 160) + "…" : firstLine;
    return { label: "Processing error", msg, hint: "Expand the details below for the full error log." };
  })();

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await videoApi.retry(videoId);
      onRetried();
    } catch {
      setRetryError("Retry failed — check service logs or try again shortly.");
      setRetrying(false);
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-[540px]" style={{ animation: "fadeUp .2s cubic-bezier(.22,.8,.4,1)" }}>
      {/* Main card */}
      <div className="overflow-hidden rounded-[18px] border border-red-500/20 bg-[#0e1420]">
        {/* Top accent bar */}
        <div className="h-[3px] w-full bg-gradient-to-r from-red-500/80 via-red-400/60 to-transparent" />

        <div className="p-6">
          {/* Header row */}
          <div className="mb-5 flex items-start gap-4">
            {/* Icon */}
            <div className="mt-0.5 grid h-10 w-10 flex-none place-items-center rounded-[10px] border border-red-500/25 bg-red-500/10">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[13px] font-bold text-red-300">{kind.label}</span>
                <span className="rounded-full border border-red-400/20 bg-red-400/10 px-2 py-0.5 text-[10px] font-semibold text-red-400 uppercase tracking-wide">Failed</span>
              </div>
              <p className="text-[13px] font-medium text-zinc-200 leading-snug mb-2">{kind.msg}</p>
              <p className="text-[12px] text-zinc-500 leading-relaxed">{kind.hint}</p>
            </div>
          </div>

          {/* Retry error inline */}
          {retryError && (
            <div className="mb-4 flex items-center gap-2 rounded-[8px] border border-red-500/20 bg-red-500/[.06] px-3 py-2">
              <svg className="h-3.5 w-3.5 flex-none text-red-400" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7.25 4.75a.75.75 0 011.5 0v3.5a.75.75 0 01-1.5 0v-3.5zm.75 7a1 1 0 110-2 1 1 0 010 2z"/>
              </svg>
              <span className="text-[11.5px] text-red-400">{retryError}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="flex cursor-pointer items-center gap-2 rounded-[9px] bg-[#ff3d6a] px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-[0_2px_16px_rgba(255,61,106,.3)] transition-all hover:bg-[#ff3d6a]/85 hover:shadow-[0_4px_20px_rgba(255,61,106,.4)] active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {retrying
                ? <>
                    <span className="block h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Retrying…
                  </>
                : <>
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13.5 2.5A6.5 6.5 0 012.5 8M2.5 13.5A6.5 6.5 0 0113.5 8"/>
                      <polyline points="2.5,10.5 2.5,13.5 5.5,13.5"/>
                      <polyline points="13.5,2.5 13.5,5.5 10.5,5.5"/>
                    </svg>
                    Retry processing
                  </>
              }
            </button>

            <button
              onClick={() => setExpanded(v => !v)}
              className="flex cursor-pointer items-center gap-1.5 rounded-[9px] border border-white/[.08] bg-white/[.03] px-3.5 py-2.5 text-[12px] text-zinc-400 transition hover:border-white/[.12] hover:bg-white/[.06] hover:text-zinc-200"
            >
              <svg className={cn("h-3.5 w-3.5 transition-transform duration-150", expanded && "rotate-180")} viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 10.94L2.53 5.47a.75.75 0 011.06-1.06L8 8.88l4.41-4.47a.75.75 0 111.06 1.06L8 10.94z"/>
              </svg>
              {expanded ? "Hide details" : "Show details"}
            </button>
          </div>

          {/* Expandable log */}
          {expanded && (
            <div className="mt-4 overflow-hidden rounded-[10px] border border-white/[.07] bg-black/40">
              <div className="flex items-center gap-2 border-b border-white/[.06] px-3 py-2">
                <span className="h-2 w-2 rounded-full bg-red-400/70" />
                <span className="h-2 w-2 rounded-full bg-yellow-400/40" />
                <span className="h-2 w-2 rounded-full bg-white/10" />
                <span className="ml-2 text-[10.5px] font-mono text-zinc-600">error.log</span>
              </div>
              <pre className="max-h-[200px] overflow-auto p-4 text-[10.5px] font-mono leading-relaxed text-zinc-500 whitespace-pre-wrap">
                {errorMessage}
              </pre>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

/* ─── Results view ─── */
function ResultsView({
  video,
  clips,
  onBack,
}: {
  video: VideoResponse;
  clips: ClipApiResponse[];
  onBack: () => void;
}) {
  const grad = gradFromId(video.id);
  const [regenModal, setRegenModal] = useState(false);
  const [regenOpts, setRegenOpts] = useState(["hook","top-moments","captions"]);
  const toggleOpt = (id: string) => setRegenOpts((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkModal, setBulkModal] = useState(false);
  const [zipModal, setZipModal] = useState(false);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [publishFilter, setPublishFilter] = useState<"all" | "posted" | "queued" | "unposted">("all");
  const [detailClip, setDetailClip] = useState<ClipApiResponse | null>(null);
  const toggleSelect = (id: string) =>
    setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const selectAll = () => setSelected(new Set(clips.map((c) => c.id)));
  const clearSel = () => setSelected(new Set());

  useEffect(() => {
    platformApi.listPosts({ per_page: 200 })
      .then((r) => setPosts(Array.isArray(r.items) ? r.items : []))
      .catch(() => {});
  }, []);

  const postedClipIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of posts) { if (p.status === "posted" && p.clip_id) s.add(p.clip_id); }
    return s;
  }, [posts]);

  const scheduledClipIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of posts) {
      if (["scheduled","pending","processing"].includes(p.status) && p.clip_id) s.add(p.clip_id);
    }
    return s;
  }, [posts]);

  const postsByClipId = useMemo(() => {
    const map = new Map<string, ScheduledPost[]>();
    for (const p of posts) {
      if (!p.clip_id) continue;
      const list = map.get(p.clip_id) ?? [];
      list.push(p);
      map.set(p.clip_id, list);
    }
    return map;
  }, [posts]);

  const filteredClips = useMemo(() => {
    if (publishFilter === "all") return clips;
    return clips.filter((c) => {
      const isPosted = postedClipIds.has(c.id);
      const isQueued = scheduledClipIds.has(c.id);
      if (publishFilter === "posted") return isPosted;
      if (publishFilter === "queued") return isQueued;
      if (publishFilter === "unposted") return !isPosted && !isQueued;
      return true;
    });
  }, [clips, publishFilter, postedClipIds, scheduledClipIds]);

  const PUBLISH_FILTERS: { id: typeof publishFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "posted", label: "Posted" },
    { id: "queued", label: "Queued" },
    { id: "unposted", label: "Not posted" },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button onClick={onBack}
          className="flex items-center gap-1.5 rounded-[8px] border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-[12.5px] font-medium text-zinc-300 transition hover:bg-white/[.07] hover:text-white">
          ‹ Projects
        </button>
        <div className={cn("h-7 w-10 flex-none rounded-[6px] bg-gradient-to-br", grad)} />
        <h2 className="font-display text-[18px] font-bold">{video.title ?? "Untitled"}</h2>
        <span className="rounded-full border border-white/[.08] bg-white/[.04] px-2.5 py-0.5 text-[11px] font-semibold text-zinc-400">
          {clips.length} clips
        </span>
        {(video.status === "done" || video.status === "ready")
          ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Ready</span>
          : <><span className="inline-flex items-center gap-1 rounded-full border border-red-400/20 bg-red-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-red-400"><span className="h-1.5 w-1.5 rounded-full bg-red-400" />Failed</span>
            <RetryVideoButton videoId={video.id} onRetried={onBack} /></>}
        <div className="ml-auto flex shrink-0 gap-2">
          <button
            onClick={() => { selectAll(); setBulkModal(true); }}
            className="flex items-center gap-1.5 rounded-[8px] bg-[#ff3d6a] px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-[0_2px_12px_rgba(255,61,106,.3)] transition hover:bg-[#ff3d6a]/85"
          >
            ↗ Publish all
          </button>
          {video.source_type !== "ranking" && (
            <button onClick={() => setRegenModal(true)}
              className="flex items-center gap-1.5 rounded-[8px] border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-[12.5px] font-medium text-zinc-300 transition hover:text-white">
              ✦ Regenerate all
            </button>
          )}
          {video.source_type !== "ranking" && video.storage_url && (
            <button
              onClick={() => void downloadUrl(video.storage_url!, safeFilename(video.title, "mp4"))}
              className="flex items-center gap-1.5 rounded-[8px] border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-[12.5px] font-medium text-zinc-300 transition hover:bg-white/[.07] hover:text-white"
            >
              ↓ Source video
            </button>
          )}
          <button
            onClick={() => setZipModal(true)}
            className="flex items-center gap-1.5 rounded-[8px] bg-[#ff3d6a] px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-[0_2px_12px_rgba(255,61,106,.3)] transition hover:bg-[#ff3d6a]/85">
            ↓ Download all
          </button>
        </div>
      </div>
      {selected.size > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-[10px] border border-[#ff3d6a]/20 bg-[#ff3d6a]/5 px-4 py-2.5">
          <span className="text-[12.5px] font-semibold text-rose-300">{selected.size} clip{selected.size > 1 ? "s" : ""} selected</span>
          <button onClick={clearSel} className="text-[11.5px] text-zinc-500 hover:text-zinc-300">Clear</button>
          <button onClick={selectAll} className="text-[11.5px] text-zinc-500 hover:text-zinc-300">Select all</button>
          <button
            onClick={() => setBulkModal(true)}
            className="ml-auto flex items-center gap-1.5 rounded-[8px] bg-[#ff3d6a] px-3 py-1.5 text-[12px] font-semibold text-white"
          >
            ↗ Schedule {selected.size} clip{selected.size > 1 ? "s" : ""}
          </button>
        </div>
      )}
      {/* Published filter chips */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PUBLISH_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setPublishFilter(f.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition cursor-pointer whitespace-nowrap",
              publishFilter === f.id
                ? "border-[#ff3d6a]/35 bg-[#ff3d6a]/10 text-rose-100"
                : "border-white/[.06] bg-white/[.018] text-zinc-500 hover:border-white/[.12] hover:bg-white/[.035] hover:text-zinc-200"
            )}
          >
            {f.label}
            {f.id === "posted" && postedClipIds.size > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 py-px text-[10px] font-bold text-amber-400">{postedClipIds.size}</span>
            )}
            {f.id === "queued" && scheduledClipIds.size > 0 && (
              <span className="ml-1.5 rounded-full bg-blue-500/15 px-1.5 py-px text-[10px] font-bold text-blue-400">{scheduledClipIds.size}</span>
            )}
          </button>
        ))}
      </div>

      {filteredClips.length > 0
        ? <VirtualizedGrid
            items={filteredClips}
            keyForItem={(clip) => clip.id}
            estimateRowHeight={390}
            columns={[{ minWidth: 640, columns: 2 }, { minWidth: 1024, columns: 4 }]}
            renderItem={(c, i) => (
              <ClipCard
                clip={c}
                idx={i}
                selected={selected.has(c.id)}
                onToggleSelect={() => toggleSelect(c.id)}
                isPosted={postedClipIds.has(c.id)}
                isScheduled={scheduledClipIds.has(c.id)}
                posts={postsByClipId.get(c.id) ?? []}
                onOpen={() => setDetailClip(c)}
              />
            )}
          />
        : video.status === "failed"
          ? <FailedErrorCard errorMessage={video.error_message ?? "Processing failed. No additional details available."} videoId={video.id} onRetried={() => onBack()} />
          : <div className="py-16 text-center text-zinc-500">No clips generated yet.</div>}

      {bulkModal && (
        <BulkPublishModal
          clips={clips.filter((c) => selected.has(c.id))}
          onClose={() => { setBulkModal(false); clearSel(); }}
        />
      )}

      {zipModal && (
        <ZipDownloadModal
          clips={clips}
          videoTitle={video.title ?? "clips"}
          onClose={() => setZipModal(false)}
        />
      )}

      {/* Regenerate modal */}
      {regenModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-6"
          style={{ background: "rgba(4,7,15,.8)", backdropFilter: "blur(6px)", animation: "fadeUp .15s ease" }}
          onClick={(e) => e.target === e.currentTarget && setRegenModal(false)}>
          <div className="w-full max-w-[460px] overflow-hidden rounded-[18px] border border-white/[.12] bg-[#0e1420] p-4 shadow-[0_40px_100px_rgba(0,0,0,.7)] sm:rounded-[20px] sm:p-6"
            style={{ animation: "fadeUp .2s cubic-bezier(.22,.8,.4,1)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-[10px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-[#ff3d6a]">✦</div>
              <div>
                <h3 className="font-display text-[16px] font-bold">Regenerate clips</h3>
                <p className="text-[12px] text-zinc-500">Choose what to optimize in the new batch</p>
              </div>
              <button onClick={() => setRegenModal(false)} className="ml-auto grid h-7 w-7 place-items-center rounded-[7px] border border-white/[.08] text-[13px] text-zinc-500 hover:text-white">✕</button>
            </div>

            <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[.1em] text-zinc-600">Optimization options</div>
            <div className="mb-5 flex flex-wrap gap-2">
              {REGEN_OPTS.map((o) => (
                <button key={o.id} onClick={() => toggleOpt(o.id)}
                  className={cn("rounded-[8px] border px-3 py-1.5 text-[12px] font-semibold transition",
                    regenOpts.includes(o.id)
                      ? "border-[#ff3d6a]/35 bg-[#ff3d6a]/10 text-[#ff3d6a]"
                      : "border-white/[.07] bg-white/[.03] text-zinc-400 hover:border-white/[.12] hover:text-zinc-200"
                  )}>
                  {o.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2.5">
              <button onClick={() => setRegenModal(false)}
                className="rounded-[9px] border border-white/[.08] bg-white/[.03] px-4 py-2 text-[13px] font-semibold text-zinc-300 transition hover:text-white">
                Cancel
              </button>
              <button onClick={() => setRegenModal(false)}
                className="ml-auto flex items-center gap-1.5 rounded-[9px] bg-[#ff3d6a] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_2px_12px_rgba(255,61,106,.3)]">
                ✦ Regenerate {clips.length} clips
              </button>
            </div>
          </div>
        </div>
      )}

      {detailClip && (
        <ClipDetailModal
          clip={detailClip}
          isPosted={postedClipIds.has(detailClip.id)}
          isScheduled={scheduledClipIds.has(detailClip.id)}
          posts={postsByClipId.get(detailClip.id) ?? []}
          onClose={() => setDetailClip(null)}
          onPublish={() => setBulkModal(true)}
        />
      )}
    </div>
  );
}

/* ─── Main UploadPage ─── */
/* ─── Upload wizard stepper ─── */
const UPLOAD_STEPS = [
  { label: "Source",       sub: "Upload file or YouTube" },
  { label: "Destinations", sub: "Platforms & format" },
  { label: "Clips",        sub: "Length, count, score" },
  { label: "Style",        sub: "AI, captions, quality" },
  { label: "Review",       sub: "Confirm & start" },
] as const;

function UploadStepper({ step, onStep }: { step: number; onStep: (n: number) => void }) {
  return (
    <div className="flex w-48 flex-none flex-col gap-0 py-1">
      {UPLOAD_STEPS.map((s, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <div key={n} className="flex flex-col">
            <button
              type="button"
              onClick={() => done ? onStep(n) : undefined}
              className={cn("flex items-center gap-3 rounded-[11px] px-3 py-2.5 text-left transition", active ? "bg-white/[.06]" : done ? "hover:bg-white/[.03] cursor-pointer" : "cursor-default")}
            >
              <div className={cn(
                "grid h-8 w-8 flex-none place-items-center rounded-full border text-[13px] font-bold transition",
                active ? "border-[#ff3d6a] bg-[#ff3d6a] text-white shadow-[0_0_14px_rgba(255,61,106,.4)]"
                : done  ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/15 text-[#ff7a9a]"
                :         "border-white/[.12] bg-white/[.04] text-zinc-500"
              )}>
                {done ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg>
                ) : n}
              </div>
              <div className="min-w-0">
                <div className={cn("text-[13px] font-semibold leading-tight", active ? "text-white" : done ? "text-zinc-300" : "text-zinc-500")}>{s.label}</div>
                <div className={cn("mt-0.5 text-[11px] leading-tight", active ? "text-zinc-400" : "text-zinc-600")}>{s.sub}</div>
              </div>
            </button>
            {i < UPLOAD_STEPS.length - 1 && (
              <div className={cn("ml-7 h-5 w-[2px] rounded-full", done ? "bg-[#ff3d6a]/30" : "bg-white/[.07]")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function UploadPage() {
  const [source, setSource] = useState<Source>("file");
  const [view, setView] = useState<View>("upload");
  const [uploadStep, setUploadStep] = useState(1);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [activeVideo, setActiveVideo] = useState<VideoResponse | null>(null);
  const [clips, setClips] = useState<ClipApiResponse[]>([]);
  const [drag, setDrag] = useState(false);
  const [urlVal, setUrlVal] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const [history, setHistory] = useState<VideoResponse[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VideoResponse | null>(null);
  const [clipConfig, setClipConfig] = useState<ClipConfig>(DEFAULT_CONFIG);
  const [captureVideo, setCaptureVideo] = useState<VideoResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isTerminalStatus = (v: VideoResponse) =>
    v.status === "done" || v.status === "ready" || v.status === "failed" || v.pipeline_step === "complete";

  /* Load history on mount */
  useEffect(() => {
    videoApi.list().then((res) => {
      setHistory(res.items);
    }).catch(() => {}).finally(() => setHistoryLoading(false));
  }, []);

  /* SSE subscriptions for in-progress videos in history — no polling */
  const historySseRef = useRef<Map<string, EventSource>>(new Map());
  useEffect(() => {
    const inProgress = history.filter((v) => !isTerminalStatus(v) && v.celery_task_id);
    const activeIds = new Set(inProgress.map((v) => v.celery_task_id!));

    // Close stale sources
    for (const [tid, es] of historySseRef.current) {
      if (!activeIds.has(tid)) { es.close(); historySseRef.current.delete(tid); }
    }

    const t = authToken.get() || "";
    if (!t) return;

    for (const video of inProgress) {
      const tid = video.celery_task_id!;
      if (historySseRef.current.has(tid)) continue;

      const es = new EventSource(`${VIDEO_SSE_BASE}/progress/${tid}?token=${encodeURIComponent(t)}`);
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === "keepalive") return;
          if (d.pct != null || d.step != null || d.status != null) {
            setHistory((prev) => prev.map((v) =>
              v.id === video.id
                ? { ...v,
                    pipeline_pct: d.pct ?? v.pipeline_pct,
                    pipeline_step: d.step ?? v.pipeline_step,
                    status: d.status === "complete" ? "ready" : d.status === "failed" ? "failed" : v.status,
                  }
                : v
            ));
          }
          if (d.status === "complete" || d.status === "failed") {
            es.close();
            historySseRef.current.delete(tid);
            videoApi.get(video.id).then((updated) =>
              setHistory((prev) => prev.map((v) => v.id === updated.id ? updated : v))
            ).catch(() => {});
          }
        } catch { /* ignore */ }
      };
      es.onerror = () => { es.close(); historySseRef.current.delete(tid); };
      historySseRef.current.set(tid, es);
    }

    return () => {/* keep sources open across renders — cleaned up above */};
  }, [history.map((v) => `${v.id}:${v.status}:${v.celery_task_id}`).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => () => {
    for (const es of historySseRef.current.values()) es.close();
    historySseRef.current.clear();
  }, []);

  /* YouTube URL validation */
  useEffect(() => {
    if (!urlVal.trim()) { setUrlReady(false); return; }
    const t = setTimeout(() => {
      const valid = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{11}/.test(urlVal.trim());
      setUrlReady(valid);
      if (!valid) setUploadError("Enter a valid YouTube URL (youtube.com/watch?v=… or youtu.be/…)");
      else setUploadError("");
    }, 600);
    return () => clearTimeout(t);
  }, [urlVal]);

  const handleFile = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    setPendingFile(files[0]);
    setUploadError("");
    setUploadStep(2);
  }, []);

  const handleUrlReady = useCallback(() => {
    if (!urlReady) return;
    setUploadError("");
    setUploadStep(2);
  }, [urlReady]);

  const handleConfirm = useCallback(async () => {
    setUploading(true);
    setUploadError("");
    try {
      if (source === "file" && pendingFile) {
        const video = await videoApi.upload(pendingFile, pendingFile.name.replace(/\.[^.]+$/, ""), clipConfig);
        setHistory((h) => [video, ...h]);
        setActiveVideo(video);
        setView("processing");
      } else if (source === "yt" && urlVal.trim()) {
        const video = await videoApi.youtube(urlVal.trim(), undefined, clipConfig);
        setHistory((h) => [video, ...h]);
        setActiveVideo(video);
        setUrlVal("");
        setUrlReady(false);
        if (video.needs_browser_capture) {
          setCaptureVideo(video);
        } else {
          setView("processing");
        }
      }
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      setUploadStep(5);
    } finally {
      setUploading(false);
    }
  }, [source, pendingFile, urlVal, clipConfig]);

  const handleDone = useCallback(async (updated: VideoResponse) => {
    setHistory((h) => h.map((v) => v.id === updated.id ? updated : v));
    setActiveVideo(updated);
    if (updated.status === "done" || updated.status === "ready") {
      try {
        const clipList = await videoApi.clips(updated.id);
        setClips(clipList.items);
      } catch { setClips([]); }
    }
    setView("results");
  }, []);

  const loadVideo = useCallback(async (vid: VideoResponse) => {
    if (vid.status === "processing" || vid.status === "pending" || vid.status === "queued") {
      setActiveVideo(vid);
      setView("processing");
      return;
    }
    setActiveVideo(vid);
    if (vid.status === "done" || vid.status === "ready") {
      try {
        const clipList = await videoApi.clips(vid.id);
        setClips(clipList.items);
      } catch { setClips([]); }
    }
    setView("results");
  }, []);

  useEffect(() => {
    // Support both /upload?video=ID and /projects/:id
    const pathMatch = window.location.pathname.match(/^\/projects\/([^/]+)$/);
    const videoId = pathMatch?.[1] ?? new URLSearchParams(window.location.search).get("video");
    if (!videoId) return;
    setView("processing");
    videoApi.get(videoId)
      .then(loadVideo)
      .catch((err: unknown) => {
        setUploadError(err instanceof Error ? err.message : "Could not open project");
        setView("upload");
      });
  }, [loadVideo]);

  const handleDelete = useCallback((e: React.MouseEvent, vid: VideoResponse) => {
    e.stopPropagation();
    setDeleteTarget(vid);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const vid = deleteTarget;
    setDeleteTarget(null);
    setDeletingId(vid.id);
    try {
      await videoApi.delete(vid.id);
      setHistory((h) => h.filter((v) => v.id !== vid.id));
      if (activeVideo?.id === vid.id) {
        setActiveVideo(null);
        setClips([]);
        setView("upload");
      }
    } catch { /* ignore — leave in list */ }
    finally { setDeletingId(null); }
  }, [deleteTarget, activeVideo]);

  return (
    <>
      {deleteTarget && (
        <DeleteModal
          video={deleteTarget}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {captureVideo && (
        <BrowserCaptureModal
          video={captureVideo}
          onDone={(updated) => {
            setCaptureVideo(null);
            setActiveVideo(updated);
            setHistory((h) => h.map((v) => v.id === updated.id ? updated : v));
            setView("processing");
          }}
          onCancel={() => setCaptureVideo(null)}
        />
      )}

      <div className="flex h-[calc(100vh-116px)] flex-col overflow-hidden rounded-[18px] border border-white/[.07] bg-[#0e1420] shadow-[0_24px_80px_rgba(0,0,0,.28)]">
        <div className="flex flex-col items-stretch gap-3 border-b border-white/[.06] bg-[#090e16]/95 px-3 py-3 sm:px-5 sm:py-4 lg:flex-row lg:flex-wrap lg:items-center">
          <div className="min-w-0 lg:mr-2">
            <div className="flex items-center gap-2">
              {view === "results" && (
                <button
                  onClick={() => navigate("/projects")}
                  className="mr-1 text-zinc-500 transition hover:text-white"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="m15 18-6-6 6-6"/></svg>
                </button>
              )}
              <h1 className="font-display text-[20px] font-bold tracking-[-.02em] text-white">
                {view === "upload" ? "New upload" : view === "processing" ? "Processing…" : "Generated Clips"}
              </h1>
              {view === "results" && activeVideo && (
                <span className="rounded-full border border-white/[.06] bg-white/[.025] px-2 py-0.5 text-xs font-medium text-zinc-500">
                  {activeVideo.title || "Untitled"}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-zinc-600">
              {view === "upload" ? "Upload a file or paste a YouTube link."
              : view === "processing" ? (activeVideo?.source_type === "ranking" ? "Rendering your ranked countdown video from the provided segments." : "AI is analyzing your video and generating clips.")
              : "Preview, edit, download or publish your clips below."}
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:ml-auto">
            {view !== "results" && (
              <button
                onClick={() => navigate("/projects")}
                className="h-10 rounded-[11px] border border-white/[.07] bg-white/[.025] px-3 text-xs font-semibold text-zinc-400 transition hover:text-zinc-200"
              >
                Projects
              </button>
            )}
            {view !== "upload" && (
              <button
                onClick={() => { setView("upload"); setActiveVideo(null); setClips([]); setUploadError(""); setUploadStep(1); setPendingFile(null); }}
                className="h-10 rounded-[11px] bg-[#ff3d6a] px-4 text-sm font-bold text-white shadow-[0_8px_24px_rgba(255,61,106,.25)] transition hover:bg-[#e8304f]"
              >
                + New upload
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden px-3 py-3 sm:px-5 sm:py-5">
          {/* Upload view — stepper wizard */}
          {view === "upload" && (
            <div className="flex h-full gap-6 overflow-hidden">
              {/* Left: vertical stepper */}
              <div className="hidden flex-none overflow-y-auto pt-1 md:flex">
                <UploadStepper step={uploadStep} onStep={setUploadStep} />
              </div>

              {/* Divider */}
              <div className="hidden w-px flex-none bg-white/[.06] md:block" />

              {/* Right: step content */}
              <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">

                {/* Step 1: Source */}
                {uploadStep === 1 && (
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-1 rounded-[12px] border border-white/[.07] bg-white/[.02] p-1">
                      {(["file", "yt"] as Source[]).map((s) => (
                        <button key={s} onClick={() => { setSource(s); setUploadError(""); setPendingFile(null); }}
                          className={cn(
                            "flex flex-1 items-center justify-center gap-2 rounded-[9px] py-2.5 text-[13px] font-semibold transition",
                            source === s ? "bg-white/[.08] text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"
                          )}>
                          {s === "file" ? (
                            <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Upload file</>
                          ) : (
                            <><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.28 8.28 0 0 0 4.84 1.56V6.79a4.85 4.85 0 0 1-1.07-.1z"/></svg>YouTube URL</>
                          )}
                        </button>
                      ))}
                    </div>

                    {source === "file" && (
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                        onDragLeave={() => setDrag(false)}
                        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files); }}
                        className={cn(
                          "flex flex-1 cursor-pointer flex-col items-center justify-center gap-4 rounded-[18px] border-2 border-dashed p-12 text-center transition",
                          drag ? "border-[#ff3d6a]/60 bg-[#ff3d6a]/[.06] scale-[1.01]"
                          : pendingFile ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/[.04]"
                          : "border-white/[.09] bg-white/[.015] hover:border-white/20 hover:bg-white/[.03]"
                        )}
                      >
                        <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => handleFile(e.target.files)} />
                        {pendingFile ? (
                          <>
                            <div className="grid h-16 w-16 place-items-center rounded-[20px] border border-[#ff3d6a]/30 bg-[#ff3d6a]/[.10]">
                              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ff7a9a" strokeWidth={1.8}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            </div>
                            <div>
                              <p className="font-display text-[16px] font-bold text-white">{pendingFile.name}</p>
                              <p className="mt-1 text-[12px] text-zinc-500">{(pendingFile.size / 1024 / 1024).toFixed(1)} MB · click to change</p>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); setUploadStep(2); }}
                              className="rounded-[11px] bg-[#ff3d6a] px-6 py-2.5 text-[13px] font-bold text-white shadow-[0_4px_16px_rgba(255,61,106,.25)] transition hover:bg-[#e8304f]">
                              Continue →
                            </button>
                          </>
                        ) : (
                          <>
                            <div className="grid h-16 w-16 place-items-center rounded-[20px] border border-[#ff3d6a]/20 bg-[#ff3d6a]/[.08]">
                              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ff7a9a" strokeWidth={1.8}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                            </div>
                            <div>
                              <p className="font-display text-2xl font-bold text-white">{drag ? "Drop to upload" : "Drop video here"}</p>
                              <p className="mt-1.5 text-[13px] text-zinc-500">MP4, MOV, WebM, MKV, AVI · up to 4 GB</p>
                            </div>
                            <button className="rounded-[11px] border border-white/[.1] bg-white/[.06] px-6 py-2.5 text-[13px] font-bold text-zinc-200 transition hover:bg-white/[.10] hover:text-white">
                              Browse files
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {source === "yt" && (
                      <div className="flex flex-1 flex-col justify-center rounded-[18px] border border-white/[.08] bg-white/[.02] p-8">
                        <div className="mb-6 grid h-16 w-16 place-items-center rounded-[20px] border border-red-400/20 bg-red-400/[.08]">
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="#f87171"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.28 8.28 0 0 0 4.84 1.56V6.79a4.85 4.85 0 0 1-1.07-.1z"/></svg>
                        </div>
                        <h3 className="font-display text-xl font-bold text-white">Import from YouTube</h3>
                        <p className="mt-1 text-[13px] text-zinc-500">Paste a public YouTube URL to generate clips from it.</p>
                        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                          <input
                            value={urlVal}
                            onChange={(e) => setUrlVal(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && urlReady && handleUrlReady()}
                            placeholder="https://youtube.com/watch?v=…"
                            className="min-w-0 flex-1 rounded-[11px] border border-white/[.08] bg-white/[.04] px-4 py-3 text-[13px] font-medium text-zinc-200 placeholder-zinc-600 outline-none transition focus:border-[#ff3d6a]/50 focus:shadow-[0_0_0_3px_rgba(255,61,106,.08)]"
                          />
                          <button
                            disabled={!urlReady}
                            onClick={handleUrlReady}
                            className="rounded-[11px] bg-[#ff3d6a] px-6 py-3 text-[13px] font-bold text-white transition hover:bg-[#e8304f] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Continue →
                          </button>
                        </div>
                        {urlReady && (
                          <div className="mt-4 flex items-center gap-2.5 rounded-[11px] border border-emerald-300/15 bg-emerald-400/[.08] px-4 py-3 text-[12.5px] font-semibold text-emerald-300">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                            YouTube video detected — ready to continue
                          </div>
                        )}
                      </div>
                    )}

                    {uploadError && (
                      <div className="flex items-center gap-2.5 rounded-[11px] border border-red-400/20 bg-red-400/[.07] px-4 py-3 text-[12.5px] font-medium text-red-400">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        {uploadError}
                      </div>
                    )}
                  </div>
                )}

                {/* Steps 2–4: ClipConfigPanel scoped to that step */}
                {(uploadStep === 2 || uploadStep === 3 || uploadStep === 4) && (
                  <div className="flex flex-col gap-6">
                    <ClipConfigPanel
                      config={clipConfig}
                      onChange={setClipConfig}
                      step={uploadStep === 2 ? 1 : uploadStep === 3 ? 2 : 3}
                    />
                    <div className="flex items-center justify-between border-t border-white/[.06] pt-4">
                      <button onClick={() => setUploadStep((s) => s - 1)}
                        className="rounded-[10px] border border-white/[.08] bg-white/[.03] px-4 py-2 text-[13px] font-semibold text-zinc-400 transition hover:text-white">
                        ← Back
                      </button>
                      <button onClick={() => setUploadStep((s) => s + 1)}
                        className="rounded-[10px] bg-[#ff3d6a] px-5 py-2 text-[13px] font-bold text-white shadow-[0_4px_16px_rgba(255,61,106,.2)] transition hover:bg-[#e8304f]">
                        Continue →
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 5: Review */}
                {uploadStep === 5 && (
                  <div className="flex flex-col gap-5">
                    <div className="rounded-[14px] border border-white/[.08] bg-white/[.025] p-5">
                      <h3 className="mb-4 font-display text-[15px] font-bold text-white">Review & start</h3>
                      <div className="space-y-3 text-[13px]">
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-500">Source</span>
                          <span className="font-semibold text-zinc-200">
                            {source === "file" ? (pendingFile?.name ?? "No file selected") : (urlVal || "No URL entered")}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-500">Platforms</span>
                          <span className="font-semibold text-zinc-200">{(clipConfig.platforms ?? []).join(", ") || "None"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-500">Clip length</span>
                          <span className="font-semibold text-zinc-200">{clipConfig.duration_min}–{clipConfig.duration_max}s</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-500">Max clips</span>
                          <span className="font-semibold text-zinc-200">{clipConfig.max_clips}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-500">Captions</span>
                          <span className="font-semibold text-zinc-200">{clipConfig.add_captions ? `On · ${clipConfig.caption_style}` : "Off"}</span>
                        </div>
                      </div>
                    </div>

                    {uploadError && (
                      <div className="flex items-center gap-2.5 rounded-[11px] border border-red-400/20 bg-red-400/[.07] px-4 py-3 text-[12.5px] font-medium text-red-400">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        {uploadError}
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <button onClick={() => setUploadStep(4)}
                        className="rounded-[10px] border border-white/[.08] bg-white/[.03] px-4 py-2 text-[13px] font-semibold text-zinc-400 transition hover:text-white">
                        ← Back
                      </button>
                      <button
                        disabled={uploading || (source === "file" ? !pendingFile : !urlReady)}
                        onClick={handleConfirm}
                        className="flex items-center gap-2 rounded-[10px] bg-[#ff3d6a] px-6 py-2.5 text-[13px] font-bold text-white shadow-[0_4px_20px_rgba(255,61,106,.3)] transition hover:bg-[#e8304f] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {uploading ? <span className="block h-4 w-4 rounded-full border-2 border-white/70 border-t-transparent animate-spin" /> : null}
                        {uploading ? "Starting…" : "Confirm & start"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Processing */}
          {view === "processing" && activeVideo && (
            <div className="h-full overflow-y-auto">
              <ProcessingView
                video={activeVideo}
                onDone={handleDone}
                onCancel={async () => {
                  try { await videoApi.cancel(activeVideo.id); } catch { /* ignore */ }
                  setView("upload");
                  setActiveVideo(null);
                  setClips([]);
                }}
              />
            </div>
          )}

          {/* Results */}
          {view === "results" && activeVideo && (
            <div className="h-full overflow-y-auto">
              <ResultsView
                video={activeVideo}
                clips={clips}
                onBack={() => navigate("/projects")}
              />
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
