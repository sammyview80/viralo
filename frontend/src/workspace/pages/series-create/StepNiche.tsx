import { cn } from "@/lib/utils";
import type { SeriesOption } from "@/lib/api";
import { NICHE_DESCRIPTIONS, type Draft } from "./constants";
import { OptionCard } from "./OptionCard";

interface StepNicheProps {
  nicheTab: "presets" | "custom";
  setNicheTab: (t: "presets" | "custom") => void;
  niches: SeriesOption[];
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
}

export function StepNiche({ nicheTab, setNicheTab, niches, draft, set }: StepNicheProps) {
  return (
    <>
      <div className="mb-4 flex gap-6 border-b border-c-border">
        {(["presets", "custom"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setNicheTab(t)}
            className={cn(
              "cursor-pointer border-b-2 pb-2.5 text-[13.5px] font-bold capitalize transition",
              nicheTab === t ? "border-[#ff3d6a] text-[#ff7a9a]" : "border-transparent text-c-text-muted hover:text-c-text"
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {nicheTab === "presets" ? (
        <div className="grid gap-3">
          {niches.map((n) => (
            <OptionCard
              key={n.id}
              label={n.label}
              desc={NICHE_DESCRIPTIONS[n.id]}
              selected={draft.niche === n.id}
              onClick={() => set("niche", n.id)}
            />
          ))}
        </div>
      ) : (
        <>
          <p className="mb-1.5 text-[12.5px] font-bold text-c-text-secondary">Niche description</p>
          <textarea
            value={draft.custom_prompt}
            onChange={(e) => set("custom_prompt", e.target.value)}
            maxLength={5000}
            placeholder="Describe your niche… e.g. daily facts about deep sea creatures with an ominous tone"
            className="h-32 w-full rounded-[12px] border border-c-border bg-surface-1 p-3.5 text-[13px] text-c-text outline-none placeholder:text-c-text-muted focus:border-[#ff3d6a]/50"
          />
          <p className="mb-1.5 mt-4 text-[12.5px] font-bold text-c-text-secondary">
            Example script <span className="font-medium text-c-text-muted">(optional)</span>
          </p>
          <textarea
            value={draft.example_script}
            onChange={(e) => set("example_script", e.target.value)}
            maxLength={2000}
            placeholder="Paste an example script so the AI matches its tone and style."
            className="h-28 w-full rounded-[12px] border border-c-border bg-surface-1 p-3.5 text-[13px] text-c-text outline-none placeholder:text-c-text-muted focus:border-[#ff3d6a]/50"
          />
        </>
      )}
    </>
  );
}
