import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { videoApi, type ClipConfig } from "@/lib/api";
import { ASPECT_OPTIONS, ASPECT_DETAILS, LENGTH_PRESETS, CAPTION_STYLES, type CaptionStyleOption } from "./constants";
import { formatClipTime } from "./helpers";

/* 9:16 phone-frame mock of how each caption style renders on video — the
   caption sits where the real burn-in places it (TikTok-style lower-center,
   mid-frame for word-pop, lower-third for minimal). Pure CSS, no assets. */
export function CaptionPreview({ s, selected }: { s: CaptionStyleOption; selected: boolean }) {
  const outlineShadow = "0 0 2px #000, 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000";
  const frame = "relative aspect-[9/16] w-full overflow-hidden rounded-[10px] bg-gradient-to-b from-[#2b303e] to-[#141824]";
  const check = selected && (
    <span className="absolute right-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-[#ff3d6a] text-[9px] font-bold text-white">✓</span>
  );

  if (!s.id) {
    return (
      <div className={frame}>
        {check}
        <div className="flex h-full flex-col items-center justify-center gap-1">
          <span className="text-[16px]">✨</span>
          <span className="text-[9px] font-bold text-emerald-400">Best match</span>
        </div>
      </div>
    );
  }

  const hl = s.highlight ?? "#f5c518";
  const tx = (w: string) => (s.uppercase ? w.toUpperCase() : w);
  // black text on bright pills, white on dark ones (matches backend luminance rule)
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hl.slice(i, i + 2), 16));
  const pillText = 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#000" : "#fff";

  const caption = (() => {
    switch (s.family) {
      case "pill":
        return (
          <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5">
            <span className="text-[8px] font-bold text-white/85" style={{ textShadow: "1px 1px 0 #000" }}>{tx("here is")}</span>
            <span className="rounded-[3px] px-1 py-px text-[8px] font-black" style={{ background: hl, color: pillText }}>{tx("your")}</span>
            <span className="text-[8px] font-bold text-white/85" style={{ textShadow: "1px 1px 0 #000" }}>{tx("subtitle")}</span>
          </div>
        );
      case "reveal":
        return (
          <div className="flex flex-col items-center gap-0.5">
            <span className="rounded-[4px] bg-black/85 px-1.5 py-0.5 text-[8px] font-bold text-white">Here is your</span>
            <span className="rounded-[4px] bg-black/85 px-1.5 py-0.5 text-[8px] font-bold text-white">subtitle</span>
          </div>
        );
      case "pop":
        return <span className="text-[14px] font-black text-white" style={{ textShadow: outlineShadow }}>WOW</span>;
      case "karaoke":
        return (
          <span className="whitespace-nowrap rounded-[3px] bg-black/75 px-1.5 py-0.5 text-[8px] font-bold text-white">
            here is <span style={{ color: hl }}>your</span> subtitle
          </span>
        );
      case "outline":
        return (
          <span className={cn("text-center font-black leading-tight text-white", s.uppercase ? "text-[9.5px]" : "text-[8.5px]")}
            style={{ textShadow: outlineShadow }}>{tx("Here is your subtitle")}</span>
        );
      case "bounce":
        return (
          <span className="inline-flex items-end gap-1 font-black" style={{ textShadow: outlineShadow }}>
            <span className="text-[8px] text-white">so</span>
            <span className="text-[11px]" style={{ color: hl }}>viral</span>
            <span className="text-[8px] text-white">now</span>
          </span>
        );
      case "glow":
        return (
          <span className="text-[9px] font-black text-white"
            style={{ textShadow: `0 0 4px ${hl}, 0 0 8px ${hl}, 0 0 2px #000` }}>
            so <span style={{ color: hl }}>viral</span> now
          </span>
        );
      case "shadow":
        return (
          <span className="text-[10px] font-black uppercase text-white"
            style={{ textShadow: `3px 3px 0 ${hl}, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000` }}>
            so viral now
          </span>
        );
      case "highlighter":
        return (
          <span className="inline-flex items-center gap-1 text-[8.5px] font-black text-white" style={{ textShadow: "1px 1px 0 #000" }}>
            so <span className="rounded-[3px] px-1 py-px" style={{ background: hl, color: pillText }}>viral</span> now
          </span>
        );
      case "rainbow":
        return (
          <span className="inline-flex gap-1 text-[9px] font-black" style={{ textShadow: outlineShadow }}>
            <span style={{ color: "#ff5252" }}>so</span>
            <span style={{ color: "#fadc32" }}>viral</span>
            <span style={{ color: "#46c8ff" }}>now</span>
          </span>
        );
      default: // minimal
        return <span className="text-[8px] font-semibold text-zinc-300">here is your subtitle</span>;
    }
  })();

  const pos = s.family === "pop" ? "top-[42%]" : s.family === "minimal" ? "top-[78%]" : "top-[62%]";
  return (
    <div className={frame}>
      {check}
      <div className="absolute inset-x-0 top-[12%] text-center text-[7.5px] font-semibold leading-tight text-white/60">
        Your video<br />title
      </div>
      <div className={cn("absolute inset-x-0 flex justify-center px-1", pos)}>{caption}</div>
    </div>
  );
}

