export const PERIOD_LABELS: Record<string, string> = {
  monthly: "شهر",
  quarterly: "ثلاثة أشهر",
  yearly: "سنة",
};
export const STATUS_LABELS: Record<string, string> = {
  active: "فعّال",
  trialing: "تجريبي",
  canceled: "ملغى",
  suspended: "موقوف",
  past_due: "متأخر الدفع",
  unpaid: "غير مدفوع",
  incomplete: "غير مكتمل",
  expired: "منتهي",
  open: "مستحقة",
  paid: "مدفوعة",
  void: "ملغاة",
};
export function planPrice(plan: any, period: string) {
  return Number(
    plan?.[
      period === "yearly"
        ? "price_yearly"
        : period === "quarterly"
          ? "price_quarterly"
          : "price_monthly"
    ] ?? 0,
  );
}
export function billingMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("ar", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}
export function usageLimit(max: number | undefined) {
  return max === undefined ? "غير محدد" : max === -1 ? "غير محدود" : String(max);
}
