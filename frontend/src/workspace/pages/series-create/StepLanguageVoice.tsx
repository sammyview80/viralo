import { cn } from "@/lib/utils";
import type { SeriesOption } from "@/lib/api";
import { LANGUAGES, type Draft } from "./constants";

interface StepLanguageVoiceProps {
  voices: SeriesOption[];
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
}

export function StepLanguageVoice({ voices, draft, set }: StepLanguageVoiceProps) {
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[13.5px] font-bold text-c-text">Language</p>
        <div className="relative">
          <select
            value={draft.language}
            onChange={(e) => set("language", e.target.value)}
            className="h-[48px] w-full appearance-none cursor-pointer rounded-[12px] border border-c-border bg-surface-1 px-4 pr-10 text-[13.5px] font-semibold text-c-text outline-none focus:border-[#ff3d6a]/50"
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id} className="bg-surface-1 text-c-text py-1">
                {l.flag} {l.label}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-c-text-muted">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2.5 text-[13.5px] font-bold text-c-text">Voice Style</p>
        <div className="overflow-hidden rounded-[14px] border border-c-border bg-surface-1 divide-y divide-c-border">
          {voices.map((v) => {
            const selected = draft.voice === v.id;
            const isFemale = v.label.toLowerCase().includes("female");
            const parts = v.label.split(" — ");
            const name = parts[0] || v.label;
            const desc = parts[1] || "";
            return (
              <div
                key={v.id}
                onClick={() => set("voice", v.id)}
                className={cn(
                  "flex items-center justify-between p-4 cursor-pointer transition",
                  selected ? "bg-[#ff3d6a]/[.06]" : "hover:bg-surface-2"
                )}
              >
                <div className="flex items-center gap-3.5">
                  <span
                    className={cn(
                      "grid h-5 w-5 shrink-0 place-items-center rounded-full border transition",
                      selected ? "border-[#ff3d6a] bg-[#ff3d6a]" : "border-c-border bg-transparent"
                    )}
                  >
                    {selected && <span className="h-2 w-2 rounded-full bg-white" />}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-bold text-c-text">{name}</span>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                          isFemale
                            ? "border border-purple-500/30 bg-purple-500/10 text-purple-400"
                            : "border border-blue-500/30 bg-blue-500/10 text-blue-400"
                        )}
                      >
                        {isFemale ? "Female" : "Male"}
                      </span>
                    </div>
                    {desc && <p className="mt-0.5 text-[12.5px] text-c-text-muted">{desc}</p>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if ("speechSynthesis" in window) {
                      window.speechSynthesis.cancel();
                      const u = new SpeechSynthesisUtterance(`Hello! I am ${name}, your narrator.`);
                      window.speechSynthesis.speak(u);
                    }
                  }}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-c-border bg-surface-2 text-c-text transition hover:border-[#ff3d6a] hover:text-[#ff3d6a]"
                  title="Preview voice"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
