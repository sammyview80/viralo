import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { navigate } from "@/lib/router";
import {
  seriesApi, platformApi,
  type SeriesOptions, type SocialAccount,
} from "@/lib/api";

const CAPTION_STYLES = [
  { id: "capcut", label: "CapCut", desc: "Clean pill captions, word-by-word highlight" },
  { id: "capcut-bold", label: "CapCut Bold", desc: "Heavier weight, bigger presence" },
  { id: "tiktok", label: "TikTok", desc: "Classic TikTok-style boxed captions" },
  { id: "word-pop", label: "Word Pop", desc: "One big word at a time" },
  { id: "beast", label: "Beast", desc: "Loud MrBeast-style color pops" },
  { id: "neon", label: "Neon", desc: "Glowing neon on dark box" },
  { id: "karaoke", label: "Karaoke", desc: "Words light up as spoken" },
  { id: "minimal", label: "Minimal", desc: "Subtle, clean, no boxes" },
];

const NICHE_DESCRIPTIONS: Record<string, string> = {
  "crime-heists": "Real criminal cases and heists — meticulous planning, shocking aftermath, justice served or cases gone cold.",
  "scary-stories": "Scary stories that give you goosebumps.",
  "history": "Viral videos about history, from ancient times to the modern day.",
  "greek-mythology": "Shocking and dramatic stories from Greek mythology.",
  "historical-figures": "Life stories in one-minute videos about important historical figures.",
  "true-crime": "Gripping true-crime style mysteries.",
  "stoic-motivation": "Stoic wisdom and motivation with memorable lessons.",
  "good-morals": "Short fable-like stories with a strong moral.",
};

// Mirror of /series/options — used while loading or if the fetch fails.
export const FALLBACK_OPTIONS: SeriesOptions = {
  niches: [
    { id: "crime-heists", label: "Crime & Heists" },
    { id: "scary-stories", label: "Scary Stories" },
    { id: "history", label: "History" },
    { id: "greek-mythology", label: "Greek Mythology" },
    { id: "historical-figures", label: "Historical Figures" },
    { id: "true-crime", label: "True Crime" },
    { id: "stoic-motivation", label: "Stoic Motivation" },
    { id: "good-morals", label: "Good Morals" },
  ],
  voices: [
    { id: "en-US-GuyNeural", label: "Guy — deep American male" },
    { id: "en-US-ChristopherNeural", label: "Christopher — calm narrator" },
    { id: "en-US-JennyNeural", label: "Jenny — warm American female" },
    { id: "en-US-AriaNeural", label: "Aria — expressive female" },
    { id: "en-GB-RyanNeural", label: "Ryan — British male" },
    { id: "en-AU-NatashaNeural", label: "Natasha — Australian female" },
  ],
  art_styles: [
    { id: "comic", label: "Comic" },
    { id: "creepy-comic", label: "Creepy Comic" },
    { id: "modern-cartoon", label: "Modern Cartoon" },
    { id: "disney", label: "Disney" },
    { id: "anime", label: "Anime" },
    { id: "realistic", label: "Realistic" },
    { id: "pixel", label: "Pixel" },
    { id: "watercolor", label: "Watercolor" },
  ],
  music_tracks: [
    { id: "hype", label: "Hype — energetic" },
    { id: "dramatic", label: "Dramatic — tense build" },
    { id: "chill", label: "Chill — laid back" },
  ],
  cadences: [
    { id: "daily", label: "Every day" },
    { id: "3x_week", label: "3× per week" },
    { id: "weekly", label: "Once a week" },
  ],
};

const STEPS = [
  { title: "Choose your niche", sub: "Select a preset or describe your own niche" },
  { title: "Language & Voice", sub: "Pick the narrator for your videos" },
  { title: "Background Music", sub: "Set the mood under the voiceover", optional: true },
  { title: "Art Style", sub: "The visual look of every scene" },
  { title: "Caption Style", sub: "How burned-in captions appear" },
  { title: "Effects", sub: "Extra visual polish", optional: true },
  { title: "Connect Social Accounts", sub: "Where finished videos get posted", optional: true },
  { title: "Series Details", sub: "Name, duration and publish schedule" },
] as const;

