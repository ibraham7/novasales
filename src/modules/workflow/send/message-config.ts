/**
 * Checks the settings of the message and staff-alert steps when a workflow is SAVED or switched on, so a typo in a
 * variable name or a missing text is found by the person writing it, not by a customer receiving «{nmae}».
 * Returns an Arabic message for the first problem, or null.
 */
import { MAX_MESSAGE_LENGTH, unknownVariables } from "./template.ts";

export const MESSAGE_ACTIONS = ["message.whatsapp", "message.email", "notify.staff"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function textProblem(label: string, value: unknown, max: number, required = true): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return required ? `اكتب ${label}` : null;
  if (text.length > max) return `${label} أطول من ${max} حرفاً`;
  const unknown = unknownVariables(text);
  if (unknown.length) return `${label}: المتغيّر {${unknown[0]}} غير معروف`;
  return null;
}

export function validateMessageStep(action: string, config: Record<string, unknown>): string | null {
  if (action === "message.whatsapp" || action === "message.email") {
    if (config.kind !== undefined && config.kind !== "service" && config.kind !== "promo") return "نوع الرسالة: خدمة أو ترويج";
    if (config.account !== undefined && config.account !== "ticket" && config.account !== "owner") return "رقم الواتساب المرسِل: محادثة التذكرة أو رقم المندوب";
    if (config.channel_account_id !== undefined && !(typeof config.channel_account_id === "string" && UUID.test(config.channel_account_id))) return "معرّف حساب الواتساب غير صحيح";
    if (action === "message.email") {
      const subject = textProblem("موضوع الرسالة", config.subject, 200);
      if (subject) return subject;
    }
    return textProblem("نص الرسالة", config.body, MAX_MESSAGE_LENGTH);
  }
  if (action === "notify.staff") {
    const to = config.to ?? "assignee";
    if (to !== "assignee" && to !== "managers" && to !== "users") return "اختر من يصله التنبيه: المندوب أو المديرون أو أشخاص محددون";
    if (to === "users" && !(Array.isArray(config.user_ids) && config.user_ids.length > 0 && config.user_ids.every((id) => typeof id === "string" && UUID.test(id)))) return "اختر موظفاً واحداً على الأقل للتنبيه";
    return textProblem("عنوان التنبيه", config.title, 120) ?? textProblem("نص التنبيه", config.body, 240, false);
  }
  return null;
}

/** The first problem among all steps of a definition, naming the step. */
export function validateMessageSteps(steps: any[]): string | null {
  for (const [i, step] of (steps ?? []).entries()) {
    if (step?.type !== "action" || !(MESSAGE_ACTIONS as readonly string[]).includes(step.action)) continue;
    const problem = validateMessageStep(step.action, step.config ?? {});
    if (problem) return `الخطوة ${i + 1}${step.label ? ` («${step.label}»)` : ""}: ${problem}`;
  }
  return null;
}
