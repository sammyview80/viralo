import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { onboarding, token } from "@/lib/api";
import { navigate } from "@/lib/router";
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

/* ─── After finalize: store new token (has tenant_id) then redirect ─── */
function applyFinalizeToken(accessToken: string, dest: string) {
  token.set(accessToken);
  localStorage.removeItem("viralo_reg_subdomain");
  navigate(dest);
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
        <span className="text-[12px] font-medium text-zinc-500">Step {step} of {TOTAL_STEPS}</span>
      </div>
      <div className="h-[3px] overflow-hidden rounded-full bg-white/[.07]">
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
    <button onClick={onClick} className="mt-2.5 w-full bg-transparent py-2 text-[13px] text-zinc-600 transition hover:text-zinc-400">
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
      <p className="mx-auto mb-8 max-w-[400px] text-[15px] leading-[1.65] text-zinc-500">
        Turn any idea into a platform-ready short video in under a minute. Let's get you set up — it takes 2 minutes.
      </p>
      <div className="mx-auto mb-8 grid max-w-[460px] grid-cols-1 gap-2.5 sm:grid-cols-3">
        {[
          { icon:"🎬", t:"AI video in 60s",  s:"From idea to viral clip" },
          { icon:"📅", t:"Auto-schedule",     s:"Posts at peak reach times" },
          { icon:"⚡", t:"Virality scoring",  s:"Know what will perform best" },
        ].map((f) => (
          <div key={f.t} className="rounded-[13px] border border-white/[.08] bg-white/[.04] px-2.5 py-3.5 text-center">
            <div className="mb-2 text-[22px]">{f.icon}</div>
            <div className="text-[13px] font-semibold">{f.t}</div>
            <div className="mt-1 text-[12px] leading-[1.4] text-zinc-500">{f.s}</div>
          </div>
        ))}
      </div>
      <button onClick={onNext}
        className="mx-auto flex items-center gap-2 rounded-[11px] bg-[#ff3d6a] px-8 py-3 text-[15px] font-semibold text-white shadow-[0_4px_18px_rgba(255,61,106,.4),inset_0_1px_0_rgba(255,255,255,.2)] transition hover:shadow-[0_6px_28px_rgba(255,61,106,.55)]">
        Let's set you up →
      </button>
      <button onClick={onSkip} className="mt-4 block w-full bg-transparent text-[13px] text-zinc-600 hover:text-zinc-400">
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
        <p className="mt-2 text-[14px] text-zinc-500">Select your active platforms — you can add more later.</p>
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
                <div className={cn("text-[13.5px] font-bold", on ? "text-white" : "text-zinc-300")}>{p.name}</div>
                <div className="mt-0.5 text-[11.5px] text-zinc-500">{p.desc}</div>
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
        <p className="mt-2 text-[14px] text-zinc-500">AI uses this to tailor your content, hooks, and posting strategy.</p>
      </div>
      <div className="mb-6 space-y-5">
        <div>
          <label className="mb-2 block text-[11.5px] font-bold uppercase tracking-[.08em] text-zinc-400">Creator / brand name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maya Creates"
            className="w-full rounded-[11px] border border-white/[.08] bg-white/[.04] px-4 py-3 text-[14px] text-zinc-200 placeholder-zinc-600 outline-none transition focus:border-[#ff3d6a]/45 focus:shadow-[0_0_0_3px_rgba(255,61,106,.08)]"
          />
        </div>
        <div>
          <label className="mb-2.5 block text-[11.5px] font-bold uppercase tracking-[.08em] text-zinc-400">Your niche <span className="text-[#ff3d6a]">*</span></label>
          <div className="flex flex-wrap gap-2">
            {NICHES.map((n) => (
              <div key={n} onClick={() => setNiche(n)}
                className={cn("cursor-pointer rounded-[9px] border px-3 py-1.5 text-[13px] transition",
                  niche === n
                    ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10 text-white"
                    : "border-white/[.08] bg-white/[.04] text-zinc-400 hover:border-white/20 hover:text-zinc-200"
                )}>
                {n}
              </div>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-3 block text-[11.5px] font-bold uppercase tracking-[.08em] text-zinc-400">Accent color</label>
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
        <p className="mt-2 text-[14px] text-zinc-500">We'll tune your dashboard and recommendations around it.</p>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {GOALS.map((g) => (
          <div key={g.id} onClick={() => setSel(g.id)}
            className={cn(
              "flex cursor-pointer flex-col gap-2 rounded-[14px] border p-4 transition-all",
              sel === g.id
                ? "border-[#ff3d6a]/45 bg-[#ff3d6a]/10"
                : "border-white/[.08] bg-white/[.03] hover:border-white/20"
            )}>
            <span className="text-[26px]">{g.icon}</span>
            <div className={cn("text-[13.5px] font-bold", sel === g.id ? "text-white" : "text-zinc-300")}>{g.title}</div>
            <div className="text-[12px] leading-[1.45] text-zinc-500">{g.desc}</div>
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

/* ═══════════════ STEP 5 — Plan + Finalize ═══════════════ */
function S5Plan({ onComplete }: { onComplete: (dest: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function finalize(plan: string, dest: string) {
    setError(""); setLoading(true);
    try {
      await onboarding.plan(plan);
      const res = await onboarding.finalize();
      applyFinalizeToken(res.access_token, dest);
    } catch (e: any) {
      setError(e?.message ?? "Failed to finalize. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="relative overflow-hidden py-2 text-center">
      <Confetti />
      <div className="relative z-10">
        <div className="mb-4 text-[64px]" style={{ animation: "bounceIn .6s cubic-bezier(.34,1.56,.64,1)" }}>🎉</div>
        <h2 className="mb-2 font-display text-[28px] font-extrabold tracking-[-0.02em]">Almost done!</h2>
        <p className="mx-auto mb-6 max-w-[360px] text-[14px] leading-[1.65] text-zinc-500">
          Choose a plan to activate your workspace. You can upgrade anytime.
        </p>

        {/* Plan cards */}
        <div className="mx-auto mb-6 grid max-w-[500px] grid-cols-1 gap-3 text-left sm:grid-cols-2">
          <div className="rounded-[16px] border border-white/[.08] bg-white/[.04] p-5">
            <div className="mb-3 text-[12px] font-bold uppercase tracking-[.1em] text-zinc-500">Free</div>
            <div className="mb-1 font-display text-[28px] font-bold">$0<span className="text-[14px] font-normal text-zinc-500">/mo</span></div>
            <p className="mb-4 text-[12px] text-zinc-500">3 videos/mo · 1 platform · Basic captions</p>
            <button onClick={() => finalize("free", "/")} disabled={loading}
              className="w-full rounded-[9px] border border-white/[.10] bg-white/[.04] py-2 text-[13px] font-semibold text-zinc-300 transition hover:bg-white/[.08] disabled:opacity-50">
              Start free
            </button>
          </div>
          <div className="rounded-[16px] border border-[#ff3d6a]/30 bg-[#ff3d6a]/[.06] p-5 shadow-[0_0_0_1px_rgba(255,61,106,.12)]">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[12px] font-bold uppercase tracking-[.1em] text-[#ff3d6a]">Pro</span>
              <span className="rounded-full bg-[#ff3d6a]/15 px-2 py-px text-[10px] font-bold text-[#ff3d6a]">Popular</span>
            </div>
            <div className="mb-1 font-display text-[28px] font-bold">$29<span className="text-[14px] font-normal text-zinc-500">/mo</span></div>
            <p className="mb-4 text-[12px] text-zinc-500">Unlimited videos · All platforms · Voice cloning</p>
            <button onClick={() => finalize("pro", "/")} disabled={loading}
              className="w-full rounded-[9px] bg-[#ff3d6a] py-2 text-[13px] font-semibold text-white shadow-[0_2px_12px_rgba(255,61,106,.35)] transition hover:shadow-[0_4px_18px_rgba(255,61,106,.5)] disabled:opacity-50">
              {loading ? <span className="inline-block h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" /> : "Get Pro"}
            </button>
          </div>
        </div>

        <Err msg={error} />

        <div className="mx-auto grid max-w-[300px] grid-cols-1 gap-2 sm:grid-cols-3">
          {[
            { icon:"🎬", label:"Studio",   dest:"/studio" },
            { icon:"🔥", label:"Trending", dest:"/trending" },
            { icon:"📊", label:"Dashboard",dest:"/" },
          ].map((a) => (
            <div key={a.label} onClick={() => !loading && finalize("free", a.dest)}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-1.5 rounded-[12px] border border-white/[.08] bg-white/[.04] py-3 transition hover:border-[#ff3d6a]/30 hover:bg-[#ff3d6a]/[.06]",
                loading && "pointer-events-none opacity-50"
              )}>
              <span className="text-xl">{a.icon}</span>
              <span className="text-[12px] font-semibold">{a.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ WIZARD ═══════════════ */
export function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [skipping, setSkipping] = useState(false);

  const next = () => setStep((s) => s + 1);

  async function handleSkipAll() {
    setSkipping(true);
    try {
      // Ensure niche step buffered (required before skip)
      const subdomain = getSubdomain();
      if (subdomain) {
        try { await onboarding.niche("general", subdomain); } catch {}
      }
      const res = await onboarding.skip();
      applyFinalizeToken(res.access_token, "/");
    } catch {
      // If skip fails just navigate — worst case tenant creation will retry
      navigate("/");
    }
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-[rgba(4,7,15,.94)] p-6 backdrop-blur-[12px]"
      style={{ animation: "fadeUp .3s cubic-bezier(.22,.8,.4,1)" }}>

      <div className="flex max-h-[90vh] w-full max-w-[600px] flex-col overflow-hidden rounded-[18px] border border-white/[.14] bg-[#0e1420] shadow-[0_40px_100px_rgba(0,0,0,.8)] sm:rounded-[24px]">
        <Progress step={step} />

        <div className="flex-1 overflow-y-auto px-7 pb-8 pt-6">
          {step === 1 && <S1Welcome onNext={next} onSkip={handleSkipAll} />}
          {step === 2 && <S2Platforms onNext={next} />}
          {step === 3 && <S3NicheBrand onNext={next} />}
          {step === 4 && <S4Goal onNext={next} />}
          {step === 5 && <S5Plan onComplete={(dest) => { navigate(dest); }} />}
        </div>
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


