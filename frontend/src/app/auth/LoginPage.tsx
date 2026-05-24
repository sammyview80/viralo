import { useState, type FormEvent } from "react";
import { login } from "@/stores/auth";
import { ApiError } from "@/lib/api";
import { navigate } from "@/lib/router";
import { AuthShell, Field, Input, ErrorBanner, SubmitBtn } from "./components";

export function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [showPw, setShowPw]     = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your Viralo workspace"
      footer={<>No account? <a href="/register" className="font-semibold text-[#ff3d6a] hover:underline">Create one free</a></>}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email" error="">
          <Input
            type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>

        <Field label="Password" error="">
          <div className="relative">
            <Input
              type={showPw ? "text" : "password"} autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" className="pr-10"
            />
            <button type="button" tabIndex={-1}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              onClick={() => setShowPw((v) => !v)}>
              {showPw ? "🙈" : "👁"}
            </button>
          </div>
        </Field>

        <div className="flex justify-end">
          <a href="/forgot-password" className="text-[12px] text-zinc-500 hover:text-zinc-300">Forgot password?</a>
        </div>

        {error && <ErrorBanner message={error} />}

        <SubmitBtn loading={loading}>Sign in</SubmitBtn>
      </form>
    </AuthShell>
  );
}
