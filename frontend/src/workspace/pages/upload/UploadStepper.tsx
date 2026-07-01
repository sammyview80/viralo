import { cn } from "@/lib/utils";

const UPLOAD_STEPS = [
  { label: "Source",       sub: "Upload file or YouTube" },
  { label: "Format",       sub: "Ratio and length" },
  { label: "Clips",        sub: "Length, count, score" },
  { label: "Style",        sub: "AI, captions, quality" },
  { label: "Review",       sub: "Confirm & start" },
] as const;

export function UploadStepper({ step, onStep }: { step: number; onStep: (n: number) => void }) {
  return (
    <div className="flex w-48 flex-none flex-col gap-0 py-1">
      {UPLOAD_STEPS.map((s, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <div key={n} className="flex flex-col">
            <button
              type="button"
              onClick={() => done ? onStep(n) : undefined}
              className={cn("flex items-center gap-3 rounded-[11px] px-3 py-2.5 text-left transition", active ? "bg-white/[.06]" : done ? "hover:bg-white/[.03] cursor-pointer" : "cursor-default")}
            >
              <div className={cn(
                "grid h-8 w-8 flex-none place-items-center rounded-full border text-[13px] font-bold transition",
                active ? "border-[#ff3d6a] bg-[#ff3d6a] text-white shadow-[0_0_14px_rgba(255,61,106,.4)]"
                : done  ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/15 text-[#ff7a9a]"
                :         "border-white/[.12] bg-white/[.04] text-zinc-500"
              )}>
                {done ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg>
                ) : n}
              </div>
              <div className="min-w-0">
                <div className={cn("text-[13px] font-semibold leading-tight", active ? "text-white" : done ? "text-zinc-300" : "text-zinc-500")}>{s.label}</div>
                <div className={cn("mt-0.5 text-[11px] leading-tight", active ? "text-zinc-400" : "text-zinc-600")}>{s.sub}</div>
              </div>
            </button>
            {i < UPLOAD_STEPS.length - 1 && (
              <div className={cn("ml-7 h-5 w-[2px] rounded-full", done ? "bg-[#ff3d6a]/30" : "bg-white/[.07]")} />
            )}
          </div>
        );
      })}
    </div>
  );
}
