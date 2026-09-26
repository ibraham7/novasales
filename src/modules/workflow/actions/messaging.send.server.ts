import { registerAction, type ActionHandler } from "./registry.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { opSendText } from "@/modules/channels/whatsapp/channel-ops.server";
import { resolveAccountProvider } from "@/modules/channels/whatsapp/registry.server";

const db = supabaseAdmin as any;

// messaging.send — { channel, channel_account_id, phone?, contact_id?, template_id?, template_version?, body?, variables? }
const messagingSend: ActionHandler = async (config, ctx) => {
  const channel = String(config.channel ?? "whatsapp");
  const accountId = String(config.channel_account_id ?? "");
  if (!accountId) return { ok: false, error: "channel_account_id required" };

  // Resolve phone
  let phone = config.phone as string | undefined;
  const contactId = (config.contact_id as string | undefined) ??
    (ctx.triggerPayload?.contact_id as string | undefined) ??
    (ctx.runContext?.contact_id as string | undefined);
  if (!phone && contactId) {
    const { data: cp } = await db
      .from("crm_contact_points")
      .select("identifier")
      .eq("contact_id", contactId)
      .eq("channel_type", channel)
      .maybeSingle();
    phone = cp?.identifier;
  }
  if (!phone) return { ok: false, error: "no_phone" };

  // Resolve text
  let body = config.body as string | undefined;
  if (!body && config.template_id) {
    const templateId = String(config.template_id);
    const version = Number(config.template_version ?? 0);
    const tv = version
      ? await db.from("cmp_template_versions").select("body,media_url").eq("template_id", templateId).eq("version", version).maybeSingle()
      : await db.from("cmp_templates").select("body,media_url").eq("id", templateId).maybeSingle();
    body = tv.data?.body;
  }
  if (!body) return { ok: false, error: "no_body" };

  // Variable interpolation ({{var}})
  const variables = (config.variables ?? {}) as Record<string, unknown>;
  body = body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => {
    const v = (variables[k] ?? (ctx.triggerPayload as any)?.[k]);
    return v == null ? "" : String(v);
  });

  // Load channel account for external_ref
  const { data: acc } = await db
    .from("msg_channel_accounts")
    .select("id, external_ref, organization_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!acc?.external_ref) return { ok: false, error: "account_unavailable" };

  // Risk layer: automated/cold outreach respects observation window, quotas and
  // the circuit breaker.
  const remoteJidForGuard = `${phone}@s.whatsapp.net`;
  const { data: knownSession } = await db
    .from("msg_sessions")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("channel_account_id", accountId)
    .eq("peer_identifier", remoteJidForGuard)
    .maybeSingle();
  const risk = await import("@/modules/risk/risk.server");
  const guard = await risk.riskGuard({
    orgId: ctx.organizationId,
    accountId,
    source: String(config.risk_source ?? "automation") as any,
    peer: remoteJidForGuard,
    isNewConversation: !knownSession,
  });
  if (!guard.allowed) return { ok: false, error: guard.reason ?? "risk_blocked" };

  let sent = false;
  let externalId: string | null = null;
  try {
    const ref = await resolveAccountProvider(accountId);
    if (ref.provider.isConfigured()) {
      const r: any = await opSendText(accountId, phone, body);
      sent = true;
      externalId = r?.key?.id ?? null;
      await risk.recordOutbound({ orgId: ctx.organizationId, accountId, isNewConversation: !knownSession });
    }
  } catch (e) {
    await risk.recordHealthEvent({
      orgId: ctx.organizationId,
      accountId,
      eventType: "send_failed",
      detail: { error: (e as Error).message },
    });
    return { ok: false, error: (e as Error).message };
  }


  // Record session + outbound message
  const remoteJid = `${phone}@s.whatsapp.net`;
  const { data: existing } = await db
    .from("msg_sessions")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("channel_account_id", accountId)
    .eq("peer_identifier", remoteJid)
    .maybeSingle();
  let sessionId: string | undefined = existing?.id;
  const now = new Date().toISOString();
  const preview = body.slice(0, 500);
  if (!sessionId) {
    const { data: s } = await db
      .from("msg_sessions")
      .insert({
        organization_id: ctx.organizationId,
        channel_account_id: accountId,
        external_thread_id: remoteJid,
        peer_identifier: remoteJid,
        last_message_preview: preview,
        last_message_at: now,
      })
      .select("id")
      .single();
    sessionId = s?.id;
  } else {
    await db.from("msg_sessions").update({ last_message_preview: preview, last_message_at: now }).eq("id", sessionId);
  }
  if (sessionId) {
    await db.from("msg_messages").insert({
      organization_id: ctx.organizationId,
      session_id: sessionId,
      direction: "outbound",
      message_type: "text",
      content: body,
      status: sent ? "sent" : "queued",
      external_id: externalId,
    });
  }

  return { ok: true, output: { sent, session_id: sessionId, external_id: externalId, phone } };
};

export function register() {
  registerAction("messaging.send", messagingSend);
}
