// عرض حالة أهلية رقم واتساب لاستقبال عملاء جدد.
export const BLOCK_MSG =
  "لا يمكن إسناد عملاء جدد لهذا الرقم حتى تنتهي فترة المراقبة ويصبح مستقراً.";

export type EligibilityRow = {
  account_id: string;
  health_state: "stable" | "observation" | "watch" | "high_risk";
  eligible: boolean;
  reason: string | null;
  observation_remaining_hours: number;
  send_paused: boolean;
  is_restricted_now: boolean;
};

export function stateLabel(e?: EligibilityRow | null): string {
  if (!e) return "";
  if (e.is_restricted_now) return "مقيّد حالياً";
  if (e.send_paused) return "الإرسال موقوف";
  if (e.reason === "observation_window")
    return `تحت المراقبة (${e.observation_remaining_hours} ساعة)`;
  if (e.health_state === "high_risk") return "مرتفع الخطورة";
  if (e.health_state === "watch") return "تحت المتابعة";
  return "تحت المراقبة";
}
