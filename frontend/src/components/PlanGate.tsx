import { navigate } from "@/lib/router";
import { usePlan } from "@/hooks/usePlan";
import { Button } from "@/components/ui/button";

const PLAN_LABELS: Record<string, string> = {
  starter:   "Starter ($9/mo)",
  pro:       "Pro ($19/mo)",
  creator:   "Creator ($35/mo)",
  unlimited: "Unlimited ($49/mo)",
};

interface PlanGateProps {
  feature: "brainstorm" | "workflows" | "channels" | "integrations";
  minPlan: "starter" | "pro" | "creator" | "unlimited";
  children: React.ReactNode;
}

export function PlanGate({ feature, minPlan, children }: PlanGateProps) {
  const { features, loading, isAtLeast } = usePlan();

  // While loading, avoid mounting gated children that may trigger protected side effects.
  if (loading) {
    return (
      <div className="min-h-[320px] w-full animate-pulse rounded-xl border border-white/[.07] bg-[#0e1420]" />
    );
  }

  const featureVal = features[feature];
  const hasAccess = featureVal === true && isAtLeast(minPlan);

  if (hasAccess) return <>{children}</>;

  return (
    <div className="relative min-h-[320px] w-full overflow-hidden rounded-xl border border-white/[.07] bg-[#0e1420]">
      {/* Placeholder only: do not mount gated children without entitlement. */}
      <div className="pointer-events-none select-none opacity-30" aria-hidden>
        <div className="m-4 grid gap-3">
          <div className="h-12 rounded-xl bg-white/[.04]" />
          <div className="h-32 rounded-xl bg-white/[.035]" />
          <div className="h-12 rounded-xl bg-white/[.04]" />
        </div>
      </div>

      {/* Upgrade overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#080b12]/70 backdrop-blur-[2px]">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/[.08] bg-[#0e1420] px-8 py-7 shadow-[0_24px_60px_rgba(0,0,0,.5)] max-w-sm text-center">
          <span className="text-3xl leading-none" role="img" aria-label="lock">🔒</span>
          <h3 className="font-display text-[15px] font-semibold text-white">
            Upgrade to {PLAN_LABELS[minPlan] ?? minPlan}
          </h3>
          <p className="text-[13px] leading-relaxed text-zinc-400">
            Upgrade to <span className="font-semibold text-zinc-300">{PLAN_LABELS[minPlan] ?? minPlan}</span> to access this feature.
          </p>
          <Button
            className="mt-1 w-full bg-[#ff3d6a] text-white hover:bg-[#ff2257] shadow-[0_3px_14px_rgba(255,61,106,.25)]"
            onClick={() => navigate("/billing")}
          >
            View Plans
          </Button>
        </div>
      </div>
    </div>
  );
}