type Draft = {
  name: string;
  niche: string;
  custom_prompt: string;
  example_script: string;
  voice: string;
  music_track: string | null;
  art_style: string;
  caption_style: string;
  effects: Record<string, boolean>;
  duration_sec: number;
  social_account_ids: string[];
  publish_time: string;
  cadence: "daily" | "3x_week" | "weekly";
  auto_publish: boolean;
};

const DEFAULT_DRAFT: Draft = {
  name: "", niche: "crime-heists", custom_prompt: "", example_script: "",
  voice: "en-US-GuyNeural", music_track: null, art_style: "comic",
  caption_style: "capcut", effects: {}, duration_sec: 65, social_account_ids: [],
  publish_time: "18:00", cadence: "daily", auto_publish: true,
};

function OptionCard({ label, desc, selected, onClick }: {
  label: string; desc?: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative w-full cursor-pointer rounded-[14px] border p-4 text-left transition",
        selected ? "border-[#ff3d6a] bg-[#ff3d6a]/[.07]" : "border-c-border bg-surface-1 hover:bg-surface-2"
      )}
    >
      {selected && (
        <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-[#ff3d6a]">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5}><path d="M20 6L9 17l-5-5"/></svg>
        </span>
      )}
      <p className="pr-6 text-[14px] font-bold capitalize text-c-text">{label}</p>
      {desc && <p className="mt-1 text-[12.5px] text-c-text-muted">{desc}</p>}
    </button>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button type="button" onClick={onChange}
      className={cn("relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors", on ? "bg-[#ff3d6a]" : "bg-surface-3")}>
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left]", on ? "left-[calc(100%-22px)]" : "left-0.5")} />
    </button>
  );
}

