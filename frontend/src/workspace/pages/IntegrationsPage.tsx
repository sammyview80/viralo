import { useEffect, useState } from "react";
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
    color: "text-red-400",
    quota: "~6 uploads/day",
    oauth_url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${YOUTUBE_CLIENT_ID}&redirect_uri=${REDIRECT}&response_type=code&scope=https://www.googleapis.com/auth/youtube.upload+https://www.googleapis.com/auth/youtube.readonly&access_type=offline&state=youtube&prompt=consent`,
  },
  {
    id: "instagram",
    label: "Instagram",
    icon: "📸",
    color: "text-purple-400",
    quota: "25 posts/day",
    oauth_url: `https://api.instagram.com/oauth/authorize?client_id=${IG_CLIENT_ID}&redirect_uri=${REDIRECT}&scope=instagram_business_basic,instagram_content_publish&response_type=code&state=instagram`,
  },
  {
    id: "tiktok",
    label: "TikTok",
    icon: "♪",
    color: "text-rose-400",
    quota: "25 videos/day",
    oauth_url: `https://www.tiktok.com/v2/auth/authorize?client_key=${TIKTOK_KEY}&scope=user.info.basic,video.publish&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}&state=tiktok`,
  },
  {
    id: "twitter",
    label: "Twitter/X",
    icon: "✕",
    color: "text-sky-400",
    quota: "34 posts/day",
    oauth_url: `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${TWITTER_KEY}&redirect_uri=${REDIRECT}&scope=tweet.write%20users.read%20media.write&code_challenge=challenge&code_challenge_method=plain&state=twitter`,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    icon: "in",
    color: "text-blue-400",
    quota: "—",
    oauth_url: `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${LI_CLIENT_ID}&redirect_uri=${REDIRECT}&scope=w_member_social&state=linkedin`,
  },
  {
    id: "facebook",
    label: "Facebook",
    icon: "f",
    color: "text-indigo-400",
    quota: "200 calls/hr",
    oauth_url: `https://www.facebook.com/v21.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${REDIRECT}&scope=public_profile&state=facebook&response_type=code`,
  },
];

/* ─── platform card ─── */
function PlatformCard({
  platform,
  account,
  onConnect,
  onDisconnect,
  disconnecting,
}: {
  platform: (typeof PLATFORMS)[number];
  account: SocialAccount | undefined;
  onConnect: () => void;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  const connected = !!account;

  return (
    <Card
      className={cn(
        "flex flex-col gap-5 rounded-[12px] border bg-[#0e1420] p-5 transition",
        connected
          ? "border-[#ff3d6a]/30 shadow-[0_0_0_1px_rgba(255,61,106,.08)]"
          : "border-white/[.07]",
      )}
      style={{ animation: "fadeUp .28s cubic-bezier(.22,.8,.4,1) both" }}
    >
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-white/[.07] bg-[#141926] text-lg font-bold",
              platform.color,
            )}
          >
            {platform.icon}
          </div>
          <div>
            <div className="font-display text-[15px] font-bold leading-5">
              {platform.label}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              Quota: {platform.quota}
            </div>
          </div>
        </div>

        {connected ? (
          <Badge variant="ready" className="shrink-0 text-[11px]">
            Connected
          </Badge>
        ) : (
          <Badge variant="muted" className="shrink-0 text-[11px]">
            Not connected
          </Badge>
        )}
      </div>

      {/* username row */}
      {connected && account?.platform_username && (
        <div className="flex items-center gap-2 rounded-[8px] border border-white/[.07] bg-[#141926] px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-[12px] text-zinc-300">
            @{account.platform_username}
          </span>
        </div>
      )}

      {/* actions */}
      <div className="mt-auto flex gap-2">
        {connected ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full border border-white/[.07] text-zinc-400 hover:border-rose-500/40 hover:text-rose-400"
            onClick={onDisconnect}
            disabled={disconnecting}
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </Button>
        ) : (
          <Button
            size="sm"
            className="w-full bg-[#ff3d6a] text-white hover:bg-[#ff3d6a]/85"
            onClick={onConnect}
          >
            Connect
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ─── toast ─── */
function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-[10px] border border-emerald-500/30 bg-[#0e1420] px-4 py-3 shadow-xl">
      <span className="h-2 w-2 rounded-full bg-emerald-400" />
      <span className="text-[13px] text-zinc-200">{msg}</span>
      <button
        onClick={onClose}
        className="ml-2 text-zinc-600 hover:text-zinc-300"
      >
        ✕
      </button>
    </div>
  );
}

/* ─── page ─── */
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

  /* handle OAuth callback params on this page */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state"); // platform id

    if (code && state) {
      /* strip query from URL without reload */
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

  const handleConnect = (platform: (typeof PLATFORMS)[number]) => {
    window.location.href = platform.oauth_url;
  };

  const handleDisconnect = async (platform: (typeof PLATFORMS)[number], account: SocialAccount) => {
    setDisconnecting(platform.id);
    try {
      await platformApi.deleteAccount(account.id);
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      setToast(`${platform.label} disconnected.`);
    } catch {
      setToast("Failed to disconnect — please try again.");
    } finally {
      setDisconnecting(null);
    }
  };

  const connected = accounts.filter((a) => a.is_active).length;

  return (
    <Shell active="integrations">
      <div className="flex min-h-[calc(100vh-116px)] flex-col overflow-hidden rounded-[12px] border border-white/[.07] bg-[#0e1420]">
        {/* header */}
        <div className="flex flex-wrap items-center gap-3 border-b border-white/[.07] bg-[#0b101a] p-4">
          <h1 className="font-display text-[19px] font-bold tracking-[-.01em]">
            Integrations
          </h1>
          <span className="rounded-full border border-white/[.07] bg-[#141926] px-2 py-0.5 text-xs font-semibold text-zinc-500">
            {connected}/{PLATFORMS.length} connected
          </span>
          <p className="ml-auto text-[13px] text-zinc-500">
            Connect your social channels to enable one-click publishing.
          </p>
        </div>

        {/* grid */}
        <div className="p-5">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {PLATFORMS.map((p) => (
                <div
                  key={p.id}
                  className="h-[170px] animate-pulse rounded-[12px] border border-white/[.05] bg-[#141926]"
                />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {PLATFORMS.map((p) => {
                const account = accounts.find((a) => a.platform === p.id && a.is_active);
                return (
                  <PlatformCard
                    key={p.id}
                    platform={p}
                    account={account}
                    onConnect={() => handleConnect(p)}
                    onDisconnect={() => account && handleDisconnect(p, account)}
                    disconnecting={disconnecting === p.id}
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
