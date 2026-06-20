import type { BrainstormSession, VideoIdea } from "@/lib/api";
import { AgentStepper } from "./AgentStepper";
import { AGENT_DESC, AGENT_LABELS } from "./constants";

function scoreTone(score: number) {
  if (score >= 80) return { label: "Strong", copy: "Prioritize this angle", className: "text-emerald-300 bg-emerald-500/10 border-emerald-400/20" };
  if (score >= 60) return { label: "Promising", copy: "Test with a sharper hook", className: "text-amber-300 bg-amber-500/10 border-amber-400/20" };
  return { label: "Risky", copy: "Needs a stronger twist", className: "text-red-300 bg-red-500/10 border-red-400/20" };
}

function splitVerdict(verdict: string) {
  const paragraphs = verdict.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const title = paragraphs[0]?.replace(/^\*+|\*+$/g, "") ?? "Niche verdict";
  const body = paragraphs.slice(1).join("\n\n") || paragraphs[0] || "";
  const sentences = body.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  return {
    title,
    summary: sentences.slice(0, 2).join(" "),
    caution: sentences.find(s => /caution|risk|however|but\b/i.test(s)) ?? sentences[2] ?? "Validate the angle with a small batch before scaling production.",
    nextMove: sentences.find(s => /must|should|to succeed|recommend/i.test(s)) ?? sentences[sentences.length - 1] ?? "Pick one differentiated angle and make a pilot video.",
  };
}

export function OverviewTab({ session, ideas }: { session: BrainstormSession; ideas: VideoIdea[] }) {
  const isRunning = session.status === "running" || session.status === "draft";
  const avgScore = ideas.length ? Math.round(ideas.reduce((s, i) => s + (i.virality_score ?? 0), 0) / ideas.length) : 0;
  const strongCount = ideas.filter(i => (i.virality_score ?? 0) >= 80).length;
  const topFormat = ideas.reduce<Record<string, number>>((acc, i) => {
    const f = i.format?.replace(/_/g, " ") || "Unspecified";
    acc[f] = (acc[f] ?? 0) + 1;
    return acc;
  }, {});
  const dominantFormat = Object.entries(topFormat).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  const tone = scoreTone(avgScore);

  return (
    <div className="flex flex-col gap-5">
      {/* Agent stepper */}
      <div className="rounded-[18px] border border-white/[.07] bg-white/[.02] p-4">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Agent pipeline</p>
          {isRunning && session.current_agent && (
            <p className="text-[11px] text-zinc-500">
              <span className="font-semibold text-rose-300">{AGENT_LABELS[session.current_agent]}</span>
              {" — "}{AGENT_DESC[session.current_agent] ?? "Working…"}
            </p>
          )}
        </div>
        <AgentStepper current={session.current_agent} completed={session.agents_completed} />
      </div>

      {/* Stats row */}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
        {[
          [ideas.length || "—", "ranked ideas"],
          [strongCount || "—", "strong bets"],
          [dominantFormat, "dominant format"],
        ].map(([value, label]) => (
          <div key={String(label)} className="rounded-[14px] border border-white/[.06] bg-white/[.025] px-4 py-3">
            <p className="truncate text-[15px] font-black text-white">{value}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-zinc-600">{label}</p>
          </div>
        ))}
        {avgScore > 0 && (
          <div className={`rounded-[14px] border px-4 py-3 ${tone.className}`}>
            <p className="text-[18px] font-black leading-none">{avgScore}</p>
            <p className="mt-1 text-[10px] font-bold">{tone.label}</p>
          </div>
        )}
      </div>

      {/* Verdict brief — only when complete */}
      {session.niche_verdict && (() => {
        const parsed = splitVerdict(session.niche_verdict);
        return (
          <div className="rounded-[18px] border border-white/[.07] bg-white/[.02] p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-600">Niche verdict</p>
            <h3 className="mt-1 text-[17px] font-black text-white">{parsed.title}</h3>
            <div className="mt-4 grid gap-3 lg:grid-cols-[1.15fr_.85fr]">
              <div className="rounded-[14px] border border-white/[.06] bg-black/20 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">Executive read</p>
                <p className="mt-2 text-[13px] leading-6 text-zinc-300">{parsed.summary}</p>
              </div>
              <div className="grid gap-3">
                <div className="rounded-[14px] border border-amber-400/15 bg-amber-400/[.04] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300/70">Watch-out</p>
                  <p className="mt-2 text-[12px] leading-5 text-zinc-400">{parsed.caution}</p>
                </div>
                <div className="rounded-[14px] border border-emerald-400/15 bg-emerald-400/[.04] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/70">Suggested move</p>
                  <p className="mt-2 text-[12px] leading-5 text-zinc-400">{parsed.nextMove}</p>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Running state — no ideas yet */}
      {isRunning && ideas.length === 0 && (
        <div className="rounded-[18px] border border-white/[.07] bg-white/[.02] p-8 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#ff3d6a]/30 border-t-[#ff3d6a]" />
          <p className="mt-3 text-[12px] font-semibold text-zinc-400">Agents are researching your niche…</p>
          <p className="mt-1 text-[11px] text-zinc-600">Results appear in the Ideas tab as each agent finishes.</p>
        </div>
      )}
    </div>
  );
}
