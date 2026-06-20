import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { agentApi, type BrainstormSession, type VideoIdea } from "@/lib/api";
import { SessionRow } from "@/components/brainstorm/SessionRow";
import { EmptyState } from "@/components/brainstorm/EmptyState";
import { OverviewTab } from "@/components/brainstorm/OverviewTab";
import { IdeasTab } from "@/components/brainstorm/IdeasTab";
import { AnalysisTab } from "@/components/brainstorm/AnalysisTab";

const EXAMPLE_TOPICS = ["AI fitness coach", "Street food Nepal", "Solo travel tips", "Budget skincare"];

function sessionProgress(session: BrainstormSession | null) {
  if (!session) return 0;
  if (session.status === "complete") return 100;
  if (session.status === "failed") return Math.max(8, ((session.agents_completed?.length ?? 0) / 7) * 100);
  const completed = session.agents_completed?.length ?? 0;
  const activeBoost = session.current_agent ? 0.5 : 0;
  return Math.min(96, Math.round(((completed + activeBoost) / 7) * 100));
}

function statusClasses(status: BrainstormSession["status"]) {
  if (status === "complete") return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/20";
  if (status === "running") return "bg-[#ff3d6a]/15 text-rose-300 ring-[#ff3d6a]/20";
  if (status === "failed") return "bg-red-500/15 text-red-300 ring-red-500/20";
  return "bg-white/[.05] text-zinc-400 ring-white/[.08]";
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

type Tab = "overview" | "ideas" | "analysis";

export function BrainstormPage() {
  const [sessions, setSessions] = useState<BrainstormSession[]>([]);
  const [selected, setSelected] = useState<BrainstormSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [topic, setTopic] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await agentApi.listSessions();
      setSessions(res.items);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!selected || !["running", "draft"].includes(selected.status)) return;
    pollRef.current = setInterval(async () => {
      try {
        const updated = await agentApi.getSession(selected.id);
        setSelected(updated);
        setSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
        if (!["running", "draft"].includes(updated.status)) clearInterval(pollRef.current!);
      } catch { /* ignore */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selected?.id, selected?.status]);

  function handleSelectSession(s: BrainstormSession) {
    setSelected(s);
    setTab("overview");
  }

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
      setTab("overview");
      setTopic("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start session");
    } finally {
      setCreating(false);
    }
  }

  const ideas: VideoIdea[] = useMemo(
    () => [...(selected?.video_ideas ?? [])].sort((a, b) => (b.virality_score ?? 0) - (a.virality_score ?? 0)),
    [selected?.video_ideas],
  );

  const isRunning = selected?.status === "running" || selected?.status === "draft";
  const progress = sessionProgress(selected);

  const tabs: { key: Tab; label: string; badge?: string; disabled?: boolean }[] = [
    { key: "overview", label: "Overview" },
    { key: "ideas", label: "Ideas", badge: isRunning ? "..." : ideas.length > 0 ? String(ideas.length) : undefined },
    { key: "analysis", label: "Full Analysis", disabled: isRunning },
  ];

  return (
    <>
      <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(255,61,106,.08),transparent_34%),#06080d]">
        {/* Page header */}
        <div className="border-b border-white/[.07] px-5 py-5 sm:px-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Brainstorm Room
          </div>
          <h1 className="mt-2 font-display text-[26px] font-black tracking-tight text-white sm:text-[30px]">Build your next viral angle</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-6 text-zinc-500">
            Give the agents a niche. Get a verdict, research path, and ranked video ideas without leaving this room.
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Sidebar */}
          <div className="flex shrink-0 flex-col gap-4 overflow-y-auto border-b border-white/[.07] p-4 lg:w-80 lg:border-b-0 lg:border-r">
            {/* New session input */}
            <div className="rounded-[20px] border border-white/[.07] bg-white/[.025] p-3 shadow-xl shadow-black/10">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-[12px] font-bold text-white">New brainstorm</p>
                  <p className="text-[10px] text-zinc-600">Focused topics work best</p>
                </div>
                <span className="rounded-full bg-[#ff3d6a]/10 px-2 py-1 text-[10px] font-bold text-rose-300">7 agents</span>
              </div>
              <textarea
                value={topic}
                onChange={e => setTopic(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreate(); } }}
                placeholder="Enter a niche or topic..."
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
                  <><span className="inline-block h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" /> Starting...</>
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

            {/* Sessions list */}
            <div className="min-h-0 flex-1">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Sessions</p>
                <span className="text-[10px] text-zinc-700">{sessions.length}</span>
              </div>
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-[14px] bg-white/[.03]" />)}
                </div>
              ) : sessions.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-white/[.08] bg-white/[.015] p-4 text-center">
                  <p className="text-[11px] font-semibold text-zinc-500">No sessions yet</p>
                  <p className="mt-1 text-[10px] leading-4 text-zinc-700">Run your first brainstorm to save it here.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sessions.map(s => (
                    <SessionRow key={s.id} session={s} active={selected?.id === s.id} onSelect={() => handleSelectSession(s)} />
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
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-0 p-5 sm:p-6">
                {/* Lean session header */}
                <div className="mb-5 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-[10px] font-bold capitalize ring-1 ${statusClasses(selected.status)}`}>{selected.status}</span>
                    <span className="text-[10px] text-zinc-600">{formatRelative(selected.created_at)}</span>
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
                  <h2 className="text-[22px] font-black leading-tight text-white">{selected.name || selected.topic}</h2>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-600">
                      <span>Research progress</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[.05]">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#ff3d6a] to-[#ff8aa8] transition-all duration-500" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                </div>

                {/* Tab nav */}
                <div className="mb-5 flex gap-1 border-b border-white/[.07] pb-0">
                  {tabs.map(t => (
                    <button
                      key={t.key}
                      onClick={() => !t.disabled && setTab(t.key)}
                      disabled={t.disabled}
                      className={`flex items-center gap-1.5 rounded-t-[10px] px-4 py-2.5 text-[12px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        tab === t.key
                          ? "border border-b-[#06080d] border-white/[.08] bg-white/[.04] text-white"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {t.label}
                      {t.badge !== undefined && (
                        <span className="rounded-full bg-white/[.08] px-1.5 py-0.5 text-[9px] font-black text-zinc-400">{t.badge}</span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                {tab === "overview" && <OverviewTab session={selected} ideas={ideas} />}
                {tab === "ideas" && <IdeasTab ideas={ideas} />}
                {tab === "analysis" && <AnalysisTab verdict={selected.niche_verdict} session={selected} />}
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
    </>
  );
}
