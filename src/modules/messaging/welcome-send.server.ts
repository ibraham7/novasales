// Server-only helper. Assignments/CRM modules call this instead of touching
// the WhatsApp/Evolution modules directly. `.server.ts` blocks client bundling.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { opSendText } from "@/modules/channels/whatsapp/channel-ops.server";
import { resolveAccountProvider } from "@/modules/channels/whatsapp/registry.server";

const db = supabaseAdmin as any;

export interface SendWelcomeInput {
  organizationId: string;
  opportunityId: string;
  contactId: string;
  sendingAccountId: string;
  renderedText: string;
  sentByUserId?: string | null;
}

export interface SendWelcomeResult {
  ok: boolean;
  sessionId?: string;
  sent: boolean;
  reason?: string;
}

/**
 * Sends a welcome message via WhatsApp/Evolution AND records the outbound
 * message + session link in messaging + crm_opportunity_sessions.
 * Never throws for send failures — returns { sent:false, reason }.
 */
export async function sendWelcomeMessage(input: SendWelcomeInput): Promise<SendWelcomeResult> {
  // Look up phone
  const { data: cp } = await db
    .from("crm_contact_points")
    .select("identifier")
    .eq("contact_id", input.contactId)
    .eq("channel_type", "whatsapp")
    .maybeSingle();
  const phone: string | undefined = cp?.identifier;
  if (!phone) return { ok: false, sent: false, reason: "no_phone" };

  const { data: acc } = await db
    .from("msg_channel_accounts")
    .select("id, external_ref")
    .eq("id", input.sendingAccountId)
    .maybeSingle();
  if (!acc?.external_ref) return { ok: false, sent: false, reason: "account_unavailable" };

  // Attempt send (best-effort)
  let sent = false;
  let sendReason: string | undefined;
  try {
    const ref = await resolveAccountProvider(acc.id);
    if (ref.provider.isConfigured()) {
      await opSendText(acc.id, phone.replace(/\D/g, ""), input.renderedText);
      sent = true;
    } else {
      sendReason = "provider_unconfigured";
    }
  } catch (e) {
    console.error("[sendWelcomeMessage] send failed", e);
    sendReason = e instanceof Error ? e.message : "send_failed";
  }

  // Record session + outbound message
  const remoteJid = `${phone}@s.whatsapp.net`;
  const { data: existing } = await db
    .from("msg_sessions")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("channel_account_id", input.sendingAccountId)
    .eq("peer_identifier", remoteJid)
    .maybeSingle();
  let sessionId: string | undefined = existing?.id;
  const preview = input.renderedText.slice(0, 500);
  const now = new Date().toISOString();
  if (!sessionId) {
    const { data: newSess } = await db
      .from("msg_sessions")
      .insert({
        organization_id: input.organizationId,
        channel_account_id: input.sendingAccountId,
        external_thread_id: remoteJid,
        peer_identifier: remoteJid,
        last_message_preview: preview,
        last_message_at: now,
      })
      .select("id")
      .single();
    sessionId = newSess?.id;
  } else {
    await db
      .from("msg_sessions")
      .update({ last_message_preview: preview, last_message_at: now })
      .eq("id", sessionId);
  }
  if (sessionId) {
    const { error: msgErr } = await db.from("msg_messages").insert({
      organization_id: input.organizationId,
      session_id: sessionId,
      direction: "outbound",
      message_type: "text",
      content: input.renderedText,
      status: sent ? "sent" : "failed",
      sent_by_user_id: input.sentByUserId ?? null,
    });
    if (msgErr) console.error("[sendWelcomeMessage] message insert failed", msgErr);
    await db
      .from("crm_opportunity_sessions")
      .insert({
        organization_id: input.organizationId,
        opportunity_id: input.opportunityId,
        session_ref: sessionId,
        channel: "whatsapp",
      })
      .select()
      .maybeSingle()
      .then(
        () => {},
        () => {}
      );
  }

  return { ok: true, sessionId, sent, reason: sendReason };
}
