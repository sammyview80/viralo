import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { platforms } from "./data";
import type { Tone } from "./types";

export function DotIcon({ label, tone = "rose" }: { label: string; tone?: Tone }) {
  const tones: Record<Tone, string> = {
    rose: "border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-rose-200",
    blue: "border-sky-300/20 bg-sky-400/10 text-sky-200",
    green: "border-emerald-300/20 bg-emerald-400/10 text-emerald-200",
    violet: "border-violet-300/20 bg-violet-400/10 text-violet-200",
    orange: "border-orange-300/20 bg-orange-400/10 text-orange-200",
  };
  return <span className={cn("grid h-9 w-9 place-items-center rounded-[9px] border text-[11px] font-black", tones[tone])}>{label}</span>;
}

export function Platform({ id }: { id: string }) {
  const p = platforms.find(([x]) => x === id) ?? platforms[0];
  return <span className={cn("grid h-6 w-6 place-items-center rounded-[5px] border border-white/10 text-[10px] font-black text-white", p[3])}>{p[2]}</span>;
}

export function Phone({ label = "5 habits that changed my mornings" }: { label?: string }) {
  return (
    <div className="mx-auto max-w-[260px] rounded-[22px] border border-white/10 bg-zinc-950 p-2 shadow-2xl">
      <div className="aspect-[9/16] overflow-hidden rounded-[16px] bg-gradient-to-br from-[#ff3d6a] via-[#ff7a3d] to-[#3daaff] p-4">
        <div className="flex justify-between text-[10px] font-semibold text-white/80"><span>00:47</span><span>9:16</span></div>
        <div className="mt-28 rounded-xl bg-black/25 p-3 backdrop-blur">
          <div className="text-lg font-black leading-5">{label}</div>
          <div className="mt-2 h-1.5 w-24 rounded-full bg-white/70" />
          <div className="mt-1.5 h-1.5 w-16 rounded-full bg-white/50" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2"><div className="h-12 rounded-lg bg-white/20" /><div className="h-12 rounded-lg bg-white/30" /><div className="h-12 rounded-lg bg-white/15" /></div>
      </div>
    </div>
  );
}

export function HeroBlock({ title, copy }: { title: string; copy: string }) {
  return <Card className="p-4 sm:p-6"><div className="max-w-3xl"><div className="mb-3 text-[11px] font-bold uppercase tracking-[.16em] text-[#ff7a9a]">Viralo</div><h1 className="page-title font-display text-2xl font-extrabold sm:text-4xl">{title}</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400 sm:mt-4">{copy}</p></div></Card>;
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="app-panel rounded-[12px] p-4"><div className="mb-3 text-xs font-semibold tracking-[-0.01em] text-zinc-400">{title}</div>{children}</div>;
}

export function ChipRow({ items, active }: { items: string[]; active: string[] }) {
  return <div className="flex flex-wrap gap-2">{items.map((x) => <span key={x} className={cn("rounded-lg border px-3 py-1.5 text-xs font-semibold transition", active.includes(x) ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10 text-rose-200" : "border-white/[.07] bg-white/[.025] text-zinc-500 hover:border-white/[.12] hover:text-zinc-300")}>{x}</span>)}</div>;
}

export function SelectLike({ value }: { value: string }) {
  return <div className="rounded-[9px] border border-white/[.07] bg-white/[.035] px-3 py-2 text-sm text-zinc-300 shadow-[inset_0_1px_0_rgba(255,255,255,.025)]">{value}</div>;
}

export function Slider({ value }: { value: string }) {
  return <div><div className="h-2 rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-[#ff3d6a]" style={{ width: `${value}%` }} /></div><div className="mt-2 text-right font-mono text-xs text-zinc-400">{value}</div></div>;
}

export function Ring({ value }: { value: number }) {
  const c = 213.6;
  return <div className="relative h-[76px] w-[76px]"><svg className="-rotate-90" height="76" width="76"><circle cx="38" cy="38" fill="none" r="34" stroke="rgba(255,255,255,.06)" strokeWidth="5.5" /><circle cx="38" cy="38" fill="none" r="34" stroke="#ff3d6a" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} strokeLinecap="round" strokeWidth="5.5" /></svg><div className="absolute inset-0 grid place-items-center font-display text-lg font-bold">{value}</div></div>;
}

export function UrlImport() {
  return <div className="space-y-5"><div><label className="text-xs font-semibold text-zinc-400">YouTube URL</label><div className="mt-2 flex flex-col gap-3 sm:flex-row"><Input className="h-11" placeholder="https://youtube.com/watch?v=..." /><Button variant="secondary">Fetch</Button></div></div><Panel title="Clip count"><ChipRow items={["1", "3", "5"]} active={["3"]} /></Panel><Button className="w-full">Import & Clip</Button></div>;
}

export function UploadZone({ compact }: { compact?: boolean }) {
  return <div className={cn("grid place-items-center rounded-[18px] border border-dashed border-white/15 bg-white/[.02] p-5 text-center transition hover:border-[#ff3d6a]/35 hover:bg-[#ff3d6a]/[.025] sm:p-8", compact ? "min-h-56" : "min-h-[260px] sm:min-h-[320px]")}><div><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-xl font-black text-[#ff7a9a]">UP</div><h2 className="font-display text-xl font-bold sm:text-2xl">Drop your video here</h2><p className="mt-2 text-sm text-zinc-500">MP4, MOV, WebM up to 500 MB.</p><Button variant="secondary" className="mt-5">Browse files</Button></div></div>;
}

export function Row({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return <div className="grid grid-cols-[40px_1fr_auto] items-center gap-3 rounded-xl border border-white/[.06] bg-white/[.025] p-3 transition hover:border-white/[.1] hover:bg-white/[.04]"><DotIcon label={icon} /><div className="min-w-0"><div className="truncate text-sm font-semibold">{title}</div><div className="truncate text-xs text-zinc-500">{sub}</div></div><span className="text-zinc-600">›</span></div>;
}

export function Agent({ name, active }: { name: string; active: boolean }) {
  return <Card className="p-5"><DotIcon label={name.slice(0, 2).toUpperCase()} tone={active ? "green" : "rose"} /><h3 className="mt-4 font-semibold">{name} agent</h3><p className="mt-2 text-sm text-zinc-500">{active ? "Running research pass." : "Ready."}</p></Card>;
}

export function Idea({ title }: { title: string }) {
  return <div className="rounded-xl border border-white/[.06] bg-white/[.025] p-4"><div className="text-sm font-semibold">{title}</div><div className="mt-3 flex gap-2"><Badge variant="ready">score 84</Badge><Badge>hook</Badge></div></div>;
}

export function Bars({ tall }: { tall?: boolean }) {
  const bars = [42, 55, 38, 70, 64, 82, 74, 93, 88, 106, 98, 118, 110, 132];
  const max = Math.max(...bars);
  return <div className={cn("flex items-end gap-2", tall ? "h-[280px]" : "h-[240px]")}>{bars.map((v, i) => <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-[#ff3d6a]/55 to-[#ff7a3d]" style={{ height: `${(v / max) * 100}%` }} />)}</div>;
}

export function Trend({ title, score }: { title: string; score: number }) {
  return <Card className="p-5"><div className="flex items-start justify-between"><DotIcon label="HOT" tone="orange" /><div className="font-display text-2xl font-bold">{score}</div></div><h3 className="mt-4 font-semibold">{title}</h3><p className="mt-2 text-sm text-zinc-500">Rising velocity across creator niches.</p></Card>;
}
