import {
  getEffectiveFeatures,
  getEffectiveLimits,
  getCurrentUsage,
  getSubscription,
} from "./billing.server";

export class EntitlementError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "EntitlementError";
  }
}

export async function ensureFeature(featureKey: string, organizationId?: string): Promise<void> {
  const features = await getEffectiveFeatures(organizationId);
  if (features[featureKey] !== true) {
    throw new EntitlementError(
      `هذه الميزة (${featureKey}) غير مفعّلة في اشتراكك الحالي. رجاءً قم بترقية الباقة.`,
      "feature_not_enabled",
    );
  }
}

export async function ensureLimit(
  limitKey: string,
  requestedAmount = 1,
  organizationId?: string,
): Promise<{ allowed: boolean; current: number; max: number }> {
  const sub = await getSubscription(organizationId);
  if (
    sub &&
    (!["active", "trialing"].includes(sub.status) ||
      (sub.current_period_end && Date.parse(sub.current_period_end) <= Date.now()) ||
      (sub.status === "trialing" &&
        (!sub.trial_ends_at || Date.parse(sub.trial_ends_at) <= Date.now())))
  )
    throw new EntitlementError(
      "اشتراك المؤسسة غير فعّال؛ تواصل مع الإدارة",
      "subscription_inactive",
    );
  const [limits, usage] = await Promise.all([
    getEffectiveLimits(organizationId),
    getCurrentUsage(organizationId),
  ]);
  const max = limits[limitKey];
  const current = usage[limitKey] ?? 0;
  if (max === undefined || max === -1) return { allowed: true, current, max: max ?? -1 };
  if (current + requestedAmount > max) {
    throw new EntitlementError(
      `تم الوصول إلى الحد الأقصى (${max}) لـ ${limitKey}. الاستخدام الحالي: ${current}.`,
      "limit_reached",
    );
  }
  return { allowed: true, current, max };
}
