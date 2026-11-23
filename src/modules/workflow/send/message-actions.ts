/**
 * The automation steps that talk to people: a WhatsApp message, an email, and an alert to the sales team. All of
 * them go through the same gate (see gate.ts / send-core.ts) and leave a row in the message log. The database, the
 * senders and the notifier are passed in, so this is tested without sending or notifying anyone.
 *
 * What a step answers back to the run (always in `output.outcome`):
 *   sent      the message went out                  deferred  it waits for the sending hours / its turn
 *   skipped   it was not sent, `output.reason` says why (opted out, sending off, no number…)
 * Only a real failure of the sender stops the run. A skipped message does not turn the step red, and it is never
 * shown as «done»: the run log reads `outcome`.
 */
import type { ActionHandler, ActionResult } from "../actions/registry.server.ts";
import { loadMessageContext, pickWhatsappAccount } from "./context.ts";
import { loadAlertsEnabled, sendThroughGate, type SendOutcome, type Senders } from "./send-core.ts";
import { MEETING_CHANGED_REASON, meetingStillValid, reminderMeeting } from "./meeting-guard.ts";
import { renderMessage } from "./template.ts";

export type NotifyFn = (input: { organizationId: string; type: "automation"; userIds: string[]; title: string; body?: string; url?: string; dedupeKey?: string; logNoDevice?: boolean }) => Promise<{ configured?: boolean; targeted: number; accepted: number; noDevice: number; duplicates: number }>;

export type MessageActionDeps = {
  db: any;
  senders: Senders;
  notify: NotifyFn;
  managers: (organizationId: string) => Promise<string[]>;
  random?: () => number;
  now?: () => Date;
};

export const PROMO_FOOTER = "\n\nلإيقاف الرسائل الترويجية ردّ بكلمة: إيقاف";
export const ALERTS_OFF_REASON = "تنبيهات الفريق مطفأة لهذه المؤسسة (إعدادات الأتمتة)";

