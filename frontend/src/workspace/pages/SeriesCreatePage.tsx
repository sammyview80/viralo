import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { navigate } from "@/lib/router";
import {
  seriesApi, platformApi,
  type SeriesOptions, type SocialAccount,
} from "@/lib/api";

import { DEFAULT_DRAFT, FALLBACK_OPTIONS, STEPS, type Draft } from "./series-create/constants";
import { StepNiche } from "./series-create/StepNiche";
import { StepLanguageVoice } from "./series-create/StepLanguageVoice";
import { StepMusic, StepArtStyle, StepCaptionStyle, StepEffects } from "./series-create/StepOptionsGrid";
import { StepSocialAccounts, StepSeriesDetails } from "./series-create/StepSocialAndDetails";

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

  const set = useCallback(<K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
  }, []);

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
        language: draft.language,
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
        {step === 0 && <StepNiche nicheTab={nicheTab} setNicheTab={setNicheTab} niches={options.niches} draft={draft} set={set} />}
        {step === 1 && <StepLanguageVoice voices={options.voices} draft={draft} set={set} />}
        {step === 2 && <StepMusic musicTracks={options.music_tracks} draft={draft} set={set} />}
        {step === 3 && <StepArtStyle artStyles={options.art_styles} draft={draft} set={set} />}
        {step === 4 && <StepCaptionStyle draft={draft} set={set} />}
        {step === 5 && <StepEffects draft={draft} set={set} />}
        {step === 6 && <StepSocialAccounts accounts={accounts} draft={draft} set={set} />}
        {step === 7 && <StepSeriesDetails cadences={options.cadences} draft={draft} set={set} />}
      </div>

      {error && <p className="mt-4 text-[12px] font-medium text-red-400">{error}</p>}

      {/* Footer nav */}
      <div className="mt-10 flex items-center justify-between">
        <button
          type="button"
          onClick={() => (step === 0 ? navigate("/series") : setStep((s) => s - 1))}
          className="cursor-pointer rounded-[11px] border border-c-border px-5 py-2.5 text-[13px] font-semibold text-c-text-muted transition hover:text-c-text"
        >
          {step === 0 ? "Cancel" : "← Back"}
        </button>
        {step < STEPS.length - 1 ? (
          <Button
            disabled={!canContinue}
            onClick={() => setStep((s) => s + 1)}
            className="rounded-[11px] bg-[#ff3d6a] px-6 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
          >
            Continue →
          </Button>
        ) : (
          <Button
            disabled={!canContinue || saving}
            onClick={submit}
            className="rounded-[11px] bg-gradient-to-r from-[#ff3d6a] to-[#ff7a3d] px-6 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
          >
            {saving ? "Creating…" : "✦ Create Series"}
          </Button>
        )}
      </div>
    </div>
  );
}
