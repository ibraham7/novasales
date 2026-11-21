/**
 * The words the automation screens use: events, actions, statuses and the result of a step, in Arabic, plus a few
 * helpers (duration units, reading a step's result). Pure, so it is tested without a screen.
 */
import { TIME_EVENTS } from "./trigger-config.ts";

export const EVENT_OPTIONS: { value: string; label: string; group: "عملاء وتذاكر" | "رسائل" | "زمنية" }[] = [
  { value: "crm.lead.created", label: "عميل محتمل جديد", group: "عملاء وتذاكر" },
  { value: "crm.lead.assigned", label: "إسناد عميل محتمل لمندوب", group: "عملاء وتذاكر" },
  { value: "crm.opportunity.created", label: "تذكرة (فرصة) جديدة", group: "عملاء وتذاكر" },
  { value: "crm.opportunity.stage_changed", label: "تغيّر مرحلة التذكرة", group: "عملاء وتذاكر" },
  { value: "crm.opportunity.assigned", label: "إسناد التذكرة لمندوب", group: "عملاء وتذاكر" },
  { value: "messaging.message.received", label: "وصلت رسالة من عميل", group: "رسائل" },
  { value: "messaging.reply.yes", label: "ردّ العميل بـ «نعم»", group: "رسائل" },
  { value: "messaging.reply.no", label: "ردّ العميل بـ «لا»", group: "رسائل" },
  ...Object.entries(TIME_EVENTS).map(([value, label]) => ({ value, label, group: "زمنية" as const })),
];
export const eventLabel = (event: string | null | undefined): string => EVENT_OPTIONS.find((e) => e.value === event)?.label ?? event ?? "—";

export const ACTION_LABELS: Record<string, string> = {
  "message.whatsapp": "رسالة واتساب للعميل",
  "message.email": "رسالة إيميل للعميل",
  "notify.staff": "تنبيه لموظف داخل النظام",
  "messaging.send": "رسالة واتساب (الطريقة القديمة)",
  "crm.lead.update_fields": "تحديث بيانات العميل",
  "crm.opportunity.move_stage": "نقل التذكرة لمرحلة",
  "crm.task.create": "إنشاء مهمة",
  "crm.note.add": "إضافة ملاحظة للتذكرة",
  "crm.lead.assign": "إسناد العميل لمندوب",
  "crm.lead.transfer": "نقل العميل لمندوب آخر",
  "platform.event.emit": "إطلاق حدث",
};
export const actionLabel = (action: string | null | undefined): string => (action && ACTION_LABELS[action]) || action || "—";

export const STEP_TYPE_LABELS: Record<string, string> = { action: "إجراء", delay: "انتظار زمني", wait_for_event: "انتظار حدث", condition: "شرط", end: "نهاية", branch: "تفرّع" };
export const RUN_STATUS_LABELS: Record<string, string> = { running: "جارٍ", waiting: "بانتظار", completed: "اكتمل", failed: "فشل", cancelled: "أُوقف" };
export const MESSAGE_STATUS_LABELS: Record<string, string> = { sent: "أُرسلت", skipped: "تُخطّيت", deferred: "مؤجّلة", failed: "فشلت", sending: "قيد الإرسال" };
export const CHANNEL_LABELS: Record<string, string> = { whatsapp: "واتساب", email: "إيميل" };
export const KIND_LABELS: Record<string, string> = { service: "خدمة", promo: "ترويجية" };

export type Tone = "ok" | "skipped" | "deferred" | "waiting" | "failed";
export type StepView = { tone: Tone; badge: string; detail: string | null };

/**
 * How one step of a run is shown. A message that was skipped is NEVER shown as done: its badge says «تُخطّيت» and
 * the reason is written next to it. A held one says when it will go out.
 */
export function describeStep(step: { status?: string; step_type?: string; action?: string | null; output?: any; error?: string | null }): StepView {
  const out = step.output ?? {};
  if (step.status === "failed") return { tone: "failed", badge: "فشلت", detail: step.error ?? out.reason ?? null };
  if (step.status === "waiting") return { tone: "waiting", badge: "بانتظار", detail: null };
  const outcome = out.outcome as string | undefined;
  if (outcome === "skipped") return { tone: "skipped", badge: "تُخطّيت", detail: out.reason ?? null };
  if (outcome === "deferred") return { tone: "deferred", badge: "مؤجّلة", detail: [out.reason, out.not_before ? `الموعد: ${new Date(out.not_before).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" })}` : null].filter(Boolean).join(" · ") || null };
  if (outcome === "sent") return { tone: "ok", badge: step.action === "notify.staff" ? "أُرسل التنبيه" : "أُرسلت", detail: null };
  return { tone: "ok", badge: "تمّت", detail: null };
}

/** Minutes ↔ a number and a unit for the duration boxes. */
export const DURATION_UNITS = [{ value: "minutes", label: "دقيقة", factor: 1 }, { value: "hours", label: "ساعة", factor: 60 }, { value: "days", label: "يوم", factor: 1440 }] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number]["value"];

export function splitDuration(minutes: number): { amount: number; unit: DurationUnit } {
  if (minutes > 0 && minutes % 1440 === 0) return { amount: minutes / 1440, unit: "days" };
  if (minutes > 0 && minutes % 60 === 0) return { amount: minutes / 60, unit: "hours" };
  return { amount: minutes, unit: "minutes" };
}
export function joinDuration(amount: number, unit: DurationUnit): number {
  return Math.round(amount * (DURATION_UNITS.find((u) => u.value === unit)?.factor ?? 1));
}
export function durationText(minutes: number): string {
  const { amount, unit } = splitDuration(minutes);
  return `${amount} ${DURATION_UNITS.find((u) => u.value === unit)!.label}`;
}
