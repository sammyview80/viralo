import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { agentApi, type BrainstormSession, type VideoIdea } from "@/lib/api";
import { SessionRow } from "@/components/brainstorm/SessionRow";
import { EmptyState } from "@/components/brainstorm/EmptyState";
import { OverviewTab } from "@/components/brainstorm/OverviewTab";
import { IdeasTab } from "@/components/brainstorm/IdeasTab";
import { AnalysisTab } from "@/components/brainstorm/AnalysisTab";
import { EXAMPLE_TOPICS } from "@/components/brainstorm/constants";

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
  return "bg-surface-2 text-c-text-muted ring-c-border";
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
      <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(255,61,106,.08),transparent_34%),rgb(var(--surface-0))]">
        {/* Page header */}
        <div className="border-b border-c-border px-5 py-4 sm:px-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-c-border bg-surface-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-c-text-muted">
            Brainstorm Room
          </div>
          <h1 className="mt-1.5 font-display text-[22px] font-black tracking-tight text-c-text sm:text-[26px]">Build your next viral angle</h1>
        </div>

        {/* Top input row */}
        <div className="border-b border-c-border px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <textarea
                value={topic}
                onChange={e => setTopic(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCreate(); } }}
                placeholder="Enter a niche or topic…"
                rows={2}
                className="w-full resize-none rounded-[14px] border border-c-border bg-surface-1 px-3.5 py-3 text-[13px] leading-5 text-c-text placeholder:text-c-text-muted focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/40"
              />
              {error && <p className="mt-1.5 text-[10px] text-red-400">{error}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {EXAMPLE_TOPICS.slice(0, 3).map(example => (
                  <button key={example} onClick={() => setTopic(example)} className="rounded-full bg-surface-2 px-2 py-1 text-[10px] text-c-text-muted transition hover:text-c-text">
                    {example}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 pt-0.5">
              <button
                onClick={handleCreate}
                disabled={creating || !topic.trim()}
                className="flex items-center gap-2 rounded-[14px] bg-[#ff3d6a] px-5 py-3 text-[12px] font-black text-white transition hover:bg-[#ff5580] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
              >
                {creating ? (
                  <><span className="inline-block h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" /> Starting...</>
                ) : "✦ Run Brainstorm"}
              </button>
              <span className="rounded-full bg-[#ff3d6a]/10 px-2 py-1 text-[10px] font-bold text-rose-300">7 agents</span>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left sidebar: history */}
          <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-c-border p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-c-text-muted">History</p>
              <span className="text-[10px] text-c-text-muted">{sessions.length}</span>
            </div>
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-[14px] bg-surface-1" />)}
              </div>
            ) : sessions.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-c-border bg-surface-1 p-4 text-center">
                <p className="text-[11px] font-semibold text-c-text-muted">No sessions yet</p>
                <p className="mt-1 text-[10px] leading-4 text-c-text-muted">Run your first brainstorm to save it here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sessions.map(s => (
                  <SessionRow key={s.id} session={s} active={selected?.id === s.id} onSelect={() => handleSelectSession(s)} />
                ))}
              </div>
            )}
          </div>

          {/* Main panel */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!selected ? (
              <EmptyState onPickExample={setTopic} />
            ) : (
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-0 p-2 sm:p-6">
                {/* Lean session header */}
                <div className="mb-5 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-[10px] font-bold capitalize ring-1 ${statusClasses(selected.status)}`}>{selected.status}</span>
                    <span className="text-[10px] text-c-text-muted">{formatRelative(selected.created_at)}</span>
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
                  <h2 className="text-[22px] font-black leading-tight text-c-text">{selected.name || selected.topic}</h2>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[10px] text-c-text-muted">
                      <span>Research progress</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#ff3d6a] to-[#ff8aa8] transition-all duration-500" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                </div>

                {/* Tab nav */}
                <div className="mb-5 flex gap-1 border-b border-c-border pb-0">
                  {tabs.map(t => (
                    <button
                      key={t.key}
                      onClick={() => !t.disabled && setTab(t.key)}
                      disabled={t.disabled}
                      className={`flex items-center gap-1.5 rounded-t-[10px] px-4 py-2.5 text-[12px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        tab === t.key
                          ? "border border-b-surface-0 border-c-border bg-surface-2 text-c-text"
                          : "text-c-text-muted hover:text-c-text-secondary"
                      }`}
                    >
                      {t.label}
                      {t.badge !== undefined && (
                        <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[9px] font-black text-c-text-muted">{t.badge}</span>
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
