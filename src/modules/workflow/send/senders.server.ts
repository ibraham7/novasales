/**
 * The two real senders behind the gate. Server-only. They are only called when the gate says «send», which needs the
 * organization's automatic sending switched ON. WhatsApp keeps the existing number-health checks (risk guard) and records
 * the message in the ticket's chat; email goes out through the organization's own mailbox (SMTP).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Senders, SenderResult } from "./send-core";

const db = supabaseAdmin as any;
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function sendWhatsapp(m: Parameters<Senders["whatsapp"]>[0]): Promise<SenderResult> {
  const { opSendText, sentExternalId } = await import("@/modules/channels/whatsapp/channel-ops.server");
  const { resolveAccountProvider } = await import("@/modules/channels/whatsapp/registry.server");
  const risk = await import("@/modules/risk/risk.server");

  const { data: acc } = await db.from("msg_channel_accounts").select("id,external_ref").eq("id", m.accountId).eq("organization_id", m.organizationId).maybeSingle();
  if (!acc?.external_ref) return { ok: false, error: "حساب واتساب غير متاح" };
  const remoteJid = `${m.to}@s.whatsapp.net`;
  const { data: known } = await db.from("msg_sessions").select("id").eq("organization_id", m.organizationId).eq("channel_account_id", m.accountId).eq("peer_identifier", remoteJid).maybeSingle();

  // The number's health rules (observation window, quotas, circuit breaker) apply to automatic messages too.
  const guard = await risk.riskGuard({ orgId: m.organizationId, accountId: m.accountId, source: "automation" as any, peer: remoteJid, isNewConversation: !known });
  if (!guard.allowed) return { ok: false, error: guard.reason ?? "منعت طبقة حماية الرقم هذه الرسالة" };

  let externalId: string | null = null;
  try {
    const ref = await resolveAccountProvider(m.accountId);
    if (!ref.provider.isConfigured()) return { ok: false, error: "مزود واتساب غير مهيأ للإرسال" };
    externalId = sentExternalId(await opSendText(m.accountId, m.to, m.text));
    await risk.recordOutbound({ orgId: m.organizationId, accountId: m.accountId, isNewConversation: !known });
  } catch (e) {
    await risk.recordHealthEvent({ orgId: m.organizationId, accountId: m.accountId, eventType: "send_failed", detail: { error: (e as Error).message } });
    return { ok: false, error: (e as Error).message };
  }

  // The message is out; recording it in the chat must not turn a delivered message into a failure.
  try {
    const now = new Date().toISOString();
    let sessionId: string | undefined = known?.id;
    if (!sessionId) {
      const { data: created } = await db.from("msg_sessions").insert({ organization_id: m.organizationId, channel_account_id: m.accountId, external_thread_id: remoteJid, peer_identifier: remoteJid, last_message_preview: m.text.slice(0, 500), last_message_at: now }).select("id").single();
      sessionId = created?.id;
    } else {
      await db.from("msg_sessions").update({ last_message_preview: m.text.slice(0, 500), last_message_at: now }).eq("id", sessionId);
    }
    if (sessionId) {
      await db.from("msg_messages").insert({ organization_id: m.organizationId, session_id: sessionId, direction: "outbound", message_type: "text", content: m.text, status: "sent", external_id: externalId });
      // Same as the welcome message: link the chat to the ticket; a link that already exists is simply ignored.
      if (m.opportunityId) await db.from("crm_opportunity_sessions").insert({ organization_id: m.organizationId, opportunity_id: m.opportunityId, session_ref: sessionId, channel: "whatsapp" }).select().maybeSingle().then(() => {}, () => {});
    }
  } catch (e) {
    console.error("[automation] message sent but not recorded in the chat", e instanceof Error ? e.message : e);
  }
  return { ok: true };
}

async function sendEmail(m: Parameters<Senders["email"]>[0]): Promise<SenderResult> {
  const { loadMailbox } = await import("@/modules/marketing/mailbox-core");
  const { mailboxSecret } = await import("@/modules/marketing/email-send.server");
  const { smtpSend } = await import("@/modules/marketing/smtp");
  const { data: boxes } = await db.from("ob_mailboxes").select("id,status").eq("organization_id", m.organizationId).order("created_at", { ascending: true });
  const usable = (boxes ?? []).find((b: any) => b.status !== "disabled");
  if (!usable) return { ok: false, error: "لا يوجد صندوق بريد مربوط لهذه المؤسسة" };
  let box;
  try {
    box = await loadMailbox(db, { secret: mailboxSecret() }, m.organizationId, usable.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "تعذر قراءة إعدادات الصندوق" };
  }
  if (!box) return { ok: false, error: "صندوق البريد محذوف أو معطّل" };
  const domain = box.fromEmail.split("@")[1] ?? "novasales.local";
  const r = await smtpSend(box.smtp, {
    from: { name: box.fromName, email: box.fromEmail },
    to: m.to,
    subject: m.subject,
    text: m.text,
    html: `<div dir="auto" style="white-space:pre-wrap">${escapeHtml(m.text)}</div>`,
    messageId: `${crypto.randomUUID()}@${domain}`,
    headers: {},
  });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export const realSenders: Senders = { whatsapp: sendWhatsapp, email: sendEmail };
