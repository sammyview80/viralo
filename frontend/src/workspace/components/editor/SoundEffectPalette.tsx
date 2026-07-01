import { cn } from "@/lib/utils";

export type SoundType = "quack" | "applause" | "ding" | "airhorn" | "womp" | "tada";

export interface PaletteItem {
  sound: SoundType;
  emoji: string;
  label: string;
}

export const PALETTE: PaletteItem[] = [
  { sound: "quack",    emoji: "🦆", label: "Quack" },
  { sound: "applause", emoji: "👏", label: "Applause" },
  { sound: "ding",     emoji: "🔔", label: "Ding" },
  { sound: "airhorn",  emoji: "📯", label: "Airhorn" },
  { sound: "womp",     emoji: "😬", label: "Womp" },
  { sound: "tada",     emoji: "🎉", label: "Tada" },
  { sound: "ding",     emoji: "🔥", label: "Fire" },
  { sound: "tada",     emoji: "❤️", label: "Love" },
  { sound: "applause", emoji: "💯", label: "100" },
  { sound: "womp",     emoji: "💀", label: "Dead" },
  { sound: "ding",     emoji: "⚡", label: "Zap" },
  { sound: "airhorn",  emoji: "🚀", label: "Rocket" },
];

interface SoundEffectPaletteProps {
  selected: PaletteItem;
  onSelect: (item: PaletteItem) => void;
}

export function SoundEffectPalette({ selected, onSelect }: SoundEffectPaletteProps) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-[.12em] text-c-text-muted">
        Sound Effects
      </p>
      <p className="text-[11px] text-c-text-muted">Select an effect, then click the timeline to place it.</p>
      <div className="grid grid-cols-3 gap-1.5">
        {PALETTE.map((p) => {
          const active = selected.emoji === p.emoji && selected.label === p.label;
          return (
            <button
              key={`${p.sound}-${p.label}`}
              onClick={() => onSelect(p)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-[10px] border px-2 py-2.5 text-[11px] font-semibold transition cursor-pointer",
                active
                  ? "border-[#ff3d6a]/50 bg-[#ff3d6a]/15 text-rose-200 shadow-[0_0_0_1px_rgba(255,61,106,.2)]"
                  : "border-c-border bg-surface-1 text-c-text-secondary hover:bg-surface-2 hover:text-c-text"
              )}
            >
              <span className="text-2xl leading-none">{p.emoji}</span>
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
