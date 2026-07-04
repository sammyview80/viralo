import React, { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { platformApi, SocialAccount } from "@/lib/api";

/* ─── env / redirect ─── */
const YOUTUBE_CLIENT_ID = import.meta.env.VITE_YOUTUBE_CLIENT_ID ?? "";
const IG_CLIENT_ID      = import.meta.env.VITE_IG_CLIENT_ID ?? "";
const TIKTOK_KEY        = import.meta.env.VITE_TIKTOK_KEY ?? "";
const TWITTER_KEY       = import.meta.env.VITE_TWITTER_KEY ?? "";
const LI_CLIENT_ID      = import.meta.env.VITE_LI_CLIENT_ID ?? "";
const FB_APP_ID         = import.meta.env.VITE_FB_APP_ID ?? "";

const REDIRECT = import.meta.env.VITE_OAUTH_REDIRECT
  || (typeof window !== "undefined" ? `${window.location.origin}/oauth/callback` : "");


function base64UrlEncode(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomCodeVerifier() {
  const bytes = new Uint8Array(64);
  window.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes.buffer);
}

function randomOAuthState() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes.buffer);
}

function rememberOAuthAttempt(platform: string, state: string, codeVerifier?: string) {
  sessionStorage.setItem("oauth_state", JSON.stringify({ platform, state, codeVerifier: codeVerifier ?? null }));
}

async function buildOAuthUrl(platform: Platform) {
  const state = randomOAuthState();
  const paramsByPlatform: Record<string, { base: string; params: Record<string, string> }> = {
    youtube: {
      base: "https://accounts.google.com/o/oauth2/v2/auth",
      params: {
        client_id: YOUTUBE_CLIENT_ID,
        redirect_uri: REDIRECT,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
        access_type: "offline",
        prompt: "consent",
        state,
      },
    },
    instagram: {
      base: "https://api.instagram.com/oauth/authorize",
      params: {
        client_id: IG_CLIENT_ID,
        redirect_uri: REDIRECT,
        scope: "instagram_business_basic,instagram_content_publish",
        response_type: "code",
        state,
      },
    },
    twitter: {
      base: "https://twitter.com/i/oauth2/authorize",
      params: {
        response_type: "code",
        client_id: TWITTER_KEY,
        redirect_uri: REDIRECT,
        scope: "tweet.write users.read media.write",
        code_challenge: "challenge",
        code_challenge_method: "plain",
        state,
      },
    },
    linkedin: {
      base: "https://www.linkedin.com/oauth/v2/authorization",
      params: {
        response_type: "code",
        client_id: LI_CLIENT_ID,
        redirect_uri: REDIRECT,
        scope: "w_member_social",
        state,
      },
    },
    facebook: {
      base: "https://www.facebook.com/v21.0/dialog/oauth",
      params: {
        client_id: FB_APP_ID,
        redirect_uri: REDIRECT,
        scope: "public_profile",
        response_type: "code",
        state,
      },
    },
  };

  if (platform.id === "tiktok") return buildTikTokOAuthUrl(state);

  const config = paramsByPlatform[platform.id];
  if (!config) throw new Error("Unsupported platform");
  rememberOAuthAttempt(platform.id, state);
  const params = new URLSearchParams(config.params);
  return `${config.base}?${params.toString()}`;
}

async function sha256Base64Url(value: string) {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncode(digest);
}

