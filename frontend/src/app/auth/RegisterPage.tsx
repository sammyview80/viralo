import { useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import { register } from "@/stores/auth";
import { ApiError } from "@/lib/api";
import { navigate } from "@/lib/router";
import { AuthShell, Field, Input, ErrorBanner, SubmitBtn } from "./components";

export function RegisterPage() {
  const [fullName,  setFullName]  = useState("");
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [showPw,    setShowPw]    = useState(false);
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(false);

  /* auto-fill subdomain from name */
  function handleNameChange(v: string) {
    setFullName(v);
    if (!subdomain || subdomain === slugify(fullName)) {
      setSubdomain(slugify(v));
    }
  }

  function slugify(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  }

  const subdomainValid = /^[a-z0-9][a-z0-9\-]*[a-z0-9]$/.test(subdomain) && subdomain.length >= 3;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!subdomainValid) { setError("Subdomain must be 3+ chars, lowercase letters, numbers, hyphens"); return; }
    setLoading(true);
    try {
      const user = await register(email, password, fullName, subdomain);
      // Persist subdomain — needed for /onboarding/niche and /onboarding/skip
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
      footer={<>Already have an account? <a href="/login" className="font-semibold text-[#ff3d6a] hover:underline">Sign in</a></>}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Full name">
          <Input
            type="text" autoComplete="name" required
            value={fullName} onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Maya Chen"
          />
        </Field>

        <Field label="Email">
          <Input
            type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>

        <Field label="Password" hint="Min. 8 characters">
          <div className="relative">
            <Input
              type={showPw ? "text" : "password"} autoComplete="new-password"
              required minLength={8}
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" className="pr-10"
            />
            <button type="button" tabIndex={-1}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              onClick={() => setShowPw((v) => !v)}>
              {showPw ? "🙈" : "👁"}
            </button>
          </div>
          {password.length > 0 && (
            <PasswordStrength password={password} />
          )}
        </Field>

        <Field
          label="Workspace subdomain"
          hint={subdomain.length >= 3 ? `${subdomain}.viralo.app` : "your-workspace.viralo.app"}
        >
          <div className="flex items-center overflow-hidden rounded-[9px] border border-white/[.08] bg-white/[.04] focus-within:border-[#ff3d6a]/50 focus-within:shadow-[0_0_0_3px_rgba(255,61,106,.08)]">
            <input
              type="text" required minLength={3} maxLength={63}
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="my-workspace"
              className="flex-1 bg-transparent px-3.5 py-2.5 text-[13px] font-medium text-zinc-200 placeholder-zinc-600 outline-none"
            />
            <span className="border-l border-white/[.07] bg-white/[.02] px-3 py-2.5 text-[12px] text-zinc-500">.viralo.app</span>
          </div>
        </Field>

        {error && <ErrorBanner message={error} />}

        <SubmitBtn loading={loading}>Create workspace</SubmitBtn>

        <p className="text-center text-[11.5px] text-zinc-600">
          By creating an account you agree to our{" "}
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
  const colors = ["", "bg-red-500", "bg-yellow-500", "bg-blue-400", "bg-emerald-400"];
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex flex-1 gap-1">
        {[1,2,3,4].map((i) => (
          <div key={i} className={cn("h-1 flex-1 rounded-full transition-colors", i <= score ? colors[score] : "bg-white/[.06]")} />
        ))}
      </div>
      <span className="text-[11px] font-medium text-zinc-500">{labels[score]}</span>
    </div>
  );
}
