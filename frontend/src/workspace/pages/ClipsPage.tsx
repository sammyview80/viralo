import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { clips } from "../data";
import { Shell } from "../Shell";
import { Platform } from "../components";

function ClipCard({ title, status, dur, score, views, grad, plats, active, onClick, delay = 0 }: {
  title: string; status: string; dur: string; score: string; views: string; grad: string; plats: string[]; active?: boolean; onClick?: () => void; delay?: number;
}) {
  return (
    <button onClick={onClick} className={cn("overflow-hidden rounded-[12px] border bg-[#0e1420] text-left transition hover:border-[#ff3d6a]/25", active ? "border-[#ff3d6a]/45 shadow-[0_0_0_1px_rgba(255,61,106,.12)]" : "border-white/[.07]")} style={{ animation: `fadeUp .28s ${delay}ms cubic-bezier(.22,.8,.4,1) both` }}>
      <div className={cn("relative aspect-[9/12] bg-gradient-to-br p-3", grad)}>
        <div className="absolute inset-0 bg-black/10" />
        <div className="absolute left-3 top-3 z-[1] flex gap-1">{plats.slice(0, 3).map((p) => <Platform key={p} id={p} />)}</div>
        <div className="absolute inset-0 grid place-items-center"><div className="grid h-10 w-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur">▶</div></div>
        <div className="absolute bottom-3 right-3 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">{dur}</div>
      </div>
      <div className="p-4">
        <div className="line-clamp-2 min-h-10 text-[13px] font-semibold leading-5">{title}</div>
        <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500"><span>{views} views</span><span>May 23</span></div>
        <div className="mt-4 flex items-center justify-between"><Badge variant={status === "ready" ? "ready" : status === "processing" ? "warn" : "muted"}>{status}</Badge><div className="font-display text-xl font-bold">{score}</div></div>
      </div>
    </button>
  );
}

export function ClipsPage() {
  const [selected, setSelected] = useState<string | null>(clips[0][0]);
  const drawer = clips.find(([title]) => title === selected) ?? clips[0];
  return (
    <Shell active="clips">
      <div className="flex min-h-[calc(100vh-116px)] flex-col overflow-hidden rounded-[12px] border border-white/[.07] bg-[#0e1420]">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/[.07] bg-[#0b101a] p-4">
          <h1 className="font-display text-[19px] font-bold tracking-[-.01em]">Clips</h1>
          <span className="rounded-full border border-white/[.07] bg-[#141926] px-2 py-0.5 text-xs font-semibold text-zinc-500">{clips.length}</span>
          <div className="relative min-w-[220px] flex-1"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600">/</span><Input className="h-[34px] pl-8 text-sm" placeholder="Search clips..." /></div>
          <div className="flex rounded-[9px] border border-white/[.07] bg-[#141926] p-1"><button className="rounded-md bg-white/[.06] px-2.5 py-1 text-xs font-semibold">Grid</button><button className="rounded-md px-2.5 py-1 text-xs font-semibold text-zinc-500">List</button></div>
          <Button size="sm">+ New video</Button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-white/[.07] px-4 py-3">{["All clips", "TikTok", "Reels", "Shorts", "Ready", "Processing", "Failed"].map((x, i) => <button key={x} className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold", i === 0 ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10 text-rose-200" : "border-white/[.07] bg-white/[.025] text-zinc-500 hover:text-zinc-200")}>{x}</button>)}</div>
        <div className="grid min-h-0 flex-1 xl:grid-cols-[1fr_360px]">
          <div className="min-h-0 overflow-y-auto p-4"><div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{clips.map(([title, status, dur, score, views, grad, plats], i) => <ClipCard key={title} title={title} status={status} dur={dur} score={score} views={views} grad={grad} plats={[...plats]} active={title === selected} onClick={() => setSelected(title)} delay={i * 35} />)}</div></div>
          <div className="hidden border-l border-white/[.07] bg-[#0b101a] xl:block">
            <div className="flex h-[52px] items-center gap-3 border-b border-white/[.07] px-4"><span className="font-display text-[13px] font-bold">Clip details</span><button className="ml-auto rounded-lg border border-white/[.07] px-2 py-1 text-xs text-zinc-500">•••</button></div>
            <div className="p-4">
              <div className={cn("relative mx-auto aspect-[9/14] max-w-[220px] overflow-hidden rounded-[18px] bg-gradient-to-br", drawer[5])}><div className="absolute inset-0 bg-black/15" /><div className="absolute inset-0 grid place-items-center"><div className="grid h-12 w-12 place-items-center rounded-full bg-white text-zinc-950">▶</div></div><div className="absolute bottom-4 left-4 right-4 h-1 rounded-full bg-white/25"><div className="h-full w-1/3 rounded-full bg-white" /></div></div>
              <h2 className="mt-5 font-display text-lg font-bold leading-6">{drawer[0]}</h2>
              <div className="mt-3 flex items-center gap-2"><Badge variant={drawer[1] === "ready" ? "ready" : "warn"}>{drawer[1]}</Badge><span className="text-xs text-zinc-500">{drawer[2]}</span></div>
              <div className="mt-5 grid grid-cols-3 gap-2">{[["Views", drawer[4]], ["Virality", drawer[3]], ["Format", "9:16"]].map(([l, v]) => <div key={l} className="rounded-[10px] border border-white/[.07] bg-white/[.025] p-3 text-center"><div className="font-display text-lg font-bold">{v}</div><div className="mt-1 text-[10px] uppercase tracking-[.08em] text-zinc-600">{l}</div></div>)}</div>
              <div className="mt-5 space-y-2"><Button className="w-full">Publish</Button><Button className="w-full" variant="secondary">Edit clip</Button><Button className="w-full" variant="ghost">Download</Button></div>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
