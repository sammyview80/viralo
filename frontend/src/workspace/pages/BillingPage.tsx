import { useState, useEffect } from "react";
import { billingApi, PlanInfo, SubscriptionInfo, EsewaQR } from "@/lib/api";
import { useQuery, invalidate } from "@/lib/query";

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function fmtNPR(usd: number): string {
  const npr = Math.round(usd * 133);
  return npr.toLocaleString("en-IN");
}

const PLAN_ORDER = ["free", "starter", "pro", "creator", "unlimited"];

function planRank(name: string): number {
  return PLAN_ORDER.indexOf(name.toLowerCase());
}

// ─── Usage bar ───────────────────────────────────────────────────────────────

function UsageBar({ label, used, max, formatUsed, formatMax }: {
  label: string;
  used: number;
  max: number;
  formatUsed: (n: number) => string;
  formatMax: (n: number) => string;
}) {
  const pct = max <= 0 ? 0 : Math.min(100, (used / max) * 100);
  const danger = pct >= 90;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-c-text-secondary">{label}</span>
        <span className={danger ? "text-red-400" : "text-c-text-secondary"}>
          {formatUsed(used)} / {max < 0 ? "∞" : formatMax(max)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        {max > 0 && (
          <div
            className={`h-full rounded-full transition-all ${danger ? "bg-red-500" : "bg-[#ff3d6a]"}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Skeleton pieces ──────────────────────────────────────────────────────────

function SkeletonBanner() {
  return (
    <div className="animate-pulse rounded-[14px] border border-c-border bg-surface-1 p-6 space-y-4">
      <div className="h-5 w-40 rounded bg-surface-2" />
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-surface-2" />
        <div className="h-3 w-3/4 rounded bg-surface-2" />
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-[14px] border border-c-border bg-surface-1 p-5 space-y-3">
      <div className="h-4 w-20 rounded bg-surface-2" />
      <div className="h-7 w-16 rounded bg-surface-2" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-3 rounded bg-surface-2" style={{ width: `${60 + (i * 11) % 35}%` }} />
        ))}
      </div>
    </div>
  );
}

// ─── eSewa modal ──────────────────────────────────────────────────────────────

function EsewaModal({ plan, onClose }: { plan: PlanInfo; onClose: () => void }) {
  const { data: qr, loading, error } = useQuery<EsewaQR>(
    `billing:esewa:${plan.name}`,
    () => billingApi.esewaQR(plan.name),
    { ttl: 300_000 },
  );

  const qrData = qr ? encodeURIComponent(JSON.stringify({
    merchant: qr.merchant_id,
    product: qr.product_id,
    amount: qr.amount_npr,
  })) : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[18px] border border-c-border bg-surface-1 p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold">Pay with eSewa</h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-c-text-muted hover:bg-surface-2 hover:text-c-text transition-colors"
          >
            ✕
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-10">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff3d6a] border-t-transparent" />
          </div>
        )}

        {error && (
          <p className="text-sm text-red-400">Failed to load QR: {error}</p>
        )}

        {qr && !loading && (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-[10px] bg-white p-3">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${qrData}`}
                alt="eSewa QR code"
                width={200}
                height={200}
                className="block"
              />
            </div>
            <div className="text-center space-y-1">
              <p className="font-display text-2xl font-bold">NPR {qr.amount_npr.toLocaleString("en-IN")}</p>
              <p className="text-xs text-c-text-muted">Ref: <span className="font-mono text-c-text-secondary">{qr.product_id}</span></p>
            </div>
            <div className="w-full rounded-[10px] border border-[#ff3d6a]/20 bg-[#ff3d6a]/5 p-3 text-xs text-c-text-secondary space-y-1">
              <p className="font-semibold text-c-text">Instructions</p>
              <p>{qr.instructions}</p>
              <p className="text-c-text-secondary">After payment, contact <span className="text-[#ff3d6a]">support@viralo.com</span> with your reference ID.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Plan card ────────────────────────────────────────────────────────────────

interface PlanCardProps {
  plan: PlanInfo;
  currentPlanName: string;
  onUpgrade: (plan: PlanInfo) => void;
  onEsewa: (plan: PlanInfo) => void;
  upgrading: string | null;
}

function PlanCard({ plan, currentPlanName, onUpgrade, onEsewa, upgrading }: PlanCardProps) {
  const isCurrent = plan.name.toLowerCase() === currentPlanName.toLowerCase();
  const isPopular = plan.name.toLowerCase() === "pro";
  const currentRank = planRank(currentPlanName);
  const thisRank = planRank(plan.name);
  const isUpgrade = thisRank > currentRank;
  const isFree = plan.price_monthly === 0;

  const features: string[] = [
    plan.videos_per_month < 0 ? "Unlimited videos/mo" : `${plan.videos_per_month} videos/mo`,
    plan.storage_gb < 0 ? "Unlimited storage" : `${plan.storage_gb} GB storage`,
    plan.accounts_per_platform > 0
      ? `${plan.accounts_per_platform} account${plan.accounts_per_platform > 1 ? "s" : ""}/platform`
      : "No social accounts",
    plan.video_duration_limit_min ? `${plan.video_duration_limit_min}min video cap` : "No duration limit",
    plan.brainstorm ? "Brainstorm AI" : null,
    plan.workflows ? "Workflows" : null,
    plan.channels ? "Channel monitor" : null,
    plan.watermark ? "Watermark" : null,
  ].filter((f): f is string => f !== null);

  return (
    <div
      className={`relative flex flex-col rounded-[14px] border p-5 transition-all ${
        isCurrent
          ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/5"
          : "border-c-border bg-surface-1 hover:border-c-border-hover"
      }`}
    >
      {isPopular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#ff3d6a] px-3 py-0.5 text-[11px] font-bold uppercase tracking-widest text-white shadow">
          Popular
        </span>
      )}

      <div className="mb-4 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-display text-base font-bold capitalize">{plan.name}</span>
          {isCurrent && (
            <span className="rounded-full border border-[#ff3d6a]/40 bg-[#ff3d6a]/10 px-2 py-0.5 text-[10px] font-semibold text-[#ff3d6a]">
              Current
            </span>
          )}
        </div>
        <div>
          <span className="font-display text-3xl font-bold tracking-[-0.03em]">
            {isFree ? "Free" : `$${plan.price_monthly}`}
          </span>
          {!isFree && <span className="text-xs text-c-text-muted">/mo</span>}
          {!isFree && (
            <p className="text-[11px] text-c-text-muted">NPR ~{fmtNPR(plan.price_monthly)}/mo</p>
          )}
        </div>
      </div>

      <ul className="flex-1 space-y-1.5 text-xs text-c-text-secondary mb-5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-1.5">
            <span className="mt-0.5 text-[#ff3d6a]">✓</span>
            {f}
          </li>
        ))}
      </ul>

      {isFree ? (
        <button
          disabled={isCurrent}
          className="w-full rounded-[8px] border border-c-border py-2 text-xs font-semibold text-c-text-secondary disabled:opacity-40"
        >
          {isCurrent ? "Current plan" : "Downgrade to Free"}
        </button>
      ) : (
        <div className="space-y-2">
          <button
            disabled={isCurrent || upgrading === plan.name}
            onClick={() => onUpgrade(plan)}
            className={`w-full rounded-[8px] py-2 text-xs font-semibold transition-colors disabled:opacity-40 ${
              isCurrent
                ? "border border-c-border text-c-text-secondary"
                : isUpgrade
                  ? "bg-[#ff3d6a] text-white hover:bg-[#e0354f]"
                  : "border border-c-border text-c-text-secondary hover:bg-surface-2"
            }`}
          >
            {upgrading === plan.name
              ? "Redirecting…"
              : isCurrent
                ? "Current"
                : isUpgrade
                  ? "Upgrade"
                  : "Downgrade"}
          </button>
          {!isCurrent && (
            <button
              onClick={() => onEsewa(plan)}
              className="w-full rounded-[8px] border border-green-500/30 bg-green-500/5 py-2 text-xs font-semibold text-green-400 hover:bg-green-500/10 transition-colors"
            >
              Pay with eSewa
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function BillingPage() {
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [esewaTarget, setEsewaTarget] = useState<PlanInfo | null>(null);
  const params = new URLSearchParams(window.location.search);
  const successPlan = params.get("success") === "1" ? (params.get("plan") ?? "") : null;
  // session_id present without plan = legacy redirect from /billing/success
  const successSession = !successPlan && params.get("session_id") ? true : false;
  const cancelled = params.get("cancelled") === "1";
  const upgradeTo = params.get("upgrade") ?? null;

  useEffect(() => {
    if (successPlan || successSession) {
      const sid = params.get("session_id");
      // Confirm with backend (handles case where webhook hasn't fired)
      if (sid) {
        billingApi.confirm(sid)
          .then(() => invalidate("billing:subscription"))
          .catch(() => invalidate("billing:subscription"));
      } else {
        invalidate("billing:subscription");
      }
      window.history.replaceState({}, "", "/billing");
    }
    if (cancelled) {
      window.history.replaceState({}, "", "/billing");
    }
    if (upgradeTo) {
      window.history.replaceState({}, "", "/billing");
    }
  }, []);

  // Auto-trigger checkout when arriving with ?upgrade=<plan>
  useEffect(() => {
    if (!upgradeTo || upgrading) return;
    setUpgrading(upgradeTo);
    billingApi.checkout(
      upgradeTo,
      "monthly",
      `${window.location.origin}/billing?success=1&plan=${upgradeTo}`,
      `${window.location.origin}/billing?cancelled=1`,
    ).then(({ checkout_url }) => {
      window.location.href = checkout_url;
    }).catch(() => setUpgrading(null));
  }, [upgradeTo]);

  const { data: plans, loading: loadingPlans, error: plansError } = useQuery<PlanInfo[]>(
    "billing:plans",
    () => billingApi.plans(),
    { ttl: 600_000 },
  );

  const { data: sub, loading: loadingSub, error: subError } = useQuery<SubscriptionInfo>(
    "billing:subscription",
    () => billingApi.subscription(),
    { ttl: 60_000 },
  );

  const currentPlanName = sub?.plan_name ?? "free";

  const currentPlan = plans?.find((p) => p.name.toLowerCase() === currentPlanName.toLowerCase());
  const storageLimit = currentPlan ? currentPlan.storage_gb * 1_073_741_824 : 1_073_741_824;
  const videosLimit = currentPlan ? currentPlan.videos_per_month : 5;

  async function handleUpgrade(plan: PlanInfo) {
    setUpgrading(plan.name);
    try {
      const { checkout_url } = await billingApi.checkout(
        plan.name,
        "monthly",
        `${window.location.href.split("?")[0]}?success=1&plan=${plan.name}`,
        `${window.location.href.split("?")[0]}?cancelled=1`,
      );
      window.location.href = checkout_url;
    } catch (err) {
      console.error("Checkout error", err);
      setUpgrading(null);
    }
  }

  const sortedPlans = plans
    ? [...plans].sort((a, b) => planRank(a.name) - planRank(b.name))
    : [];

  return (
    <>
      <div className="space-y-8">
        {/* Header */}
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">Billing</h1>

        {(successPlan || successSession) && (
          <div className="flex items-center gap-3 rounded-[12px] border border-emerald-500/30 bg-emerald-500/10 px-5 py-4">
            <span className="text-xl">🎉</span>
            <div>
              <p className="font-semibold text-emerald-300 capitalize">
                {successPlan ? `You're now on the ${successPlan} plan!` : "Payment successful! Your plan has been upgraded."}
              </p>
              <p className="text-xs text-emerald-400/70 mt-0.5">
                Your subscription is active. Features unlocked immediately.
              </p>
            </div>
          </div>
        )}

        {cancelled && (
          <div className="flex items-center gap-3 rounded-[12px] border border-c-border bg-surface-1 px-5 py-4">
            <span className="text-xl">↩️</span>
            <p className="text-sm text-c-text-secondary">Payment cancelled. Your plan was not changed.</p>
          </div>
        )}

        {/* Current plan banner */}
        {loadingSub ? (
          <SkeletonBanner />
        ) : subError ? (
          <div className="rounded-[14px] border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
            Failed to load subscription: {subError}
          </div>
        ) : sub ? (
          <div className="rounded-[14px] border border-c-border bg-surface-1 p-6 space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.08em] text-c-text-muted">Current plan</p>
                <p className="font-display text-xl font-bold capitalize mt-0.5">{sub.plan_name}</p>
                <p className="text-xs text-c-text-muted mt-0.5">
                  Status: <span className="capitalize text-c-text-secondary">{sub.status}</span>
                  {sub.billing_cycle !== "none" && (
                    <> &middot; {sub.billing_cycle}</>
                  )}
                </p>
              </div>
              {sub.current_period_end && (
                <div className="text-right">
                  <p className="text-xs text-c-text-muted">
                    {sub.cancel_at_period_end ? "Cancels" : "Renews"}
                  </p>
                  <p className="text-sm font-semibold text-c-text-secondary">
                    {new Date(sub.current_period_end).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                    })}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <UsageBar
                label="Videos this month"
                used={sub.videos_used}
                max={videosLimit}
                formatUsed={(n) => String(n)}
                formatMax={(n) => String(n)}
              />
              <UsageBar
                label="Storage used"
                used={sub.storage_bytes_used}
                max={storageLimit}
                formatUsed={fmtBytes}
                formatMax={fmtBytes}
              />
            </div>
          </div>
        ) : null}

        {/* Plans grid */}
        <div>
          <h2 className="mb-4 font-display text-base font-bold text-c-text">Plans</h2>
          {plansError ? (
            <div className="rounded-[14px] border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
              Failed to load plans: {plansError}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {loadingPlans
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
                : sortedPlans.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      currentPlanName={currentPlanName}
                      onUpgrade={handleUpgrade}
                      onEsewa={(p) => setEsewaTarget(p)}
                      upgrading={upgrading}
                    />
                  ))}
            </div>
          )}
        </div>

        <p className="text-[11px] text-c-text-muted">
          Prices in USD. eSewa payments are converted at ~NPR 133/USD. For billing queries contact{" "}
          <a href="mailto:support@viralo.com" className="text-c-text-muted hover:text-c-text underline transition-colors">
            support@viralo.com
          </a>
        </p>
      </div>

      {esewaTarget && (
        <EsewaModal plan={esewaTarget} onClose={() => setEsewaTarget(null)} />
      )}
    </>
  );
}
