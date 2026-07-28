import type { SeriesOption } from "@/lib/api";
import { CAPTION_STYLES, type Draft } from "./constants";
import { OptionCard, Toggle } from "./OptionCard";

interface StepMusicProps {
  musicTracks: SeriesOption[];
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
}

export function StepMusic({ musicTracks, draft, set }: StepMusicProps) {
  return (
    <div className="grid gap-3">
      <OptionCard
        label="No music"
        desc="Voiceover only"
        selected={draft.music_track === null}
        onClick={() => set("music_track", null)}
      />
      {musicTracks.map((m) => (
        <OptionCard
          key={m.id}
          label={m.label}
          selected={draft.music_track === m.id}
          onClick={() => set("music_track", m.id)}
        />
      ))}
    </div>
  );
}

interface StepArtStyleProps {
  artStyles: SeriesOption[];
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
}

export function StepArtStyle({ artStyles, draft, set }: StepArtStyleProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {artStyles.map((a) => (
        <OptionCard
          key={a.id}
          label={a.label}
          selected={draft.art_style === a.id}
          onClick={() => set("art_style", a.id)}
        />
      ))}
    </div>
  );
}

interface StepCaptionStyleProps {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
}

export function StepCaptionStyle({ draft, set }: StepCaptionStyleProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {CAPTION_STYLES.map((c) => (
        <OptionCard
          key={c.id}
          label={c.label}
          desc={c.desc}
          selected={draft.caption_style === c.id}
          onClick={() => set("caption_style", c.id)}
        />
      ))}
    </div>
  );
}

interface StepEffectsProps {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
}

export function StepEffects({ draft, set }: StepEffectsProps) {
  const effects = [
    { id: "glitch", label: "Glitch effect", desc: "Short glitch transitions between scenes" },
    { id: "animated_hook", label: "Animated hook", desc: "Extra motion on the first scene to grab attention" },
  ];

  return (
    <div className="grid gap-3">
      {effects.map((fx) => (
        <div key={fx.id} className="flex items-center gap-3 rounded-[14px] border border-c-border bg-surface-1 p-4">
          <div className="flex-1">
            <p className="text-[14px] font-bold text-c-text">{fx.label}</p>
            <p className="text-[12.5px] text-c-text-muted">{fx.desc}</p>
          </div>
          <Toggle
            on={Boolean(draft.effects[fx.id])}
            onChange={() => set("effects", { ...draft.effects, [fx.id]: !draft.effects[fx.id] })}
          />
        </div>
      ))}
    </div>
  );
}
