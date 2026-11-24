/**
 * Turns what the database or the rules answer into a plain Arabic sentence. The database errors are generic codes
 * (CAL_*) or constraint names; nothing here ever shows the details of another meeting or another organization.
 */
const MESSAGES: Record<string, string> = {
  CAL_DISABLED: "التقويم غير مفعّل لهذه المؤسسة",
  CAL_BAD_STATUS: "لا يمكن إنشاء الموعد بهذه الحالة",
  CAL_BAD_TRANSITION: "لا يمكن نقل الموعد إلى هذه الحالة",
  CAL_FINAL_STATUS: "الموعد منتهٍ ولا يمكن تغيير وقته أو مسؤوله",
  CAL_CROSS_ORG: "العميل أو الفرصة أو نوع الموعد لا يتبع هذه المؤسسة",
  CAL_BAD_OWNER: "المندوب غير فعّال في هذه المؤسسة",
  CAL_OWNER_BUSY: "المندوب مشغول بهذا الوقت",
  CAL_BAD_RANGE: "وقت النهاية يجب أن يكون بعد البداية وبمدة لا تتجاوز 24 ساعة",
  CAL_OUTSIDE_HOURS: "الموعد خارج ساعات عمل المندوب",
  CAL_OFF_DAY: "المندوب لا يعمل في هذا اليوم",
  CAL_CLOSED_DAY: "هذا اليوم خارج أيام العمل",
  CAL_ON_BREAK: "الموعد يتعارض مع استراحة المندوب",
  CAL_TIME_OFF: "المندوب في إجازة في هذا اليوم",
  CAL_BAD_TIMEZONE: "المنطقة الزمنية غير معروفة",
  CAL_OUTCOME_NOT_ALLOWED: "تُسجَّل نتيجة الموعد بعد انتهائه فقط",
};
const FALLBACK = "تعذر حفظ الموعد، حاول مرة أخرى";

export function calendarError(error: { message?: string; code?: string } | string | null | undefined): string {
  const text = typeof error === "string" ? error : (error?.message ?? "");
  const code = Object.keys(MESSAGES).find((c) => text.includes(c));
  if (code) return MESSAGES[code]!;
  if (text.includes("cal_meetings_owner_no_overlap")) return MESSAGES.CAL_OWNER_BUSY!;
  if (text.includes("cal_meetings_time_order")) return MESSAGES.CAL_BAD_RANGE!;
  if (text.includes("cal_meetings_outcome_after_completed")) return MESSAGES.CAL_OUTCOME_NOT_ALLOWED!;
  return FALLBACK;
}
export const ruleMessage = (code: string | null): string | null => (code ? (MESSAGES[code] ?? FALLBACK) : null);
