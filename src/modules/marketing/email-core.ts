/**
 * Outbound email: who may be emailed, the final approval, sending in small batches, the unsubscribe
 * link and what bounces and complaints do. The database and the mail provider are passed in, so all
 * of it is tested without Supabase or a real mailbox.
 */
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { logEvent } from "./outbound-core.ts";

const CHUNK = 100;
const chunks = <T>(items: T[], size = CHUNK) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

export const EMAIL_MAX_RECIPIENTS = 200;
export const EMAIL_MAX_THROTTLE = 30;
export const EMAIL_DEFAULT_DAILY_CAP = 100;
const STUCK_MINUTES = 10;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
export const normalizeEmail = (value: unknown): string | null => {
  const email = String(value ?? "").trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
};
export const newEmailToken = () => randomBytes(18).toString("base64url");

/* ------------------------------ do-not-send list ------------------------------ */

export async function blockedEmails(db: any, organizationId: string, emails: string[]): Promise<Set<string>> {
  const blocked = new Set<string>();
  for (const part of chunks([...new Set(emails.filter(Boolean))])) {
    const { data, error } = await db.from("ob_suppressions").select("identifier").eq("organization_id", organizationId).eq("channel", "email").in("identifier", part);
    if (error) {
      if (MISSING_TABLE.has(error.code)) return blocked;
      throw new Error(error.message);
    }
    for (const row of data ?? []) blocked.add(row.identifier);
  }
  return blocked;
}

