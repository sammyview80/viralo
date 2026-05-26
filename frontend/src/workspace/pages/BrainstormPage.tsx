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
const EXAMPLE_TOPICS = ["AI fitness coach", "Street food Nepal", "Solo travel tips", "Budget skincare"];

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

function sessionProgress(session: BrainstormSession | null) {
  if (!session) return 0;
  if (session.status === "complete") return 100;
  if (session.status === "failed") return Math.max(8, ((session.agents_completed?.length ?? 0) / AGENTS.length) * 100);
  const completed = session.agents_completed?.length ?? 0;
  const activeBoost = session.current_agent ? 0.5 : 0;
  return Math.min(96, Math.round(((completed + activeBoost) / AGENTS.length) * 100));
}

function statusClasses(status: BrainstormSession["status"]) {
  if (status === "complete") return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/20";
  if (status === "running") return "bg-[#ff3d6a]/15 text-rose-300 ring-[#ff3d6a]/20";
  if (status === "failed") return "bg-red-500/15 text-red-300 ring-red-500/20";
  return "bg-white/[.05] text-zinc-400 ring-white/[.08]";
}

/* ─── Agent step indicator ─── */
function AgentSteps({ current, completed }: { current: string | null; completed: string[] | null }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {AGENTS.map((a, i) => {
        const isDone = completed?.includes(a);
        const isActive = current === a;
        return (
          <div
            key={a}
            className={`rounded-[12px] border p-3 transition ${
              isDone ? "border-emerald-500/20 bg-emerald-500/[.06]" :
              isActive ? "border-[#ff3d6a]/30 bg-[#ff3d6a]/[.07]" :
              "border-white/[.06] bg-white/[.018]"
            }`}
          >
            <div className="flex items-center gap-2">
              <div
                className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-black ${
                  isDone ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30" :
                  isActive ? "animate-pulse bg-[#ff3d6a]/20 text-rose-200 ring-1 ring-[#ff3d6a]/40" :
                  "bg-white/[.05] text-zinc-500"
                }`}
              >
                {isDone ? "✓" : i + 1}
              </div>
              <div className="min-w-0">
                <p className={`text-[11px] font-bold ${isActive ? "text-rose-200" : isDone ? "text-emerald-300" : "text-zinc-300"}`}>
                  {AGENT_LABELS[a]}
                </p>
                <p className="truncate text-[10px] text-zinc-600">{isActive ? "Working now" : isDone ? "Complete" : "Queued"}</p>
              </div>
            </div>
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
      className="group cursor-pointer rounded-[16px] border border-white/[.07] bg-[#0c111b]/80 p-4 transition hover:-translate-y-0.5 hover:border-white/[.14] hover:bg-white/[.035]"
      style={{ animation: `fadeUp .25s ${index * 40}ms cubic-bezier(.22,.8,.4,1) both` }}
      onClick={() => setOpen(o => !o)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/[.05] text-[10px] font-black text-zinc-400">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-5 text-white">{idea.title}</p>
            <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-zinc-500">“{idea.hook}”</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1 rounded-full border px-2 py-0.5" style={{ borderColor: `${color}30`, background: `${color}10` }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            <span className="font-mono text-[11px] font-bold" style={{ color }}>{sc}</span>
          </div>
          <span className="text-[9px] text-zinc-600">{open ? "Close" : "Details"}</span>
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
            <p className="text-[12px] leading-5 text-zinc-300">“{idea.hook}”</p>
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

/* ─── Session row ─── */
function SessionRow({ session, onSelect, active }: { session: BrainstormSession; onSelect: () => void; active: boolean }) {
  const statusColor = session.status === "complete" ? "#34d399" : session.status === "running" ? "#ff3d6a" : session.status === "failed" ? "#f87171" : "#71717a";
  const progress = sessionProgress(session);
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-[14px] border px-3 py-3 text-left transition hover:border-white/[.14] ${active ? "border-[#ff3d6a]/35 bg-[#ff3d6a]/[.06]" : "border-white/[.06] bg-white/[.018]"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold text-white">{session.name || session.topic}</p>
          <p className="mt-0.5 truncate text-[10px] text-zinc-600">{formatRelative(session.created_at)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
          <span className="text-[10px] capitalize" style={{ color: statusColor }}>{session.status}</span>
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[.05]">
        <div className="h-full rounded-full bg-[#ff3d6a] transition-all" style={{ width: `${progress}%` }} />
      </div>
    </button>
  );
}

function EmptyState({ onPickExample }: { onPickExample: (topic: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10">
      <div className="rounded-[24px] border border-white/[.07] bg-gradient-to-br from-white/[.055] to-white/[.015] p-6 shadow-2xl shadow-black/20">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#ff3d6a]/20 bg-[#ff3d6a]/10 px-3 py-1 text-[11px] font-bold text-rose-200">
          ✦ AI content strategy room
        </div>
        <h2 className="max-w-2xl text-[28px] font-black leading-tight tracking-tight text-white sm:text-[34px]">
          Turn a niche into clear, ranked video ideas.
        </h2>
        <p className="mt-3 max-w-2xl text-[13px] leading-6 text-zinc-500">
          Six agents scan trends, competitors, audience angles, monetization fit, and content formats, then synthesize a verdict with 10 video ideas you can expand.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            ["6", "specialized agents"],
            ["10", "ranked video ideas"],
            ["1", "niche verdict"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-[16px] border border-white/[.06] bg-black/20 p-4">
              <p className="text-[24px] font-black text-white">{value}</p>
              <p className="mt-1 text-[11px] text-zinc-500">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-[20px] border border-white/[.07] bg-white/[.02] p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">What you get</p>
          <div className="mt-4 space-y-3">
            {[
              ["Trend read", "Formats, hooks, and momentum signals for the niche."],
              ["Market map", "Creator gaps and competitor angles worth attacking."],
              ["Idea stack", "Titles, hooks, format, estimated views, and virality score."],
            ].map(([title, copy]) => (
              <div key={title} className="flex gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-[#ff3d6a]" />
                <div>
                  <p className="text-[12px] font-bold text-zinc-200">{title}</p>
                  <p className="mt-0.5 text-[11px] leading-5 text-zinc-600">{copy}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[20px] border border-white/[.07] bg-white/[.02] p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Try a topic</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {EXAMPLE_TOPICS.map(example => (
              <button
                key={example}
                onClick={() => onPickExample(example)}
                className="rounded-full border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-[11px] font-semibold text-zinc-300 transition hover:border-[#ff3d6a]/35 hover:bg-[#ff3d6a]/10 hover:text-rose-100"
              >
                {example}
              </button>
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-5 text-zinc-600">
            Tip: use a focused niche like “meal prep for busy nurses” instead of a broad category like “food”.
          </p>
        </section>
      </div>
    </div>
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
  const progress = sessionProgress(selected);

  return (
    <Shell active="brainstorm">
      <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(255,61,106,.08),transparent_34%),#06080d]">
        {/* Header */}
        <div className="border-b border-white/[.07] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Brainstorm Room
              </div>
              <h1 className="font-display text-[26px] font-black tracking-tight text-white sm:text-[30px]">Build your next viral angle</h1>
              <p className="mt-1 max-w-2xl text-[13px] leading-6 text-zinc-500">
                Give the agents a niche. Get a verdict, research path, and ranked video ideas without leaving this room.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 lg:w-[360px]">
              {[
                [sessions.length, "Sessions"],
                [sessions.filter(s => s.status === "complete").length, "Done"],
                [sessions.filter(s => s.status === "running" || s.status === "draft").length, "Running"],
              ].map(([value, label]) => (
                <div key={label} className="rounded-[14px] border border-white/[.06] bg-white/[.025] px-3 py-2">
                  <p className="text-[16px] font-black text-white">{value}</p>
                  <p className="text-[10px] text-zinc-600">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Sidebar — session list */}
          <div className="flex shrink-0 flex-col gap-4 overflow-y-auto border-b border-white/[.07] p-4 lg:w-80 lg:border-b-0 lg:border-r">
            {/* New session input */}
            <div className="rounded-[20px] border border-white/[.07] bg-white/[.025] p-3 shadow-xl shadow-black/10">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-[12px] font-bold text-white">New brainstorm</p>
                  <p className="text-[10px] text-zinc-600">Focused topics work best</p>
                </div>
                <span className="rounded-full bg-[#ff3d6a]/10 px-2 py-1 text-[10px] font-bold text-rose-300">6 agents</span>
              </div>
              <textarea
                value={topic}
                onChange={e => setTopic(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreate(); } }}
                placeholder="Enter a niche or topic…"
                rows={4}
                className="w-full resize-none rounded-[14px] border border-white/[.08] bg-[#0d1320] px-3 py-3 text-[12px] leading-5 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/40"
              />
              {error && <p className="mt-2 text-[10px] text-red-400">{error}</p>}
              <button
                onClick={handleCreate}
                disabled={creating || !topic.trim()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#ff3d6a] px-3 py-3 text-[12px] font-black text-white transition hover:bg-[#ff5580] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? (
                  <><span className="inline-block h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" /> Starting…</>
                ) : "✦ Run Brainstorm"}
              </button>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {EXAMPLE_TOPICS.slice(0, 3).map(example => (
                  <button key={example} onClick={() => setTopic(example)} className="rounded-full bg-white/[.04] px-2 py-1 text-[10px] text-zinc-500 transition hover:text-zinc-200">
                    {example}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Sessions</p>
                <span className="text-[10px] text-zinc-700">{sessions.length}</span>
              </div>
              {loading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-16 animate-pulse rounded-[14px] bg-white/[.03]" />)}
                </div>
              ) : sessions.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-white/[.08] bg-white/[.015] p-4 text-center">
                  <p className="text-[11px] font-semibold text-zinc-500">No sessions yet</p>
                  <p className="mt-1 text-[10px] leading-4 text-zinc-700">Run your first brainstorm to save it here.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sessions.map(s => (
                    <SessionRow key={s.id} session={s} active={selected?.id === s.id} onSelect={() => setSelected(s)} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Main panel */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!selected ? (
              <EmptyState onPickExample={setTopic} />
            ) : (
              <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-5 sm:p-6">
                {/* Session header */}
                <div className="rounded-[22px] border border-white/[.07] bg-gradient-to-br from-white/[.05] to-white/[.015] p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-[10px] font-bold capitalize ring-1 ${statusClasses(selected.status)}`}>{selected.status}</span>
                        <span className="text-[10px] text-zinc-600">Created {formatRelative(selected.created_at)}</span>
                      </div>
                      <h2 className="text-[22px] font-black leading-tight text-white">{selected.name || selected.topic}</h2>
                      <p className="mt-1 text-[12px] leading-5 text-zinc-500">Topic: “{selected.topic}”</p>
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
                          className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[10px] font-bold text-red-300 transition hover:bg-red-500/20"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-5">
                    <div className="mb-2 flex items-center justify-between text-[10px] text-zinc-600">
                      <span>Research progress</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/[.05]">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#ff3d6a] to-[#ff8aa8] transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                </div>

                {/* Agent pipeline */}
                <section className="rounded-[20px] border border-white/[.07] bg-white/[.02] p-4">
                  <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Agent pipeline</p>
                    {isRunning && selected.current_agent && (
                      <p className="text-[11px] text-zinc-500">
                        <span className="font-semibold text-rose-300">{AGENT_LABELS[selected.current_agent]}</span>
                        {" — "}{AGENT_DESC[selected.current_agent] ?? "Working…"}
                      </p>
                    )}
                  </div>
                  <AgentSteps current={selected.current_agent} completed={selected.agents_completed} />
                </section>

                {/* Niche verdict */}
                {selected.niche_verdict && (
                  <section className="rounded-[20px] border border-white/[.07] bg-white/[.02] p-5">
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-600">Niche verdict</p>
                    <p className="whitespace-pre-wrap text-[13px] leading-6 text-zinc-300">{selected.niche_verdict}</p>
                  </section>
                )}

                {/* Video ideas */}
                {ideas.length > 0 && (
                  <section className="rounded-[20px] border border-white/[.07] bg-white/[.02] p-4">
                    <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Video ideas</p>
                        <p className="mt-1 text-[11px] text-zinc-600">Ranked concepts with hook, format, and virality score.</p>
                      </div>
                      <span className="text-[10px] text-zinc-600">{ideas.length} ideas · click cards for reasoning</span>
                    </div>
                    <div className="grid gap-3 xl:grid-cols-2">
                      {ideas.map((idea, i) => <IdeaCard key={i} idea={idea} index={i} />)}
                    </div>
                  </section>
                )}

                {/* Running spinner */}
                {isRunning && ideas.length === 0 && (
                  <div className="rounded-[20px] border border-white/[.07] bg-white/[.02] p-8 text-center">
                    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#ff3d6a]/30 border-t-[#ff3d6a]" />
                    <p className="mt-3 text-[12px] font-semibold text-zinc-400">Agents are researching your niche…</p>
                    <p className="mt-1 text-[11px] text-zinc-600">The session will update automatically as each agent finishes.</p>
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