/** A meeting reminder must not be held past the start of the meeting. */
const notAfter = (trigger: Record<string, unknown> | undefined): Date | null => {
  const m = reminderMeeting(trigger);
  return m ? new Date(m.startsAt) : null;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** «Once per customer»: true when this same step already sent (or holds) a message to this customer within the last N days. */
export async function alreadySentToContact(db: any, input: { organizationId: string; workflowId: string; stepId?: string | null; contactId: string | null; days: number; now: Date }): Promise<boolean> {
  if (!(input.days > 0) || !input.contactId) return false;
  const since = new Date(input.now.getTime() - input.days * 86_400_000).toISOString();
  let q = db.from("wf_message_log").select("id").eq("organization_id", input.organizationId).eq("workflow_id", input.workflowId).eq("contact_id", input.contactId).in("status", ["sent", "sending", "deferred"]).gte("created_at", since).limit(1);
  if (input.stepId) q = q.eq("step_id", input.stepId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
const ONCE_REASON = "أُرسلت هذه الرسالة لهذا العميل من قبل (مرة واحدة لكل عميل)";

function fromOutcome(o: SendOutcome, extra: Record<string, unknown>): ActionResult {
  if (o.status === "failed") return { ok: false, error: o.reason ?? "فشل الإرسال", output: { outcome: "failed", code: o.code, reason: o.reason, log_id: o.logId, ...extra } };
  return { ok: true, output: { outcome: o.status, code: o.code, reason: o.reason, log_id: o.logId, ...(o.notBefore ? { not_before: o.notBefore } : {}), ...extra } };
}

export function createMessageActions(deps: MessageActionDeps): Record<"message.whatsapp" | "message.email" | "notify.staff", ActionHandler> {
  const { db } = deps;
  const clock = () => deps.now?.() ?? new Date();
  const dedupe = (ctx: { workflowId: string; runId: string; stepId?: string }) => `${ctx.workflowId}:${ctx.stepId ?? "step"}:${ctx.runId}`;

  const whatsapp: ActionHandler = async (config, ctx) => {
    const message = await loadMessageContext(db, ctx.organizationId, ctx.triggerPayload, config);
    const kind = config.kind === "promo" ? "promo" : "service";
    if (await alreadySentToContact(db, { organizationId: ctx.organizationId, workflowId: ctx.workflowId, stepId: ctx.stepId, contactId: message.contactId, days: Number(config.once_per_contact_days ?? 0), now: clock() })) return { ok: true, output: { outcome: "skipped", code: "once_per_contact", reason: ONCE_REASON, channel: "whatsapp", kind } };
    if (!(await meetingStillValid(db, ctx.organizationId, ctx.triggerPayload, clock()))) return { ok: true, output: { outcome: "skipped", code: "meeting_changed", reason: MEETING_CHANGED_REASON, channel: "whatsapp", kind } };
    const rendered = renderMessage(String(config.body ?? ""), message.vars, deps.random);
    const outcome = await sendThroughGate(
      { db, senders: deps.senders, now: clock() },
      {
        organizationId: ctx.organizationId, workflowId: ctx.workflowId, runId: ctx.runId, stepId: ctx.stepId ?? null,
        opportunityId: message.opportunityId, contactId: message.contactId, channel: "whatsapp", kind,
        to: message.phone, accountId: pickWhatsappAccount(config.account, message, str(config.channel_account_id)),
        body: rendered ? rendered + (kind === "promo" ? PROMO_FOOTER : "") : "", dedupeKey: dedupe(ctx), allowFirstContact: config.allow_first_contact === true, notAfter: notAfter(ctx.triggerPayload),
      },
    );
    return fromOutcome(outcome, { channel: "whatsapp", kind });
  };

  const email: ActionHandler = async (config, ctx) => {
    const message = await loadMessageContext(db, ctx.organizationId, ctx.triggerPayload, config);
    const kind = config.kind === "promo" ? "promo" : "service";
    if (await alreadySentToContact(db, { organizationId: ctx.organizationId, workflowId: ctx.workflowId, stepId: ctx.stepId, contactId: message.contactId, days: Number(config.once_per_contact_days ?? 0), now: clock() })) return { ok: true, output: { outcome: "skipped", code: "once_per_contact", reason: ONCE_REASON, channel: "email", kind } };
    if (!(await meetingStillValid(db, ctx.organizationId, ctx.triggerPayload, clock()))) return { ok: true, output: { outcome: "skipped", code: "meeting_changed", reason: MEETING_CHANGED_REASON, channel: "email", kind } };
    const body = renderMessage(String(config.body ?? ""), message.vars, deps.random);
    const outcome = await sendThroughGate(
      { db, senders: deps.senders, now: clock() },
      {
        organizationId: ctx.organizationId, workflowId: ctx.workflowId, runId: ctx.runId, stepId: ctx.stepId ?? null,
        opportunityId: message.opportunityId, contactId: message.contactId, channel: "email", kind, to: message.email,
        subject: renderMessage(String(config.subject ?? ""), message.vars, deps.random), body: body ? body + (kind === "promo" ? PROMO_FOOTER : "") : "",
        dedupeKey: dedupe(ctx), allowFirstContact: config.allow_first_contact === true, notAfter: notAfter(ctx.triggerPayload),
      },
    );
    return fromOutcome(outcome, { channel: "email", kind });
  };

  const staff: ActionHandler = async (config, ctx) => {
    if (!(await loadAlertsEnabled(db, ctx.organizationId))) return { ok: true, output: { outcome: "skipped", code: "alerts_off", reason: ALERTS_OFF_REASON } };
    const message = await loadMessageContext(db, ctx.organizationId, ctx.triggerPayload, config);
    const to = config.to ?? "assignee";
    const userIds = to === "managers" ? await deps.managers(ctx.organizationId) : to === "users" ? ((config.user_ids as string[] | undefined) ?? []) : message.ownerId ? [message.ownerId] : [];
    if (!userIds.length) return { ok: true, output: { outcome: "skipped", code: "no_recipient", reason: "لا يوجد موظف يصله التنبيه (لا مندوب مسؤول عن التذكرة)" } };
    const title = renderMessage(String(config.title ?? ""), message.vars, deps.random);
    const body = renderMessage(String(config.body ?? ""), message.vars, deps.random);
    const result = await deps.notify({
      organizationId: ctx.organizationId, type: "automation", userIds, title, body,
      url: str(config.url) ?? (message.opportunityId ? `/pipeline/${message.opportunityId}` : "/pipeline"),
      dedupeKey: `wf:${dedupe(ctx)}`, logNoDevice: true,
    });
    const reached = result.accepted + result.noDevice > 0;
    const code = reached ? null : result.duplicates > 0 ? "duplicate" : "no_delivery";
    const reason = reached ? null : result.duplicates > 0 ? "سبق إرسال هذا التنبيه لنفس الحدث" : "لم يصل التنبيه لأحد (الإشعارات غير مفعّلة أو لا أجهزة)";
    return { ok: true, output: { outcome: reached ? "sent" : "skipped", code, reason, targeted: result.targeted, accepted: result.accepted, no_device: result.noDevice } };
  };

  return { "message.whatsapp": whatsapp, "message.email": email, "notify.staff": staff };
}
