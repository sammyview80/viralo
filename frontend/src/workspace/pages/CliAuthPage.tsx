import { useState } from "react";
import { deviceAuth, ApiError } from "@/lib/api";

function normalize(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

export function CliAuthPage() {
  const initial = normalize(new URLSearchParams(window.location.search).get("code") ?? "");
  const [code, setCode] = useState(initial);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const approve = async () => {
    if (!code.trim()) return;
    setStatus("loading");
    try {
      await deviceAuth.approve(code);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof ApiError ? err.message : "Could not authorize this code.");
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-surface-0 px-4">
      <div className="w-full max-w-[380px] overflow-hidden rounded-[20px] border border-c-border bg-surface-1 p-8 text-center shadow-[0_32px_80px_rgba(0,0,0,.3)]">
        {status === "success" ? (
          <>
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-[14px] border border-emerald-300/25 bg-emerald-400/10 text-2xl text-emerald-300">✓</div>
            <h2 className="font-display text-[18px] font-bold text-c-text">CLI authorized</h2>
            <p className="mt-2 text-[13px] text-c-text-muted">You can return to your terminal.</p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-[14px] border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-2xl">🔑</div>
            <h2 className="font-display text-[18px] font-bold text-c-text">Authorize CLI access</h2>
            <p className="mt-2 text-[13px] text-c-text-muted">
              Confirm the code shown in your terminal matches the one below, then authorize.
            </p>

            <input
              value={code}
              onChange={(e) => setCode(normalize(e.target.value))}
              placeholder="XXXX-XXXX"
              maxLength={9}
              className="mt-5 w-full rounded-[10px] border border-c-border bg-surface-2 px-3 py-3 text-center font-mono text-[20px] font-semibold tracking-widest text-c-text placeholder:text-c-text-muted/50 focus:border-[#ff3d6a]/50 focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/20"
            />

            {status === "error" && (
              <p className="mt-3 text-[12px] text-red-400">{message}</p>
            )}

            <button
              onClick={approve}
              disabled={status === "loading" || !code.trim()}
              className="mt-5 h-10 w-full cursor-pointer rounded-[10px] bg-[#ff3d6a] text-[13px] font-semibold text-white transition-colors hover:bg-[#e8304f] disabled:opacity-50"
            >
              {status === "loading" ? "Authorizing…" : "Authorize"}
            </button>

            <p className="mt-4 text-[11.5px] text-c-text-muted">
              This grants full workspace access to whatever issued this code. Only approve codes you generated yourself.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default CliAuthPage;
