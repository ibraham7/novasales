/**
 * واتساب الرسمي (Meta Cloud API / Coexistence) — مزوّد كامل على العقد الموحّد.
 *
 * الربط يتم عبر Embedded Signup من Meta (لا QR)، لذلك `externalRef` هنا هو
 * `phone_number_id` الثابت من Meta ولا يتغيّر بإعادة الربط.
 *
 * Coexistence تعني أن الرقم يبقى يعمل في تطبيق WhatsApp Business على الجوال
 * وفي NovaSales في نفس الوقت — لا انقطاع ولا بصمة اتصال غير رسمية.
 */
import {
  NO_CAPABILITIES,
  type CreateInstanceInput,
  type CreateInstanceResult,
  type IWhatsAppProvider,
  type MessageKeyRef,
  type NormalizedWebhook,
  type OutboundQuote,
  type ProviderDebugInfo,
  type ProviderStatus,
  type QrPayload,
} from "./provider";
import {
  decryptToken,
  downloadMedia as cloudDownloadMedia,
  getPhoneInfo,
  graphVersion,
  isCoexistenceConfigured,
  markRead as cloudMarkRead,
  sendMedia as cloudSendMedia,
  sendReaction as cloudSendReaction,
  sendTemplate as cloudSendTemplate,
  sendText as cloudSendText,
  subscribeApp,
} from "./cloud-http";
import { normalizeCloudWebhook } from "./cloud.webhook";

export const COEXISTENCE_PROVIDER_ID = "coexistence";

type CloudAccountRow = {
  id: string;
  organization_id: string;
  channel_account_id: string;
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  quality_rating: string | null;
  access_token_cipher: string | null;
  status: string;
};

async function loadCloudAccount(phoneNumberId: string): Promise<CloudAccountRow> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any)
    .from("plugin_whatsapp_cloud_accounts")
    .select(
      "id, organization_id, channel_account_id, waba_id, phone_number_id, display_phone_number, verified_name, quality_rating, access_token_cipher, status",
    )
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (!data) throw new Error("الرقم غير مربوط بواتساب الرسمي — أعد الربط من صفحة جلسات واتساب.");
  return data as CloudAccountRow;
}

async function creds(phoneNumberId: string) {
  const row = await loadCloudAccount(phoneNumberId);
  if (!row.access_token_cipher) throw new Error("تفويض واتساب الرسمي مفقود — أعد ربط الرقم.");
  return { row, token: await decryptToken(row.access_token_cipher) };
}

/** رقم الطرف الآخر بصيغة أرقام فقط. */
function digits(identifier: string) {
  return String(identifier).split("@")[0]!.replace(/\D/g, "");
}

function quotedId(quoted?: OutboundQuote) {
  return quoted?.key?.id;
}

