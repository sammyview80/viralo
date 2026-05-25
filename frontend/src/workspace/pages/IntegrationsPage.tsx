import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { platformApi, SocialAccount } from "@/lib/api";
import { Shell } from "../Shell";

/* ─── env / redirect ─── */
const YOUTUBE_CLIENT_ID = import.meta.env.VITE_YOUTUBE_CLIENT_ID ?? "";
const IG_CLIENT_ID      = import.meta.env.VITE_IG_CLIENT_ID ?? "";
const TIKTOK_KEY        = import.meta.env.VITE_TIKTOK_KEY ?? "";
const TWITTER_KEY       = import.meta.env.VITE_TWITTER_KEY ?? "";
const LI_CLIENT_ID      = import.meta.env.VITE_LI_CLIENT_ID ?? "";
const FB_APP_ID         = import.meta.env.VITE_FB_APP_ID ?? "";

const REDIRECT = import.meta.env.VITE_OAUTH_REDIRECT
  || (typeof window !== "undefined" ? `${window.location.origin}/oauth/callback` : "");

/* ─── platform config ─── */
const PLATFORMS = [
  {
    id: "youtube",
    label: "YouTube",
    icon: "▶",
    color: "text-red-300",
    bgColor: "bg-red-500/10",
    accent: "#ff5b64",
    quota: "~6 uploads/day",
    bestFor: "Shorts and video uploads",
    oauth_url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${YOUTUBE_CLIENT_ID}&redirect_uri=${REDIRECT}&response_type=code&scope=https://www.googleapis.com/auth/youtube.upload+https://www.googleapis.com/auth/youtube.readonly&access_type=offline&state=youtube&prompt=consent`,
  },
  {
    id: "instagram",
    label: "Instagram",
    icon: "◎",
    color: "text-purple-300",
    bgColor: "bg-purple-500/10",
    accent: "#c084fc",
    quota: "25 posts/day",
    bestFor: "Reels and creator posts",
    oauth_url: `https://api.instagram.com/oauth/authorize?client_id=${IG_CLIENT_ID}&redirect_uri=${REDIRECT}&scope=instagram_business_basic,instagram_content_publish&response_type=code&state=instagram`,
  },
  {
    id: "tiktok",
    label: "TikTok",
    icon: "♪",
    color: "text-rose-300",
    bgColor: "bg-rose-500/10",
    accent: "#ff3d6a",
    quota: "25 videos/day",
    bestFor: "Trend testing",
    oauth_url: `https://www.tiktok.com/v2/auth/authorize?client_key=${TIKTOK_KEY}&scope=user.info.basic,video.publish&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}&state=tiktok`,
  },
  {
    id: "twitter",
    label: "Twitter/X",
    icon: "𝕏",
    color: "text-sky-300",
    bgColor: "bg-sky-500/10",
    accent: "#38bdf8",
    quota: "34 posts/day",
    bestFor: "Quick distribution",
    oauth_url: `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${TWITTER_KEY}&redirect_uri=${REDIRECT}&scope=tweet.write%20users.read%20media.write&code_challenge=challenge&code_challenge_method=plain&state=twitter`,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    icon: "in",
    color: "text-blue-300",
    bgColor: "bg-blue-500/10",
    accent: "#60a5fa",
    quota: "—",
    bestFor: "Professional clips",
    oauth_url: `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${LI_CLIENT_ID}&redirect_uri=${REDIRECT}&scope=w_member_social&state=linkedin`,
  },
  {
    id: "facebook",
    label: "Facebook",
    icon: "f",
    color: "text-indigo-300",
    bgColor: "bg-indigo-500/10",
    accent: "#818cf8",
    quota: "200 calls/hr",
    bestFor: "Pages and community posts",
    oauth_url: `https://www.facebook.com/v21.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${REDIRECT}&scope=public_profile&state=facebook&response_type=code`,
  },
];

type Platform = (typeof PLATFORMS)[number];

function isExpiringSoon(value: string | null) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  return time - Date.now() < 1000 * 60 * 60 * 24 * 14;
}

function AccountChip({
  account,
  onDisconnect,
  disconnecting,
}: {
  account: SocialAccount;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  const expiring = isExpiringSoon(account.token_expires_at);

  return (
    <div className="flex items-center gap-2 rounded-[11px] border border-white/[.07] bg-white/[.025] px-3 py-2">
      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-300">
        {account.platform_username ? `@${account.platform_username}` : account.id}
      </span>
      {expiring && <span className="hidden text-[10px] font-semibold text-amber-300 sm:inline">Refresh soon</span>}
      <button
        onClick={onDisconnect}
        disabled={disconnecting}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] text-zinc-600 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-40"
        title="Disconnect"
      >
        {disconnecting ? "…" : "✕"}
      </button>
    </div>
  );
}

