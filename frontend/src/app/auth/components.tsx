import { cn } from "@/lib/utils";
import type { ReactNode, InputHTMLAttributes } from "react";
import { useState, useEffect } from "react";
import { ViraloLogo } from "@/components/ViraloLogo";

/* ─── Feature showcase (left panel) ─── */
const FEATURES = [
  {
    icon: "🎬",
    title: "AI video in 60 seconds",
    desc: "Paste a URL or idea — Viralo scripts, voices, and renders a platform-ready short clip automatically.",
    stat: "60s avg. generation",
  },
  {
    icon: "🔥",
    title: "Virality scoring",
    desc: "Every clip gets a real-time virality score so you post only what's built to perform.",
    stat: "3× avg. reach boost",
  },
  {
    icon: "📅",
    title: "Auto-schedule across platforms",
    desc: "Queue posts to TikTok, Instagram Reels, YouTube Shorts, and more — all from one dashboard.",
    stat: "6 platforms supported",
  },
  {
    icon: "✂️",
    title: "Smart clip extraction",
    desc: "Drop a long video and Viralo finds the viral moments, trims them, and adds captions in seconds.",
    stat: "Up to 20 clips/video",
  },
  {
    icon: "🤖",
    title: "Brainstorm AI agent",
    desc: "Generate hook ideas, trending angles, and full scripts tailored to your niche and audience.",
    stat: "100+ hook templates",
  },
];

const PLATFORM_ICONS = [
  { label: "TikTok",     bg: "bg-zinc-950",                    ltr: "♪" },
  { label: "Instagram",  bg: "bg-gradient-to-br from-fuchsia-500 to-orange-400", ltr: "⊙" },
  { label: "YouTube",    bg: "bg-red-600",                     ltr: "▶" },
  { label: "Twitter/X",  bg: "bg-zinc-100 text-zinc-900",      ltr: "𝕏" },
  { label: "LinkedIn",   bg: "bg-blue-700",                    ltr: "in" },
];

