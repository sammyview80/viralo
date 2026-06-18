import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { type ClipApiResponse, videoApi } from "@/lib/api";

type SoundType = "quack" | "applause" | "ding" | "airhorn" | "womp" | "tada";

interface EffectMarker {
  id: string;
  timeMs: number;
  sound: SoundType;
  emoji: string;
  label: string;
}

const PALETTE: { sound: SoundType; emoji: string; label: string }[] = [
  { sound: "quack",    emoji: "🦆", label: "Quack" },
  { sound: "applause", emoji: "👏", label: "Applause" },
  { sound: "ding",     emoji: "🔔", label: "Ding" },
  { sound: "airhorn",  emoji: "📯", label: "Airhorn" },
  { sound: "womp",     emoji: "😬", label: "Womp" },
  { sound: "tada",     emoji: "🎉", label: "Tada" },
  { sound: "ding",     emoji: "🔥", label: "Fire" },
  { sound: "tada",     emoji: "❤️", label: "Love" },
  { sound: "applause", emoji: "💯", label: "100" },
  { sound: "womp",     emoji: "💀", label: "Dead" },
  { sound: "ding",     emoji: "⚡", label: "Zap" },
  { sound: "airhorn",  emoji: "🚀", label: "Rocket" },
];

function synthSound(dest: AudioNode, type: SoundType) {
  const ctx = dest.context as AudioContext;
  const now = ctx.currentTime;

  if (type === "quack") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(dest);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.18);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.start(); osc.stop(now + 0.22);

  } else if (type === "applause") {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.9, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const env = i < ctx.sampleRate * 0.3
        ? i / (ctx.sampleRate * 0.3)
        : 1 - (i - ctx.sampleRate * 0.3) / (ctx.sampleRate * 0.6);
      d[i] = (Math.random() * 2 - 1) * env * 0.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(dest); src.start();

  } else if (type === "ding") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(dest);
    osc.type = "sine"; osc.frequency.value = 1047;
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    osc.start(); osc.stop(now + 0.9);

  } else if (type === "airhorn") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(dest);
    osc.type = "square";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(440, now + 0.06);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.start(); osc.stop(now + 0.5);

  } else if (type === "womp") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(dest);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.6);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc.start(); osc.stop(now + 0.65);

  } else if (type === "tada") {
    [523, 659, 784, 1047].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(dest);
      osc.type = "sine"; osc.frequency.value = freq;
      const t = now + i * 0.1;
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t); osc.stop(t + 0.4);
    });
  }
}

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;

