import { useState, useEffect, useRef, useCallback } from "react";
import { Shell } from "../Shell";
import { agentApi, type BrainstormSession, type VideoIdea } from "@/lib/api";

/* ─── Helpers ─── */
const AGENTS = ["trend_agent", "competitor_agent", "monetization_agent", "audience_agent", "content_agent", "synthesizer"];
const AGENT_LABELS: Record<string, string> = {
  trend_agent: "Trend",
  competitor_agent: "Competitor",
  monetization_agent: "Monetize",
  audience_agent: "Audience",
  content_agent: "Content",
  synthesizer: "Synthesizer",
};
const AGENT_DESC: Record<string, string> = {
  trend_agent: "Researching trending formats & growth trajectory",
  competitor_agent: "Mapping top creators & content gaps",
  monetization_agent: "Analyzing revenue potential & brand fit",
  audience_agent: "Profiling target demographics & motivations",
  content_agent: "Generating viral video concepts",
  synthesizer: "Synthesizing final verdict & strategy",
};

function scoreColor(s: number) {
  return s >= 75 ? "#34d399" : s >= 50 ? "#fbbf24" : "#f87171";
}

function formatRelative(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ─── Agent step indicator ─── */
function AgentSteps({ current, completed }: { current: string | null; completed: string[] | null }) {
  return (
    <div className="flex items-center gap-0">
      {AGENTS.map((a, i) => {
        const isDone = completed?.includes(a);
        const isActive = current === a;
        const isPending = !isDone && !isActive;
        return (
          <div key={a} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-black transition-all ${
                  isDone ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40" :
                  isActive ? "animate-pulse bg-[#ff3d6a]/20 text-rose-300 ring-1 ring-[#ff3d6a]/50" :
                  "bg-white/[.04] text-zinc-600"
                }`}
              >
                {isDone ? "✓" : i + 1}
              </div>
              <span className={`text-[8px] font-semibold uppercase tracking-wide ${isActive ? "text-rose-300" : isDone ? "text-emerald-400" : "text-zinc-700"}`}>
                {AGENT_LABELS[a]}
              </span>
            </div>
            {i < AGENTS.length - 1 && (
              <div className={`mb-4 h-px w-6 ${isDone ? "bg-emerald-500/40" : "bg-white/[.06]"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Video idea card ─── */
function IdeaCard({ idea, index }: { idea: VideoIdea; index: number }) {
  const [open, setOpen] = useState(false);
  const sc = idea.virality_score ?? 0;
  const color = scoreColor(sc);
  return (
    <div
      className="rounded-[14px] border border-white/[.07] bg-white/[.02] p-4 transition hover:border-white/[.12] cursor-pointer"
      style={{ animation: `fadeUp .25s ${index * 40}ms cubic-bezier(.22,.8,.4,1) both` }}
      onClick={() => setOpen(o => !o)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold leading-5 text-white">{idea.title}</p>
          {open && (
            <div className="mt-3 space-y-2">
              <div className="rounded-[8px] bg-white/[.03] px-3 py-2">
                <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-zinc-600">Hook</p>
                <p className="text-[12px] leading-5 text-zinc-300">"{idea.hook}"</p>
              </div>
              <div className="flex gap-2">
                <span className="rounded-full border border-white/[.06] bg-white/[.03] px-2 py-0.5 text-[10px] text-zinc-500 capitalize">{idea.format?.replace(/_/g, " ")}</span>
                <span className="rounded-full border border-white/[.06] bg-white/[.03] px-2 py-0.5 text-[10px] text-zinc-500 capitalize">{idea.estimated_views_potential}</span>
              </div>
              {idea.reasoning && <p className="text-[11px] leading-[1.5] text-zinc-600">{idea.reasoning}</p>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1 rounded-full border px-2 py-0.5" style={{ borderColor: `${color}30`, background: `${color}10` }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            <span className="font-mono text-[11px] font-bold" style={{ color }}>{sc}</span>
          </div>
          <span className="text-[9px] text-zinc-600">{open ? "▲" : "▼"}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Session row ─── */
function SessionRow({ session, onSelect, active }: { session: BrainstormSession; onSelect: () => void; active: boolean }) {
  const statusColor = session.status === "complete" ? "#34d399" : session.status === "running" ? "#ff3d6a" : session.status === "failed" ? "#f87171" : "#71717a";
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-[12px] border px-3 py-2.5 text-left transition hover:border-white/[.12] ${active ? "border-[#ff3d6a]/30 bg-[#ff3d6a]/05" : "border-white/[.06] bg-white/[.015]"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[12px] font-semibold text-white">{session.name || session.topic}</p>
        <div className="flex shrink-0 items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
          <span className="text-[10px] capitalize" style={{ color: statusColor }}>{session.status}</span>
        </div>
      </div>
      <p className="mt-0.5 truncate text-[10px] text-zinc-600">{formatRelative(session.created_at)}</p>
    </button>
  );
}

/* ─── Main page ─── */
export function BrainstormPage() {
  const [sessions, setSessions] = useState<BrainstormSession[]>([]);
  const [selected, setSelected] = useState<BrainstormSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [topic, setTopic] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await agentApi.listSessions();
      setSessions(res.items);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll selected session if running
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!selected || !["running", "draft"].includes(selected.status)) return;

    pollRef.current = setInterval(async () => {
      try {
        const updated = await agentApi.getSession(selected.id);
        setSelected(updated);
        setSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
        if (!["running", "draft"].includes(updated.status)) {
          clearInterval(pollRef.current!);
        }
      } catch { /* ignore */ }
    }, 3000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selected?.id, selected?.status]);

  async function handleCreate() {
    if (!topic.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const session = await agentApi.createSession(topic.trim());
      await agentApi.runSession(session.id);
      const running = { ...session, status: "running" as const };
      setSessions(prev => [running, ...prev]);
      setSelected(running);
      setTopic("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start session");
    } finally {
      setCreating(false);
    }
  }

  const ideas: VideoIdea[] = selected?.video_ideas ?? [];
  const isRunning = selected?.status === "running" || selected?.status === "draft";

  return (
    <Shell active="brainstorm">
      <div className="flex h-full min-h-0 flex-col gap-0">
        {/* Header */}
        <div className="border-b border-white/[.07] px-6 py-5">
          <h1 className="font-display text-[22px] font-black tracking-tight text-white">Brainstorm Room</h1>
          <p className="mt-0.5 text-[13px] text-zinc-500">Six AI agents research your niche and generate 10 viral video ideas.</p>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Sidebar — session list */}
          <div className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-white/[.07] p-4">
            {/* New session input */}
            <div className="space-y-2">
              <textarea
                value={topic}
                onChange={e => setTopic(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreate(); } }}
                placeholder="Enter a niche or topic…"
                rows={3}
                className="w-full resize-none rounded-[10px] border border-white/[.08] bg-[#0e1420] px-3 py-2 text-[12px] text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/40"
              />
              {error && <p className="text-[10px] text-red-400">{error}</p>}
              <button
                onClick={handleCreate}
                disabled={creating || !topic.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#ff3d6a] px-3 py-2 text-[12px] font-bold text-white transition hover:bg-[#ff5580] disabled:opacity-50"
              >
                {creating ? (
                  <><span className="inline-block h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" /> Starting…</>
                ) : "✦ Run Brainstorm"}
              </button>
            </div>

            <div className="border-t border-white/[.06] pt-3">
              <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-zinc-600">Sessions</p>
              {loading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-12 animate-pulse rounded-[10px] bg-white/[.03]" />)}
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-[11px] text-zinc-700">No sessions yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {sessions.map(s => (
                    <SessionRow key={s.id} session={s} active={selected?.id === s.id} onSelect={() => setSelected(s)} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Main panel */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {!selected ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="text-4xl">✦</div>
                <p className="text-[14px] font-semibold text-zinc-400">Enter a topic and run a brainstorm</p>
                <p className="text-[12px] text-zinc-600">Six agents will research your niche in parallel and generate 10 video ideas.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-5 p-6">
                {/* Session header */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[18px] font-bold text-white">{selected.name || selected.topic}</h2>
                    <p className="mt-0.5 text-[12px] text-zinc-500">"{selected.topic}"</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {selected.status === "failed" && (
                      <button
                        onClick={async () => {
                          try {
                            await agentApi.runSession(selected.id);
                            setSelected(s => s ? { ...s, status: "running" } : s);
                          } catch { /* ignore */ }
                        }}
                        className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[10px] font-bold text-red-400 transition hover:bg-red-500/20"
                      >
                        Retry
                      </button>
                    )}
                    <span className={`rounded-full px-3 py-1 text-[10px] font-bold capitalize ${
                      selected.status === "complete" ? "bg-emerald-500/15 text-emerald-400" :
                      selected.status === "running" ? "bg-[#ff3d6a]/15 text-rose-300" :
                      selected.status === "failed" ? "bg-red-500/15 text-red-400" :
                      "bg-white/[.05] text-zinc-500"
                    }`}>{selected.status}</span>
                  </div>
                </div>

                {/* Agent pipeline */}
                <section className="rounded-[14px] border border-white/[.06] bg-white/[.018] p-4">
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-600">Agent pipeline</p>
                  <AgentSteps current={selected.current_agent} completed={selected.agents_completed} />
                  {isRunning && selected.current_agent && (
                    <p className="mt-3 text-[11px] text-zinc-500">
                      <span className="text-rose-300 font-semibold">{AGENT_LABELS[selected.current_agent]}</span>
                      {" — "}{AGENT_DESC[selected.current_agent] ?? "Working…"}
                    </p>
                  )}
                </section>

                {/* Niche verdict */}
                {selected.niche_verdict && (
                  <section className="rounded-[14px] border border-white/[.06] bg-white/[.018] p-4">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">Niche verdict</p>
                    <p className="text-[13px] leading-6 text-zinc-300 whitespace-pre-wrap">{selected.niche_verdict}</p>
                  </section>
                )}

                {/* Video ideas */}
                {ideas.length > 0 && (
                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Video ideas</p>
                      <span className="text-[10px] text-zinc-600">{ideas.length} ideas · click to expand</span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {ideas.map((idea, i) => <IdeaCard key={i} idea={idea} index={i} />)}
                    </div>
                  </section>
                )}

                {/* Running spinner */}
                {isRunning && ideas.length === 0 && (
                  <div className="flex flex-col items-center gap-3 py-12">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff3d6a]/30 border-t-[#ff3d6a]" />
                    <p className="text-[12px] text-zinc-500">Agents are researching your niche…</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </Shell>
  );
}
