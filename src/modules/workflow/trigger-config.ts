/**
 * Checks the trigger of a workflow when it is saved: the time-based events need their duration, and the «stop»
 * choices must be known ones. Returns an Arabic message for the first problem, or null.
 */
export const TIME_EVENTS = {
  "time.stage_timeout": "بقاء التذكرة في مرحلة مدة معيّنة",
  "time.no_reply": "عدم ردّ العميل على آخر رسالة منّا",
  "time.stale": "تذكرة راكدة (لا نشاط ولا رسائل)",
  "time.task_overdue": "مهمة أو متابعة متأخرة",
  "time.unassigned": "تذكرة بلا مندوب مسؤول لمدة",
  "time.daily_digest": "ملخص الصباح لكل مندوب",
  "time.channel_disconnected": "انقطاع حساب واتساب لمدة",
  "time.meeting_reminder": "تذكير قبل موعد الاجتماع بمدة تختارها",
} as const;
export type TimeEvent = keyof typeof TIME_EVENTS;
export const isTimeEvent = (event: unknown): event is TimeEvent => typeof event === "string" && event in TIME_EVENTS;

export const STOP_REASONS = { customer_reply: "ردّ العميل", stage_change: "انتقال التذكرة لمرحلة أخرى" } as const;
export type StopReason = keyof typeof STOP_REASONS;

export const MIN_AFTER_MINUTES = 5;
export const MAX_AFTER_MINUTES = 525_600; // a year

export function validateTriggerConfig(triggerType: string, config: Record<string, unknown>): string | null {
  if (triggerType !== "event") return null;
  const event = config.event;
  if (isTimeEvent(event)) {
    const after = config.after_minutes;
    if (event === "time.task_overdue") {
      // A grace period is optional for tasks: 0 means «as soon as it is overdue».
      if (after !== undefined && !(Number.isInteger(after) && (after as number) >= 0 && (after as number) <= MAX_AFTER_MINUTES)) return "مهلة التأخير يجب أن تكون عدداً صحيحاً من الدقائق";
    } else if (event === "time.daily_digest") {
      const hour = config.hour;
      if (!(Number.isInteger(hour) && (hour as number) >= 0 && (hour as number) <= 23)) return "ساعة الملخص يجب أن تكون من 0 إلى 23";
    } else if (!(Number.isInteger(after) && (after as number) >= MIN_AFTER_MINUTES && (after as number) <= MAX_AFTER_MINUTES)) {
      return `اكتب المدة بالدقائق (من ${MIN_AFTER_MINUTES} إلى ${MAX_AFTER_MINUTES})`;
    }
    if (config.stage_id !== undefined && config.stage_id !== null && !/^[0-9a-f-]{36}$/i.test(String(config.stage_id))) return "المرحلة غير صحيحة";
  }
  if (config.stop_on !== undefined) {
    if (!Array.isArray(config.stop_on) || !config.stop_on.every((r) => typeof r === "string" && r in STOP_REASONS)) return "خيار الإيقاف غير معروف (ردّ العميل أو انتقال التذكرة)";
  }
  return null;
}