function FeatureCarousel() {
  const [idx, setIdx] = useState(0);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      setAnimating(true);
      setTimeout(() => {
        setIdx((i) => (i + 1) % FEATURES.length);
        setAnimating(false);
      }, 300);
    }, 3200);
    return () => clearInterval(t);
  }, []);

  const f = FEATURES[idx];

  return (
    <div
      className="transition-all duration-300"
      style={{ opacity: animating ? 0 : 1, transform: animating ? "translateY(10px)" : "translateY(0)" }}
    >
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-3xl shadow-inner">
        {f.icon}
      </div>
      <h3 className="mb-2 font-display text-[22px] font-bold leading-tight tracking-[-0.02em] text-c-text">
        {f.title}
      </h3>
      <p className="mb-4 text-[14px] leading-[1.7] text-c-text-secondary">{f.desc}</p>
      <div className="inline-flex items-center gap-2 rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 px-3.5 py-1.5 text-[12px] font-semibold text-[#ff3d6a]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#ff3d6a]" />
        {f.stat}
      </div>

      {/* Dots */}
      <div className="mt-6 flex gap-1.5">
        {FEATURES.map((_, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === idx ? "w-6 bg-[#ff3d6a]" : "w-1.5 bg-c-border-hover hover:bg-c-text-muted/40"
            )}
          />
        ))}
      </div>
    </div>
  );
}

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
    <div className="relative flex h-screen overflow-hidden bg-background">
      {/* ── Left panel — feature showcase (hidden on mobile) ── */}
      <div className="relative hidden h-screen w-[52%] flex-none overflow-hidden border-r border-c-border lg:flex lg:flex-col">
        {/* Ambient blobs */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-15%] top-[-10%] h-[600px] w-[600px] rounded-full bg-[#ff3d6a]/[.08] blur-[130px]" />
          <div className="absolute bottom-[-10%] right-[-10%] h-[500px] w-[500px] rounded-full bg-[#a855f7]/[.05] blur-[120px]" />
        </div>
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,.03) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />

        {/* Logo — top */}
        <div className="relative z-10 px-12 pt-10 xl:px-16">
          <ViraloLogo size={30} wordmark textSize="text-[15px]" />
        </div>

        {/* Center content */}
        <div className="relative z-10 flex flex-1 flex-col justify-center px-12 xl:px-16">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[.14em] text-[#ff3d6a]">
            AI-powered content engine
          </p>
          <h2 className="mb-10 font-display text-[30px] font-extrabold leading-[1.18] tracking-[-0.025em] text-c-text xl:text-[34px]">
            Turn any idea into<br />
            <span className="bg-gradient-to-r from-[#ff3d6a] to-[#ff7a3d] bg-clip-text text-transparent">
              viral short-form content.
            </span>
          </h2>
          <FeatureCarousel />
        </div>

        {/* Platform row — bottom */}
        <div className="relative z-10 px-12 pb-10 xl:px-16">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[.12em] text-c-text-muted">
            Post to
          </p>
          <div className="flex gap-2">
            {PLATFORM_ICONS.map((p) => (
              <div
                key={p.label}
                title={p.label}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-[9px] text-[13px] font-black text-white shadow",
                  p.bg
                )}
              >
                {p.ltr}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right panel — form ── */}
      <div className="relative flex h-screen flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-10 sm:px-10">
        {/* Mobile ambient */}
        <div className="pointer-events-none fixed inset-0 z-0 lg:hidden">
          <div className="absolute left-[-10%] top-[-10%] h-[400px] w-[400px] rounded-full bg-[#ff3d6a]/[.05] blur-[100px]" />
        </div>
        <div
          className="pointer-events-none fixed inset-0 z-0 opacity-25 lg:hidden"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,.028) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />

        <div className="relative z-10 w-full max-w-[360px]">
          {/* Mobile logo */}
          <div className="mb-8 flex justify-center lg:hidden">
            <ViraloLogo size={34} wordmark textSize="text-lg" />
          </div>

          {/* Heading above card */}
          <div className="mb-6">
            <h1 className="font-display text-[24px] font-bold tracking-[-0.025em] text-c-text">{title}</h1>
            <p className="mt-1.5 text-[13px] text-c-text-muted">{subtitle}</p>
          </div>

          <div className="py-2">{children}</div>

          {footer && (
            <p className="mt-5 text-center text-[13px] text-c-text-muted">{footer}</p>
          )}
        </div>
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
      <label className="block text-[11.5px] font-semibold uppercase tracking-[.07em] text-c-text-muted">{label}</label>
      {children}
      {hint && !error && <p className="text-[11px] text-c-text-muted">{hint}</p>}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

/* ─── Input ─── */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-[10px] border border-c-border bg-surface-2 px-4 py-3 text-[13.5px] text-c-text placeholder-c-text-muted outline-none transition",
        "focus:border-[#ff3d6a]/40 focus:bg-surface-3 focus:shadow-[0_0_0_3px_rgba(255,61,106,.07)]",
        className,
      )}
      {...props}
    />
  );
}

/* ─── Error banner ─── */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[10px] border border-red-500/20 bg-red-500/[.08] px-4 py-3 text-[12.5px] text-red-300">
      <span className="mt-px flex-none text-red-400">⚠</span>
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
      className="flex w-full items-center justify-center gap-2.5 rounded-[10px] bg-[#ff3d6a] py-3 text-[14px] font-semibold text-white shadow-[0_4px_16px_rgba(255,61,106,.35),inset_0_1px_0_rgba(255,255,255,.15)] transition hover:shadow-[0_6px_24px_rgba(255,61,106,.5)] active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-55"
    >
      {loading && <span className="block h-4 w-4 rounded-full border-2 border-white/35 border-t-white animate-spin" />}
      {children}
    </button>
  );
}