function PlatformCard({
  platform,
  accounts,
  onConnect,
  onDisconnect,
  disconnecting,
}: {
  platform: Platform;
  accounts: SocialAccount[];
  onConnect: () => void;
  onDisconnect: (account: SocialAccount) => void;
  disconnecting: string | null;
}) {
  const hasAny = accounts.length > 0;

  return (
    <Card
      className={cn(
        "group relative flex min-h-[224px] flex-col overflow-hidden rounded-[18px] border p-5 transition duration-200",
        hasAny
          ? "border-[#ff3d6a]/25 bg-[#111827] shadow-[0_0_0_1px_rgba(255,61,106,.05)]"
          : "border-white/[.07] bg-[#101722] hover:border-white/[.12] hover:bg-[#121a27]",
      )}
      style={{ animation: "fadeUp .22s cubic-bezier(.22,.8,.4,1) both" }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-70" style={{ background: `linear-gradient(90deg, transparent, ${platform.accent}55, transparent)` }} />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center rounded-[13px] border border-white/[.08] text-lg font-black",
              platform.bgColor,
              platform.color,
            )}
          >
            {platform.icon}
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-[17px] font-bold leading-6 tracking-[-.02em] text-white">
              {platform.label}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-zinc-500">
              {platform.bestFor}
            </div>
          </div>
        </div>

        {hasAny ? (
          <Badge variant="ready" className="shrink-0 text-[11px]">
            {accounts.length} connected
          </Badge>
        ) : (
          <Badge variant="muted" className="shrink-0 text-[11px]">
            Not connected
          </Badge>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 text-[11px] text-zinc-500">
        <span className="rounded-full border border-white/[.06] bg-white/[.025] px-2.5 py-1 font-medium">
          Quota: {platform.quota}
        </span>
        <span className="rounded-full border border-white/[.06] bg-white/[.025] px-2.5 py-1 font-medium">
          OAuth
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {accounts.map((acct) => (
          <AccountChip
            key={acct.id}
            account={acct}
            onDisconnect={() => onDisconnect(acct)}
            disconnecting={disconnecting === acct.id}
          />
        ))}
      </div>

      <Button
        size="sm"
        className={cn(
          "mt-auto h-10 w-full rounded-[12px] font-bold",
          hasAny
            ? "border border-white/[.08] bg-white/[.025] text-zinc-200 hover:border-[#ff3d6a]/40 hover:bg-[#ff3d6a]/10 hover:text-white"
            : "bg-[#ff3d6a] text-white shadow-[0_14px_34px_rgba(255,61,106,.18)] hover:bg-[#e8304f]",
        )}
        onClick={onConnect}
      >
        {hasAny ? `+ Add another ${platform.label}` : `Connect ${platform.label}`}
      </Button>
    </Card>
  );
}

function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex max-w-[calc(100vw-24px)] items-center gap-3 rounded-[12px] border border-emerald-500/30 bg-[#0e1420] px-4 py-3 shadow-xl">
      <span className="h-2 w-2 rounded-full bg-emerald-400" />
      <span className="text-[13px] text-zinc-200">{msg}</span>
      <button onClick={onClose} className="ml-2 text-zinc-600 hover:text-zinc-300">✕</button>
    </div>
  );
}

export function IntegrationsPage() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await platformApi.listAccounts();
      setAccounts(data ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    if (code && state) {
      window.history.replaceState({}, "", window.location.pathname);

      platformApi
        .connectOAuth(state, code, REDIRECT)
        .then(() => {
          setToast(`${state.charAt(0).toUpperCase() + state.slice(1)} connected!`);
          load();
        })
        .catch(() => {
          setToast("OAuth failed — please try again.");
        });
    } else {
      load();
    }
  }, []);

  const handleConnect = (platform: Platform) => {
    window.location.href = platform.oauth_url;
  };

  const handleDisconnect = async (platform: Platform, account: SocialAccount) => {
    setDisconnecting(account.id);
    try {
      await platformApi.deleteAccount(account.id);
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      setToast(`${platform.label} (@${account.platform_username ?? account.id}) disconnected.`);
    } catch {
      setToast("Failed to disconnect — please try again.");
    } finally {
      setDisconnecting(null);
    }
  };

  const totalConnected = accounts.filter((a) => a.is_active).length;
  const connectedPlatforms = useMemo(
    () => PLATFORMS.filter((p) => accounts.some((a) => a.platform === p.id && a.is_active)).length,
    [accounts],
  );

  return (
    <Shell active="integrations">
      <div className="flex min-h-[calc(100vh-116px)] flex-col overflow-hidden rounded-[18px] border border-white/[.07] bg-[#0b111c] shadow-[0_24px_80px_rgba(0,0,0,.25)]">
        <div className="border-b border-white/[.07] bg-[#090e16]/95 px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-display text-2xl font-black tracking-[-.03em] text-white">Integrations</h1>
                <span className="rounded-full border border-[#ff3d6a]/20 bg-[#ff3d6a]/10 px-2.5 py-1 text-[11px] font-bold text-rose-200">
                  {totalConnected} connected
                </span>
              </div>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-zinc-500">
                Connect social accounts once, then publish and schedule clips from Viralo.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-[12px] text-zinc-500">
              <span className="rounded-full border border-white/[.07] bg-white/[.025] px-3 py-1.5">
                {connectedPlatforms}/{PLATFORMS.length} platforms ready
              </span>
              <span className="rounded-full border border-white/[.07] bg-white/[.025] px-3 py-1.5">
                Multi-account publishing
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 p-3 sm:p-5">
          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {PLATFORMS.map((p) => (
                <div key={p.id} className="h-[224px] animate-pulse rounded-[18px] border border-white/[.05] bg-white/[.025]" />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {PLATFORMS.map((p) => {
                const platformAccounts = accounts.filter(
                  (a) => a.platform === p.id && a.is_active,
                );
                return (
                  <PlatformCard
                    key={p.id}
                    platform={p}
                    accounts={platformAccounts}
                    onConnect={() => handleConnect(p)}
                    onDisconnect={(acct) => handleDisconnect(p, acct)}
                    disconnecting={disconnecting}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
    </Shell>
  );
}
