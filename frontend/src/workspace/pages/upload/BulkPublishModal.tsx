import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { platformApi, type ClipApiResponse, type SocialAccount } from "@/lib/api";

export function BulkPublishModal({ clips, onClose }: { clips: ClipApiResponse[]; onClose: () => void }) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [groups, setGroups] = useState<Array<{ id: string; clipIds: string[]; accountId: string; scheduledAt: string; postNow: boolean }>>(() => {
    const base = new Date(Date.now() + 60 * 60 * 1000);
    const localIso = new Date(base.getTime() - base.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    return [{ id: crypto.randomUUID(), clipIds: clips.map((c) => c.id), accountId: "", scheduledAt: localIso, postNow: false }];
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedCount, setFailedCount] = useState(0);
  // Per-(group, clip, account) postId so a retry never re-runs schedulePost for an assignment
  // that already has one — only a failed publishNow (needsPublish) is retried. Account is part
  // of the key because changing a slot's account after schedulePost succeeded but publishNow
  // failed must not reuse the stale postId/old account on retry.
  const [clipState, setClipState] = useState<Record<string, { postId: string; needsPublish: boolean }>>({});
  const assignmentKey = (groupId: string, clipId: string, accountId: string) => `${groupId}:${clipId}:${accountId}`;

  useEffect(() => {
    platformApi.listAccounts()
      .then((accs) => {
        const active = accs.filter((a) => a.is_active);
        setAccounts(active);
        setGroups((prev) => prev.map((g) => ({ ...g, accountId: active[0]?.id ?? "" })));
      })
      .catch(() => setAccounts([]))
      .finally(() => setLoadingAccounts(false));
  }, []);

  const addGroup = () => {
    const last = groups[groups.length - 1];
    const nextTime = new Date(new Date(last.scheduledAt).getTime() + 2 * 60 * 60 * 1000);
    const localIso = new Date(nextTime.getTime() - nextTime.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setGroups((prev) => [...prev, { id: crypto.randomUUID(), clipIds: [], accountId: accounts[0]?.id ?? "", scheduledAt: localIso, postNow: false }]);
  };

  const removeGroup = (gid: string) => setGroups((prev) => prev.filter((g) => g.id !== gid));

  const toggleClipInGroup = (gid: string, clipId: string) => {
    setGroups((prev) => prev.map((g) => {
      if (g.id !== gid) return g;
      return { ...g, clipIds: g.clipIds.includes(clipId) ? g.clipIds.filter((id) => id !== clipId) : [...g.clipIds, clipId] };
    }));
  };

  const updateGroup = (gid: string, patch: Partial<typeof groups[0]>) =>
    setGroups((prev) => prev.map((g) => g.id === gid ? { ...g, ...patch } : g));

  const BULK_KEY_MAP: Record<string, string> = {
    instagram: "reels", reels: "reels", tiktok: "tiktok", tt: "tiktok",
    shorts: "shorts", youtube: "youtube", yt: "youtube",
    twitter: "twitter", tw: "twitter", facebook: "facebook",
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    const succeeded: string[] = [];
    const failed: { label: string; reason: string; publishOnly: boolean }[] = [];
    const nextClipState = { ...clipState };

    for (const g of groups) {
      const account = accounts.find((a) => a.id === g.accountId);
      if (!account || g.clipIds.length === 0) continue;
      const platformKey = BULK_KEY_MAP[account.platform.toLowerCase()] ?? account.platform.toLowerCase();

      for (const clipId of g.clipIds) {
        const clip = clips.find((c) => c.id === clipId);
        const clipLabel = (clip as any)?.clip_metadata?.ai_title ?? clip?.title ?? clipId;
        const key = assignmentKey(g.id, clipId, g.accountId);
        const existing = nextClipState[key];

        // Fully done in a prior submit — never touch again.
        if (existing && !existing.needsPublish) {
          succeeded.push(clipLabel);
          continue;
        }

        try {
          let postId = existing?.postId;

          // Only call schedulePost if this clip doesn't already have a real post_id from a prior attempt.
          if (!postId) {
            const content = clip?.clip_metadata?.platforms?.[platformKey];
            const caption = content?.description ?? clip?.clip_metadata?.ai_title ?? clip?.title ?? undefined;
            const hashtags = content?.tags ?? undefined;
            const scheduledAt = g.postNow ? new Date().toISOString() : new Date(g.scheduledAt).toISOString();
            const post = await platformApi.schedulePost({
              clip_id: clipId,
              social_account_id: g.accountId,
              platform: account.platform,
              scheduled_at: scheduledAt,
              caption,
              hashtags,
            });
            postId = post.id;
          }

          if (g.postNow) {
            try {
              await platformApi.publishNow(postId);
              nextClipState[key] = { postId, needsPublish: false };
              succeeded.push(clipLabel);
            } catch (e) {
              nextClipState[key] = { postId, needsPublish: true };
              failed.push({
                label: clipLabel,
                reason: `saved as scheduled but failed to enqueue for immediate publishing (${e instanceof Error ? e.message : "unknown error"})`,
                publishOnly: true,
              });
            }
          } else {
            nextClipState[key] = { postId, needsPublish: false };
            succeeded.push(clipLabel);
          }
        } catch (e) {
          failed.push({ label: clipLabel, reason: e instanceof Error ? e.message : "unknown error", publishOnly: false });
        }
      }
    }

    setClipState(nextClipState);
    setFailedCount(failed.length);

    if (failed.length === 0) {
      setSuccess(true);
      setTimeout(onClose, 1500);
    } else {
      const failedList = failed.map((f) => `${f.label} (${f.reason})`).join("; ");
      const succeededNote = succeeded.length > 0
        ? ` Already succeeded and does NOT need retrying: ${succeeded.join(", ")}.`
        : "";
      const prefix = failed.every((f) => f.publishOnly) ? "Post saved but not enqueued: " : "";
      setError(`${prefix}Failed: ${failedList}.${succeededNote} Click Retry to re-attempt only the failed item(s) — already-posted clips will not be duplicated.`);
    }
    setSubmitting(false);
  };

  const totalScheduled = groups.reduce((n, g) => n + g.clipIds.length, 0);
  const anyPostNow = groups.some((g) => g.postNow && g.clipIds.length > 0);
  const allPostNow = groups.length > 0 && groups.every((g) => g.clipIds.length === 0 || g.postNow);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{ background: "rgba(4,7,15,.85)", backdropFilter: "blur(6px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div data-testid="bulk-publish-modal" className="flex w-full max-w-[560px] min-w-0 max-w-full flex-col overflow-x-hidden rounded-[20px] border border-c-border bg-surface-0 shadow-[0_40px_100px_rgba(0,0,0,.7)]"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-c-border px-5 py-4 shrink-0">
          <div className="grid h-10 w-10 place-items-center rounded-[12px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-[#ff3d6a] text-lg font-black">↗</div>
          <div>
            <h3 className="font-display text-[16px] font-bold text-c-text">Bulk Schedule</h3>
            <p className="text-[11.5px] text-c-text-muted">Assign clips to time slots across accounts, or post them now</p>
          </div>
          <button onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-[7px] border border-c-border text-c-text-muted hover:text-c-text transition">✕</button>
        </div>

        {/* Body */}
        <div className="min-w-0 overflow-y-auto p-5 space-y-4">
          {success ? (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-green-500/10 text-3xl">✓</div>
              <p className="font-display text-lg font-bold text-c-text">{allPostNow ? "Posting!" : "Scheduled!"}</p>
              <p className="text-sm text-c-text-muted">
                {allPostNow
                  ? `${totalScheduled} clip${totalScheduled !== 1 ? "s" : ""} enqueued to post now.`
                  : anyPostNow
                  ? `${totalScheduled} clip${totalScheduled !== 1 ? "s" : ""} queued — some posting now, some scheduled.`
                  : `${totalScheduled} clip${totalScheduled !== 1 ? "s" : ""} queued for publishing.`}
              </p>
              <button onClick={onClose} className="w-full sm:w-auto rounded-[10px] bg-[#ff3d6a] px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-[#ff3d6a]/85">
                Done
              </button>
            </div>
          ) : loadingAccounts ? (
            <div className="space-y-3">{[1,2].map((i) => <div key={i} className="h-28 animate-pulse rounded-[12px] bg-surface-1" />)}</div>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-[12px] border border-[#ff3d6a]/20 bg-[#ff3d6a]/5 px-4 py-8 text-center">
              <div className="grid h-10 w-10 place-items-center rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-lg">⚡</div>
              <p className="text-sm font-semibold text-c-text">No social accounts connected</p>
              <a href="/integrations" className="rounded-[9px] bg-[#ff3d6a] px-4 py-2 text-xs font-semibold text-white hover:bg-[#ff3d6a]/85 transition">Connect social media →</a>
            </div>
          ) : (
            <>
              {groups.map((g, gi) => {
                const slotAccount = accounts.find((a) => a.id === g.accountId);
                const slotPlatform = slotAccount?.platform?.toLowerCase() ?? "";
                const slotKey = ({ instagram:"reels", reels:"reels", tiktok:"tiktok", tt:"tiktok", shorts:"shorts", youtube:"youtube", yt:"youtube", twitter:"twitter", tw:"twitter", facebook:"facebook" } as Record<string,string>)[slotPlatform] ?? slotPlatform;
                const slotCfg = ({ youtube:{color:"#FF0000",icon:"▶",label:"YouTube"}, shorts:{color:"#FF0000",icon:"▶",label:"Shorts"}, tiktok:{color:"#69C9D0",icon:"♪",label:"TikTok"}, reels:{color:"#E1306C",icon:"◈",label:"Reels"}, instagram:{color:"#E1306C",icon:"◈",label:"Instagram"}, twitter:{color:"#1DA1F2",icon:"𝕏",label:"Twitter"}, facebook:{color:"#1877F2",icon:"f",label:"Facebook"} } as Record<string,{color:string;icon:string;label:string}>)[slotKey] ?? {color:"#ff3d6a",icon:"↗",label:"Platform"};

                return (
                  <div key={g.id} className="overflow-hidden rounded-[14px] border bg-surface-1" style={{ borderColor: `${slotCfg.color}40` }}>
                    <div className="flex items-center gap-2.5 px-4 py-2.5" style={{ background: `${slotCfg.color}12`, borderBottom: `1px solid ${slotCfg.color}25` }}>
                      <div className="grid h-6 w-6 place-items-center rounded-full text-[11px] font-black text-white" style={{ background: slotCfg.color }}>{slotCfg.icon}</div>
                      <span className="text-[12px] font-bold" style={{ color: slotCfg.color }}>{slotCfg.label}</span>
                      <span className="text-[11px] font-semibold text-c-text-muted">· Slot {gi + 1}</span>
                      {groups.length > 1 && (
                        <button onClick={() => removeGroup(g.id)} className="ml-auto text-[11px] text-c-text-muted hover:text-red-400 transition">Remove</button>
                      )}
                    </div>

                    <div className="p-4 space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[.08em] text-c-text-muted">Account</label>
                          <select value={g.accountId} onChange={(e) => updateGroup(g.id, { accountId: e.target.value })}
                            className="w-full rounded-[9px] border bg-surface-1 px-2.5 py-2 text-[12px] text-c-text focus:outline-none transition"
                            style={{ borderColor: `${slotCfg.color}40` }}>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.platform.charAt(0).toUpperCase() + a.platform.slice(1)} — @{a.platform_username ?? "?"}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[.08em] text-c-text-muted">When</label>
                          {g.postNow ? (
                            <div className="flex h-[35px] items-center rounded-[9px] border border-dashed border-c-border bg-surface-1 px-2.5 text-[12px] font-semibold text-c-text-muted">
                              Posting immediately
                            </div>
                          ) : (
                            <input type="datetime-local" value={g.scheduledAt}
                              onChange={(e) => updateGroup(g.id, { scheduledAt: e.target.value })}
                              className="w-full rounded-[9px] border border-c-border bg-surface-1 px-2.5 py-2 text-[12px] text-c-text focus:outline-none" />
                          )}
                        </div>
                      </div>

                      <div className="flex gap-1.5 rounded-[9px] border border-c-border bg-surface-1 p-1" role="group" aria-label="Post timing mode">
                        <button type="button" onClick={() => updateGroup(g.id, { postNow: false })}
                          className={cn("flex-1 rounded-[7px] py-1.5 text-[11.5px] font-semibold transition",
                            !g.postNow ? "bg-surface-2 text-c-text" : "text-c-text-muted hover:text-c-text-secondary")}>
                          Schedule for later
                        </button>
                        <button type="button" onClick={() => updateGroup(g.id, { postNow: true })}
                          className={cn("flex-1 rounded-[7px] py-1.5 text-[11.5px] font-semibold transition",
                            g.postNow ? "bg-surface-2 text-c-text" : "text-c-text-muted hover:text-c-text-secondary")}>
                          Post now
                        </button>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[.08em] text-c-text-muted">Clips ({g.clipIds.length})</label>
                        <div className="flex flex-wrap gap-1.5">
                          {clips.map((c) => (
                            <button key={c.id} onClick={() => toggleClipInGroup(g.id, c.id)}
                              className={cn("rounded-[8px] border px-2.5 py-1.5 text-[11px] font-semibold transition",
                                !g.clipIds.includes(c.id) && "border-c-border bg-surface-1 text-c-text-muted")}
                              style={g.clipIds.includes(c.id)
                                ? { borderColor: `${slotCfg.color}50`, background: `${slotCfg.color}15`, color: slotCfg.color }
                                : undefined
                              }>
                              {(c as any).clip_metadata?.ai_title ?? c.title ?? `Clip ${clips.indexOf(c) + 1}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <button onClick={addGroup}
                className="w-full rounded-[12px] border border-dashed border-c-border py-3 text-[12px] font-semibold text-c-text-muted transition hover:border-c-border-hover hover:text-c-text-secondary">
                + Add time slot
              </button>

              {error && (
                <p className="rounded-[8px] bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {success ? (
          <div data-testid="bulk-publish-actions" className="grid grid-cols-2 gap-2 sm:flex sm:w-auto sm:gap-3 border-t border-c-border px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] shrink-0">
            <button onClick={onClose} className="col-span-2 sm:col-span-1 w-full sm:w-auto ml-auto rounded-[10px] bg-[#ff3d6a] px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-[#ff3d6a]/85">
              Done
            </button>
          </div>
        ) : accounts.length > 0 && (
          <div data-testid="bulk-publish-actions" className="grid grid-cols-2 gap-2 sm:flex sm:w-auto sm:gap-3 border-t border-c-border px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] shrink-0">
            <button onClick={onClose} className="w-full sm:w-auto rounded-[10px] border border-c-border bg-surface-1 px-5 py-2.5 text-[13px] font-semibold text-c-text-secondary hover:text-c-text transition">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={submitting || totalScheduled === 0}
              className="col-span-2 sm:col-span-1 w-full sm:w-auto sm:ml-auto flex items-center justify-center gap-2 rounded-[10px] bg-[#ff3d6a] px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-50 transition hover:bg-[#ff3d6a]/85">
              {submitting
                ? (failedCount > 0 ? "Retrying…" : allPostNow ? "Posting…" : "Scheduling…")
                : failedCount > 0
                ? `↗ Retry ${failedCount} failed clip${failedCount !== 1 ? "s" : ""}`
                : allPostNow
                ? `↗ Post ${totalScheduled} clip${totalScheduled !== 1 ? "s" : ""} now`
                : `↗ Schedule ${totalScheduled} clip${totalScheduled !== 1 ? "s" : ""}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
