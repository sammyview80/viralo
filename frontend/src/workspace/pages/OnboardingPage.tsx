import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { onboarding, billingApi, type PlanInfo } from "@/lib/api";
import { navigate } from "@/lib/router";
import { applyTokenAndRedirect } from "@/stores/auth";
import { ViraloLogo } from "@/components/ViraloLogo";

/* ─── Constants ─── */
const PLATFORMS = [
  { id:"tt", ltr:"♪", name:"TikTok",    desc:"1B+ users daily",    color:"#FF0050", bg:"bg-zinc-950" },
  { id:"ig", ltr:"⊙", name:"Instagram", desc:"Reels & Stories",    color:"#E4405F", bg:"bg-gradient-to-br from-fuchsia-500 to-orange-400" },
  { id:"yt", ltr:"▶", name:"YouTube",   desc:"Shorts & longform",  color:"#FF0000", bg:"bg-red-500" },
  { id:"tw", ltr:"𝕏", name:"Twitter/X", desc:"Viral text & clips", color:"#1DA1F2", bg:"bg-zinc-100 text-zinc-950" },
  { id:"li", ltr:"in",name:"LinkedIn",  desc:"B2B & professional", color:"#0A66C2", bg:"bg-blue-700" },
  { id:"fb", ltr:"f", name:"Facebook",  desc:"Reels & video feed", color:"#1877F2", bg:"bg-blue-600" },
];

const NICHES = [
  "💪 Fitness","💰 Finance","🎮 Gaming","✈ Travel","🍳 Food",
  "💄 Beauty","🎓 Education","🔧 Tech & AI","🎵 Music","🌱 Lifestyle",
];

const GOALS: { id: string; icon: string; title: string; desc: string }[] = [
  { id:"viral",     icon:"🔥", title:"Go viral",          desc:"Maximize reach and shares on short-form platforms" },
  { id:"marketing", icon:"📢", title:"Brand marketing",   desc:"Build audience and convert followers to customers" },
  { id:"hustle",    icon:"💰", title:"Side hustle",       desc:"Monetize content and grow a creator income stream" },
  { id:"agency",    icon:"🏢", title:"Run an agency",     desc:"Manage multiple clients and automate content at scale" },
];

const ACCENT_COLORS = [
  { id:"pink",   hex:"#FF3D6A" },
  { id:"blue",   hex:"#3DAAFF" },
  { id:"green",  hex:"#22C55E" },
  { id:"violet", hex:"#A855F7" },
  { id:"orange", hex:"#FF7A3D" },
];

const TOTAL_STEPS = 5;

/* ─── Helpers ─── */
function getSubdomain() {
  return localStorage.getItem("viralo_reg_subdomain") ?? "";
}

/* ─── After finalize: store new token (has tenant_id), refresh auth state, then redirect ─── */
async function applyFinalizeToken(accessToken: string, dest: string) {
  localStorage.removeItem("viralo_reg_subdomain");
  await applyTokenAndRedirect(accessToken, dest, navigate);
}

/* ─── Final Submit entry point (Step 5 plan pick) ─── */
export async function submitFinalize(planName: string, dest: string) {
  await onboarding.plan("free");
  const res = await onboarding.finalize();
  await applyFinalizeToken(res.access_token, dest);
}

/* ─── Global Skip entry point ─── */
export async function submitSkip() {
  const subdomain = getSubdomain();
  if (subdomain) {
    try { await onboarding.niche("general", subdomain); } catch {}
  }
  const res = await onboarding.skip();
  await applyFinalizeToken(res.access_token, "/");
}

/* ─── Confetti ─── */
function Confetti() {
  const COLORS = ["#FF3D6A","#FF7A3D","#FFB347","#3DAAFF","#22C55E","#A855F7","#FCD34D"];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 26 }).map((_, i) => (
        <div key={i} className="absolute top-[-10px]" style={{
          left: `${5 + (i * 3.8) % 92}%`,
          width: 6 + (i % 4) * 3, height: 6 + (i % 4) * 3,
          borderRadius: i % 3 === 0 ? "50%" : 2,
          background: COLORS[i % COLORS.length],
          animation: `confettiFall ${1.2 + (i % 5) * 0.15}s ${(i * 0.07).toFixed(2)}s ease-in forwards`,
        }} />
      ))}
    </div>
  );
}