export function SeriesCreatePage() {
  const [options, setOptions] = useState<SeriesOptions>(FALLBACK_OPTIONS);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [nicheTab, setNicheTab] = useState<"presets" | "custom">("presets");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    seriesApi.options().then(setOptions).catch(() => null);
    platformApi.listAccounts()
      .then((l) => {
        const active = l.filter((a) => a.is_active);
        setAccounts(active);
        setDraft((d) => ({ ...d, social_account_ids: active.map((a) => a.id) }));
      })
      .catch(() => null);
  }, []);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const canContinue = useMemo(() => {
    if (step === 0) return nicheTab === "presets" ? Boolean(draft.niche) : draft.custom_prompt.trim().length > 10;
    if (step === 7) return draft.name.trim().length > 0;
    return true;
  }, [step, nicheTab, draft]);

  const submit = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      await seriesApi.create({
        ...draft,
        niche: nicheTab === "custom" ? "custom" : draft.niche,
        custom_prompt: nicheTab === "custom" ? draft.custom_prompt.trim() : null,
        example_script: draft.example_script.trim() || null,
        language: "en",
      });
      navigate("/series");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create series");
      setSaving(false);
    }
  }, [draft, nicheTab]);

  const meta = STEPS[step];

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-8">
      {/* Segmented progress */}
      <div className="mb-8 flex gap-2">
        {STEPS.map((_, i) => (
          <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= step ? "bg-[#ff3d6a]" : "bg-surface-3")} />
        ))}
      </div>

      <div className="mb-1 flex items-center gap-3">
        <h1 className="font-display text-[24px] font-bold text-c-text">{meta.title}</h1>
        <span className="rounded-full border border-[#ff3d6a]/30 bg-[#ff3d6a]/[.08] px-3 py-1 text-[11.5px] font-bold text-[#ff7a9a]">
          Step {step + 1} of {STEPS.length}
        </span>
        {"optional" in meta && meta.optional && (
          <span className="rounded-full border border-c-border px-2.5 py-1 text-[11px] font-semibold text-c-text-muted">Optional</span>
        )}
      </div>
      <p className="mb-7 text-[13.5px] text-c-text-muted">{meta.sub}</p>

      <div className="min-h-[320px]">
        {step === 0 && (
          <>
            <div className="mb-4 flex gap-6 border-b border-c-border">
              {(["presets", "custom"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setNicheTab(t)}
                  className={cn("cursor-pointer border-b-2 pb-2.5 text-[13.5px] font-bold capitalize transition",
                    nicheTab === t ? "border-[#ff3d6a] text-[#ff7a9a]" : "border-transparent text-c-text-muted hover:text-c-text")}>
                  {t}
                </button>
              ))}
            </div>
            {nicheTab === "presets" ? (
              <div className="grid gap-3">
                {options.niches.map((n) => (
                  <OptionCard key={n.id} label={n.label} desc={NICHE_DESCRIPTIONS[n.id]}
                    selected={draft.niche === n.id} onClick={() => set("niche", n.id)} />
                ))}
              </div>
            ) : (
              <>
                <p className="mb-1.5 text-[12.5px] font-bold text-c-text-secondary">Niche description</p>
                <textarea value={draft.custom_prompt} onChange={(e) => set("custom_prompt", e.target.value)} maxLength={5000}
                  placeholder="Describe your niche… e.g. daily facts about deep sea creatures with an ominous tone"
                  className="h-32 w-full rounded-[12px] border border-c-border bg-surface-1 p-3.5 text-[13px] text-c-text outline-none placeholder:text-c-text-muted focus:border-[#ff3d6a]/50" />
                <p className="mb-1.5 mt-4 text-[12.5px] font-bold text-c-text-secondary">Example script <span className="font-medium text-c-text-muted">(optional)</span></p>
                <textarea value={draft.example_script} onChange={(e) => set("example_script", e.target.value)} maxLength={2000}
                  placeholder="Paste an example script so the AI matches its tone and style."
                  className="h-28 w-full rounded-[12px] border border-c-border bg-surface-1 p-3.5 text-[13px] text-c-text outline-none placeholder:text-c-text-muted focus:border-[#ff3d6a]/50" />
              </>
            )}
          </>
        )}

        {step === 1 && (
          <div className="grid gap-3">
            {options.voices.map((v) => (
              <OptionCard key={v.id} label={v.label} selected={draft.voice === v.id} onClick={() => set("voice", v.id)} />
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3">
            <OptionCard label="No music" desc="Voiceover only" selected={draft.music_track === null} onClick={() => set("music_track", null)} />
            {options.music_tracks.map((m) => (
              <OptionCard key={m.id} label={m.label} selected={draft.music_track === m.id} onClick={() => set("music_track", m.id)} />
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {options.art_styles.map((a) => (
              <OptionCard key={a.id} label={a.label} selected={draft.art_style === a.id} onClick={() => set("art_style", a.id)} />
            ))}
          </div>
        )}

        {step === 4 && (
          <div className="grid grid-cols-2 gap-3">
            {CAPTION_STYLES.map((c) => (
              <OptionCard key={c.id} label={c.label} desc={c.desc} selected={draft.caption_style === c.id} onClick={() => set("caption_style", c.id)} />
            ))}
          </div>
        )}

        {step === 5 && (
          <div className="grid gap-3">
            {[
              { id: "glitch", label: "Glitch effect", desc: "Short glitch transitions between scenes" },
              { id: "animated_hook", label: "Animated hook", desc: "Extra motion on the first scene to grab attention" },
            ].map((fx) => (
              <div key={fx.id} className="flex items-center gap-3 rounded-[14px] border border-c-border bg-surface-1 p-4">
                <div className="flex-1">
                  <p className="text-[14px] font-bold text-c-text">{fx.label}</p>
                  <p className="text-[12.5px] text-c-text-muted">{fx.desc}</p>
                </div>
                <Toggle on={Boolean(draft.effects[fx.id])}
                  onChange={() => set("effects", { ...draft.effects, [fx.id]: !draft.effects[fx.id] })} />
              </div>
            ))}
          </div>
        )}

        {step === 6 && (
          accounts.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-c-border p-8 text-center">
              <p className="text-[13px] text-c-text-muted">No social accounts connected yet.</p>
              <button type="button" onClick={() => navigate("/integrations")}
                className="mt-2 cursor-pointer text-[13px] font-bold text-[#ff7a9a] hover:underline">Connect an account →</button>
              <p className="mt-3 text-[12px] text-c-text-muted">You can skip this — videos will still generate for review.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {accounts.map((a) => {
                const on = draft.social_account_ids.includes(a.id);
                return (
                  <div key={a.id} className="flex items-center gap-3 rounded-[14px] border border-c-border bg-surface-1 p-4">
                    <div className="flex-1">
                      <p className="text-[14px] font-bold capitalize text-c-text">{a.platform}</p>
                      {a.platform_username && <p className="text-[12.5px] text-c-text-muted">@{a.platform_username}</p>}
                    </div>
                    <Toggle on={on}
                      onChange={() => set("social_account_ids", on ? draft.social_account_ids.filter((i) => i !== a.id) : [...draft.social_account_ids, a.id])} />
                  </div>
                );
              })}
              <div className="mt-1 flex items-center gap-3 rounded-[14px] border border-c-border bg-surface-1 p-4">
                <div className="flex-1">
                  <p className="text-[14px] font-bold text-c-text">Auto-publish</p>
                  <p className="text-[12.5px] text-c-text-muted">Post automatically without manual review</p>
                </div>
                <Toggle on={draft.auto_publish} onChange={() => set("auto_publish", !draft.auto_publish)} />
              </div>
            </div>
          )
        )}

        {step === 7 && (
          <div className="grid gap-5">
            <div>
              <p className="mb-1.5 text-[12.5px] font-bold text-c-text-secondary">Series name</p>
              <input value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={255}
                placeholder="e.g. Midnight Horror Stories"
                className="h-[48px] w-full rounded-[12px] border border-c-border bg-surface-1 px-4 text-[13.5px] text-c-text outline-none placeholder:text-c-text-muted focus:border-[#ff3d6a]/50" />
            </div>
            <div>
              <p className="mb-1.5 text-[12.5px] font-bold text-c-text-secondary">Video duration</p>
              <div className="flex flex-wrap gap-2">
                {[[45, "≈45 seconds"], [65, "60–70s · Monetizable"], [90, "≈90 seconds"]].map(([v, l]) => (
                  <button key={v} type="button" onClick={() => set("duration_sec", v as number)}
                    className={cn("cursor-pointer rounded-full border px-4 py-2 text-[12.5px] font-semibold transition",
                      draft.duration_sec === v ? "border-[#ff3d6a] bg-[#ff3d6a]/[.08] text-[#ff7a9a]" : "border-c-border text-c-text-muted hover:text-c-text")}>{l}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="mb-1.5 text-[12.5px] font-bold text-c-text-secondary">Publish time (UTC)</p>
                <input type="time" value={draft.publish_time} onChange={(e) => set("publish_time", e.target.value)}
                  className="h-[44px] rounded-[12px] border border-c-border bg-surface-1 px-3.5 text-[13.5px] text-c-text outline-none" />
              </div>
              <div>
                <p className="mb-1.5 text-[12.5px] font-bold text-c-text-secondary">Frequency</p>
                <div className="flex gap-2">
                  {options.cadences.map((c) => (
                    <button key={c.id} type="button" onClick={() => set("cadence", c.id as Draft["cadence"])}
                      className={cn("cursor-pointer rounded-full border px-3.5 py-2 text-[12.5px] font-semibold transition",
                        draft.cadence === c.id ? "border-[#ff3d6a] bg-[#ff3d6a]/[.08] text-[#ff7a9a]" : "border-c-border text-c-text-muted hover:text-c-text")}>{c.label}</button>
                  ))}
                </div>
              </div>
            </div>
            <p className="text-[12px] text-c-text-muted">Videos are generated 6 hours before the scheduled publish time so you have time to review them.</p>
          </div>
        )}
      </div>

      {error && <p className="mt-4 text-[12px] font-medium text-red-400">{error}</p>}

      {/* Footer nav */}
      <div className="mt-10 flex items-center justify-between">
        <button type="button" onClick={() => (step === 0 ? navigate("/series") : setStep((s) => s - 1))}
          className="cursor-pointer rounded-[11px] border border-c-border px-5 py-2.5 text-[13px] font-semibold text-c-text-muted transition hover:text-c-text">
          {step === 0 ? "Cancel" : "← Back"}
        </button>
        {step < STEPS.length - 1 ? (
          <Button disabled={!canContinue} onClick={() => setStep((s) => s + 1)}
            className="rounded-[11px] bg-[#ff3d6a] px-6 py-2.5 text-[13px] font-bold text-white disabled:opacity-50">
            Continue →
          </Button>
        ) : (
          <Button disabled={!canContinue || saving} onClick={submit}
            className="rounded-[11px] bg-gradient-to-r from-[#ff3d6a] to-[#ff7a3d] px-6 py-2.5 text-[13px] font-bold text-white disabled:opacity-50">
            {saving ? "Creating…" : "✦ Create Series"}
          </Button>
        )}
      </div>
    </div>
  );
}