export const coexistenceProvider: IWhatsAppProvider = {
  id: COEXISTENCE_PROVIDER_ID,
  label: "واتساب الرسمي (Coexistence)",
  description:
    "ربط رسمي معتمد من Meta: الرقم يعمل في تطبيق WhatsApp Business وفي NovaSales معاً، بأقل خطر تقييد.",
  linkMode: "embedded_signup",
  isOfficial: true,
  capabilities: {
    ...NO_CAPABILITIES,
    supportsMedia: true,
    supportsAudioNote: true,
    supportsReactions: true,
    supportsMarkRead: true,
    supportsProfilePicture: false,
    supportsQrLogin: false,
  },
  isConfigured: () => isCoexistenceConfigured(),

  // ── دورة حياة الجلسة ───────────────────────────────────────────
  async createInstance(_input: CreateInstanceInput): Promise<CreateInstanceResult> {
    throw new Error(
      'واتساب الرسمي لا يُنشأ بجلسة QR. اضغط "ربط رقم رسمي" واتبع خطوات Meta لاختيار الرقم.',
    );
  },

  async connectInstance(_externalRef: string): Promise<QrPayload> {
    // لا يوجد QR في الربط الرسمي — الربط يكتمل من نافذة Meta.
    return { base64: null, value: null, pairingCode: null };
  },

  async getStatus(externalRef: string): Promise<ProviderStatus> {
    if (!isCoexistenceConfigured()) return { state: "unconfigured" };
    const { row, token } = await creds(externalRef);
    const info = await getPhoneInfo(externalRef, token);
    if (!info) return { state: "disconnected", phoneNumber: row.display_phone_number ?? null };
    const phone = (info.display_phone_number ?? row.display_phone_number ?? "").replace(/\D/g, "");
    return {
      state: "connected",
      phoneNumber: phone || null,
      meta: {
        verifiedName: info.verified_name ?? null,
        qualityRating: info.quality_rating ?? null,
        platformType: info.platform_type ?? null,
        wabaId: row.waba_id,
      },
    };
  },

  async disconnect(externalRef: string): Promise<void> {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any)
      .from("plugin_whatsapp_cloud_accounts")
      .update({ status: "disconnected" })
      .eq("phone_number_id", externalRef);
  },

  async deleteInstance(externalRef: string): Promise<void> {
    // لا نلمس حساب Meta نفسه (الرقم يبقى للعميل)؛ نحذف الربط عندنا فقط.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any)
      .from("plugin_whatsapp_cloud_accounts")
      .delete()
      .eq("phone_number_id", externalRef);
  },

  async configureWebhook(externalRef: string, _webhookUrl: string): Promise<void> {
    // ويبهوك Meta مضبوط على مستوى التطبيق؛ المطلوب هنا اشتراك حساب الأعمال.
    const { row, token } = await creds(externalRef);
    await subscribeApp(row.waba_id, token);
  },

  async getDebugInfo(externalRef: string): Promise<ProviderDebugInfo | null> {
    if (!isCoexistenceConfigured()) return null;
    const { row, token } = await creds(externalRef).catch(() => ({ row: null as any, token: "" }));
    if (!row) return null;
    const info = await getPhoneInfo(externalRef, token);
    return {
      engine: "META_CLOUD_API",
      server: `graph.facebook.com/${graphVersion()}`,
      sessionName: externalRef,
      state: row.status,
      phoneNumber: (info?.display_phone_number ?? row.display_phone_number ?? "").replace(/\D/g, "") || null,
      profileName: info?.verified_name ?? row.verified_name ?? null,
      webhookConfigured: true,
      raw: {
        wabaId: row.waba_id,
        qualityRating: info?.quality_rating ?? row.quality_rating ?? null,
        platformType: info?.platform_type ?? null,
        coexistence: true,
      },
    };
  },

  // ── الإرسال ────────────────────────────────────────────────────
  async sendText(externalRef, toIdentifier, text, quoted) {
    const { token } = await creds(externalRef);
    return cloudSendText(externalRef, token, digits(toIdentifier), text, quotedId(quoted));
  },

  async sendMedia(externalRef, toIdentifier, params) {
    const { token } = await creds(externalRef);
    return cloudSendMedia(externalRef, token, digits(toIdentifier), {
      mediatype: params.mediatype,
      media: params.media,
      ...(params.mimetype ? { mimetype: params.mimetype } : {}),
      ...(params.fileName ? { fileName: params.fileName } : {}),
      ...(params.caption ? { caption: params.caption } : {}),
      ...(quotedId(params.quoted) ? { replyToId: quotedId(params.quoted)! } : {}),
    });
  },

  async sendAudioNote(externalRef, toIdentifier, audio, quoted) {
    const { token } = await creds(externalRef);
    return cloudSendMedia(externalRef, token, digits(toIdentifier), {
      mediatype: "audio",
      media: audio,
      mimetype: "audio/ogg",
      ...(quotedId(quoted) ? { replyToId: quotedId(quoted)! } : {}),
    });
  },

  async sendTemplate(externalRef, toIdentifier, template) {
    const { token } = await creds(externalRef);
    return cloudSendTemplate(externalRef, token, digits(toIdentifier), template);
  },

  async sendReaction(externalRef: string, key: MessageKeyRef, emoji: string): Promise<void> {
    const { token } = await creds(externalRef);
    await cloudSendReaction(externalRef, token, digits(key.remoteJid), key.id, emoji);
  },

  async markRead(externalRef: string, keys: MessageKeyRef[]): Promise<void> {
    const { token } = await creds(externalRef);
    for (const k of keys.filter((k) => !k.fromMe && k.id)) {
      await cloudMarkRead(externalRef, token, k.id).catch(() => {});
    }
  },

  // ── القراءة ────────────────────────────────────────────────────
  async downloadMedia(externalRef: string, key: MessageKeyRef) {
    const { token } = await creds(externalRef);
    return cloudDownloadMedia(key.id, token);
  },

  // ── الويبهوك ───────────────────────────────────────────────────
  normalizeWebhook(payload: unknown): NormalizedWebhook {
    return normalizeCloudWebhook(payload);
  },
};
