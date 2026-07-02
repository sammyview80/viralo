import { useEffect, useState } from "react";
import { platformApi } from "@/lib/api";

const REDIRECT = import.meta.env.VITE_OAUTH_REDIRECT
  || `${window.location.origin}/oauth/callback`;

function readOAuthAttempt(state: string): { platform: string; codeVerifier?: string | null } | null {
  try {
    const raw = sessionStorage.getItem("oauth_state");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { platform?: string; state?: string; codeVerifier?: string | null };
    if (parsed.state !== state || !parsed.platform) return null;
    sessionStorage.removeItem("oauth_state");
    return { platform: parsed.platform, codeVerifier: parsed.codeVerifier ?? null };
  } catch {
    return null;
  }
}

export function OAuthCallbackPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Connecting your account…");
  const [platform, setPlatform] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const attempt = state ? readOAuthAttempt(state) : null;
    const plat = attempt?.platform ?? null;

    if (!code) {
      setStatus("error");
      setMessage("No authorization code received.");
      return;
    }
    if (!plat) {
      setStatus("error");
      setMessage("Could not determine platform. Please try again.");
      return;
    }

    setPlatform(plat);

    const extra: Record<string, string> = {};
    if (plat === "tiktok" && attempt?.codeVerifier) {
      extra.code_verifier = attempt.codeVerifier;
    }

    platformApi
      .connectOAuth(plat, code, REDIRECT, extra)
      .then(() => {
        setStatus("success");
        setMessage(`${plat.charAt(0).toUpperCase() + plat.slice(1)} connected!`);
        setTimeout(() => {
          window.location.replace("/integrations");
        }, 1800);
      })
      .catch((err: Error) => {
        setStatus("error");
        setMessage(err?.message ?? "OAuth failed. Please try again.");
      });
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-surface-0 px-4">
      <div className="w-full max-w-[380px] overflow-hidden rounded-[20px] border border-c-border bg-surface-1 p-8 text-center shadow-[0_32px_80px_rgba(0,0,0,.3)]">
        {status === "loading" && (
          <>
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-[14px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10">
              <span className="block h-6 w-6 rounded-full border-[3px] border-[#ff3d6a]/30 border-t-[#ff3d6a] animate-spin" />
            </div>
            <h2 className="font-display text-[18px] font-bold text-c-text">Connecting…</h2>
            <p className="mt-2 text-[13px] text-c-text-muted">{message}</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-[14px] border border-emerald-300/25 bg-emerald-400/10 text-2xl text-emerald-300">
              ✓
            </div>
            <h2 className="font-display text-[18px] font-bold text-c-text">{message}</h2>
            <p className="mt-2 text-[13px] text-c-text-muted">Redirecting to integrations…</p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-[14px] border border-red-400/25 bg-red-400/10 text-2xl text-red-400">
              ✕
            </div>
            <h2 className="font-display text-[18px] font-bold text-c-text">Connection failed</h2>
            <p className="mt-2 text-[13px] text-c-text-muted">{message}</p>
            <a
              href="/integrations"
              className="mt-5 inline-block rounded-[9px] border border-c-border bg-surface-glass px-5 py-2 text-[13px] font-semibold text-c-text-secondary transition hover:bg-surface-2 hover:text-c-text"
            >
              ← Back to integrations
            </a>
          </>
        )}
      </div>

      {platform && status === "loading" && (
        <p className="text-[11.5px] text-c-text-muted">
          Exchanging OAuth code for {platform} access token…
        </p>
      )}
    </div>
  );
}
