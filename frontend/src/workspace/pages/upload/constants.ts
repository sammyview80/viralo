import type { ClipConfig } from "@/lib/api";

export const ASPECT_OPTIONS = ["9:16","1:1","16:9"];

export const ASPECT_DETAILS: Record<string, { title: string; desc: string; badge: string }> = {
  "9:16": { title: "Vertical", desc: "TikTok, Shorts, Reels", badge: "Shorts" },
  "1:1": { title: "Square", desc: "Feed posts", badge: "Feed" },
  "16:9": { title: "Wide", desc: "YouTube, landscape", badge: "YouTube" },
};

export const LENGTH_PRESETS = [
  { id: "short", label: "Short", hint: "Under 60s", min: 15, max: 60 },
  { id: "standard", label: "Standard", hint: "1-2 mins", min: 60, max: 120 },
  { id: "extended", label: "Extended", hint: "3-5 mins", min: 180, max: 300 },
  { id: "custom", label: "Custom", hint: "Manual", min: null, max: null },
] as const;

export const DEFAULT_CONFIG: ClipConfig = {
  max_clips: 3,
  min_score: 0.5,
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

/* ─── Pipeline step label mapping ─── */
export const PROC_STEPS = [
  { keys: ["queued","queue","waiting"],    emoji:"⏳", label:"Queued",                  sub:"Waiting for a worker to become available" },
  { keys: ["download"],                    emoji:"⬇",  label:"Downloading video",       sub:"Fetching from source" },
  { keys: ["upload","uploading"],          emoji:"⬆",  label:"Uploading file",          sub:"Transferring to secure storage" },
  { keys: ["metadata","probe"],            emoji:"🔎", label:"Probing video",           sub:"Reading resolution, duration, codec" },
  { keys: ["transcribe","speech","diarization","topic_segmentation","scene_extraction"], emoji:"📝", label:"Transcribing speech", sub:"AI speech-to-text, speaker ID & segmentation" },
  { keys: ["scoring","analyze","signal","ai_content"], emoji:"⚡", label:"Finding viral moments", sub:"Detecting viral signals & generating AI content" },
  { keys: ["captions","caption","caption_burn","burn"], emoji:"💬", label:"Generating captions", sub:"Building word-level caption timeline" },
  { keys: ["export","render","encode"],    emoji:"🎬", label:"Rendering clips",         sub:"Cutting, cropping, burning captions" },
  { keys: ["complete","done"],             emoji:"✅", label:"Done",                    sub:"All clips ready" },
];

export const STEP_ICONS: Record<string, string> = {
  download: "⬇", upload: "⬆", transcribe: "🎙", scoring: "🧠",
  ai_content: "✍", export: "🎞", captions: "💬", saving: "💾",
  metadata: "🔎", diarization: "👥", topic_segmentation: "📑", scene_extraction: "🎥",
  starting: "🚀", downloading: "⬇", rendering: "🎬", concatenating: "🔗",
  complete: "✅", failed: "✗", cancelled: "⊘",
};

export const STEP_COLORS: Record<string, string> = {
  download: "border-blue-400/20 bg-blue-400/10 text-blue-300",
  upload: "border-purple-400/20 bg-purple-400/10 text-purple-300",
  transcribe: "border-cyan-400/20 bg-cyan-400/10 text-cyan-300",
  scoring: "border-yellow-400/20 bg-yellow-400/10 text-yellow-300",
  ai_content: "border-pink-400/20 bg-pink-400/10 text-pink-300",
  export: "border-orange-400/20 bg-orange-400/10 text-orange-300",
  captions: "border-indigo-400/20 bg-indigo-400/10 text-indigo-300",
  saving: "border-teal-400/20 bg-teal-400/10 text-teal-300",
  metadata: "border-sky-400/20 bg-sky-400/10 text-sky-300",
  diarization: "border-violet-400/20 bg-violet-400/10 text-violet-300",
  topic_segmentation: "border-amber-400/20 bg-amber-400/10 text-amber-300",
  scene_extraction: "border-rose-400/20 bg-rose-400/10 text-rose-300",
  starting: "border-blue-400/20 bg-blue-400/10 text-blue-300",
  downloading: "border-blue-400/20 bg-blue-400/10 text-blue-300",
  rendering: "border-orange-400/20 bg-orange-400/10 text-orange-300",
  concatenating: "border-teal-400/20 bg-teal-400/10 text-teal-300",
  complete: "border-emerald-300/20 bg-emerald-400/10 text-emerald-300",
  cancelled: "border-zinc-400/20 bg-zinc-400/10 text-zinc-400",
};

export const SOCIAL_PLATFORMS = [
  { id: "youtube",   label: "YouTube",   icon: "▶", color: "bg-red-500" },
  { id: "instagram", label: "Instagram", icon: "◎", color: "bg-gradient-to-br from-fuchsia-500 to-orange-400" },
  { id: "tiktok",    label: "TikTok",    icon: "♪", color: "bg-zinc-900" },
  { id: "twitter",   label: "Twitter/X", icon: "𝕏", color: "bg-zinc-100 text-zinc-900" },
  { id: "linkedin",  label: "LinkedIn",  icon: "in", color: "bg-blue-700" },
  { id: "facebook",  label: "Facebook",  icon: "f",  color: "bg-blue-600" },
];

export function pipelineStepIdx(step: string | null): number {
  if (!step) return 0;
  const s = step.toLowerCase();
  const idx = PROC_STEPS.findIndex((p) => p.keys.some((k) => s.includes(k)));
  return idx >= 0 ? idx : 0;
}

export function formatElapsedSince(iso: string | null | undefined, now = Date.now()): string {
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
