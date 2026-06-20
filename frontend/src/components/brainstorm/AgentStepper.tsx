import { AGENTS, AGENT_LABELS } from "./constants";

export function AgentStepper({ current, completed }: { current: string | null; completed: string[] | null }) {
  return (
    <div className="flex items-start gap-0 overflow-x-auto pb-1">
      {AGENTS.map((a, i) => {
        const isDone = completed?.includes(a);
        const isActive = current === a;
        const isLast = i === AGENTS.length - 1;
        return (
          <div key={a} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              {/* Connector left */}
              <div className={`h-px flex-1 transition-colors ${i === 0 ? "invisible" : isDone || isActive ? "bg-[#ff3d6a]/40" : "bg-white/[.07]"}`} />
              {/* Step dot */}
              <div
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-black ring-1 transition-all ${
                  isDone
                    ? "bg-emerald-500/20 text-emerald-300 ring-emerald-500/30"
                    : isActive
                    ? "animate-pulse bg-[#ff3d6a]/20 text-rose-200 ring-[#ff3d6a]/40"
                    : "bg-white/[.05] text-zinc-600 ring-white/[.06]"
                }`}
              >
                {isDone ? "✓" : i + 1}
              </div>
              {/* Connector right */}
              <div className={`h-px flex-1 transition-colors ${isLast ? "invisible" : isDone ? "bg-[#ff3d6a]/40" : "bg-white/[.07]"}`} />
            </div>
            <p className={`mt-1.5 text-center text-[9px] font-bold leading-tight ${isActive ? "text-rose-300" : isDone ? "text-emerald-400" : "text-zinc-600"}`}>
              {AGENT_LABELS[a]}
            </p>
          </div>
        );
      })}
    </div>
  );
}
