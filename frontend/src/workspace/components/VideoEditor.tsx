import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { type ClipApiResponse, type EditorData, videoApi } from "@/lib/api";
import { Timeline, type EffectMarker } from "./editor/Timeline";
import { TrimBar } from "./editor/TrimBar";
import { CaptionEditor, type Caption } from "./editor/CaptionEditor";
import { SoundEffectPalette, PALETTE, type PaletteItem, type SoundType } from "./editor/SoundEffectPalette";
import { RenderPanel } from "./editor/RenderPanel";

/* ─── Audio synthesis ─── */
function synthSound(dest: AudioNode, type: SoundType) {
  const ctx = dest.context as AudioContext;
  const now = ctx.currentTime;
  if (type === "quack") {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(dest); osc.type = "sawtooth";
    osc.frequency.setValueAtTime(900, now); osc.frequency.exponentialRampToValueAtTime(300, now + 0.18);
    gain.gain.setValueAtTime(0.5, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.start(); osc.stop(now + 0.22);
  } else if (type === "applause") {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.9, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const env = i < ctx.sampleRate * 0.3 ? i / (ctx.sampleRate * 0.3) : 1 - (i - ctx.sampleRate * 0.3) / (ctx.sampleRate * 0.6);
      d[i] = (Math.random() * 2 - 1) * env * 0.5;
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(dest); src.start();
  } else if (type === "ding") {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(dest); osc.type = "sine"; osc.frequency.value = 1047;
    gain.gain.setValueAtTime(0.5, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    osc.start(); osc.stop(now + 0.9);
  } else if (type === "airhorn") {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(dest); osc.type = "square";
    osc.frequency.setValueAtTime(220, now); osc.frequency.linearRampToValueAtTime(440, now + 0.06);
    gain.gain.setValueAtTime(0.35, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.start(); osc.stop(now + 0.5);
  } else if (type === "womp") {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(dest); osc.type = "sawtooth";
    osc.frequency.setValueAtTime(400, now); osc.frequency.exponentialRampToValueAtTime(50, now + 0.6);
    gain.gain.setValueAtTime(0.4, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc.start(); osc.stop(now + 0.65);
  } else if (type === "tada") {
    [523, 659, 784, 1047].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(dest); osc.type = "sine"; osc.frequency.value = freq;
      const t = now + i * 0.1;
      gain.gain.setValueAtTime(0.35, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t); osc.stop(t + 0.4);
    });
  }
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function drawTemplateCaption(ctx: CanvasRenderingContext2D, cap: Caption, W: number, H: number, yPos: number) {
  const uppercaseTemplates = new Set(["mr-beast", "news", "meme", "sports"]);
  const text = uppercaseTemplates.has(cap.template) ? cap.text.toUpperCase() : cap.text;
  const fontSize = cap.template === "mr-beast" ? Math.max(cap.fontSize, 32) : cap.fontSize;
  ctx.font = `900 ${fontSize}px sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const metrics = ctx.measureText(text);
  const boxW = Math.min(W * 0.86, metrics.width + 42);
  const boxH = fontSize * 1.55;
  const x = W / 2;
  const radius = 12;

  function roundRect(fill: string) {
    ctx.fillStyle = fill;
    const left = x - boxW / 2;
    const top = yPos - boxH / 2;
    ctx.beginPath();
    ctx.roundRect(left, top, boxW, boxH, radius);
    ctx.fill();
  }

  ctx.save();
  const boxed: Partial<Record<Caption["template"], { bg: string; fg: string; stroke?: string }>> = {
    default: { bg: "rgba(255,255,255,0.96)", fg: "#111827" },
    modern: { bg: "rgba(0,0,0,0.92)", fg: "#ffea00" },
    bouncy: { bg: "rgba(255,255,255,0.96)", fg: "#7c2dff" },
    "mr-beast": { bg: "#ffd21f", fg: "#00a7b7", stroke: "rgba(0,0,0,0.35)" },
    neon: { bg: "rgba(16,16,38,0.84)", fg: "#39ff14", stroke: "rgba(255,0,255,0.35)" },
    podcast: { bg: "rgba(17,24,39,0.88)", fg: "#ffffff" },
    gaming: { bg: "rgba(76,29,149,0.86)", fg: "#00e5ff" },
    news: { bg: "rgba(225,29,72,0.92)", fg: "#ffffff" },
    luxury: { bg: "rgba(5,5,5,0.8)", fg: "#d4af37" },
    karaoke: { bg: "rgba(29,78,216,0.86)", fg: "#fff2a8" },
    meme: { bg: "rgba(0,0,0,0.7)", fg: "#ffffff", stroke: "rgba(0,0,0,0.7)" },
    documentary: { bg: "rgba(0,0,0,0.58)", fg: "#f5f5dc" },
    sports: { bg: "rgba(17,17,17,0.86)", fg: "#ccff00" },
    soft: { bg: "rgba(49,46,129,0.58)", fg: "#ffc7d8" },
  };
  const style = boxed[cap.template];
  if (style) {
    roundRect(style.bg);
    ctx.fillStyle = style.fg;
    if (style.stroke) {
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 4;
      ctx.strokeText(text, x, yPos);
    }
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 6;
  } else {
    const plainColors: Partial<Record<Caption["template"], string>> = {
      business: "#ffffff",
      clean: "#ffffff",
      cinematic: "#f5d76e",
    };
    ctx.fillStyle = plainColors[cap.template] ?? cap.color;
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = cap.template === "clean" ? 4 : 10;
  }
  ctx.fillText(text, x, yPos);
  ctx.restore();
}

type EditorTab = "trim" | "captions" | "effects" | "export";

const SPEEDS = [0.5, 1, 1.5, 2] as const;
type Speed = typeof SPEEDS[number];

/* ─── Icons ─── */
const IconCut = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
    <line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/>
    <line x1="8.12" y1="8.12" x2="12" y2="12"/>
  </svg>
);
const IconText = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/>
    <line x1="12" y1="4" x2="12" y2="20"/>
  </svg>
);
const IconEffects = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);
const IconPlay = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
);
const IconPause = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>
);
const IconMute = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
    <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
  </svg>
);
const IconVol = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
  </svg>
);
const IconLoop = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
    <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
  </svg>
);
const IconExport = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

export function VideoEditor({
  clip,
  onClose,
  onPost,
}: {
  clip: ClipApiResponse;
  onClose: () => void;
  onPost?: () => void;
}) {
  /* ─── Refs ─── */
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const triggeredRef = useRef<Set<string>>(new Set());
  const markersRef = useRef<EffectMarker[]>([]);
  const captionsRef = useRef<Caption[]>([]);
  const seekBarRef = useRef<HTMLDivElement>(null);

  /* ─── State ─── */
  const [markers, setMarkers] = useState<EffectMarker[]>([]);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [selected, setSelected] = useState<PaletteItem>(PALETTE[0]);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(clip.duration_ms ? clip.duration_ms / 1000 : 0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(clip.duration_ms ? clip.duration_ms / 1000 : 0);
  const [activeTab, setActiveTab] = useState<EditorTab>("trim");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "err">("idle");
  const [noVideo] = useState(!clip.storage_url);
  const [speed, setSpeed] = useState<Speed>(1);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);

  /* Keep refs in sync */
  useEffect(() => { markersRef.current = markers; }, [markers]);
  useEffect(() => { captionsRef.current = captions; }, [captions]);
  useEffect(() => { if (duration > 0 && trimEnd === 0) setTrimEnd(duration); }, [duration, trimEnd]);

  /* Apply video properties */
  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    v.playbackRate = speed;
  }, [speed]);
  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    v.muted = muted;
  }, [muted]);
  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    v.loop = loop;
  }, [loop]);

  /* ─── Audio ─── */
  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current) {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      mediaDestRef.current = ctx.createMediaStreamDestination();
    }
    return audioCtxRef.current;
  }
  function ensureMediaSource() {
    if (mediaSourceRef.current || !videoRef.current) return;
    const ctx = getAudioCtx();
    try {
      const src = ctx.createMediaElementSource(videoRef.current);
      src.connect(ctx.destination); src.connect(mediaDestRef.current!);
      mediaSourceRef.current = src;
    } catch { /* CORS or already captured */ }
  }

  /* ─── Canvas loop ─── */
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width; const H = canvas.height;
    function draw() {
      ctx.clearRect(0, 0, W, H);
      const video = videoRef.current;
      if (video && video.readyState >= 2) ctx.drawImage(video, 0, 0, W, H);
      const nowMs = (video?.currentTime ?? 0) * 1000;
      for (const m of markersRef.current) {
        if (!triggeredRef.current.has(m.id) && nowMs >= m.timeMs && nowMs < m.timeMs + 200) {
          triggeredRef.current.add(m.id);
          if (audioCtxRef.current && mediaDestRef.current) {
            const mixer = audioCtxRef.current.createGain();
            mixer.connect(audioCtxRef.current.destination); mixer.connect(mediaDestRef.current);
            synthSound(mixer, m.sound as SoundType);
          }
        }
      }
      for (const m of markersRef.current) {
        const age = nowMs - m.timeMs;
        if (age >= 0 && age < 1500) {
          const t = age / 1500;
          const scale = t < 0.2 ? (t / 0.2) * 1.4 : t < 0.35 ? 1.4 - ((t - 0.2) / 0.15) * 0.4 : 1.0;
          const opacity = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
          const yOff = -t * 80;
          const seed = m.id.charCodeAt(m.id.length - 1) ?? 0;
          const xOff = ((seed % 80) - 40) * (W / 360);
          ctx.save();
          ctx.globalAlpha = Math.max(0, opacity);
          ctx.font = `${Math.round(W * 0.24 * scale)}px serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 12;
          ctx.fillText(m.emoji, W / 2 + xOff, H / 2 + yOff);
          ctx.restore();
        }
      }
      const nowSec = video?.currentTime ?? 0;
      for (const cap of captionsRef.current) {
        if (nowSec >= cap.startSec && nowSec <= cap.endSec) {
          const yPos = cap.position === "top" ? H * 0.1 : cap.position === "center" ? H * 0.5 : H * 0.88;
          drawTemplateCaption(ctx, cap, W, H, yPos);
        }
      }
      animRef.current = requestAnimationFrame(draw);
    }
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── Playback ─── */
  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    ensureMediaSource();
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") ctx.resume();
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSeekDelta = useCallback((delta: number) => {
    const v = videoRef.current; if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || duration, v.currentTime + delta));
    triggeredRef.current.clear();
  }, [duration]);

  const handleSeekBar = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = seekBarRef.current; if (!bar || duration <= 0) return;
    const { left, width } = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - left) / width));
    const v = videoRef.current;
    if (v) { v.currentTime = pct * duration; triggeredRef.current.clear(); }
  }, [duration]);

  /* ─── Markers ─── */
  function addMarker(timeMs: number) {
    const v = videoRef.current;
    if (v) { v.currentTime = timeMs / 1000; triggeredRef.current.clear(); }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setMarkers((prev) => [...prev, { id, timeMs, sound: selected.sound, emoji: selected.emoji, label: selected.label }]);
  }
  function removeMarker(id: string) { setMarkers((prev) => prev.filter((m) => m.id !== id)); }

  /* ─── Load saved state ─── */
  useEffect(() => {
    videoApi.getEditorData(clip.id).then((res) => {
      const ed = res.editor;
      if (ed.trim_start_sec !== undefined) setTrimStart(ed.trim_start_sec);
      if (ed.trim_end_sec != null) setTrimEnd(ed.trim_end_sec);
      if (ed.captions?.length) {
        setCaptions(ed.captions.map((c) => ({ id: c.id, text: c.text, startSec: c.start_sec, endSec: c.end_sec, position: c.position, color: c.color, fontSize: c.font_size, template: c.template ?? "default" })));
      }
      if (ed.markers?.length) {
        setMarkers(ed.markers.map((m) => ({ id: m.id, timeMs: m.time_ms, sound: m.sound, emoji: m.emoji, label: m.label })));
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  /* ─── Save ─── */
  async function handleSave() {
    setSaving(true); setSaveStatus("idle");
    const editorData: EditorData = {
      trim_start_sec: trimStart, trim_end_sec: trimEnd || null,
      captions: captions.map((c) => ({ id: c.id, text: c.text, start_sec: c.startSec, end_sec: c.endSec, position: c.position, color: c.color, font_size: c.fontSize, template: c.template })),
      markers: markers.map((m) => ({ id: m.id, time_ms: m.timeMs, sound: m.sound, emoji: m.emoji, label: m.label })),
    };
    try {
      await videoApi.saveEditorData(clip.id, editorData);
      setSaveStatus("ok"); setTimeout(() => setSaveStatus("idle"), 3000);
    } catch {
      setSaveStatus("err"); setTimeout(() => setSaveStatus("idle"), 3000);
    } finally { setSaving(false); }
  }

  const TABS: { id: EditorTab; label: string; icon: React.ReactNode }[] = [
    { id: "trim",     label: "Trim",     icon: <IconCut /> },
    { id: "captions", label: "Captions", icon: <IconText /> },
    { id: "effects",  label: "Effects",  icon: <IconEffects /> },
    { id: "export",   label: "Export",   icon: <IconExport /> },
  ];

  const progress = duration > 0 ? currentTime / duration : 0;
  const trimProgress = duration > 0 ? (currentTime - trimStart) / ((trimEnd || duration) - trimStart) : 0;

  const editorContent = (
    <div className="fixed inset-0 flex flex-col bg-[#0a0a0f]" style={{ zIndex: 9999 }}>

      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[.06] bg-[#0f0f17] px-5 py-2.5 h-14">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/[.07] hover:text-white transition cursor-pointer shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </button>
          <div className="min-w-0">
            <h1 className="font-bold text-[14px] leading-none text-white truncate max-w-[200px]">
              {clip.clip_metadata?.ai_title ?? clip.title ?? "Untitled clip"}
            </h1>
            <p className="mt-0.5 text-[10px] text-zinc-600">Video Editor</p>
          </div>
          {noVideo && (
            <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400 shrink-0">
              No source
            </span>
          )}
        </div>

        {/* Center: playback speed + mute + loop */}
        <div className="flex items-center gap-1">
          {/* Speed pills */}
          <div className="flex items-center gap-0.5 rounded-lg bg-white/[.04] border border-white/[.06] p-0.5">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-bold transition cursor-pointer",
                  speed === s ? "bg-white/[.12] text-white" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {s}×
              </button>
            ))}
          </div>

          <div className="mx-2 h-5 w-px bg-white/[.06]" />

          {/* Mute */}
          <button
            onClick={() => { setMuted((m) => !m); }}
            title={muted ? "Unmute" : "Mute"}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-lg transition cursor-pointer",
              muted ? "bg-rose-500/15 text-rose-400" : "text-zinc-500 hover:bg-white/[.06] hover:text-zinc-200"
            )}
          >
            {muted ? <IconMute /> : <IconVol />}
          </button>

          {/* Loop */}
          <button
            onClick={() => setLoop((l) => !l)}
            title="Toggle loop"
            className={cn(
              "grid h-8 w-8 place-items-center rounded-lg transition cursor-pointer",
              loop ? "bg-violet-500/15 text-violet-400" : "text-zinc-500 hover:bg-white/[.06] hover:text-zinc-200"
            )}
          >
            <IconLoop />
          </button>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-[12px] font-semibold transition cursor-pointer disabled:opacity-50",
              saveStatus === "ok" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : saveStatus === "err" ? "border-red-500/40 bg-red-500/10 text-red-300"
                : "border-white/[.1] bg-white/[.04] text-zinc-300 hover:bg-white/[.08] hover:text-white"
            )}
          >
            {saving
              ? <><span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> Saving</>
              : saveStatus === "ok" ? "✓ Saved"
              : saveStatus === "err" ? "Failed"
              : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Save</>}
          </button>

          {onPost && (
            <button
              onClick={() => { onClose(); onPost(); }}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3.5 py-1.5 text-[12px] font-semibold text-violet-300 hover:bg-violet-500/20 disabled:opacity-50 transition cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              Post
            </button>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left: Video preview ── */}
        <div className="flex flex-col items-center justify-between bg-[#0a0a0f] border-r border-white/[.05] py-6 px-6 w-[300px] shrink-0">

          {/* Canvas / preview */}
          <div className="flex-1 flex items-center justify-center w-full min-h-0">
            <div
              className="relative overflow-hidden rounded-2xl bg-black shadow-[0_0_0_1px_rgba(255,255,255,.07),0_24px_64px_rgba(0,0,0,.9)]"
              style={{ maxHeight: "100%", aspectRatio: "9/16", maxWidth: "100%" }}
            >
              {clip.thumbnail_url && (
                <img src={clip.thumbnail_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
              )}
              {clip.storage_url && (
                <video
                  ref={videoRef}
                  src={clip.storage_url}
                  crossOrigin="anonymous"
                  playsInline
                  preload="metadata"
                  className="absolute inset-0 h-full w-full object-cover opacity-0 pointer-events-none"
                  onTimeUpdate={(e) => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
                  onEnded={() => setPlaying(false)}
                  onLoadedMetadata={(e) => {
                    const v = e.target as HTMLVideoElement;
                    if (v.duration && isFinite(v.duration)) {
                      setDuration(v.duration);
                      setTrimEnd((prev) => prev === 0 ? v.duration : prev);
                      v.playbackRate = speed;
                      v.muted = muted;
                      v.loop = loop;
                    }
                  }}
                />
              )}
              <canvas ref={canvasRef} width={360} height={640} className="absolute inset-0 h-full w-full" />

              {/* Current time overlay */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 backdrop-blur-sm px-3 py-1 font-mono text-[11px] text-white/80 pointer-events-none">
                {fmt(currentTime)} / {fmt(duration)}
              </div>
            </div>
          </div>

          {/* Seek bar */}
          <div className="w-full mt-4 space-y-2">
            <div
              ref={seekBarRef}
              onClick={handleSeekBar}
              className="relative h-1.5 w-full cursor-pointer rounded-full bg-white/[.08] hover:bg-white/[.12] transition group"
            >
              {/* Trim region */}
              {duration > 0 && (
                <div
                  className="absolute inset-y-0 bg-white/[.06] rounded-full"
                  style={{
                    left: `${(trimStart / duration) * 100}%`,
                    width: `${((trimEnd || duration) - trimStart) / duration * 100}%`,
                  }}
                />
              )}
              {/* Progress */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-[#ff3d6a]"
                style={{ width: `${progress * 100}%` }}
              />
              {/* Thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 transition"
                style={{ left: `${progress * 100}%` }}
              />
            </div>

            {/* Transport */}
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => handleSeekDelta(-5)}
                className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/[.06] hover:text-zinc-200 transition cursor-pointer text-[10px] font-bold"
              >
                −5s
              </button>
              <button
                onClick={togglePlay}
                className="grid h-10 w-10 place-items-center rounded-full bg-[#ff3d6a] text-white shadow-[0_0_20px_rgba(255,61,106,.4)] hover:bg-[#e8304f] transition cursor-pointer"
              >
                {playing ? <IconPause /> : <IconPlay />}
              </button>
              <button
                onClick={() => handleSeekDelta(5)}
                className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/[.06] hover:text-zinc-200 transition cursor-pointer text-[10px] font-bold"
              >
                +5s
              </button>
            </div>
          </div>
        </div>

        {/* ── Right: Tool panel ── */}
        <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">

          {/* Vertical tab nav */}
          <div className="flex flex-col gap-1 border-r border-white/[.05] bg-[#0f0f17] px-2 py-4 w-[80px] shrink-0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-[10px] font-semibold transition cursor-pointer",
                  activeTab === tab.id
                    ? "bg-[#ff3d6a]/15 text-[#ff3d6a]"
                    : "text-zinc-600 hover:text-zinc-300 hover:bg-white/[.05]"
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}

            {/* Divider + effects count */}
            {markers.length > 0 && (
              <>
                <div className="mx-auto h-px w-8 bg-white/[.06] my-2" />
                <div className="flex flex-col items-center gap-0.5 text-[10px] text-zinc-600">
                  <span className="font-bold text-violet-400 text-[13px]">{markers.length}</span>
                  <span>effect{markers.length !== 1 ? "s" : ""}</span>
                </div>
              </>
            )}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-5 min-h-0 bg-[#0a0a0f]">

            {activeTab === "trim" && (
              <div className="space-y-5 max-w-lg">
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-3">Trim Clip</h3>
                  <TrimBar
                    duration={duration}
                    startSec={trimStart}
                    endSec={trimEnd || duration}
                    onChange={(s, e) => { setTrimStart(s); setTrimEnd(e); }}
                  />
                </div>

                {duration > 0 && (
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Start", value: trimStart, color: "text-zinc-200" },
                      { label: "End", value: trimEnd || duration, color: "text-zinc-200" },
                      { label: "Duration", value: (trimEnd || duration) - trimStart, color: "text-[#ff3d6a]" },
                    ].map((item) => (
                      <div key={item.label} className="flex flex-col items-center rounded-xl border border-white/[.06] bg-white/[.02] p-3">
                        <span className="text-[10px] text-zinc-600 mb-1">{item.label}</span>
                        <span className={cn("font-mono text-[15px] font-bold", item.color)}>
                          {fmt(item.value)}
                        </span>
                        <span className={cn("font-mono text-[10px] mt-0.5", item.color, "opacity-60")}>
                          {item.value.toFixed(1)}s
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Precise time inputs */}
                {duration > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Precise Input</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "Start (sec)", val: trimStart, set: (v: number) => setTrimStart(Math.max(0, Math.min(v, trimEnd || duration))) },
                        { label: "End (sec)", val: trimEnd || duration, set: (v: number) => setTrimEnd(Math.max(trimStart, Math.min(v, duration))) },
                      ].map(({ label, val, set }) => (
                        <div key={label}>
                          <label className="block text-[10px] text-zinc-600 mb-1.5">{label}</label>
                          <input
                            type="number"
                            step="0.1"
                            min={0}
                            max={duration}
                            value={val.toFixed(1)}
                            onChange={(e) => set(parseFloat(e.target.value) || 0)}
                            className="w-full rounded-lg border border-white/[.08] bg-white/[.04] px-3 py-2 font-mono text-[13px] text-zinc-200 outline-none focus:border-[#ff3d6a]/40 focus:bg-white/[.06] transition"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Jump to trim points */}
                {duration > 0 && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => { const v = videoRef.current; if (v) { v.currentTime = trimStart; triggeredRef.current.clear(); } }}
                      className="flex-1 rounded-lg border border-white/[.07] bg-white/[.03] py-2 text-[11px] text-zinc-400 hover:bg-white/[.06] hover:text-zinc-200 transition cursor-pointer"
                    >
                      ⏮ Jump to start
                    </button>
                    <button
                      onClick={() => { const v = videoRef.current; if (v) { v.currentTime = trimEnd || duration; triggeredRef.current.clear(); } }}
                      className="flex-1 rounded-lg border border-white/[.07] bg-white/[.03] py-2 text-[11px] text-zinc-400 hover:bg-white/[.06] hover:text-zinc-200 transition cursor-pointer"
                    >
                      ⏭ Jump to end
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === "captions" && (
              <div className="max-w-lg">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-4">Captions</h3>
                <CaptionEditor captions={captions} duration={duration} onChange={setCaptions} />
              </div>
            )}

            {activeTab === "effects" && (
              <div className="max-w-lg">
                <div className="mb-4">
                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Sound Effects</h3>
                  <p className="text-[11px] text-zinc-600">Select an effect, then click the timeline below to place it.</p>
                </div>
                <SoundEffectPalette selected={selected} onSelect={setSelected} />

                {markers.length > 0 && (
                  <div className="mt-5">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Placed Effects</h3>
                      <button
                        onClick={() => markers.forEach((m) => removeMarker(m.id))}
                        className="text-[10px] text-zinc-600 hover:text-red-400 transition cursor-pointer"
                      >
                        Clear all
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[...markers].sort((a, b) => a.timeMs - b.timeMs).map((m) => (
                        <button
                          key={m.id}
                          onClick={() => removeMarker(m.id)}
                          className="flex items-center gap-1.5 rounded-lg border border-white/[.06] bg-white/[.03] px-2.5 py-1.5 text-[11px] text-zinc-400 hover:border-red-500/30 hover:text-red-400 transition cursor-pointer"
                        >
                          {m.emoji} <span className="font-mono">{fmt(m.timeMs / 1000)}</span>
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Trim summary in effects tab */}
                {duration > 0 && (
                  <div className="mt-5 rounded-xl border border-white/[.05] bg-white/[.02] p-3">
                    <p className="text-[10px] text-zinc-600 mb-1.5 font-semibold uppercase tracking-wide">Active Trim</p>
                    <div className="flex items-center gap-2 font-mono text-[12px]">
                      <span className="text-zinc-400">{fmt(trimStart)}</span>
                      <div className="flex-1 h-1 rounded-full bg-white/[.06] relative">
                        <div
                          className="absolute inset-y-0 rounded-full bg-[#ff3d6a]/40"
                          style={{
                            left: `${(trimStart / duration) * 100}%`,
                            width: `${((trimEnd || duration) - trimStart) / duration * 100}%`,
                          }}
                        />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-2.5 w-px bg-[#ff3d6a]"
                          style={{ left: `${trimProgress * ((trimEnd || duration) - trimStart) / duration * 100 + (trimStart / duration) * 100}%` }}
                        />
                      </div>
                      <span className="text-zinc-400">{fmt(trimEnd || duration)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "export" && (
              <div className="max-w-lg">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-4">Server Render</h3>
                <p className="text-[11px] text-zinc-600 mb-4">
                  Renders on server with FFmpeg — full quality MP4 with burned captions and sound effects.
                </p>
                <RenderPanel
                  clipId={String(clip.id)}
                  trimStart={trimStart}
                  trimEnd={trimEnd || duration}
                  captions={captions}
                  markers={markers}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom Timeline ── */}
      <div className="shrink-0 border-t border-white/[.05] bg-[#0f0f17]">
        <Timeline
          duration={duration}
          currentTime={currentTime}
          markers={markers}
          selectedEffect={selected}
          trimStart={trimStart}
          trimEnd={trimEnd || duration}
          onSeek={(t) => { const v = videoRef.current; if (v) { v.currentTime = t; triggeredRef.current.clear(); } }}
          onAddMarker={addMarker}
          onRemoveMarker={removeMarker}
        />
      </div>
    </div>
  );

  return createPortal(editorContent, document.body);
}
