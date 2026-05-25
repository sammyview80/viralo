import { useEffect, useState } from "react";
import { platformApi } from "@/lib/api";

const REDIRECT = import.meta.env.VITE_OAUTH_REDIRECT
  || `${window.location.origin}/oauth/callback`;

function detectPlatform(params: URLSearchParams): string | null {
  const state = params.get("state");
  if (state) return state;
  // Google doesn't return state if we forgot to send it — detect by iss
  const iss = params.get("iss") ?? "";
  if (iss.includes("google") || iss.includes("accounts.google")) return "youtube";
  return null;
}

export function OAuthCallbackPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Connecting your account…");
  const [platform, setPlatform] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const plat = detectPlatform(params);

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
    if (plat === "tiktok") {
      const cv = sessionStorage.getItem("tiktok_cv");
      if (cv) { extra.code_verifier = cv; sessionStorage.removeItem("tiktok_cv"); }
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#080b12] px-4">
      <div className="w-full max-w-[380px] overflow-hidden rounded-[20px] border border-white/[.09] bg-[#0e1420] p-8 text-center shadow-[0_32px_80px_rgba(0,0,0,.6)]">
        {status === "loading" && (
          <>
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-[14px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10">
              <span className="block h-6 w-6 rounded-full border-[3px] border-[#ff3d6a]/30 border-t-[#ff3d6a] animate-spin" />
            </div>
            <h2 className="font-display text-[18px] font-bold text-white">Connecting…</h2>
            <p className="mt-2 text-[13px] text-zinc-500">{message}</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-[14px] border border-emerald-300/25 bg-emerald-400/10 text-2xl text-emerald-300">
              ✓
            </div>
            <h2 className="font-display text-[18px] font-bold text-white">{message}</h2>
            <p className="mt-2 text-[13px] text-zinc-500">Redirecting to integrations…</p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-[14px] border border-red-400/25 bg-red-400/10 text-2xl text-red-400">
              ✕
            </div>
            <h2 className="font-display text-[18px] font-bold text-white">Connection failed</h2>
            <p className="mt-2 text-[13px] text-zinc-500">{message}</p>
            <a
              href="/integrations"
              className="mt-5 inline-block rounded-[9px] border border-white/[.08] bg-white/[.04] px-5 py-2 text-[13px] font-semibold text-zinc-300 transition hover:bg-white/[.08] hover:text-white"
            >
              ← Back to integrations
            </a>
          </>
        )}
      </div>

      {platform && status === "loading" && (
        <p className="text-[11.5px] text-zinc-600">
          Exchanging OAuth code for {platform} access token…
        </p>
      )}
    </div>
  );
}
