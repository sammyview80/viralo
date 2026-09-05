import { useQuery } from "@/lib/query";
import { billingApi, type SubscriptionInfo } from "@/lib/api";

const PLAN_ORDER = ["free", "starter", "pro", "creator", "unlimited"] as const;
type PlanName = (typeof PLAN_ORDER)[number];

const PLAN_FEATURES: Record<
  PlanName,
  {
    brainstorm: boolean;
    workflows: boolean;
    channels: boolean;
    integrations: boolean;
    videos_per_month: number; // -1 unlimited
    storage_gb: number;
  }
> = {
  free:      { brainstorm: false, workflows: false, channels: false, integrations: false, videos_per_month: 5,   storage_gb: 1  },
  starter:   { brainstorm: true,  workflows: false, channels: false, integrations: true,  videos_per_month: 15,  storage_gb: 10 },
  pro:       { brainstorm: true,  workflows: false, channels: false, integrations: true,  videos_per_month: 30,  storage_gb: 20 },
  creator:   { brainstorm: true,  workflows: true,  channels: true,  integrations: true,  videos_per_month: 60,  storage_gb: 40 },
  unlimited: { brainstorm: true,  workflows: true,  channels: true,  integrations: true,  videos_per_month: -1,  storage_gb: -1 },
};

type PlanFeatures = (typeof PLAN_FEATURES)[PlanName];

export function usePlan() {
  const { data, loading } = useQuery<SubscriptionInfo>(
    "billing:subscription",
    billingApi.subscription,
  );
  const selfHosted = data?.self_hosted === true;
  const planName = ((data?.plan_name ?? "free") as PlanName) in PLAN_FEATURES
    ? (data?.plan_name as PlanName)
    : "free";
  const features: PlanFeatures = selfHosted
    ? PLAN_FEATURES.unlimited
    : PLAN_FEATURES[planName] ?? PLAN_FEATURES.free;

  return {
    plan: selfHosted ? "unlimited" : planName,
    features,
    loading,
    subscription: data,
    selfHosted,
    can: (feature: keyof PlanFeatures): boolean => {
      if (selfHosted) return true;
      const val = features[feature];
      return val === true || (typeof val === "number" && val !== 0);
    },
    isAtLeast: (minPlan: PlanName): boolean =>
      selfHosted || PLAN_ORDER.indexOf(planName) >= PLAN_ORDER.indexOf(minPlan),
  };
}
