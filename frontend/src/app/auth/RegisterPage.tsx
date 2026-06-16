import { useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import { register } from "@/stores/auth";
import { ApiError } from "@/lib/api";
import { navigate } from "@/lib/router";
import { AuthShell, Field, Input, ErrorBanner, SubmitBtn } from "./components";

export function RegisterPage() {
  const [fullName,  setFullName]   = useState("");
  const [email,     setEmail]      = useState("");
  const [password,  setPassword]   = useState("");
  const [confirm,   setConfirm]    = useState("");
  const [showPw,    setShowPw]     = useState(false);
  const [showCf,    setShowCf]     = useState(false);
  const [error,     setError]      = useState("");
  const [loading,   setLoading]    = useState(false);

  function slugify(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  }

  function handleNameChange(v: string) {
    setFullName(v);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match"); return; }
    const subdomain = slugify(fullName) || slugify(email.split("@")[0]);
    setLoading(true);
    try {
      await register(email, password, fullName, subdomain);
      localStorage.setItem("viralo_reg_subdomain", subdomain);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Create your workspace"
      subtitle="Free to start · No credit card needed"
      footer={<>Already have an account?{" "}<a href="/login" className="font-semibold text-[#ff3d6a] hover:underline">Sign in →</a></>}
    >
      <form onSubmit={handleSubmit} method="post" className="space-y-4">
        <Field label="Full name">
          <Input
            name="name"
            type="text" autoComplete="name" required
            value={fullName} onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Maya Chen"
          />
        </Field>

        <Field label="Email">
          <Input
            name="email"
            type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>

        <Field label="Password" hint={password.length === 0 ? "Min. 8 characters" : undefined}>
          <div className="relative">
            <Input
              name="password"
              type={showPw ? "text" : "password"} autoComplete="new-password"
              required minLength={8}
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" className="pr-11"
            />
            <button
              type="button" tabIndex={-1}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[16px] text-zinc-500 hover:text-zinc-300 transition-colors"
              onClick={() => setShowPw((v) => !v)}
            >
              {showPw ? "🙈" : "👁"}
            </button>
          </div>
          {password.length > 0 && <PasswordStrength password={password} />}
        </Field>

        <Field label="Confirm password">
          <div className="relative">
            <Input
              type={showCf ? "text" : "password"} autoComplete="new-password"
              required
              value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••" className="pr-11"
            />
            <button
              type="button" tabIndex={-1}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[16px] text-zinc-500 hover:text-zinc-300 transition-colors"
              onClick={() => setShowCf((v) => !v)}
            >
              {showCf ? "🙈" : "👁"}
            </button>
          </div>
          {confirm.length > 0 && password !== confirm && (
            <p className="text-[11px] text-red-400">Passwords don't match</p>
          )}
        </Field>

        {error && <ErrorBanner message={error} />}

        <SubmitBtn loading={loading}>Create workspace</SubmitBtn>

        <p className="text-center text-[11px] text-zinc-600">
          By signing up you agree to our{" "}
          <a href="/terms" className="underline hover:text-zinc-400">Terms</a> and{" "}
          <a href="/privacy" className="underline hover:text-zinc-400">Privacy Policy</a>.
        </p>
      </form>
    </AuthShell>
  );
}

function PasswordStrength({ password }: { password: string }) {
  const score = [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  const colors = ["", "bg-red-500", "bg-amber-400", "bg-blue-400", "bg-emerald-400"];
  return (
    <div className="mt-2 flex items-center gap-2.5">
      <div className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn("h-[3px] flex-1 rounded-full transition-all duration-300", i <= score ? colors[score] : "bg-white/[.07]")}
          />
        ))}
      </div>
      <span className="text-[11px] font-medium text-zinc-500">{labels[score]}</span>
    </div>
  );
}