/* ─── Progress ─── */
function Progress({ step }: { step: number }) {
  return (
    <div className="flex-none px-7 pb-0 pt-6">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ViraloLogo size={28} wordmark textSize="text-[15px]" />
        </div>
        <span className="text-[12px] font-medium text-c-text-muted">Step {step} of {TOTAL_STEPS}</span>
      </div>
      <div className="h-[3px] overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#ff3d6a] to-[#ff7a3d] transition-[width_.4s_cubic-bezier(.2,.8,.4,1)]"
          style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
        />
      </div>
    </div>
  );
}

/* ─── Btn ─── */
function PrimaryBtn({ onClick, loading, disabled, children }: {
  onClick?: () => void; loading?: boolean; disabled?: boolean; children: React.ReactNode
}) {
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-[11px] bg-[#ff3d6a] py-3 text-[14.5px] font-semibold text-white shadow-[0_4px_18px_rgba(255,61,106,.35)] transition",
        "hover:shadow-[0_6px_26px_rgba(255,61,106,.5)] disabled:cursor-not-allowed disabled:opacity-55"
      )}>
      {loading && <span className="block h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
      {children}
    </button>
  );
}

function SkipBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mt-2.5 w-full bg-transparent py-2 text-[13px] text-c-text-muted transition hover:text-c-text-secondary">
      Skip for now
    </button>
  );
}

/* ─── Error banner ─── */
function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <div className="mt-3 flex items-start gap-2 rounded-[9px] border border-red-400/20 bg-red-400/10 px-3 py-2.5 text-[12.5px] text-red-300">
      <span>⚠</span>{msg}
    </div>
  );
}