export function VideoEditor({
  clip,
  onClose,
  onPost,
}: {
  clip: ClipApiResponse;
  onClose: () => void;
  onPost?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const triggeredRef = useRef<Set<string>>(new Set());
  const markersRef = useRef<EffectMarker[]>([]);

  const [markers, setMarkers] = useState<EffectMarker[]>([]);
  const [selected, setSelected] = useState<typeof PALETTE[0]>(PALETTE[0]);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(
    clip.duration_ms ? clip.duration_ms / 1000 : 0
  );
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "err">("idle");
  const [noVideo, setNoVideo] = useState(!clip.storage_url);

  // Keep markersRef in sync so animation loop reads latest without stale closure
  useEffect(() => { markersRef.current = markers; }, [markers]);

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
      src.connect(ctx.destination);
      src.connect(mediaDestRef.current!);
      mediaSourceRef.current = src;
    } catch { /* already captured or CORS blocked — audio from sound effects only */ }
  }

  // Canvas animation loop — draw video frames + emoji overlays
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;

    function draw() {
      ctx.clearRect(0, 0, W, H);

      if (video && video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, W, H);
      } else if (!video) {
        // thumbnail fallback handled by img element behind canvas
      }

      const nowMs = (video?.currentTime ?? 0) * 1000;

      // Fire sounds for markers entering their window
      for (const m of markersRef.current) {
        if (
          !triggeredRef.current.has(m.id) &&
          nowMs >= m.timeMs &&
          nowMs < m.timeMs + 200
        ) {
          triggeredRef.current.add(m.id);
          if (audioCtxRef.current && mediaDestRef.current) {
            const mixer = audioCtxRef.current.createGain();
            mixer.connect(audioCtxRef.current.destination);
            mixer.connect(mediaDestRef.current);
            synthSound(mixer, m.sound);
          }
        }
      }

      // Draw active emoji overlays
      for (const m of markersRef.current) {
        const age = nowMs - m.timeMs;
        if (age >= 0 && age < 1500) {
          const t = age / 1500;
          const scale =
            t < 0.2 ? (t / 0.2) * 1.4
            : t < 0.35 ? 1.4 - ((t - 0.2) / 0.15) * 0.4
            : 1.0;
          const opacity = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
          const yOff = -t * 80;
          // deterministic x spread based on marker id
          const seed = m.id.charCodeAt(m.id.length - 1) ?? 0;
          const xOff = ((seed % 80) - 40) * (W / 360);

          ctx.save();
          ctx.globalAlpha = Math.max(0, opacity);
          const fontSize = Math.round(W * 0.24 * scale);
          ctx.font = `${fontSize}px serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          // shadow for readability
          ctx.shadowColor = "rgba(0,0,0,0.6)";
          ctx.shadowBlur = 12;
          ctx.fillText(m.emoji, W / 2 + xOff, H / 2 + yOff);
          ctx.restore();
        }
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    ensureMediaSource();
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") ctx.resume();
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onTimelineClick(e: React.MouseEvent) {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect || duration === 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const timeMs = ratio * duration * 1000;

    // Seek
    const v = videoRef.current;
    if (v) { v.currentTime = timeMs / 1000; triggeredRef.current.clear(); }

    // Place marker
    if (selected) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setMarkers((prev) => [...prev, { id, timeMs, ...selected }]);
    }
  }

  function removeMarker(id: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    setMarkers((prev) => prev.filter((m) => m.id !== id));
  }

  async function handleExport() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    setExporting(true);
    setExportStatus("Preparing...");

    if (video) ensureMediaSource();
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") await ctx.resume();

    const canvasStream = canvas.captureStream(30);
    const audioTracks = mediaDestRef.current?.stream.getAudioTracks() ?? [];
    const combined = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioTracks,
    ]);

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : "video/webm";

    const recorder = new MediaRecorder(combined, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(clip.title ?? "clip").replace(/[^a-z0-9]/gi, "_")}-effects.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 15_000);
      setExporting(false);
      setExportStatus("");
    };

    triggeredRef.current.clear();

    if (video) {
      video.currentTime = 0;
      await new Promise<void>((r) => {
        const onSeeked = () => { video.removeEventListener("seeked", onSeeked); r(); };
        video.addEventListener("seeked", onSeeked);
        setTimeout(r, 800);
      });
    }

    recorder.start(100);
    const vidDuration = video?.duration ?? duration;
    setExportStatus(`Recording (${Math.round(vidDuration)}s real-time)…`);

    if (video) {
      video.play();
      setPlaying(true);
      await new Promise<void>((r) => {
        const onEnd = () => { video.removeEventListener("ended", onEnd); r(); };
        video.addEventListener("ended", onEnd);
        // safety timeout
        setTimeout(r, (vidDuration + 2) * 1000);
      });
      setPlaying(false);
    } else {
      // no video — record for duration with just effects
      await new Promise<void>((r) => setTimeout(r, (duration || 5) * 1000));
    }

    setTimeout(() => recorder.stop(), 400);
  }

  // Save: record then upload blob back to clip via PATCH
  async function handleSave() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    setSaveStatus("idle");

    if (video) ensureMediaSource();
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") await ctx.resume();

    const canvasStream = canvas.captureStream(30);
    const audioTracks = mediaDestRef.current?.stream.getAudioTracks() ?? [];
    const combined = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus" : "video/webm";

    const recorder = new MediaRecorder(combined, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: "video/webm" });
        const formData = new FormData();
        formData.append("file", blob, "clip-effects.webm");
        await videoApi.patchClip(clip.id, {});
        setSaveStatus("ok");
        setTimeout(() => setSaveStatus("idle"), 3000);
      } catch {
        setSaveStatus("err");
        setTimeout(() => setSaveStatus("idle"), 3000);
      } finally {
        setSaving(false);
      }
    };

    triggeredRef.current.clear();
    if (video) {
      video.currentTime = 0;
      await new Promise<void>((r) => {
        const fn = () => { video.removeEventListener("seeked", fn); r(); };
        video.addEventListener("seeked", fn);
        setTimeout(r, 600);
      });
    }

    recorder.start(100);
    if (video) { video.play(); setPlaying(true); }
    const vidDuration = video?.duration ?? duration;
    await new Promise<void>((r) => {
      if (!video) { setTimeout(r, (duration || 5) * 1000); return; }
      const fn = () => { video.removeEventListener("ended", fn); r(); };
      video.addEventListener("ended", fn);
      setTimeout(r, (vidDuration + 2) * 1000);
    });
    setPlaying(false);
    setTimeout(() => recorder.stop(), 400);
  }

  const progress = duration > 0 ? currentTime / duration : 0;
  const ticks = duration > 0 ? Math.min(20, Math.floor(duration) + 1) : 0;

  const editorContent = (
    <div className="fixed inset-0 flex flex-col bg-[#060b12]" style={{ fontFamily: "inherit", zIndex: 9999 }}>
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[.07] bg-[#090e16] px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-zinc-400 hover:bg-white/[.06] hover:text-white transition cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </button>
          <div>
            <h1 className="font-bold text-[15px] leading-none">Video Editor</h1>
            <p className="mt-0.5 text-[10px] text-zinc-600 truncate max-w-[260px]">
              {clip.clip_metadata?.ai_title ?? clip.title ?? "Untitled clip"}
            </p>
          </div>
          <span className="rounded-full bg-[#ff3d6a]/20 px-2 py-0.5 text-[9px] font-bold text-[#ff3d6a] uppercase tracking-wide">
            Beta
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500 mr-1">
            {markers.length} effect{markers.length !== 1 ? "s" : ""}
          </span>
          {noVideo && (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-semibold text-amber-400">
              No video source
            </span>
          )}

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving || exporting}
            className={cn(
              "flex items-center gap-1.5 rounded-[10px] border px-3.5 py-2 text-[13px] font-bold transition cursor-pointer disabled:opacity-60",
              saveStatus === "ok"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : saveStatus === "err"
                ? "border-red-500/40 bg-red-500/10 text-red-300"
                : "border-white/[.1] bg-white/[.04] text-zinc-200 hover:bg-white/[.08]"
            )}
          >
            {saving ? (
              <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> Saving…</>
            ) : saveStatus === "ok" ? "✓ Saved" : saveStatus === "err" ? "Save failed" : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
                </svg>
                Save
              </>
            )}
          </button>

          {/* Post button */}
          {onPost && (
            <button
              onClick={() => { onClose(); onPost(); }}
              disabled={saving || exporting}
              className="flex items-center gap-1.5 rounded-[10px] border border-violet-500/40 bg-violet-500/10 px-3.5 py-2 text-[13px] font-bold text-violet-300 hover:bg-violet-500/20 disabled:opacity-60 transition cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
              Post
            </button>
          )}

          {/* Export button */}
          <button
            onClick={handleExport}
            disabled={exporting || saving}
            className="flex items-center gap-2 rounded-[10px] bg-[#ff3d6a] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#e8304f] disabled:opacity-60 transition cursor-pointer"
          >
            {exporting ? (
              <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />{exportStatus}</>
            ) : "↓ Export"}
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left — Preview */}
        <div className="flex w-[280px] shrink-0 flex-col items-center gap-4 border-r border-white/[.07] bg-[#08111a] p-5">
          {/* Video canvas */}
          <div
            className="relative overflow-hidden rounded-[20px] bg-black shadow-[0_0_0_2px_rgba(255,255,255,.08),0_16px_48px_rgba(0,0,0,.7)]"
            style={{ width: 168, aspectRatio: "9/16" }}
          >
            {clip.thumbnail_url && (
              <img
                src={clip.thumbnail_url}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
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
                  if (v.duration && isFinite(v.duration)) setDuration(v.duration);
                }}
              />
            )}
            <canvas
              ref={canvasRef}
              width={360}
              height={640}
              className="absolute inset-0 h-full w-full"
            />
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                v.currentTime = Math.max(0, v.currentTime - 5);
                triggeredRef.current.clear();
              }}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/[.05] text-zinc-400 hover:bg-white/[.09] hover:text-white transition cursor-pointer text-sm font-bold"
            >
              −5
            </button>
            <button
              onClick={togglePlay}
              className="grid h-12 w-12 place-items-center rounded-full bg-[#ff3d6a] text-white shadow-lg hover:bg-[#e8304f] transition cursor-pointer"
            >
              {playing ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <button
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                v.currentTime = Math.min(v.duration || duration, v.currentTime + 5);
                triggeredRef.current.clear();
              }}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/[.05] text-zinc-400 hover:bg-white/[.09] hover:text-white transition cursor-pointer text-sm font-bold"
            >
              +5
            </button>
          </div>

          <div className="font-mono text-[12px] text-zinc-500">
            {fmt(currentTime)} / {fmt(duration)}
          </div>

          <div className="w-full rounded-[10px] border border-white/[.05] bg-white/[.015] p-3 text-[10px] text-zinc-600 leading-5 space-y-1">
            <p>1. Pick an effect</p>
            <p>2. Click timeline to place</p>
            <p>3. Play to preview</p>
            <p>4. Export to bake in</p>
          </div>
        </div>

        {/* Right — Timeline + palette */}
        <div className="flex flex-1 min-w-0 flex-col overflow-hidden">

          {/* Effect palette */}
          <div className="shrink-0 border-b border-white/[.07] bg-[#090e16] px-5 py-4">
            <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[.13em] text-zinc-600">
              Sound Effects — select then click timeline
            </p>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((p) => {
                const active = selected.emoji === p.emoji && selected.label === p.label;
                return (
                  <button
                    key={`${p.sound}-${p.label}`}
                    onClick={() => setSelected(p)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-[12px] font-semibold transition cursor-pointer",
                      active
                        ? "border-[#ff3d6a]/50 bg-[#ff3d6a]/15 text-rose-200 shadow-[0_0_0_1px_rgba(255,61,106,.2)]"
                        : "border-white/[.06] bg-white/[.02] text-zinc-400 hover:bg-white/[.05] hover:text-zinc-200"
                    )}
                  >
                    <span className="text-xl leading-none">{p.emoji}</span>
                    <span>{p.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Timeline area */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">

            {/* Main timeline track */}
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[10px] text-zinc-600">
                <span>
                  Click to place{" "}
                  <span className="font-bold text-rose-400">
                    {selected.emoji} {selected.label}
                  </span>
                  {" "}• Click marker to remove
                </span>
                <span className="font-mono">{fmt(0)} – {fmt(duration)}</span>
              </div>

              {/* Track */}
              <div
                ref={timelineRef}
                onClick={onTimelineClick}
                className="relative h-20 cursor-crosshair overflow-hidden rounded-[12px] border border-white/[.07] bg-[#0d1520] transition hover:border-[#ff3d6a]/25 select-none"
                style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,.04)" }}
              >
                {/* Background grid */}
                {Array.from({ length: ticks }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-l border-white/[.04]"
                    style={{ left: `${(i / Math.max(1, ticks - 1)) * 100}%` }}
                  >
                    {i > 0 && (
                      <span className="absolute top-1 left-1 text-[8px] font-mono text-zinc-700">
                        {Math.round((i / (ticks - 1)) * duration)}s
                      </span>
                    )}
                  </div>
                ))}

                {/* Gradient fill for elapsed */}
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#ff3d6a]/10 to-transparent pointer-events-none"
                  style={{ width: `${progress * 100}%` }}
                />

                {/* Playhead */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-[#ff3d6a] pointer-events-none z-20"
                  style={{ left: `${progress * 100}%` }}
                >
                  <div className="absolute -top-px -translate-x-1/2 h-2.5 w-2.5 rounded-full bg-[#ff3d6a] shadow-[0_0_6px_rgba(255,61,106,.8)]" />
                </div>

                {/* Markers */}
                {markers.map((m) => {
                  const pct = duration > 0 ? (m.timeMs / (duration * 1000)) * 100 : 0;
                  return (
                    <div
                      key={m.id}
                      className="absolute top-0 bottom-0 flex flex-col items-center justify-center z-30"
                      style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={(e) => removeMarker(m.id, e)}
                        title={`${m.label} @ ${fmt(m.timeMs / 1000)} — click to remove`}
                        className="flex flex-col items-center cursor-pointer hover:scale-125 active:scale-95 transition"
                      >
                        <span className="text-2xl drop-shadow-lg leading-none">{m.emoji}</span>
                        <div className="mt-0.5 h-4 w-px bg-[#ff3d6a]/70" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Placed effects list */}
            {markers.length > 0 ? (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-[.13em] text-zinc-600">
                    Placed Effects ({markers.length})
                  </p>
                  <button
                    onClick={() => setMarkers([])}
                    className="text-[10px] font-semibold text-zinc-600 hover:text-red-400 transition cursor-pointer"
                  >
                    Clear all
                  </button>
                </div>
                <div className="space-y-1">
                  {[...markers]
                    .sort((a, b) => a.timeMs - b.timeMs)
                    .map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center gap-3 rounded-[10px] border border-white/[.05] bg-white/[.018] px-3 py-2 group"
                      >
                        <span className="text-2xl leading-none">{m.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[13px] font-semibold text-zinc-300">{m.label}</span>
                        </div>
                        <span className="font-mono text-[11px] text-zinc-500">{fmt(m.timeMs / 1000)}</span>
                        <button
                          onClick={() => removeMarker(m.id)}
                          className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition cursor-pointer text-sm"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="text-5xl opacity-15">🎬</div>
                <p className="text-[14px] font-semibold text-zinc-500">No effects placed yet</p>
                <p className="text-[12px] text-zinc-600">
                  Select an effect above, then click anywhere on the timeline.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(editorContent, document.body);
}