export function AspectPreview({ ratio, active }: { ratio: string; active: boolean }) {
  return (
    <div className={cn(
      "mx-auto grid h-12 place-items-center rounded-[8px] border transition",
      active ? "border-[#ff3d6a]/35 bg-[#ff3d6a]/[.07]" : "border-white/[.08] bg-black/10"
    )}>
      {ratio === "9:16" ? (
        <div className={cn(
          "relative h-10 w-6 overflow-hidden rounded-[6px] border",
          active ? "border-[#ff7a9a]/70 bg-[#ff3d6a]/15" : "border-white/[.18] bg-white/[.055]"
        )}>
          <div className="absolute inset-x-1 top-1 h-1 rounded-full bg-white/30" />
          <div className="absolute bottom-1 left-1 right-2 h-0.5 rounded-full bg-white/55" />
          <div className="absolute bottom-2 left-1 right-1 h-0.5 rounded-full bg-white/25" />
          <div className="absolute right-1 top-3 flex flex-col gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
            <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
          </div>
        </div>
      ) : ratio === "1:1" ? (
        <div className={cn(
          "relative h-9 w-9 overflow-hidden rounded-[6px] border",
          active ? "border-[#ff7a9a]/70 bg-[#ff3d6a]/15" : "border-white/[.18] bg-white/[.055]"
        )}>
          <div className="absolute inset-x-1 top-1 h-4 rounded bg-white/15" />
          <div className="absolute bottom-2 left-1 right-1 h-0.5 rounded-full bg-white/45" />
          <div className="absolute bottom-1 left-1 right-3 h-0.5 rounded-full bg-white/25" />
        </div>
      ) : (
        <div className={cn(
          "relative h-7 w-12 overflow-hidden rounded-[6px] border",
          active ? "border-[#ff7a9a]/70 bg-[#ff3d6a]/15" : "border-white/[.18] bg-white/[.055]"
        )}>
          <div className="absolute inset-0 grid place-items-center">
            <span className="h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-white/55" />
          </div>
          <div className="absolute bottom-1 left-1 right-1 h-0.5 rounded-full bg-white/35" />
        </div>
      )}
    </div>
  );
}

