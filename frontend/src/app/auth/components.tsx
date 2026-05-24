import { cn } from "@/lib/utils";
import type { ReactNode, InputHTMLAttributes } from "react";

/* ─── Page shell ─── */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#080b12] px-4">
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[-10%] top-[-10%] h-[500px] w-[500px] rounded-full bg-[#ff3d6a]/[.06] blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-5%] h-[400px] w-[400px] rounded-full bg-[#3daaff]/[.04] blur-[100px]" />
      </div>

      {/* Dot grid */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-40"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,.028) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="relative z-10 w-full max-w-[420px]">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[11px] bg-gradient-to-br from-[#ff4d78] to-[#ff8040] shadow-[0_6px_24px_rgba(255,61,106,.35),inset_0_1px_0_rgba(255,255,255,.2)]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
            </svg>
          </div>
          <span className="font-display text-xl font-bold tracking-tight">viralo</span>
        </div>

        {/* Card */}
        <div className="overflow-hidden rounded-[18px] border border-white/[.08] bg-[#0e1420] shadow-[0_32px_80px_rgba(0,0,0,.6)]">
          {/* Header */}
          <div className="border-b border-white/[.06] px-8 py-6">
            <h1 className="font-display text-[22px] font-bold tracking-[-0.01em]">{title}</h1>
            <p className="mt-1 text-[13px] text-zinc-500">{subtitle}</p>
          </div>

          {/* Body */}
          <div className="px-8 py-6">{children}</div>
        </div>

        {/* Footer */}
        {footer && (
          <p className="mt-5 text-center text-[13px] text-zinc-500">{footer}</p>
        )}
      </div>
    </div>
  );
}

/* ─── Field wrapper ─── */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[12.5px] font-semibold text-zinc-300">{label}</label>
      {children}
      {hint && !error && <p className="text-[11.5px] text-zinc-600">{hint}</p>}
      {error && <p className="text-[11.5px] text-red-400">{error}</p>}
    </div>
  );
}

/* ─── Input ─── */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-[9px] border border-white/[.08] bg-white/[.04] px-3.5 py-2.5 text-[13px] font-medium text-zinc-200 placeholder-zinc-600 outline-none transition",
        "focus:border-[#ff3d6a]/50 focus:shadow-[0_0_0_3px_rgba(255,61,106,.08)]",
        className,
      )}
      {...props}
    />
  );
}

/* ─── Error banner ─── */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[9px] border border-red-400/20 bg-red-400/10 px-3.5 py-3 text-[12.5px] font-medium text-red-300">
      <span className="mt-px flex-none">⚠</span>
      {message}
    </div>
  );
}

/* ─── Submit button ─── */
export function SubmitBtn({ loading, children }: { loading: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="mt-1 flex w-full items-center justify-center gap-2 rounded-[9px] bg-[#ff3d6a] py-2.5 text-[13.5px] font-semibold text-white shadow-[0_3px_14px_rgba(255,61,106,.3),inset_0_1px_0_rgba(255,255,255,.18)] transition hover:shadow-[0_5px_22px_rgba(255,61,106,.45)] disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {loading ? (
        <span className="block h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
      ) : null}
      {children}
    </button>
  );
}