async function buildTikTokOAuthUrl(state: string) {
  const verifier = randomCodeVerifier();
  const challenge = await sha256Base64Url(verifier);
  rememberOAuthAttempt("tiktok", state, verifier);

  const params = new URLSearchParams({
    client_key: TIKTOK_KEY,
    scope: "user.info.basic,video.publish",
    response_type: "code",
    redirect_uri: REDIRECT,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  return `https://www.tiktok.com/v2/auth/authorize?${params.toString()}`;
}

/* ─── SVG brand icons ─── */
function IconYouTube({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.5 6.2a3.01 3.01 0 00-2.12-2.13C19.46 3.6 12 3.6 12 3.6s-7.46 0-9.38.47A3.01 3.01 0 00.5 6.2C.03 8.1 0 12 0 12s.03 3.9.5 5.8a3.01 3.01 0 002.12 2.13C4.54 20.4 12 20.4 12 20.4s7.46 0 9.38-.47a3.01 3.01 0 002.12-2.13c.47-1.9.5-5.8.5-5.8s-.03-3.9-.5-5.8zM9.6 15.6V8.4l6.27 3.6-6.27 3.6z"/>
    </svg>
  );
}
function IconInstagram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
    </svg>
  );
}
function IconTikTok({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.76a4.85 4.85 0 01-1.01-.07z"/>
    </svg>
  );
}
function IconTwitterX({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  );
}
function IconLinkedIn({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  );
}
function IconFacebook({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  );
}

const PLATFORM_ICONS: Record<string, ({ className }: { className?: string }) => React.ReactElement> = {
  youtube: IconYouTube,
  instagram: IconInstagram,
  tiktok: IconTikTok,
  twitter: IconTwitterX,
  linkedin: IconLinkedIn,
  facebook: IconFacebook,
};

