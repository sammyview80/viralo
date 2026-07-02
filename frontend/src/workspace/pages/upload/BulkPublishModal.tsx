import { useState, useEffect } from "react";
import { platformApi, type ClipApiResponse, type SocialAccount } from "@/lib/api";

export function BulkPublishModal({ clips, onClose }: { clips: ClipApiResponse[]; onClose: () => void }) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [groups, setGroups] = useState<Array<{ id: string; clipIds: string[]; accountId: string; scheduledAt: string }>>(() => {
    const base = new Date(Date.now() + 60 * 60 * 1000);
    const localIso = new Date(base.getTime() - base.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    return [{ id: crypto.randomUUID(), clipIds: clips.map((c) => c.id), accountId: "", scheduledAt: localIso }];
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setGroups((prev) => [...prev, { id: crypto.randomUUID(), clipIds: [], accountId: accounts[0]?.id ?? "", scheduledAt: localIso }]);
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
    try {
      for (const g of groups) {
        const account = accounts.find((a) => a.id === g.accountId);
        if (!account || g.clipIds.length === 0) continue;
        const platformKey = BULK_KEY_MAP[account.platform.toLowerCase()] ?? account.platform.toLowerCase();
        for (const clipId of g.clipIds) {
          const clip = clips.find((c) => c.id === clipId);
          const content = clip?.clip_metadata?.platforms?.[platformKey];
          const caption = content?.description ?? clip?.clip_metadata?.ai_title ?? clip?.title ?? undefined;
          const hashtags = content?.tags ?? undefined;
          await platformApi.schedulePost({
            clip_id: clipId,
            social_account_id: g.accountId,
            platform: account.platform,
            scheduled_at: new Date(g.scheduledAt).toISOString(),
            caption,
            hashtags,
          });
        }
      }
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const totalScheduled = groups.reduce((n, g) => n + g.clipIds.length, 0);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{ background: "rgba(4,7,15,.85)", backdropFilter: "blur(6px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex w-full max-w-[560px] flex-col rounded-[20px] border border-white/[.1] bg-[#0e1420] shadow-[0_40px_100px_rgba(0,0,0,.7)]"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/[.07] px-5 py-4 shrink-0">
          <div className="grid h-10 w-10 place-items-center rounded-[12px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-[#ff3d6a] text-lg font-black">↗</div>
          <div>
            <h3 className="font-display text-[16px] font-bold">Bulk Schedule</h3>
            <p className="text-[11.5px] text-zinc-500">Assign clips to time slots across accounts</p>
          </div>
          <button onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-[7px] border border-white/[.08] text-zinc-500 hover:text-white transition">✕</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-4">
          {success ? (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-green-500/10 text-3xl">✓</div>
              <p className="font-display text-lg font-bold text-white">Scheduled!</p>
              <p className="text-sm text-zinc-500">{totalScheduled} clip{totalScheduled !== 1 ? "s" : ""} queued for publishing.</p>
            </div>
          ) : loadingAccounts ? (
            <div className="space-y-3">{[1,2].map((i) => <div key={i} className="h-28 animate-pulse rounded-[12px] bg-white/[.04]" />)}</div>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-[12px] border border-[#ff3d6a]/20 bg-[#ff3d6a]/5 px-4 py-8 text-center">
              <div className="grid h-10 w-10 place-items-center rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-lg">⚡</div>
              <p className="text-sm font-semibold text-white">No social accounts connected</p>
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
                  <div key={g.id} className="overflow-hidden rounded-[14px] border bg-[#0a0f1a]" style={{ borderColor: `${slotCfg.color}40` }}>
                    <div className="flex items-center gap-2.5 px-4 py-2.5" style={{ background: `${slotCfg.color}12`, borderBottom: `1px solid ${slotCfg.color}25` }}>
                      <div className="grid h-6 w-6 place-items-center rounded-full text-[11px] font-black text-white" style={{ background: slotCfg.color }}>{slotCfg.icon}</div>
                      <span className="text-[12px] font-bold" style={{ color: slotCfg.color }}>{slotCfg.label}</span>
                      <span className="text-[11px] font-semibold text-zinc-500">· Slot {gi + 1}</span>
                      {groups.length > 1 && (
                        <button onClick={() => removeGroup(g.id)} className="ml-auto text-[11px] text-zinc-600 hover:text-red-400 transition">Remove</button>
                      )}
                    </div>

                    <div className="p-4 space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[.08em] text-zinc-500">Account</label>
                          <select value={g.accountId} onChange={(e) => updateGroup(g.id, { accountId: e.target.value })}
                            className="w-full rounded-[9px] border bg-[#111827] px-2.5 py-2 text-[12px] text-white focus:outline-none transition"
                            style={{ borderColor: `${slotCfg.color}40` }}>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.platform.charAt(0).toUpperCase() + a.platform.slice(1)} — @{a.platform_username ?? "?"}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[.08em] text-zinc-500">Scheduled at</label>
                          <input type="datetime-local" value={g.scheduledAt}
                            onChange={(e) => updateGroup(g.id, { scheduledAt: e.target.value })}
                            className="w-full rounded-[9px] border border-white/[.08] bg-[#111827] px-2.5 py-2 text-[12px] text-white focus:outline-none [color-scheme:dark]" />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[.08em] text-zinc-500">Clips ({g.clipIds.length})</label>
                        <div className="flex flex-wrap gap-1.5">
                          {clips.map((c) => (
                            <button key={c.id} onClick={() => toggleClipInGroup(g.id, c.id)}
                              className="rounded-[8px] border px-2.5 py-1.5 text-[11px] font-semibold transition"
                              style={g.clipIds.includes(c.id)
                                ? { borderColor: `${slotCfg.color}50`, background: `${slotCfg.color}15`, color: slotCfg.color }
                                : { borderColor: "rgba(255,255,255,.07)", background: "rgba(255,255,255,.03)", color: "#71717a" }
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
                className="w-full rounded-[12px] border border-dashed border-white/[.1] py-3 text-[12px] font-semibold text-zinc-500 transition hover:border-white/20 hover:text-zinc-300">
                + Add time slot
              </button>

              {error && <p className="rounded-[8px] bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
            </>
          )}
        </div>

        {/* Footer */}
        {!success && accounts.length > 0 && (
          <div className="flex gap-3 border-t border-white/[.07] px-5 py-4 shrink-0">
            <button onClick={onClose} className="rounded-[10px] border border-white/[.08] bg-white/[.03] px-5 py-2.5 text-[13px] font-semibold text-zinc-300 hover:text-white transition">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={submitting || totalScheduled === 0}
              className="ml-auto flex items-center gap-2 rounded-[10px] bg-[#ff3d6a] px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-50 transition hover:bg-[#ff3d6a]/85">
              {submitting ? "Scheduling…" : `↗ Schedule ${totalScheduled} clip${totalScheduled !== 1 ? "s" : ""}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
