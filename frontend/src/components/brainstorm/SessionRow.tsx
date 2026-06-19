"use client";

import type { BrainstormSession } from "@/lib/api";

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

function sessionProgress(session: BrainstormSession) {
  const AGENT_COUNT = 7;
  if (session.status === "complete") return 100;
  if (session.status === "failed") return Math.max(8, ((session.agents_completed?.length ?? 0) / AGENT_COUNT) * 100);
  const completed = session.agents_completed?.length ?? 0;
  const activeBoost = session.current_agent ? 0.5 : 0;
  return Math.min(96, Math.round(((completed + activeBoost) / AGENT_COUNT) * 100));
}

export function SessionRow({ session, onSelect, active }: { session: BrainstormSession; onSelect: () => void; active: boolean }) {
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
