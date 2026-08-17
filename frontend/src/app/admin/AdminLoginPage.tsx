import { useState, type FormEvent } from "react";
import { adminApi } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { AuthShell, Field, Input, ErrorBanner, SubmitBtn } from "@/app/auth/components";

export function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await adminApi.requestLogin(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send login link");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle="Admin sign-in">
        <p className="text-[13.5px] leading-relaxed text-c-text-secondary">
          If <strong>{email}</strong> has admin access, we've sent a one-time login link.
          It expires in 15 minutes and can only be used once.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Admin sign-in" subtitle="Enter your email — we'll send you a login link, no password needed">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email">
          <Input
            name="email"
            type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@viralo.app"
          />
        </Field>

        {error && <ErrorBanner message={error} />}

        <SubmitBtn loading={loading}>Send login link</SubmitBtn>
      </form>
    </AuthShell>
  );
}
