import { cn } from "@/lib/utils";

export function fmtSec(s: number) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function fmtDur(sec: number | null) {
  if (sec == null) return "—:--";
  return fmtSec(sec);
}

export function gradFromId(id: string) {
  const GRADS = [
    "from-[#FF3D6A] to-[#FF7A3D]", "from-[#3DAAFF] to-[#7B66FF]",
    "from-[#22C55E] to-[#3DAAFF]", "from-[#A855F7] to-[#FF3D6A]",
    "from-[#FF7A3D] to-[#FFB347]",
  ];
  const n = id.charCodeAt(0) + id.charCodeAt(id.length - 1);
  return GRADS[n % GRADS.length];
}

export const PLAT_DISPLAY: Record<string, [string, string]> = {
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

export function PlatPill({ p }: { p: string }) {
  const [lbl, cls] = PLAT_DISPLAY[p] ?? ["?", "bg-zinc-700 text-white"];
  return <span className={cn("inline-grid h-5 w-5 place-items-center rounded-[4px] border border-c-border text-[9px] font-black", cls)}>{lbl}</span>;
}

export function VirChip({ score }: { score: number | null }) {
  if (score == null) return null;
  const color = score >= 75 ? "text-emerald-300 border-emerald-300/30 bg-emerald-400/15"
              : score >= 55 ? "text-yellow-300 border-yellow-300/30 bg-yellow-400/[.12]"
              : "text-c-text-muted border-c-border bg-surface-2";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-[7px] border px-2 py-0.5 text-[11px] font-bold", color)}>
      ⚡ {score}
    </span>
  );
}

export function formatClipTime(seconds: number | undefined) {
  const safe = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}
