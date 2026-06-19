"use client";
import { useState } from "react";
import type { VideoIdea } from "@/lib/api";

function scoreColor(s: number) {
  return s >= 75 ? "#34d399" : s >= 50 ? "#fbbf24" : "#f87171";
}

export function IdeaCard({ idea, index }: { idea: VideoIdea; index: number }) {
  const [open, setOpen] = useState(false);
  const sc = idea.virality_score ?? 0;
  const color = scoreColor(sc);
  return (
    <div
      className="group cursor-pointer rounded-[16px] border border-white/[.07] bg-[#0c111b]/80 p-4 transition hover:-translate-y-0.5 hover:border-white/[.14] hover:bg-white/[.035]"
      style={{ animation: `fadeUp .25s ${index * 40}ms cubic-bezier(.22,.8,.4,1) both` }}
      onClick={() => setOpen(o => !o)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/[.06] bg-white/[.04] text-[10px] font-black text-zinc-400">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-5 text-white">{idea.title}</p>
            <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-zinc-500">"{idea.hook}"</p>
          </div>
        </div>
        <div className="flex w-[74px] shrink-0 flex-col items-end gap-1.5">
          <div className="flex items-center gap-1 rounded-full border px-2 py-0.5" style={{ borderColor: `${color}30`, background: `${color}10` }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            <span className="font-mono text-[11px] font-bold" style={{ color }}>{sc}</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/[.06]">
            <div className="h-full rounded-full" style={{ width: `${Math.max(4, Math.min(100, sc))}%`, background: color }} />
          </div>
          <span className="text-[9px] text-zinc-600">{open ? "Hide" : "Expand"}</span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 pl-9">
        <span className="rounded-full border border-white/[.06] bg-white/[.03] px-2 py-0.5 text-[10px] text-zinc-500 capitalize">{idea.format?.replace(/_/g, " ")}</span>
        <span className="rounded-full border border-white/[.06] bg-white/[.03] px-2 py-0.5 text-[10px] text-zinc-500 capitalize">{idea.estimated_views_potential}</span>
      </div>
      {open && (
        <div className="mt-3 space-y-2 pl-9">
          <div className="rounded-[10px] border border-white/[.05] bg-white/[.03] px-3 py-2">
            <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-zinc-600">Hook</p>
            <p className="text-[12px] leading-5 text-zinc-300">"{idea.hook}"</p>
          </div>
          {idea.reasoning && (
            <div className="rounded-[10px] border border-white/[.05] bg-white/[.02] px-3 py-2">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-zinc-600">Why it can work</p>
              <p className="text-[11px] leading-[1.6] text-zinc-500">{idea.reasoning}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
