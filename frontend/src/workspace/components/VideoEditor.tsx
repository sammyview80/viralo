import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { type ClipApiResponse, videoApi } from "@/lib/api";
import { VideoPlayer } from "./editor/VideoPlayer";
import { Timeline, type EffectMarker } from "./editor/Timeline";
import { TrimBar } from "./editor/TrimBar";
import { CaptionEditor, type Caption } from "./editor/CaptionEditor";
import { SoundEffectPalette, PALETTE, type PaletteItem, type SoundType } from "./editor/SoundEffectPalette";

/* ─── Audio synthesis (unchanged) ─── */
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

type EditorTab = "trim" | "captions" | "effects";

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
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "err">("idle");
  const [noVideo] = useState(!clip.storage_url);

  /* Keep refs in sync for rAF loop */
  useEffect(() => { markersRef.current = markers; }, [markers]);
  useEffect(() => { captionsRef.current = captions; }, [captions]);
  useEffect(() => {
    if (duration > 0 && trimEnd === 0) setTrimEnd(duration);
  }, [duration, trimEnd]);

  /* ─── Audio helpers ─── */
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
    } catch { /* already captured or CORS blocked */ }
  }

  /* ─── Canvas animation loop — video frames + emoji + caption overlays ─── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const video = videoRef.current;

      if (video && video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, W, H);
      }

      const nowMs = (video?.currentTime ?? 0) * 1000;

      // Fire sounds
      for (const m of markersRef.current) {
        if (!triggeredRef.current.has(m.id) && nowMs >= m.timeMs && nowMs < m.timeMs + 200) {
          triggeredRef.current.add(m.id);
          if (audioCtxRef.current && mediaDestRef.current) {
            const mixer = audioCtxRef.current.createGain();
            mixer.connect(audioCtxRef.current.destination);
            mixer.connect(mediaDestRef.current);
            synthSound(mixer, m.sound as SoundType);
          }
        }
      }

      // Draw emoji overlays
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

      // Draw active captions
      const nowSec = (video?.currentTime ?? 0);
      for (const cap of captionsRef.current) {
        if (nowSec >= cap.startSec && nowSec <= cap.endSec) {
          const yPos = cap.position === "top" ? H * 0.1 : cap.position === "center" ? H * 0.5 : H * 0.88;
          ctx.save();
          ctx.font = `bold ${cap.fontSize}px sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 8;
          ctx.fillStyle = cap.color;
          ctx.fillText(cap.text, W / 2, yPos);
          ctx.restore();
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
    const v = videoRef.current;
    if (!v) return;
    ensureMediaSource();
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") ctx.resume();
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSeekDelta = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || duration, v.currentTime + delta));
    triggeredRef.current.clear();
  }, [duration]);

  /* ─── Markers ─── */
  function addMarker(timeMs: number) {
    const v = videoRef.current;
    if (v) { v.currentTime = timeMs / 1000; triggeredRef.current.clear(); }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setMarkers((prev) => [...prev, { id, timeMs, sound: selected.sound, emoji: selected.emoji, label: selected.label }]);
  }

  function removeMarker(id: string) {
    setMarkers((prev) => prev.filter((m) => m.id !== id));
  }

  /* ─── Export ─── */
  async function handleExport() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setExporting(true); setExportStatus("Preparing...");
    if (video) ensureMediaSource();
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") await ctx.resume();
    const canvasStream = canvas.captureStream(30);
    const audioTracks = mediaDestRef.current?.stream.getAudioTracks() ?? [];
    const combined = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") ? "video/webm;codecs=vp8,opus" : "video/webm";
    const recorder = new MediaRecorder(combined, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${clip.id ?? "clip"}-edited.webm`;
      a.click(); URL.revokeObjectURL(url);
      setExporting(false); setExportStatus("");
    };
    triggeredRef.current.clear();
    if (video) {
      video.currentTime = trimStart;
      await new Promise<void>((r) => {
        const fn = () => { video.removeEventListener("seeked", fn); r(); };
        video.addEventListener("seeked", fn); setTimeout(r, 600);
      });
    }
    setExportStatus("Recording...");
    recorder.start(100);
    if (video) { video.play(); setPlaying(true); }
    const exportDuration = (trimEnd || duration) - trimStart;
    await new Promise<void>((r) => {
      if (!video) { setTimeout(r, (exportDuration + 2) * 1000); return; }
      const fn = () => { video.removeEventListener("ended", fn); r(); };
      video.addEventListener("ended", fn);
      setTimeout(r, (exportDuration + 2) * 1000);
    });
    setPlaying(false);
    setTimeout(() => recorder.stop(), 400);
  }

  /* ─── Save ─── */
  async function handleSave() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true); setSaveStatus("idle");
    if (video) ensureMediaSource();
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") await ctx.resume();
    const canvasStream = canvas.captureStream(30);
    const audioTracks = mediaDestRef.current?.stream.getAudioTracks() ?? [];
    const combined = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") ? "video/webm;codecs=vp8,opus" : "video/webm";
    const recorder = new MediaRecorder(combined, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: "video/webm" });
        const formData = new FormData();
        formData.append("file", blob, "clip-effects.webm");
        await videoApi.patchClip(clip.id, {});
        setSaveStatus("ok"); setTimeout(() => setSaveStatus("idle"), 3000);
      } catch {
        setSaveStatus("err"); setTimeout(() => setSaveStatus("idle"), 3000);
      } finally { setSaving(false); }
    };
    triggeredRef.current.clear();
    if (video) {
      video.currentTime = 0;
      await new Promise<void>((r) => {
        const fn = () => { video.removeEventListener("seeked", fn); r(); };
        video.addEventListener("seeked", fn); setTimeout(r, 600);
      });
    }
    recorder.start(100);
    if (video) { video.play(); setPlaying(true); }
    const vidDuration = video?.duration ?? duration;
    await new Promise<void>((r) => {
      if (!video) { setTimeout(r, (duration || 5) * 1000); return; }
      const fn = () => { video.removeEventListener("ended", fn); r(); };
      video.addEventListener("ended", fn); setTimeout(r, (vidDuration + 2) * 1000);
    });
    setPlaying(false); setTimeout(() => recorder.stop(), 400);
  }

  /* ─── Tab content ─── */
  const TABS: { id: EditorTab; label: string }[] = [
    { id: "trim",    label: "Trim" },
    { id: "captions", label: "Captions" },
    { id: "effects",  label: "Effects" },
  ];

  const tabContent = (
    <div className="flex-1 overflow-y-auto p-4 min-h-0">
      {activeTab === "trim" && (
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[.12em] text-zinc-600">Trim</p>
            <p className="text-[11px] text-zinc-500 mb-3">Drag handles to set start and end points.</p>
            <TrimBar
              duration={duration}
              startSec={trimStart}
              endSec={trimEnd || duration}
              onChange={(s, e) => { setTrimStart(s); setTrimEnd(e); }}
            />
          </div>
          {duration > 0 && (
            <div className="rounded-[10px] border border-white/[.05] bg-white/[.015] p-3 space-y-1.5 text-[11px] text-zinc-500">
              <div className="flex justify-between"><span>Clip start</span><span className="font-mono text-zinc-300">{trimStart.toFixed(1)}s</span></div>
              <div className="flex justify-between"><span>Clip end</span><span className="font-mono text-zinc-300">{(trimEnd || duration).toFixed(1)}s</span></div>
              <div className="flex justify-between"><span>Duration</span><span className="font-mono text-[#ff3d6a]">{((trimEnd || duration) - trimStart).toFixed(1)}s</span></div>
            </div>
          )}
        </div>
      )}

      {activeTab === "captions" && (
        <CaptionEditor
          captions={captions}
          duration={duration}
          onChange={setCaptions}
        />
      )}

      {activeTab === "effects" && (
        <SoundEffectPalette
          selected={selected}
          onSelect={setSelected}
        />
      )}
    </div>
  );

  /* ─── Render ─── */
  const editorContent = (
    <div className="fixed inset-0 flex flex-col bg-[#060b12]" style={{ zIndex: 9999 }}>

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
            <p className="mt-0.5 text-[10px] text-zinc-600 truncate max-w-[200px]">
              {clip.clip_metadata?.ai_title ?? clip.title ?? "Untitled clip"}
            </p>
          </div>
          <span className="rounded-full bg-[#ff3d6a]/20 px-2 py-0.5 text-[9px] font-bold text-[#ff3d6a] uppercase tracking-wide">
            Beta
          </span>
          {noVideo && (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-semibold text-amber-400">
              No video source
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-600 mr-1">{markers.length} effect{markers.length !== 1 ? "s" : ""}</span>

          <button
            onClick={handleSave}
            disabled={saving || exporting}
            className={cn(
              "flex items-center gap-1.5 rounded-[10px] border px-3.5 py-2 text-[13px] font-bold transition cursor-pointer disabled:opacity-60",
              saveStatus === "ok" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : saveStatus === "err" ? "border-red-500/40 bg-red-500/10 text-red-300"
                : "border-white/[.1] bg-white/[.04] text-zinc-200 hover:bg-white/[.08]"
            )}
          >
            {saving ? <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> Saving…</>
              : saveStatus === "ok" ? "✓ Saved"
              : saveStatus === "err" ? "Save failed"
              : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Save</>}
          </button>

          {onPost && (
            <button
              onClick={() => { onClose(); onPost(); }}
              disabled={saving || exporting}
              className="flex items-center gap-1.5 rounded-[10px] border border-violet-500/40 bg-violet-500/10 px-3.5 py-2 text-[13px] font-bold text-violet-300 hover:bg-violet-500/20 disabled:opacity-60 transition cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              Post
            </button>
          )}

          <button
            onClick={handleExport}
            disabled={exporting || saving}
            className="flex items-center gap-2 rounded-[10px] bg-[#ff3d6a] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#e8304f] disabled:opacity-60 transition cursor-pointer"
          >
            {exporting
              ? <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />{exportStatus}</>
              : "↓ Export"}
          </button>
        </div>
      </div>

      {/* ── Body: left preview + right tools ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left — Video preview */}
        <div className="w-[260px] shrink-0 border-r border-white/[.07] bg-[#08111a]">
          <VideoPlayer
            videoRef={videoRef}
            canvasRef={canvasRef}
            playing={playing}
            currentTime={currentTime}
            duration={duration}
            thumbnailUrl={clip.thumbnail_url ?? undefined}
            storageUrl={clip.storage_url ?? undefined}
            onTogglePlay={togglePlay}
            onSeekDelta={handleSeekDelta}
            onTimeUpdate={setCurrentTime}
            onEnded={() => setPlaying(false)}
            onLoadedMetadata={(d) => {
              setDuration(d);
              setTrimEnd((prev) => prev === 0 ? d : prev);
            }}
          />
        </div>

        {/* Right — Tool panel */}
        <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="shrink-0 flex items-center gap-1 border-b border-white/[.07] bg-[#090e16] px-4 py-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "rounded-[8px] px-4 py-1.5 text-[12px] font-semibold transition cursor-pointer",
                  activeTab === tab.id
                    ? "bg-white/[.08] text-white"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[.04]"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tabContent}
        </div>
      </div>

      {/* ── Bottom Timeline ── */}
      <div className="shrink-0 border-t border-white/[.07] bg-[#08111a]">
        <Timeline
          duration={duration}
          currentTime={currentTime}
          markers={markers}
          selectedEffect={selected}
          trimStart={trimStart}
          trimEnd={trimEnd || duration}
          onSeek={(t) => {
            const v = videoRef.current;
            if (v) { v.currentTime = t; triggeredRef.current.clear(); }
          }}
          onAddMarker={addMarker}
          onRemoveMarker={removeMarker}
        />
      </div>
    </div>
  );

  return createPortal(editorContent, document.body);
}
