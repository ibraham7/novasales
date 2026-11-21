/**
 * The ONE gate every automatic message passes before it is sent. Pure: it is given the facts and answers
 * «send», «skip» (with a reason, never sent) or «defer» (hold until a time). The checks run in this order:
 *   1. the same message for the same event was already sent or is waiting      → skip
 *   2. automatic sending is switched off for the organization (the default)    → skip
 *   2b. test mode: a recipient list is set and this one is not on it           → skip
 *   3. the customer asked not to be messaged (stop list)                       → skip
 *   4. promotional message without the customer's explicit consent             → skip
 *      service message to someone who never wrote to us (unless allowed)       → skip
 *   5. outside the sending hours of the organization's time zone               → defer to the next opening
 *   6. the day's limit is used up                                              → defer to the next opening
 *   7. WhatsApp only: too soon after the previous message (random-looking gap) → defer a few seconds
 * Nothing here sends anything or touches a database.
 */
import { decideNext, scheduleProblem, type SendSchedule } from "../../campaigns/send-schedule.ts";

export type SendKind = "service" | "promo";
export type SendChannel = "whatsapp" | "email";

export type GateSettings = {
  sending_enabled: boolean;
  timezone: string;
  send_window_start: string;
  send_window_end: string;
  daily_limit: number;
  gap_min_seconds: number;
  gap_max_seconds: number;
  /** How long a held message may wait before it is dropped as expired. */
  defer_ttl_minutes: number;
  /** Test mode: when not empty, automatic messages go ONLY to these numbers / emails. */
  test_recipients: string[];
};

/** What an organization without saved settings gets: automatic sending OFF. */
export const DEFAULT_SETTINGS: GateSettings = {
  sending_enabled: false,
  timezone: "Europe/Istanbul",
  send_window_start: "09:00",
  send_window_end: "20:00",
  daily_limit: 100,
  gap_min_seconds: 45,
  gap_max_seconds: 180,
  defer_ttl_minutes: 720,
  test_recipients: [],
};

/** Does this recipient match one of the allowed ones? Numbers compare by their last 10 digits (05… and 905… are the same line). */
export function isTestRecipient(list: string[], to: string | null | undefined): boolean {
  if (!to) return false;
  const isEmail = to.includes("@");
  const tail = (v: string) => v.replace(/\D/g, "").slice(-10);
  return list.some((x) => (isEmail ? x.trim().toLowerCase() === to.trim().toLowerCase() : !x.includes("@") && tail(x).length >= 7 && tail(x) === tail(to)));
}

export type GateFacts = {
  channel: SendChannel;
  kind: SendKind;
  now: Date;
  settings: GateSettings;
  duplicate: boolean;
  blocked: boolean;
  promoConsent: boolean;
  recipient?: string | null;
  hasPriorContact: boolean;
  allowFirstContact: boolean;
  /** Messages already sent today (in the organization's time zone) from the same sender. */
  sentToday: number;
  /** When the sender last sent one (WhatsApp gap only). */
  lastSentAt: Date | null;
  /** Seed for the gap, so the same previous message always gives the same gap. */
  gapSeed?: string;
};

export type GateDecision =
  | { action: "send" }
  | { action: "skip"; code: SkipCode; reason: string }
  | { action: "defer"; code: DeferCode; reason: string; notBefore: Date };

export type SkipCode = "duplicate" | "sending_off" | "opted_out" | "no_promo_consent" | "no_prior_contact" | "bad_settings" | "not_test_recipient";
export type DeferCode = "outside_hours" | "daily_limit" | "gap";

/** Arabic reasons for every outcome, also for those decided outside the gate (kept together so the run log reads one way). */
export const REASONS: Record<string, string> = {
  duplicate: "سبق إرسال هذه الرسالة لنفس الحدث أو هي بانتظار الإرسال",
  sending_off: "الإرسال التلقائي مطفأ لهذه المؤسسة (إعدادات الإرسال)",
  opted_out: "العميل طلب عدم المراسلة",
  no_promo_consent: "رسالة ترويجية وليس لدى العميل موافقة صريحة",
  no_prior_contact: "لم يراسلنا هذا العميل من قبل؛ رسائل الخدمة تُرسل لمن راسلنا فقط",
  bad_settings: "إعدادات الإرسال غير صالحة",
  not_test_recipient: "وضع التجربة مفعّل: هذا الرقم ليس ضمن الأرقام المسموح الإرسال لها",
  outside_hours: "خارج ساعات الإرسال؛ ستُرسل عند فتحها",
  daily_limit: "بلغنا الحد اليومي؛ ستُرسل عند فتح ساعات الإرسال القادمة",
  gap: "فاصل بين الرسائل؛ ستُرسل بعد لحظات",
  expired: "انتهت صلاحية الرسالة وهي منتظرة قبل أن تُرسل",
  no_address: "لا يوجد رقم هاتف أو بريد لهذا العميل",
  no_account: "لا يوجد حساب واتساب متصل للإرسال",
  no_body: "نص الرسالة فارغ",
  interrupted: "انقطع الإرسال قبل أن يُعرف إن وصلت الرسالة؛ لم تُعاد حتى لا تتكرر",
  send_failed: "فشل الإرسال",
};

/** A gap in [min, max] seconds that looks random but is the same every time for the same seed. */
export function gapSeconds(seed: string, min: number, max: number): number {
  const lo = Math.max(0, Math.min(min, max));
  const hi = Math.max(min, max);
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return lo + (h % (hi - lo + 1));
}

export const scheduleOf = (s: GateSettings): SendSchedule => ({ dailyLimit: s.daily_limit, windowStart: s.send_window_start, windowEnd: s.send_window_end, timezone: s.timezone, ramp: null });

export function evaluateGate(f: GateFacts): GateDecision {
  const skip = (code: SkipCode): GateDecision => ({ action: "skip", code, reason: REASONS[code]! });
  if (f.duplicate) return skip("duplicate");
  if (!f.settings.sending_enabled) return skip("sending_off");
  if ((f.settings.test_recipients?.length ?? 0) > 0 && !isTestRecipient(f.settings.test_recipients, f.recipient)) return skip("not_test_recipient");
  if (f.blocked) return skip("opted_out");
  if (f.kind === "promo" && !f.promoConsent) return skip("no_promo_consent");
  if (f.kind === "service" && !f.hasPriorContact && !f.allowFirstContact) return skip("no_prior_contact");

  const schedule = scheduleOf(f.settings);
  if (scheduleProblem(schedule)) return skip("bad_settings");
  const when = decideNext(schedule, f.now, f.sentToday, 0);
  if (when.action === "wait") {
    const code: DeferCode = when.reason === "daily_limit" ? "daily_limit" : "outside_hours";
    return { action: "defer", code, reason: REASONS[code]!, notBefore: when.until };
  }
  if (f.channel === "whatsapp" && f.lastSentAt) {
    const gap = gapSeconds(f.gapSeed ?? f.lastSentAt.toISOString(), f.settings.gap_min_seconds, f.settings.gap_max_seconds);
    const next = new Date(f.lastSentAt.getTime() + gap * 1000);
    if (f.now < next) return { action: "defer", code: "gap", reason: REASONS.gap!, notBefore: next };
  }
  return { action: "send" };
}