/* ═══════════════ STEP 1 — Welcome ═══════════════ */
function S1Welcome({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 grid h-[76px] w-[76px] place-items-center rounded-[22px] bg-gradient-to-br from-[#ff3d6a] to-[#ff7a3d] shadow-[0_20px_50px_rgba(255,61,106,.4),inset_0_2px_0_rgba(255,255,255,.25)]"
        style={{ animation: "bounceIn .5s cubic-bezier(.34,1.56,.64,1)" }}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
        </svg>
      </div>
      <h2 className="mb-3 font-display text-[30px] font-extrabold leading-[1.15] tracking-[-0.02em]">
        You're about to<br />
        <span className="bg-gradient-to-r from-[#ff3d6a] to-[#ff7a3d] bg-clip-text text-transparent">go viral.</span>
      </h2>
      <p className="mx-auto mb-8 max-w-[400px] text-[15px] leading-[1.65] text-c-text-muted">
        Turn any idea into a platform-ready short video in under a minute. Let's get you set up — it takes 2 minutes.
      </p>
      <div className="mx-auto mb-8 grid max-w-[460px] grid-cols-1 gap-2.5 sm:grid-cols-3">
        {[
          { icon:"🎬", t:"AI video in 60s",  s:"From idea to viral clip" },
          { icon:"📅", t:"Auto-schedule",     s:"Posts at peak reach times" },
          { icon:"⚡", t:"Virality scoring",  s:"Know what will perform best" },
        ].map((f) => (
          <div key={f.t} className="rounded-[13px] border border-c-border bg-surface-2 px-2.5 py-3.5 text-center">
            <div className="mb-2 text-[22px]">{f.icon}</div>
            <div className="text-[13px] font-semibold">{f.t}</div>
            <div className="mt-1 text-[12px] leading-[1.4] text-c-text-muted">{f.s}</div>
          </div>
        ))}
      </div>
      <button onClick={onNext}
        className="mx-auto flex items-center gap-2 rounded-[11px] bg-[#ff3d6a] px-8 py-3 text-[15px] font-semibold text-white shadow-[0_4px_18px_rgba(255,61,106,.4),inset_0_1px_0_rgba(255,255,255,.2)] transition hover:shadow-[0_6px_28px_rgba(255,61,106,.55)]">
        Let's set you up →
      </button>
      <button onClick={onSkip} className="mt-4 block w-full bg-transparent text-[13px] text-c-text-muted hover:text-c-text-secondary">
        Skip — go straight to the dashboard →
      </button>
    </div>
  );
}

/* ═══════════════ STEP 2 — Platforms ═══════════════ */
function S2Platforms({ onNext }: { onNext: () => void }) {
  const [sel, setSel] = useState(["tt", "ig"]);
  const [loading, setLoading] = useState(false);
  const toggle = (id: string) => setSel((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  async function handleNext() {
    setLoading(true);
    try {
      // Fire connect calls in parallel — one per platform
      await Promise.allSettled(sel.map((p) => onboarding.connect(p)));
    } finally {
      setLoading(false);
      onNext();
    }
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <h2 className="font-display text-[26px] font-extrabold tracking-[-0.01em]">Where do you post?</h2>
        <p className="mt-2 text-[14px] text-c-text-muted">Select your active platforms — you can add more later.</p>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {PLATFORMS.map((p) => {
          const on = sel.includes(p.id);
          return (
            <div key={p.id} onClick={() => toggle(p.id)}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-[14px] border px-3 py-4 transition-all"
              style={{ background: on ? `${p.color}16` : "rgba(255,255,255,.03)", borderColor: on ? `${p.color}55` : "rgba(255,255,255,.08)" }}>
              <span className={cn("grid h-10 w-10 place-items-center rounded-[11px] text-[17px] font-black text-white", p.bg)}>{p.ltr}</span>
              <div className="text-center">
                <div className={cn("text-[13.5px] font-bold", on ? "text-c-text" : "text-c-text-secondary")}>{p.name}</div>
                <div className="mt-0.5 text-[11.5px] text-c-text-muted">{p.desc}</div>
              </div>
              {on && <span className="text-[11px] font-bold" style={{ color: p.color }}>✓ Selected</span>}
            </div>
          );
        })}
      </div>
      <PrimaryBtn onClick={handleNext} loading={loading}>
        Continue with {sel.length} platform{sel.length !== 1 ? "s" : ""} →
      </PrimaryBtn>
      <SkipBtn onClick={onNext} />
    </div>
  );
}

/* ═══════════════ STEP 3 — Niche + Brand ═══════════════ */
function S3NicheBrand({ onNext }: { onNext: () => void }) {
  const [name,  setName]  = useState("");
  const [niche, setNiche] = useState("");
  const [color, setColor] = useState("pink");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    const subdomain = getSubdomain();
    if (!subdomain) { setError("Subdomain missing — please re-register."); return; }
    if (!niche)     { setError("Pick a niche to continue."); return; }
    setError(""); setLoading(true);
    try {
      await onboarding.niche(niche, subdomain);
      onNext();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSkip() {
    // niche step is required — submit with a default if skipping
    const subdomain = getSubdomain();
    if (subdomain) {
      try { await onboarding.niche(niche || "general", subdomain); } catch {}
    }
    onNext();
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <h2 className="font-display text-[26px] font-extrabold tracking-[-0.01em]">Your brand kit</h2>
        <p className="mt-2 text-[14px] text-c-text-muted">AI uses this to tailor your content, hooks, and posting strategy.</p>
      </div>
      <div className="mb-6 space-y-5">
        <div>
          <label className="mb-2 block text-[11.5px] font-bold uppercase tracking-[.08em] text-c-text-muted">Creator / brand name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maya Creates"
            className="w-full rounded-[11px] border border-c-border bg-surface-2 px-4 py-3 text-[14px] text-c-text placeholder-c-text-muted outline-none transition focus:border-[#ff3d6a]/45 focus:shadow-[0_0_0_3px_rgba(255,61,106,.08)]"
          />
        </div>
        <div>
          <label className="mb-2.5 block text-[11.5px] font-bold uppercase tracking-[.08em] text-c-text-muted">Your niche <span className="text-[#ff3d6a]">*</span></label>
          <div className="flex flex-wrap gap-2">
            {NICHES.map((n) => (
              <div key={n} onClick={() => setNiche(n)}
                className={cn("cursor-pointer rounded-[9px] border px-3 py-1.5 text-[13px] transition",
                  niche === n
                    ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10 text-c-text"
                    : "border-c-border bg-surface-2 text-c-text-muted hover:border-c-border-hover hover:text-c-text"
                )}>
                {n}
              </div>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-3 block text-[11.5px] font-bold uppercase tracking-[.08em] text-c-text-muted">Accent color</label>
          <div className="flex gap-3">
            {ACCENT_COLORS.map((c) => (
              <div key={c.id} onClick={() => setColor(c.id)}
                className="h-8 w-8 cursor-pointer rounded-full transition-transform hover:scale-110"
                style={{ background: c.hex, boxShadow: color === c.id ? `0 0 0 2px #080b12, 0 0 0 4px ${c.hex}` : "none" }}
              />
            ))}
          </div>
        </div>
      </div>
      <Err msg={error} />
      <PrimaryBtn onClick={handleSave} loading={loading} disabled={!niche}>
        ✦ Save brand kit
      </PrimaryBtn>
      <SkipBtn onClick={handleSkip} />
    </div>
  );
}

/* ═══════════════ STEP 4 — Goal ═══════════════ */
function S4Goal({ onNext }: { onNext: () => void }) {
  const [sel, setSel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleNext() {
    if (!sel) { setError("Pick a goal to continue."); return; }
    setError(""); setLoading(true);
    try {
      await onboarding.goal(sel);
      onNext();
    } catch (e: any) {
      setError(e?.message ?? "Failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSkip() {
    try { await onboarding.goal("viral"); } catch {}
    onNext();
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <h2 className="font-display text-[26px] font-extrabold tracking-[-0.01em]">What's your main goal?</h2>
        <p className="mt-2 text-[14px] text-c-text-muted">We'll tune your dashboard and recommendations around it.</p>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {GOALS.map((g) => (
          <div key={g.id} onClick={() => setSel(g.id)}
            className={cn(
              "flex cursor-pointer flex-col gap-2 rounded-[14px] border p-4 transition-all",
              sel === g.id
                ? "border-[#ff3d6a]/45 bg-[#ff3d6a]/10"
                : "border-c-border bg-surface-2 hover:border-c-border-hover"
            )}>
            <span className="text-[26px]">{g.icon}</span>
            <div className={cn("text-[13.5px] font-bold", sel === g.id ? "text-c-text" : "text-c-text-secondary")}>{g.title}</div>
            <div className="text-[12px] leading-[1.45] text-c-text-muted">{g.desc}</div>
            {sel === g.id && <span className="text-[11px] font-bold text-[#ff3d6a]">✓ Selected</span>}
          </div>
        ))}
      </div>
      <Err msg={error} />
      <PrimaryBtn onClick={handleNext} loading={loading} disabled={!sel}>
        Continue →
      </PrimaryBtn>
      <SkipBtn onClick={handleSkip} />
    </div>
  );
}

const PLAN_HIGHLIGHTS: Record<string, string> = {
  free:      "3 videos/mo · 1 platform · Basic captions",
  starter:   "15 videos/mo · 3 platforms · Brainstorm AI",
  pro:       "30 videos/mo · All platforms · Voice clone",
  creator:   "60 videos/mo · Workflows · Team members",
  unlimited: "Unlimited everything · Priority support",
};

const PLAN_POPULAR = "pro";

/* ═══════════════ STEP 5 — Plan + Finalize ═══════════════ */
function S5Plan({ onComplete }: { onComplete: (dest: string) => void }) {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [plans, setPlans] = useState<PlanInfo[]>([]);

  useEffect(() => {
    billingApi.plans().then(setPlans).catch(() => {});
  }, []);

  async function finalize(planName: string, dest: string) {
    if (loadingPlan) return;
    setError(""); setLoadingPlan(planName);
    try {
      await submitFinalize(planName, dest);
    } catch (e: any) {
      setError(e?.message ?? "Failed to finalize. Try again.");
      setLoadingPlan(null);
    }
  }

  const displayPlans = plans.length > 0 ? plans : [
    { id: "free", name: "free", price_monthly: 0, videos_per_month: 3, storage_gb: 1, brainstorm: false, workflows: false, channels: false, watermark: false, accounts_per_platform: 1, video_duration_limit_min: null } as PlanInfo,
  ];

  return (
    <div className="relative overflow-hidden py-2 text-center">
      <Confetti />
      <div className="relative z-10">
        <div className="mb-4 text-[56px]" style={{ animation: "bounceIn .6s cubic-bezier(.34,1.56,.64,1)" }}>🎉</div>
        <h2 className="mb-2 font-display text-[26px] font-extrabold tracking-[-0.02em]">Almost done!</h2>
        <p className="mx-auto mb-5 max-w-[360px] text-[13.5px] leading-[1.65] text-c-text-muted">
          Pick a plan to activate your workspace. You can upgrade anytime.
        </p>

        {/* Plan cards */}
        <div className="mx-auto mb-5 grid max-w-[560px] grid-cols-1 gap-2.5 text-left sm:grid-cols-2 lg:grid-cols-3">
          {displayPlans.map((p) => {
            const isPopular = p.name === PLAN_POPULAR;
            const isFree = p.name === "free";
            const price = p.price_monthly === 0 ? "$0" : `$${Math.round(p.price_monthly)}`;
            const highlight = PLAN_HIGHLIGHTS[p.name] ?? "";
            return (
              <div key={p.id}
                className={cn(
                  "rounded-[14px] border p-4 flex flex-col gap-3",
                  isPopular
                    ? "border-[#ff3d6a]/35 bg-[#ff3d6a]/[.07] shadow-[0_0_0_1px_rgba(255,61,106,.1)]"
                    : "border-c-border bg-surface-2"
                )}>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-[11px] font-bold uppercase tracking-[.1em]",
                    isPopular ? "text-[#ff3d6a]" : "text-c-text-muted"
                  )}>
                    {p.name.charAt(0).toUpperCase() + p.name.slice(1)}
                  </span>
                  {isPopular && (
                    <span className="rounded-full bg-[#ff3d6a]/15 px-2 py-px text-[9px] font-bold text-[#ff3d6a]">Popular</span>
                  )}
                </div>
                <div>
                  <span className="font-display text-[24px] font-bold">{price}</span>
                  <span className="text-[12px] text-c-text-muted">/mo</span>
                </div>
                <p className="text-[11.5px] leading-[1.5] text-c-text-muted flex-1">{highlight}</p>
                <button
                  onClick={() => finalize(p.name, isFree ? "/" : `/billing?upgrade=${p.name}`)}
                  disabled={!!loadingPlan}
                  className={cn(
                    "flex w-full items-center justify-center gap-2 rounded-[8px] py-2 text-[12.5px] font-semibold transition disabled:opacity-60",
                    isPopular
                      ? "bg-[#ff3d6a] text-white shadow-[0_2px_12px_rgba(255,61,106,.3)] hover:shadow-[0_4px_18px_rgba(255,61,106,.45)]"
                      : "border border-c-border bg-surface-2 text-c-text-secondary hover:bg-surface-3"
                  )}>
                  {loadingPlan === p.name
                    ? <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-c-border-hover border-t-c-text animate-spin" />
                    : isFree ? "Start free" : `Get ${p.name.charAt(0).toUpperCase() + p.name.slice(1)}`}
                </button>
              </div>
            );
          })}
        </div>

        <Err msg={error} />
      </div>
    </div>
  );
}

/* ═══════════════ WIZARD ═══════════════ */
export function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [skipping, setSkipping] = useState(false);
  const [skipError, setSkipError] = useState("");

  const next = () => setStep((s) => s + 1);

  async function handleSkipAll() {
    setSkipping(true);
    setSkipError("");
    try {
      await submitSkip();
    } catch (err: any) {
      // skip()/finalize failed — no valid token applied, so don't navigate
      // (route guard would just bounce back to onboarding on stale state).
      setSkipping(false);
      setSkipError(err?.message ?? "Failed to skip. Try again.");
    }
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-[rgba(4,7,15,.94)] p-6 backdrop-blur-[12px]"
      style={{ animation: "fadeUp .3s cubic-bezier(.22,.8,.4,1)" }}>

      <div className="flex max-h-[90vh] w-full max-w-[600px] flex-col overflow-hidden rounded-[18px] border border-c-border bg-surface-1 shadow-[0_40px_100px_rgba(0,0,0,.8)] sm:rounded-[24px]">
        <Progress step={step} />

        <div className="flex-1 overflow-y-auto px-7 pb-8 pt-6">
          {step === 1 && <S1Welcome onNext={next} onSkip={handleSkipAll} />}
          {step === 2 && <S2Platforms onNext={next} />}
          {step === 3 && <S3NicheBrand onNext={next} />}
          {step === 4 && <S4Goal onNext={next} />}
          {step === 5 && <S5Plan onComplete={(dest) => { navigate(dest); }} />}
        </div>

        {skipError && (
          <div className="px-7 pb-6">
            <Err msg={skipError} />
          </div>
        )}
      </div>

      {/* Global skip overlay spinner */}
      {skipping && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/60">
          <div className="h-8 w-8 rounded-full border-2 border-[#ff3d6a]/30 border-t-[#ff3d6a] animate-spin" />
        </div>
      )}

      <style>{`
        @keyframes bounceIn {
          from { opacity:0; transform:scale(.6); }
          to   { opacity:1; transform:scale(1); }
        }
        @keyframes confettiFall {
          from { transform:translateY(0) rotate(0deg); opacity:1; }
          to   { transform:translateY(100vh) rotate(720deg); opacity:0; }
        }
        @keyframes fadeUp {
          from { opacity:0; transform:translateY(16px); }
          to   { opacity:1; transform:translateY(0); }
        }
      `}</style>
    </div>
  );
}


