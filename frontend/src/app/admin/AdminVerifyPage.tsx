import { useEffect, useState } from "react";
import { adminApi, adminToken, ApiError } from "@/lib/api";
import { navigate } from "@/lib/router";
import { AuthShell, ErrorBanner } from "@/app/auth/components";

export function AdminVerifyPage() {
  const [error, setError] = useState("");
  // Token travels in the URL fragment (#token=...), not the query string —
  // fragments are never sent to the server, so they never appear in
  // server/proxy access logs or Referer headers. They still momentarily sit
  // in the browser's own address bar / history, which is why we strip the
  // fragment immediately after reading it (replaceState, no reload).
  const [token] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const t = hash.get("token");
    if (t) history.replaceState(null, "", window.location.pathname);
    return t;
  });

  useEffect(() => {
    if (!token) {
      setError("Missing login token.");
      return;
    }
    adminApi.verifyLogin(token)
      .then((res) => {
        adminToken.set(res.access_token);
        navigate("/admin/dashboard");
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Login link is invalid or expired.");
      });
  }, [token]);

  return (
    <AuthShell title="Signing you in…" subtitle="Verifying your admin login link">
      {error ? (
        <>
          <ErrorBanner message={error} />
          <a href="/admin" className="mt-4 block text-center text-[13px] font-semibold text-[#ff3d6a] hover:underline">
            Request a new link →
          </a>
        </>
      ) : (
        <div className="flex justify-center py-6">
          <span className="block h-6 w-6 rounded-full border-2 border-[#ff3d6a]/30 border-t-[#ff3d6a] animate-spin" />
        </div>
      )}
    </AuthShell>
  );
}
