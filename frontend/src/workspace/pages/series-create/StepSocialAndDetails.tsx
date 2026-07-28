import { cn } from "@/lib/utils";
import { navigate } from "@/lib/router";
import type { SeriesOption, SocialAccount } from "@/lib/api";
import type { Draft } from "./constants";
import { Toggle } from "./OptionCard";

interface StepSocialAccountsProps {
  accounts: SocialAccount[];
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
}

export function StepSocialAccounts({ accounts, draft, set }: StepSocialAccountsProps) {
  if (accounts.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-c-border p-8 text-center">
        <p className="text-[13px] text-c-text-muted">No social accounts connected yet.</p>
        <button
          type="button"
          onClick={() => navigate("/integrations")}
          className="mt-2 cursor-pointer text-[13px] font-bold text-[#ff7a9a] hover:underline"
        >
          Connect an account →
        </button>
        <p className="mt-3 text-[12px] text-c-text-muted">You can skip this — videos will still generate for review.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {accounts.map((a) => {
        const on = draft.social_account_ids.includes(a.id);
        return (
          <div key={a.id} className="flex items-center gap-3 rounded-[14px] border border-c-border bg-surface-1 p-4">
            <div className="flex-1">
              <p className="text-[14px] font-bold capitalize text-c-text">{a.platform}</p>
              {a.platform_username && <p className="text-[12.5px] text-c-text-muted">@{a.platform_username}</p>}
            </div>
            <Toggle
              on={on}
              onChange={() =>
                set(
                  "social_account_ids",
                  on ? draft.social_account_ids.filter((i) => i !== a.id) : [...draft.social_account_ids, a.id]
                )
              }
            />
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
  );
}

interface StepSeriesDetailsProps {
  cadences: SeriesOption[];
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
}

export function StepSeriesDetails({ cadences, draft, set }: StepSeriesDetailsProps) {
  const durations = [
    [45, "≈45 seconds"],
    [65, "60–70s · Monetizable"],
    [90, "≈90 seconds"],
  ] as const;

  return (
    <div className="grid gap-5">
      <div>
        <p className="mb-1.5 text-[12.5px] font-bold text-c-text-secondary">Series name</p>
        <input
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          maxLength={255}
          placeholder="e.g. Midnight Horror Stories"
          className="h-[48px] w-full rounded-[12px] border border-c-border bg-surface-1 px-4 text-[13.5px] text-c-text outline-none placeholder:text-c-text-muted focus:border-[#ff3d6a]/50"
        />
      </div>
      <div>
        <p className="mb-1.5 text-[12.5px] font-bold text-c-text-secondary">Video duration</p>
        <div className="flex flex-wrap gap-2">
          {durations.map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => set("duration_sec", v)}
              className={cn(
                "cursor-pointer rounded-full border px-4 py-2 text-[12.5px] font-semibold transition",
                draft.duration_sec === v
                  ? "border-[#ff3d6a] bg-[#ff3d6a]/[.08] text-[#ff7a9a]"
                  : "border-c-border text-c-text-muted hover:text-c-text"
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-6">
        <div>
          <p className="mb-1.5 text-[12.5px] font-bold text-c-text-secondary">Publish time (UTC)</p>
          <input
            type="time"
            value={draft.publish_time}
            onChange={(e) => set("publish_time", e.target.value)}
            className="h-[44px] rounded-[12px] border border-c-border bg-surface-1 px-3.5 text-[13.5px] text-c-text outline-none"
          />
        </div>
        <div>
          <p className="mb-1.5 text-[12.5px] font-bold text-c-text-secondary">Frequency</p>
          <div className="flex gap-2">
            {cadences.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => set("cadence", c.id as Draft["cadence"])}
                className={cn(
                  "cursor-pointer rounded-full border px-3.5 py-2 text-[12.5px] font-semibold transition",
                  draft.cadence === c.id
                    ? "border-[#ff3d6a] bg-[#ff3d6a]/[.08] text-[#ff7a9a]"
                    : "border-c-border text-c-text-muted hover:text-c-text"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="text-[12px] text-c-text-muted">
        Videos are generated 6 hours before the scheduled publish time so you have time to review them.
      </p>
    </div>
  );
}
