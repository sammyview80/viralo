import type { BrainstormSession } from "@/lib/api";
import { AGENTS, AGENT_LABELS, AGENT_DESC } from "./constants";

export function AnalysisTab({ verdict, session }: { verdict: string | null; session: BrainstormSession }) {
  const completed = session.agents_completed ?? [];

  return (
    <div className="flex flex-col gap-5">
      {/* Full verdict text */}
      {verdict ? (
        <div className="rounded-[18px] border border-white/[.07] bg-white/[.02] p-5">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-600">Full analysis</p>
          <p className="whitespace-pre-wrap text-[13px] leading-7 text-zinc-300">{verdict}</p>
        </div>
      ) : (
        <div className="rounded-[18px] border border-dashed border-white/[.08] bg-white/[.015] p-6 text-center">
          <p className="text-[12px] text-zinc-500">Full analysis not available yet.</p>
        </div>
      )}

      {/* Agent completion list */}
      <div className="rounded-[18px] border border-white/[.07] bg-white/[.02] p-5">
        <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-600">Agent breakdown</p>
        <div className="space-y-2">
          {AGENTS.map(a => {
            const isDone = completed.includes(a);
            return (
              <div key={a} className={`flex items-start gap-3 rounded-[12px] border p-3 ${isDone ? "border-emerald-500/15 bg-emerald-500/[.04]" : "border-white/[.05] bg-white/[.01]"}`}>
                <span className={`mt-0.5 text-[12px] ${isDone ? "text-emerald-400" : "text-zinc-600"}`}>{isDone ? "✓" : "○"}</span>
                <div>
                  <p className={`text-[12px] font-bold ${isDone ? "text-emerald-300" : "text-zinc-500"}`}>{AGENT_LABELS[a]}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-600">{AGENT_DESC[a]}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