export async function addEmailSuppression(db: any, organizationId: string, email: string, info: { source: "keyword" | "link" | "manual" | "import"; reason: string }) {
  const { error } = await db.from("ob_suppressions").upsert(
    { organization_id: organizationId, channel: "email", identifier: email, reason: info.reason.slice(0, 200), source: info.source },
    { onConflict: "organization_id,channel,identifier", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
}

/* ---------------------------------- audience ---------------------------------- */

export type EmailAudience = {
  eligible: { id: string; name: string; email: string }[];
  excluded: { noEmail: number; suppressed: number; inOtherCampaign: number; duplicateEmail: number };
  approved: number;
};

/** Approved businesses with a usable email that can be emailed now, and why the others cannot. */
export async function emailAudience(db: any, organizationId: string, prospectIds?: string[]): Promise<EmailAudience> {
  let query = db.from("ob_prospects").select("id,name,emails").eq("organization_id", organizationId).eq("status", "approved").limit(5000);
  if (prospectIds?.length) query = query.in("id", prospectIds);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows: { id: string; name: string; emails: unknown }[] = data ?? [];

  const waiting = new Set<string>();
  for (const part of chunks(rows.map((r) => r.id))) {
    const { data: pending, error: pendingError } = await db.from("ob_email_messages").select("ob_prospect_id").eq("organization_id", organizationId).in("ob_prospect_id", part).in("status", ["queued", "sending"]);
    if (pendingError && !MISSING_TABLE.has(pendingError.code)) throw new Error(pendingError.message);
    for (const row of pending ?? []) waiting.add(row.ob_prospect_id);
  }
  const candidates = rows.map((r) => ({ ...r, email: (Array.isArray(r.emails) ? r.emails : []).map(normalizeEmail).find(Boolean) ?? null }));
  const blocked = await blockedEmails(db, organizationId, candidates.map((c) => c.email ?? ""));

  const excluded = { noEmail: 0, suppressed: 0, inOtherCampaign: 0, duplicateEmail: 0 };
  const seen = new Set<string>();
  const eligible: EmailAudience["eligible"] = [];
  for (const c of candidates) {
    if (!c.email) excluded.noEmail++;
    else if (blocked.has(c.email)) excluded.suppressed++;
    else if (waiting.has(c.id)) excluded.inOtherCampaign++;
    else if (seen.has(c.email)) excluded.duplicateEmail++;
    else {
      seen.add(c.email);
      eligible.push({ id: c.id, name: c.name, email: c.email });
    }
  }
  return { eligible, excluded, approved: rows.length };
}

/* ------------------------------ final approval ------------------------------ */

export type EmailCampaignInput = {
  organizationId: string;
  userId: string;
  name: string;
  subject: string;
  body: string;
  prospectIds?: string[];
  scheduledAt?: string | null;
  throttlePerMinute: number;
  acknowledgments: { b2b: boolean; optOut: boolean; review: boolean };
};
export type EmailCampaignDeps = {
  /** Whether a mail provider and a sender address are configured. */
  configured: boolean;
  /** Site address for the unsubscribe link; email is refused without it. */
  stopBaseUrl?: string;
  now?: () => Date;
  maxRecipients?: number;
  maxThrottle?: number;
  from?: string;
};

export async function createEmailCampaign(db: any, deps: EmailCampaignDeps, input: EmailCampaignInput) {
  const now = (deps.now ?? (() => new Date()))();
  if (!input.acknowledgments.b2b || !input.acknowledgments.optOut || !input.acknowledgments.review) throw new Error("أكّد كل بنود الاعتماد قبل المتابعة");
  if (!deps.configured) throw new Error("الإيميل غير مُعدّ على الخادم (مزوّد الإرسال وعنوان المرسل)؛ تواصل مع مدير النظام");
  if (!deps.stopBaseUrl) throw new Error("عنوان الموقع (PUBLIC_APP_URL) غير مضبوط؛ لا يُرسل إيميل بدون رابط إلغاء الاشتراك");
  const name = input.name.trim();
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!name) throw new Error("اكتب اسم الحملة");
  if (!subject) throw new Error("اكتب عنوان الرسالة");
  if (subject.length > 200) throw new Error("عنوان الرسالة طويل؛ الحد الأقصى 200 حرف");
  if (!body) throw new Error("اكتب نص الرسالة");
  if (body.length > 5000) throw new Error("نص الرسالة طويل؛ الحد الأقصى 5000 حرف");
  const vars = [...`${subject} ${body}`.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
  if (vars.some((v) => v !== "name")) throw new Error("الرسالة تدعم متغير {{name}} فقط حالياً");
  let scheduledAt = now.toISOString();
  if (input.scheduledAt) {
    const time = Date.parse(input.scheduledAt);
    if (!Number.isFinite(time) || time <= now.getTime()) throw new Error("اختر موعداً صحيحاً في المستقبل أو اتركه فارغاً للبدء الآن");
    scheduledAt = new Date(time).toISOString();
  }

  const audience = await emailAudience(db, input.organizationId, input.prospectIds);
  if (audience.eligible.length === 0) throw new Error("لا توجد جهات معتمدة لها بريد صالح للإرسال");
  const maxRecipients = deps.maxRecipients ?? EMAIL_MAX_RECIPIENTS;
  if (audience.eligible.length > maxRecipients) throw new Error(`الحد الأقصى ${maxRecipients} مستلماً للحملة الواحدة؛ اختر عدداً أقل`);
  const throttle = Math.max(1, Math.min(Math.floor(input.throttlePerMinute) || 1, deps.maxThrottle ?? EMAIL_MAX_THROTTLE));

  const snapshot = {
    approvedAt: now.toISOString(),
    approvedBy: input.userId,
    from: deps.from ?? null,
    recipients: audience.eligible.length,
    approved: audience.approved,
    excluded: audience.excluded,
    acknowledgments: input.acknowledgments,
  };
  const { data: campaign, error } = await db
    .from("ob_email_campaigns")
    .insert({ organization_id: input.organizationId, name: name.slice(0, 200), subject, body, status: "scheduled", scheduled_at: scheduledAt, throttle_per_minute: throttle, created_by: input.userId, approved_by: input.userId, approved_at: now.toISOString(), compliance_snapshot: snapshot })
    .select("id")
    .single();
  if (error || !campaign) throw new Error("تعذر إنشاء الحملة؛ أعد المحاولة");

  for (const part of chunks(audience.eligible)) {
    const { error: insertError } = await db.from("ob_email_messages").insert(
      part.map((p) => ({ organization_id: input.organizationId, campaign_id: campaign.id, ob_prospect_id: p.id, email: p.email, name: p.name, stop_token: newEmailToken(), status: "queued" })),
    );
    if (insertError) {
      // A half-built campaign must never run.
      await db.from("ob_email_messages").delete().eq("campaign_id", campaign.id).eq("organization_id", input.organizationId);
      await db.from("ob_email_campaigns").delete().eq("id", campaign.id).eq("organization_id", input.organizationId);
      throw new Error("تعذر تجهيز المستلمين؛ لم تُنشأ الحملة");
    }
  }
  await logEvent(db, input.organizationId, input.userId, "email_campaign_approved", "email_campaign", campaign.id, snapshot);
  return { campaignId: campaign.id as string, recipients: audience.eligible.length, excluded: audience.excluded };
}

export const EMAIL_DELETABLE_STATUSES = ["completed", "cancelled", "failed"];

export async function controlEmailCampaign(db: any, organizationId: string, id: string, action: "pause" | "resume" | "cancel") {
  const from = action === "pause" ? ["scheduled", "running"] : action === "resume" ? ["paused"] : ["scheduled", "running", "paused"];
  const to = action === "pause" ? "paused" : action === "resume" ? "running" : "cancelled";
  const { data, error } = await db.from("ob_email_campaigns").update({ status: to, ...(action === "cancel" ? { finished_at: new Date().toISOString() } : {}) }).eq("organization_id", organizationId).eq("id", id).in("status", from).select("id");
  if (error) throw new Error(error.message);
  if (!(data ?? []).length) throw new Error("لا يمكن تنفيذ هذا الإجراء على حالة الحملة الحالية");
  if (action === "cancel") await db.from("ob_email_messages").update({ status: "skipped", error: "أُلغيت الحملة" }).eq("organization_id", organizationId).eq("campaign_id", id).eq("status", "queued");
}

export async function deleteEmailCampaign(db: any, organizationId: string, id: string) {
  const { data, error } = await db.from("ob_email_campaigns").select("id,status").eq("organization_id", organizationId).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("الحملة غير موجودة");
  if (!EMAIL_DELETABLE_STATUSES.includes(data.status)) throw new Error("ألغِ الحملة أولاً ثم احذفها");
  const { error: deleteError } = await db.from("ob_email_campaigns").delete().eq("organization_id", organizationId).eq("id", id);
  if (deleteError) throw new Error(deleteError.message);
}

/* --------------------------------- the message --------------------------------- */

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (text: string, name: string) => text.replace(/\{\{\s*name\s*\}\}/g, name);
// A subject is one line: nobody can smuggle a header in through a business name.
const oneLine = (text: string) => text.replace(/[\r\n]+/g, " ").trim();

export function renderEmail(input: { subject: string; body: string; name: string; sender: string; stopUrl: string }) {
  const name = oneLine(input.name);
  const text = `${fill(input.body, name)}\n\n--\n${input.sender}\nلإلغاء الاشتراك وعدم استلام رسائل أخرى: ${input.stopUrl}`;
  const html =
    `<div dir="auto" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#111">` +
    fill(escapeHtml(input.body), escapeHtml(name)).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("") +
    `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px">` +
    `<p style="font-size:12px;color:#666">${escapeHtml(input.sender)}<br>لإلغاء الاشتراك وعدم استلام رسائل أخرى: <a href="${escapeHtml(input.stopUrl)}">اضغط هنا</a></p></div>`;
  return { subject: oneLine(fill(input.subject, name)).slice(0, 200), text, html };
}

/* -------------------------------- sending in batches -------------------------------- */

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string; retry?: boolean };
export type EmailTickDeps = {
  send: (mail: { to: string; subject: string; text: string; html: string; stopUrl: string }) => Promise<SendResult>;
  stopBaseUrl: string;
  orgName: (organizationId: string) => Promise<string>;
  dailyCap?: number;
  now?: () => Date;
};

/**
 * One run of the sender: starts campaigns that are due, then sends a small batch of each running
 * campaign, never above its per-minute limit or the organization's daily cap.
 */
export async function runEmailTick(db: any, deps: EmailTickDeps) {
  const now = (deps.now ?? (() => new Date()))();
  const stamp = now.toISOString();
  const cap = deps.dailyCap ?? EMAIL_DEFAULT_DAILY_CAP;
  let processed = 0;

  const start = await db.from("ob_email_campaigns").update({ status: "running", started_at: stamp }).eq("status", "scheduled").lte("scheduled_at", stamp);
  if (start.error) {
    if (MISSING_TABLE.has(start.error.code)) return { processed };
    throw new Error(start.error.message);
  }
  const { data: campaigns, error } = await db.from("ob_email_campaigns").select("id,organization_id,subject,body,throttle_per_minute").eq("status", "running").order("created_at").limit(50);
  if (error) throw new Error(error.message);

  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const left = new Map<string, number>();
  const names = new Map<string, string>();

  for (const c of campaigns ?? []) {
    const org: string = c.organization_id;
    // A send that never finished is not retried automatically: it may have gone out.
    await db.from("ob_email_messages").update({ status: "failed", error: "انقطع التنفيذ؛ تحقق من لوحة المزوّد قبل إعادة الإرسال" }).eq("organization_id", org).eq("campaign_id", c.id).eq("status", "sending").lt("claimed_at", new Date(now.getTime() - STUCK_MINUTES * 60_000).toISOString());

    if (!left.has(org)) {
      const { data: today, error: todayError } = await db.from("ob_email_messages").select("id").eq("organization_id", org).gte("sent_at", dayStart).limit(cap + 1);
      if (todayError) throw new Error(todayError.message);
      left.set(org, Math.max(0, cap - (today ?? []).length));
    }
    const allowed = Math.min(c.throttle_per_minute, left.get(org) ?? 0);
    if (allowed > 0) {
      const { data: queued, error: queuedError } = await db.from("ob_email_messages").select("id").eq("organization_id", org).eq("campaign_id", c.id).eq("status", "queued").order("created_at").limit(allowed);
      if (queuedError) throw new Error(queuedError.message);
      const ids = (queued ?? []).map((m: any) => m.id);
      if (ids.length) {
        // Only rows still «queued» are taken, so two runs never send the same email.
        const { data: claimed, error: claimError } = await db.from("ob_email_messages").update({ status: "sending", claimed_at: stamp }).eq("organization_id", org).in("id", ids).eq("status", "queued").select("id,email,name,stop_token,ob_prospect_id");
        if (claimError) throw new Error(claimError.message);
        const blocked = await blockedEmails(db, org, (claimed ?? []).map((m: any) => m.email));
        if (!names.has(org)) names.set(org, await deps.orgName(org));
        for (const m of claimed ?? []) {
          if (blocked.has(m.email)) {
            await db.from("ob_email_messages").update({ status: "skipped", error: "في قائمة لا ترسل" }).eq("id", m.id).eq("organization_id", org).eq("status", "sending");
            continue;
          }
          const stopUrl = `${deps.stopBaseUrl.replace(/\/$/, "")}/stop/${m.stop_token}`;
          const mail = renderEmail({ subject: c.subject, body: c.body, name: m.name ?? "", sender: names.get(org) || "", stopUrl });
          let result: SendResult;
          try {
            result = await deps.send({ to: m.email, ...mail, stopUrl });
          } catch (e) {
            result = { ok: false, error: e instanceof Error ? e.message : "تعذر الإرسال", retry: true };
          }
          if (result.ok) {
            await db.from("ob_email_messages").update({ status: "sent", sent_at: (deps.now ?? (() => new Date()))().toISOString(), provider_message_id: result.id, error: null }).eq("id", m.id).eq("organization_id", org).eq("status", "sending");
            if (m.ob_prospect_id) await db.from("ob_prospects").update({ status: "contacted", updated_at: stamp }).eq("organization_id", org).eq("id", m.ob_prospect_id).eq("status", "approved");
            left.set(org, (left.get(org) ?? 1) - 1);
            processed++;
          } else if (result.retry) {
            // The provider is busy or unreachable: this and the rest of the batch wait for the next run.
            await db.from("ob_email_messages").update({ status: "queued", claimed_at: null, error: result.error.slice(0, 300) }).eq("organization_id", org).eq("campaign_id", c.id).eq("status", "sending");
            break;
          } else {
            await db.from("ob_email_messages").update({ status: "failed", error: result.error.slice(0, 300) }).eq("id", m.id).eq("organization_id", org).eq("status", "sending");
          }
        }
      }
    }
    const { data: open } = await db.from("ob_email_messages").select("id").eq("organization_id", org).eq("campaign_id", c.id).in("status", ["queued", "sending"]).limit(1);
    if (!(open ?? []).length) await db.from("ob_email_campaigns").update({ status: "completed", finished_at: stamp }).eq("id", c.id).eq("organization_id", org).eq("status", "running");
  }
  return { processed };
}

/* ------------------------------ unsubscribe and provider events ------------------------------ */

/** The recipient pressed the unsubscribe link of an email. Returns false for an unknown token. */
export async function handleEmailStop(db: any, token: string, now = new Date()) {
  const { data, error } = await db.from("ob_email_messages").select("id,organization_id,ob_prospect_id,campaign_id,email").eq("stop_token", token).limit(1);
  if (error) {
    if (MISSING_TABLE.has(error.code)) return { ok: false as const };
    throw new Error(error.message);
  }
  const m = data?.[0];
  if (!m) return { ok: false as const };
  await addEmailSuppression(db, m.organization_id, m.email, { source: "link", reason: "ضغط رابط إلغاء الاشتراك" });
  if (m.ob_prospect_id) await db.from("ob_prospects").update({ status: "opted_out", updated_at: now.toISOString() }).eq("organization_id", m.organization_id).eq("id", m.ob_prospect_id).in("status", ["new", "review", "qualified", "approved", "contacted", "replied", "interested"]);
  await db.from("ob_email_messages").update({ replied_at: now.toISOString() }).eq("id", m.id).is("replied_at", null);
  await logEvent(db, m.organization_id, null, "opt_out", "prospect", m.ob_prospect_id, { email: m.email, campaignId: m.campaign_id, via: "email_link" });
  return { ok: true as const };
}

export type ProviderEvent = { type: string; providerMessageId: string; at?: Date };

/** A delivery, bounce or complaint reported by the mail provider. A bounce or complaint blocks the address for good. */
export async function handleProviderEvent(db: any, event: ProviderEvent) {
  const { data, error } = await db.from("ob_email_messages").select("id,organization_id,ob_prospect_id,email,campaign_id,status").eq("provider_message_id", event.providerMessageId).limit(1);
  if (error) {
    if (MISSING_TABLE.has(error.code)) return { handled: false as const };
    throw new Error(error.message);
  }
  const m = data?.[0];
  if (!m) return { handled: false as const };
  const at = (event.at ?? new Date()).toISOString();
  if (event.type === "email.delivered") {
    await db.from("ob_email_messages").update({ status: "delivered", delivered_at: at }).eq("id", m.id).eq("status", "sent");
  } else if (event.type === "email.bounced" || event.type === "email.complained") {
    const complaint = event.type === "email.complained";
    await db.from("ob_email_messages").update({ status: complaint ? "complained" : "bounced", error: complaint ? "اشتكى المستلم" : "ارتدّ الإيميل" }).eq("id", m.id);
    await addEmailSuppression(db, m.organization_id, m.email, { source: "keyword", reason: complaint ? "اشتكى المستلم" : "ارتدّ الإيميل" });
    if (complaint && m.ob_prospect_id) await db.from("ob_prospects").update({ status: "opted_out", updated_at: at }).eq("organization_id", m.organization_id).eq("id", m.ob_prospect_id).in("status", ["new", "review", "qualified", "approved", "contacted", "replied", "interested"]);
    await logEvent(db, m.organization_id, null, complaint ? "email_complaint" : "email_bounce", "prospect", m.ob_prospect_id, { email: m.email, campaignId: m.campaign_id });
  } else return { handled: false as const };
  return { handled: true as const };
}

/** Checks a Svix-style webhook signature (used by Resend): HMAC-SHA256 of «id.timestamp.body». */
export function verifyWebhookSignature(input: { secret: string; id: string | null; timestamp: string | null; signature: string | null; body: string; now?: Date }): boolean {
  if (!input.secret || !input.id || !input.timestamp || !input.signature) return false;
  const seconds = Number(input.timestamp);
  const now = (input.now ?? new Date()).getTime() / 1000;
  if (!Number.isFinite(seconds) || Math.abs(now - seconds) > 300) return false;
  const key = Buffer.from(input.secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${input.id}.${input.timestamp}.${input.body}`).digest();
  return input.signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