/* ─── platform config ─── */
const PLATFORMS = [
  {
    id: "youtube",
    label: "YouTube",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
    accent: "#ff5b64",
    quota: "~6 uploads/day",
    bestFor: "Shorts and video uploads",
    oauth_url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${YOUTUBE_CLIENT_ID}&redirect_uri=${REDIRECT}&response_type=code&scope=https://www.googleapis.com/auth/youtube.upload+https://www.googleapis.com/auth/youtube.readonly&access_type=offline&state=youtube&prompt=consent`,
  },
  {
    id: "instagram",
    label: "Instagram",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/20",
    accent: "#c084fc",
    quota: "25 posts/day",
    bestFor: "Reels and creator posts",
    oauth_url: `https://api.instagram.com/oauth/authorize?client_id=${IG_CLIENT_ID}&redirect_uri=${REDIRECT}&scope=instagram_business_basic,instagram_content_publish&response_type=code&state=instagram`,
  },
  {
    id: "tiktok",
    label: "TikTok",
    color: "text-rose-300",
    bgColor: "bg-rose-500/10",
    borderColor: "border-rose-500/20",
    accent: "#ff3d6a",
    quota: "25 videos/day",
    bestFor: "Trend testing",
    oauth_url: `https://www.tiktok.com/v2/auth/authorize?client_key=${TIKTOK_KEY}&scope=user.info.basic,video.publish&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}&state=tiktok`,
    usesPkce: true,
  },
  {
    id: "twitter",
    label: "Twitter / X",
    color: "text-sky-300",
    bgColor: "bg-sky-500/10",
    borderColor: "border-sky-500/20",
    accent: "#38bdf8",
    quota: "34 posts/day",
    bestFor: "Quick distribution",
    oauth_url: `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${TWITTER_KEY}&redirect_uri=${REDIRECT}&scope=tweet.write%20users.read%20media.write&code_challenge=challenge&code_challenge_method=plain&state=twitter`,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
    accent: "#60a5fa",
    quota: "Variable",
    bestFor: "Professional clips",
    oauth_url: `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${LI_CLIENT_ID}&redirect_uri=${REDIRECT}&scope=w_member_social&state=linkedin`,
  },
  {
    id: "facebook",
    label: "Facebook",
    color: "text-indigo-400",
    bgColor: "bg-indigo-500/10",
    borderColor: "border-indigo-500/20",
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

function AccountRow({
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
    <div className="flex items-center gap-2.5 rounded-xl border border-emerald-800/30 bg-emerald-950/20 px-3 py-2.5">
      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-c-text">
        {account.platform_username ? `@${account.platform_username}` : account.id}
      </span>
      {expiring && <Badge variant="warn" className="text-[10px] shrink-0">Refresh soon</Badge>}
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onDisconnect}
              disabled={disconnecting}
              aria-label="Disconnect account"
              className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-lg text-c-text-muted transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
            >
              {disconnecting ? (
                <span className="text-xs">…</span>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent className="bg-surface-2 border-c-border text-xs">Disconnect</TooltipContent>
        </Tooltip>
      </TooltipProvider>
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
  const PlatformIcon = PLATFORM_ICONS[platform.id];

  return (
    <Card
      className={cn(
        "relative flex flex-col overflow-hidden border transition-all duration-200",
        hasAny
          ? "border-emerald-800/40 bg-surface-1 shadow-[0_0_20px_rgba(52,211,153,.04)]"
          : "border-c-border bg-surface-1 hover:border-c-border-hover hover:bg-surface-2",
      )}
    >
      {/* top accent line */}
      <div
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: hasAny ? `linear-gradient(90deg, ${platform.accent}88, transparent)` : "transparent" }}
      />

      <CardHeader className="px-5 pt-5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* brand icon */}
            <div className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-c-border", platform.bgColor)}>
              {PlatformIcon && <PlatformIcon className={cn("w-5 h-5", platform.color)} />}
            </div>
            <div className="min-w-0">
              <p className="text-base font-bold text-c-text leading-tight">{platform.label}</p>
              <p className="text-xs text-c-text-muted mt-0.5 truncate">{platform.bestFor}</p>
            </div>
          </div>

          {hasAny ? (
            <Badge variant="ready" className="shrink-0 text-[11px]">
              {accounts.length === 1 ? "Connected" : `${accounts.length} connected`}
            </Badge>
          ) : (
            <Badge variant="muted" className="shrink-0 text-[11px]">Not connected</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 px-5 pb-5 flex-1">
        {/* quota pill */}
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default rounded-full border border-c-border bg-surface-2 px-2.5 py-1 text-[11px] text-c-text-muted font-medium hover:border-c-border-hover transition-colors">
                  {platform.quota}
                </span>
              </TooltipTrigger>
              <TooltipContent className="bg-surface-2 border-c-border text-xs">
                Daily limit for {platform.label}
              </TooltipContent>
            </Tooltip>
            <span className="rounded-full border border-c-border bg-surface-2 px-2.5 py-1 text-[11px] text-c-text-muted font-medium">
              OAuth 2.0
            </span>
          </div>
        </TooltipProvider>

        {/* connected accounts */}
        {accounts.length > 0 && (
          <>
            <Separator className="bg-c-border" />
            <div className="flex flex-col gap-2">
              {accounts.map((acct) => (
                <AccountRow
                  key={acct.id}
                  account={acct}
                  onDisconnect={() => onDisconnect(acct)}
                  disconnecting={disconnecting === acct.id}
                />
              ))}
            </div>
          </>
        )}

        {/* CTA */}
        <Button
          className={cn(
            "mt-auto h-10 w-full cursor-pointer rounded-xl font-semibold text-sm",
            hasAny
              ? "border border-c-border bg-surface-2 text-c-text-secondary hover:border-[#ff3d6a]/50 hover:bg-[#ff3d6a]/10 hover:text-c-text"
              : "bg-[#ff3d6a] text-white shadow-[0_8px_24px_rgba(255,61,106,.25)] hover:bg-[#e8304f] hover:shadow-[0_8px_32px_rgba(255,61,106,.35)]",
          )}
          onClick={onConnect}
        >
          {hasAny ? `+ Add another ${platform.label}` : `Connect ${platform.label}`}
        </Button>
      </CardContent>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card className="border-c-border bg-surface-1">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-2xl bg-surface-glass" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2 bg-surface-glass" />
            <Skeleton className="h-3 w-2/3 bg-surface-glass" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full bg-surface-glass" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-5 pb-5">
        <div className="flex gap-2">
          <Skeleton className="h-7 w-24 rounded-full bg-surface-glass" />
          <Skeleton className="h-7 w-20 rounded-full bg-surface-glass" />
        </div>
        <Skeleton className="h-10 w-full rounded-xl bg-surface-glass" />
      </CardContent>
    </Card>
  );
}

function ToastAlert({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  const isError = msg.toLowerCase().includes("fail");
  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 max-w-[calc(100vw-24px)]">
      <Alert className={cn("shadow-2xl backdrop-blur", isError ? "bg-red-950/90 border-red-800/60" : "bg-surface-1/95 border-emerald-700/40")}>
        <AlertDescription className="flex items-center gap-3 pr-6">
          <span className={cn("h-2 w-2 rounded-full shrink-0", isError ? "bg-red-400" : "bg-emerald-400")} />
          <span className={cn("text-sm", isError ? "text-red-300" : "text-c-text")}>{msg}</span>
        </AlertDescription>
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 text-c-text-muted hover:text-c-text cursor-pointer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </Alert>
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
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
  }, []);

  const handleConnect = async (platform: Platform) => {
    window.location.href = await buildOAuthUrl(platform);
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

  const connectedPlatforms = useMemo(
    () => PLATFORMS.filter((p) => accounts.some((a) => a.platform === p.id && a.is_active)).length,
    [accounts],
  );
  const progressPct = Math.round((connectedPlatforms / PLATFORMS.length) * 100);

  /* sort: connected first */
  const sortedPlatforms = useMemo(() => {
    const connected = PLATFORMS.filter((p) => accounts.some((a) => a.platform === p.id && a.is_active));
    const rest = PLATFORMS.filter((p) => !accounts.some((a) => a.platform === p.id && a.is_active));
    return [...connected, ...rest];
  }, [accounts]);

  return (
    <>
      <div className="flex min-h-[calc(100vh-116px)] flex-col overflow-hidden rounded-2xl border border-c-border bg-surface-0">

        {/* ── Header ── */}
        <div className="border-b border-c-border bg-surface-1/95 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-c-text">Integrations</h1>
              <p className="mt-1 text-sm text-c-text-secondary">Connect platforms to publish and schedule clips directly from Viralo.</p>
            </div>

            {/* stats + progress */}
            <div className="flex flex-col gap-2 lg:items-end lg:min-w-[220px]">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-c-text tabular-nums">{connectedPlatforms}</span>
                <span className="text-sm text-c-text-muted">of {PLATFORMS.length} platforms connected</span>
              </div>
              <div className="w-full lg:w-52 space-y-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#ff3d6a] to-rose-400 transition-all duration-700"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="text-[11px] text-c-text-muted">{progressPct}% coverage — more platforms, more reach</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Grid ── */}
        <div className="flex-1 p-4 sm:p-5">
          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {PLATFORMS.map((p) => <SkeletonCard key={p.id} />)}
            </div>
          ) : (
            <>
              {/* connected section label */}
              {connectedPlatforms > 0 && (
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs font-semibold uppercase tracking-widest text-emerald-500">Connected</span>
                  <div className="flex-1 h-px bg-emerald-900/40" />
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {sortedPlatforms.map((p, i) => {
                  const platformAccounts = accounts.filter((a) => a.platform === p.id && a.is_active);
                  const isFirstDisconnected = connectedPlatforms > 0 && i === connectedPlatforms;
                  return (
                    <div key={p.id}>
                      {isFirstDisconnected && (
                        <div className="flex items-center gap-3 mb-4 col-span-full">
                          <span className="text-xs font-semibold uppercase tracking-widest text-c-text-muted">Not connected</span>
                          <div className="flex-1 h-px bg-c-border" />
                        </div>
                      )}
                      <PlatformCard
                        platform={p}
                        accounts={platformAccounts}
                        onConnect={() => handleConnect(p)}
                        onDisconnect={(acct) => handleDisconnect(p, acct)}
                        disconnecting={disconnecting}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {toast && <ToastAlert msg={toast} onClose={() => setToast(null)} />}
    </>
  );
}
