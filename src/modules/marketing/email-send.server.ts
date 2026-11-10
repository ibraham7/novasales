/** Server-only: the mail provider (Resend) and the sender run that the minute timer calls. Never import from client code. */
import type { SendResult } from "./email-core";

export function emailConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  return { configured: Boolean(apiKey && from), apiKey, from, replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined };
}

export async function sendViaResend(mail: { to: string; subject: string; text: string; html: string; stopUrl: string }): Promise<SendResult> {
  const { apiKey, from, replyTo } = emailConfig();
  if (!apiKey || !from) return { ok: false, error: "الإيميل غير مُعدّ", retry: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        ...(replyTo ? { reply_to: replyTo } : {}),
        // One-click unsubscribe, as the large mailbox providers expect from bulk senders.
        headers: { "List-Unsubscribe": `<${mail.stopUrl.replace("/stop/", "/api/public/unsubscribe/")}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, id: typeof body?.id === "string" ? body.id : null };
    const message = String(body?.message ?? body?.error ?? `HTTP ${res.status}`);
    // Busy or provider-side trouble: wait and try again. Anything else is a refusal of this address or message.
    return { ok: false, error: message, retry: res.status === 429 || res.status >= 500 };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "AbortError" ? "انتهت مهلة المزوّد" : e instanceof Error ? e.message : "تعذر الاتصال بالمزوّد", retry: true };
  } finally {
    clearTimeout(timer);
  }
}

export const mailboxSecret = () => process.env.MAILBOX_ENCRYPTION_KEY?.trim() ?? "";

/** Sends through the organization's own mailbox over SMTP. Settings are loaded once per minute-run per mailbox. */
function mailboxSender(db: any) {
  const cache = new Map<string, Promise<Awaited<ReturnType<typeof import("./mailbox-core")["loadMailbox"]>>>>();
  const load = async (organizationId: string, mailboxId: string) => {
    const key = `${organizationId}:${mailboxId}`;
    if (!cache.has(key)) cache.set(key, import("./mailbox-core").then((m) => m.loadMailbox(db, { secret: mailboxSecret() }, organizationId, mailboxId)));
    return cache.get(key)!;
  };
  const send = async (mail: { to: string; subject: string; text: string; html: string; stopUrl: string; organizationId: string; mailboxId: string | null; messageId: string }): Promise<SendResult> => {
    if (!mail.mailboxId) return { ok: false, error: "لا يوجد صندوق بريد للحملة" };
    let box;
    try {
      box = await load(mail.organizationId, mail.mailboxId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "تعذر قراءة إعدادات الصندوق" };
    }
    if (!box) return { ok: false, error: "صندوق البريد محذوف أو معطّل" };
    const { smtpSend } = await import("./smtp");
    const domain = box.fromEmail.split("@")[1] ?? "novasales.local";
    const messageId = mail.messageId.replace(/@.*$/, "") + "@" + domain;
    const unsubscribe = mail.stopUrl.replace("/stop/", "/api/public/unsubscribe/");
    const r = await smtpSend(box.smtp, {
      from: { name: box.fromName, email: box.fromEmail },
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      messageId,
      headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    if (r.ok) return { ok: true, id: messageId };
    if (r.auth) {
      await db.from("ob_mailboxes").update({ status: "error", last_error: r.error.slice(0, 300) }).eq("organization_id", mail.organizationId).eq("id", mail.mailboxId);
      return { ok: false, error: "رفض الخادم تسجيل الدخول؛ حدّث كلمة سر الصندوق", retry: true };
    }
    return { ok: false, error: r.error, retry: r.retry };
  };
  const limit = async (organizationId: string, mailboxId: string): Promise<number | null> => {
    try {
      const box = await load(organizationId, mailboxId);
      return box ? box.dailyLimit : null;
    } catch {
      return null;
    }
  };
  return { send, limit };
}

export async function tickEmailCampaigns(): Promise<{ processed: number }> {
  const { configured } = emailConfig();
  const base = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!base || (!configured && !mailboxSecret())) return { processed: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { runEmailTick, EMAIL_DEFAULT_DAILY_CAP } = await import("./email-core");
  const box = mailboxSender(db);
  return runEmailTick(db, {
    send: (mail) => (mail.mailboxId ? box.send(mail) : configured ? sendViaResend(mail) : Promise.resolve({ ok: false, error: "الإيميل غير مُعدّ", retry: true })),
    mailboxLimit: box.limit,
    stopBaseUrl: base,
    dailyCap: Number(process.env.EMAIL_DAILY_CAP) || EMAIL_DEFAULT_DAILY_CAP,
    orgName: async (organizationId) => {
      const { data } = await db.from("organizations").select("name").eq("id", organizationId).maybeSingle();
      return (data?.name as string | undefined) ?? "";
    },
  });
}
