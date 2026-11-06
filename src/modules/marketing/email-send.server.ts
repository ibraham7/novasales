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

export async function tickEmailCampaigns(): Promise<{ processed: number }> {
  const { configured } = emailConfig();
  const base = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!configured || !base) return { processed: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { runEmailTick, EMAIL_DEFAULT_DAILY_CAP } = await import("./email-core");
  return runEmailTick(db, {
    send: sendViaResend,
    stopBaseUrl: base,
    dailyCap: Number(process.env.EMAIL_DAILY_CAP) || EMAIL_DEFAULT_DAILY_CAP,
    orgName: async (organizationId) => {
      const { data } = await db.from("organizations").select("name").eq("id", organizationId).maybeSingle();
      return (data?.name as string | undefined) ?? "";
    },
  });
}