export function AspectRatioSelector({
  value,
  onChange,
  labelClassName = "mb-2 block text-[11px] font-semibold text-zinc-400",
}: {
  value?: string;
  onChange: (ratio: string) => void;
  labelClassName?: string;
}) {
  return (
    <div>
      <label className={labelClassName}>Aspect ratio</label>
      <div className="grid grid-cols-3 gap-2">
        {ASPECT_OPTIONS.map((r) => {
          const detail = ASPECT_DETAILS[r];
          const active = value === r;
          return (
            <button key={r} type="button" onClick={() => onChange(r)}
              className={cn(
                "cursor-pointer rounded-[9px] border p-2 text-center transition",
                active ? "border-[#ff3d6a]/45 bg-[#ff3d6a]/[.075] text-[#ff7a9a]" : "border-white/[.09] bg-white/[.025] text-zinc-400 hover:border-white/[.15] hover:bg-white/[.04]"
              )}>
              <AspectPreview ratio={r} active={active} />
              <div className="mt-1.5 text-[12px] font-bold">{r}</div>
              <div className={cn("mt-0.5 truncate text-[10.5px] font-semibold", active ? "text-zinc-100" : "text-zinc-400")}>{detail.title}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TargetLengthControl({
  min,
  max,
  onChange,
  labelClassName = "mb-2 block text-[11px] font-semibold text-zinc-400",
  inputClassName = "w-full rounded-[10px] border border-white/[.10] bg-white/[.04] px-3 py-2.5 text-[13px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-[#ff3d6a]/45 focus:bg-white/[.055] focus:shadow-[0_0_0_3px_rgba(255,61,106,.08)]",
}: {
  min?: number;
  max?: number;
  onChange: (patch: Pick<ClipConfig, "duration_min" | "duration_max">) => void;
  labelClassName?: string;
  inputClassName?: string;
}) {
  const durationMin = min ?? 20;
  const durationMax = max ?? 60;
  const activePreset = LENGTH_PRESETS.find((preset) => preset.min === durationMin && preset.max === durationMax)?.id ?? "custom";
  const [manualOpen, setManualOpen] = useState(activePreset === "custom");
  const selectedPreset = manualOpen ? "custom" : activePreset;

  const updateMin = (value: number) => onChange({ duration_min: Math.min(value, durationMax), duration_max: durationMax });
  const updateMax = (value: number) => onChange({ duration_min: durationMin, duration_max: Math.max(value, durationMin) });

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className={cn(labelClassName, "mb-0")}>Target length</label>
        <span className="rounded-full border border-white/[.08] bg-white/[.035] px-2.5 py-1 text-[11px] font-semibold text-zinc-300">
          {formatClipTime(durationMin)}-{formatClipTime(durationMax)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {LENGTH_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              if (preset.id === "custom") {
                setManualOpen(true);
                return;
              }
              setManualOpen(false);
              if (preset.min != null && preset.max != null) onChange({ duration_min: preset.min, duration_max: preset.max });
            }}
            className={cn(
              "cursor-pointer rounded-[10px] border px-3 py-2.5 text-left transition",
              selectedPreset === preset.id ? "border-[#ff3d6a]/45 bg-[#ff3d6a]/[.075]" : "border-white/[.09] bg-white/[.025] hover:border-white/[.15] hover:bg-white/[.04]"
            )}
          >
            <div className={cn("text-[12px] font-bold", selectedPreset === preset.id ? "text-[#ff7a9a]" : "text-zinc-200")}>{preset.label}</div>
            <div className="mt-0.5 text-[10.5px] text-zinc-500">{preset.hint}</div>
          </button>
        ))}
      </div>

      {!manualOpen ? (
        <div className="mt-3 rounded-[11px] border border-white/[.08] bg-white/[.025] px-3 py-2.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-500">
            <span>Selected range</span>
            <span className="text-zinc-300">{formatClipTime(durationMin)} to {formatClipTime(durationMax)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.08]">
            <div className="h-full rounded-full bg-[#ff3d6a]" style={{ width: `${Math.min(100, Math.max(12, (durationMax / 300) * 100))}%` }} />
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-end gap-2 rounded-[11px] border border-white/[.08] bg-white/[.025] p-3">
          <div>
            <span className="mb-1 block text-[10px] font-semibold text-zinc-600">Minimum seconds</span>
            <input type="number" min={5} max={durationMax} value={durationMin}
              onChange={(e) => updateMin(Number(e.target.value))}
              className={inputClassName} />
          </div>
          <span className="pb-3 text-sm text-zinc-600">to</span>
          <div>
            <span className="mb-1 block text-[10px] font-semibold text-zinc-600">Maximum seconds</span>
            <input type="number" min={durationMin} max={300} value={durationMax}
              onChange={(e) => updateMax(Number(e.target.value))}
              className={inputClassName} />
          </div>
        </div>
      )}
    </div>
  );
}

export function ClipConfigPanel({ config, onChange, step }: { config: ClipConfig; onChange: (c: ClipConfig) => void; step?: 1 | 2 | 3 }) {
  const set = (patch: Partial<ClipConfig>) => onChange({ ...config, ...patch });
  const [captionStyles, setCaptionStyles] = useState<CaptionStyleOption[]>(CAPTION_STYLES);
  useEffect(() => {
    videoApi.captionStyles()
      .then((list) => setCaptionStyles([CAPTION_STYLES[0], ...list]))
      .catch(() => {}); // keep the static fallback if the endpoint is unreachable
  }, []);

  const virality = Math.round((config.min_score ?? 0.5) * 10);
  const durationLabel = `${config.duration_min ?? 20}-${config.duration_max ?? 60}s`;
  const labelCls = "mb-2 block text-[11px] font-semibold text-zinc-400";
  const inputCls = "w-full rounded-[10px] border border-white/[.10] bg-white/[.04] px-3 py-2.5 text-[13px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-[#ff3d6a]/45 focus:bg-white/[.055] focus:shadow-[0_0_0_3px_rgba(255,61,106,.08)]";
  const chipOn  = "border-[#ff3d6a]/40 bg-[#ff3d6a]/[.10] text-[#ff6f92]";
  const chipOff = "border-white/[.09] bg-white/[.03] text-zinc-400 hover:border-white/[.16] hover:bg-white/[.05] hover:text-zinc-200";

  const showAll = !step;
  const s1 = showAll || step === 1;
  const s2 = showAll || step === 2;
  const s3 = showAll || step === 3;

  return (
    <div>
      {showAll && (
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-[15px] font-bold text-white">Clip settings</h3>
            <p className="mt-0.5 text-[12px] text-zinc-500">Applied to every generated clip from this source.</p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold text-zinc-300">
            <span className="rounded-full border border-white/[.08] bg-white/[.035] px-2.5 py-1">{durationLabel}</span>
            <span className="rounded-full border border-[#ff3d6a]/20 bg-[#ff3d6a]/[.08] px-2.5 py-1 text-[#ff7a9a]">Score {virality}/10+</span>
          </div>
        </div>
      )}

      <div className="space-y-5">
        {/* Step 1: Aspect ratio + Target length */}
        {s1 && <div className={showAll ? "border-t border-white/[.06] pt-5" : ""}>
          <div className="flex flex-col gap-4">
            <div className="rounded-[12px] border border-white/[.07] bg-white/[.018] p-3">
              <AspectRatioSelector value={config.aspect_ratio} onChange={(aspect_ratio) => set({ aspect_ratio })} labelClassName={labelCls} />
            </div>
            <div className="rounded-[12px] border border-white/[.07] bg-white/[.018] p-3">
              <TargetLengthControl
                min={config.duration_min}
                max={config.duration_max}
                onChange={(patch) => set(patch)}
                labelClassName={labelCls}
                inputClassName={inputCls}
              />
            </div>
          </div>
        </div>}

        {/* Step 2: Max clips + Viral score */}
        {s2 && <div className={cn("grid grid-cols-1 gap-4 lg:grid-cols-2", showAll && "border-t border-white/[.06] pt-5")}>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className={cn(labelCls, "mb-0")}>Max clips</label>
              <span className="rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 px-2.5 py-1 text-[12px] font-bold text-[#ff5f86]">{config.max_clips}</span>
            </div>
            <input type="range" min={1} max={20} value={config.max_clips}
              onChange={(e) => set({ max_clips: Number(e.target.value) })}
              className="w-full accent-[#ff3d6a]" />
            <div className="mt-1 flex justify-between text-[10px] text-zinc-600"><span>Focused</span><span>Batch</span></div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className={cn(labelCls, "mb-0")}>Minimum viral score</label>
              <span className="rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 px-2.5 py-1 text-[12px] font-bold text-[#ff5f86]">{virality}/10</span>
            </div>
            <input type="range" min={0} max={10} step={1} value={virality}
              onChange={(e) => set({ min_score: Number(e.target.value) / 10 })}
              className="w-full accent-[#ff3d6a]" />
            <div className="mt-1 flex justify-between text-[10px] text-zinc-600"><span>Any</span><span>Balanced</span><span>Strict</span></div>
          </div>
        </div>}

        {/* Step 2 continued: Topic focus + Auto captions */}
        {s2 && <div className={cn("grid grid-cols-1 gap-4 lg:grid-cols-[1fr_.9fr]", showAll && "border-t border-white/[.06] pt-5")}>
          <div>
            <label className={labelCls}>Topic focus <span className="normal-case tracking-normal text-zinc-600">optional</span></label>
            <input type="text" placeholder="e.g. controversial moment, product demo, founder story…"
              value={config.topic_focus ?? ""}
              onChange={(e) => set({ topic_focus: e.target.value || null })}
              className={inputCls} />
            <p className="mt-2 text-[11.5px] text-zinc-600">Use this to bias clip selection without changing the source video.</p>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-[12px] border border-white/[.08] bg-white/[.025] p-3.5">
            <div>
              <div className="text-[13px] font-bold text-zinc-100">Auto captions</div>
              <div className="mt-0.5 text-[11.5px] text-zinc-500">Burn readable subtitles into every clip.</div>
            </div>
            <button type="button" onClick={() => set({ add_captions: !config.add_captions })}
              aria-pressed={!!config.add_captions}
              className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200",
                config.add_captions ? "bg-[#ff3d6a]" : "bg-white/[.13]")}>
              <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-200",
                config.add_captions ? "left-[calc(100%-24px)]" : "left-1")} />
            </button>
          </div>
        </div>}

        {s2 && config.add_captions && (
          <div className="border-t border-white/[.06] pt-5">
            <div className="flex items-center gap-2">
              <label className={labelCls}>Caption style</label>
              {!config.caption_style && <span className="mb-2 rounded-full border border-emerald-400/20 bg-emerald-400/[.08] px-2 py-0.5 text-[10px] font-bold text-emerald-300">Auto</span>}
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {captionStyles.map((s) => {
                const sel = (config.caption_style ?? null) === s.id;
                return (
                  <button key={String(s.id)} type="button" onClick={() => set({ caption_style: s.id })}
                    className={cn("rounded-[13px] border p-1 text-center transition",
                      sel ? "border-[#ff3d6a]/70 bg-[#ff3d6a]/[.06] shadow-[0_0_0_1px_rgba(255,61,106,.45)]"
                          : "border-white/[.07] bg-white/[.02] hover:border-white/[.18]")}>
                    <CaptionPreview s={s} selected={sel} />
                    <div className={cn("mt-1.5 text-[11px] font-bold", sel ? "text-[#ff7a9a]" : "text-zinc-200")}>{s.label}</div>
                    <div className="mb-0.5 mt-0.5 px-0.5 text-[9.5px] leading-3 text-zinc-500">{s.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3: AI enhancements */}
        {s3 && <div className={cn("space-y-4", showAll && "border-t border-white/[.06] pt-5")}>
          <label className={labelCls}>AI enhancements</label>

          <div className={cn(!showAll && "grid gap-4 lg:grid-cols-2")}>
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <div className="text-[12px] font-bold text-zinc-100">Content type</div>
                {!config.occasion && <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[.08] px-2 py-0.5 text-[10px] font-bold text-emerald-300">Auto</span>}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: null,        label: "Auto" },
                  { id: "football",  label: "Football" },
                  { id: "cricket",   label: "Cricket" },
                  { id: "ufc",       label: "UFC/MMA" },
                  { id: "gaming",    label: "Gaming" },
                  { id: "concert",   label: "Concert" },
                  { id: "podcast",   label: "Podcast" },
                  { id: "wedding",   label: "Wedding" },
                  { id: "general",   label: "Other" },
                ].map((o) => (
                  <button key={String(o.id)} type="button"
                    onClick={() => set({ occasion: o.id })}
                    className={cn("cursor-pointer rounded-[8px] border px-2 py-1.5 text-center text-[10.5px] font-medium transition-colors",
                      (config.occasion ?? null) === o.id
                        ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/[.08] text-[#ff7a9a]"
                        : "border-white/[.08] bg-white/[.025] text-zinc-400 hover:border-white/[.14]")}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={cn(showAll && "border-t border-white/[.05] pt-3")}>
              <div className="mb-1.5 flex items-center gap-2">
                <div className="text-[12px] font-bold text-zinc-100">Style</div>
                {!config.template_id && <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[.08] px-2 py-0.5 text-[10px] font-bold text-emerald-300">Auto</span>}
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {[
                  { id: null,             label: "Auto",      desc: "Matched to content" },
                  { id: "sports-hype",    label: "Hype",      desc: "Bold hook + blur bg" },
                  { id: "cinematic",      label: "Cinematic", desc: "Dramatic + overlay" },
                  { id: "gaming-clutch",  label: "Clutch",    desc: "Gaming captions" },
                  { id: "talking-head",   label: "Talk",      desc: "Clean + chill music" },
                  { id: "generic",        label: "Minimal",   desc: "No extras, clean cut" },
                ].map((t) => (
                  <button key={String(t.id)} type="button"
                    onClick={() => set({ template_id: t.id })}
                    className={cn("cursor-pointer rounded-[8px] border px-2 py-1.5 text-left transition-colors",
                      (config.template_id ?? null) === t.id
                        ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/[.08]"
                        : "border-white/[.08] bg-white/[.025] hover:border-white/[.14]")}>
                    <div className={cn("text-[10.5px] font-bold", (config.template_id ?? null) === t.id ? "text-[#ff7a9a]" : "text-zinc-200")}>{t.label}</div>
                    <div className="mt-0.5 text-[9.5px] leading-tight text-zinc-500">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={cn("grid gap-3 border-t border-white/[.05] pt-4", !showAll ? "lg:grid-cols-2" : "grid-cols-1")}>
            <div className="flex items-center justify-between gap-3 rounded-[12px] border border-white/[.08] bg-white/[.025] p-3.5">
              <div>
                <div className="text-[12px] font-bold text-zinc-100">Background music</div>
                <div className="mt-0.5 text-[11px] text-zinc-500">Royalty-free hype/chill track.</div>
              </div>
              <button type="button" onClick={() => set({ music: !(config.music ?? true) })}
                aria-pressed={config.music ?? true}
                className={cn("relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
                  (config.music ?? true) ? "bg-[#ff3d6a]" : "bg-white/[.13]")}>
                <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-200",
                  (config.music ?? true) ? "left-[calc(100%-22px)]" : "left-0.5")} />
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-[12px] border border-white/[.08] bg-white/[.025] p-3.5">
              <div>
                <div className="flex items-center gap-1.5">
                  <div className="text-[12px] font-bold text-zinc-100">AI voiceover</div>
                  <span className="rounded-full border border-[#ff3d6a]/20 bg-[#ff3d6a]/[.08] px-1.5 py-0.5 text-[9.5px] font-bold text-[#ff7a9a]">New</span>
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500">Narrator script over clip.</div>
              </div>
              <button type="button" onClick={() => set({ voiceover: !config.voiceover })}
                aria-pressed={!!config.voiceover}
                className={cn("relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
                  config.voiceover ? "bg-[#ff3d6a]" : "bg-white/[.13]")}>
                <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-200",
                  config.voiceover ? "left-[calc(100%-22px)]" : "left-0.5")} />
              </button>
            </div>
          </div>

          {/* Output quality */}
          <div className="border-t border-white/[.05] pt-4">
            <label className={labelCls}>Output quality</label>
            <div className="grid grid-cols-4 gap-1.5">
              {(["source","1080p","720p","480p"] as const).map((q) => (
                <button key={q} type="button" onClick={() => set({ output_quality: q })}
                  className={cn("cursor-pointer rounded-[9px] border px-3 py-1.5 text-center text-[12px] font-semibold transition", config.output_quality === q ? chipOn : chipOff)}>
                  {q === "source" ? "Full res" : q}
                </button>
              ))}
            </div>
          </div>
        </div>}
      </div>
    </div>
  );
}
