// Instagram as an engine in the channel registry, so the chat's «send» works the same way for it as
// for a WhatsApp number. It links through Instagram's login (instagram.functions.ts), not through a
// QR, so the session-lifecycle methods are not used. The number-protection layer is WhatsApp's and is
// skipped (skipRiskGuard); Instagram's own rule, the 24-hour window, is enforced in sendInstagramText.
import { NO_CAPABILITIES, type IWhatsAppProvider, type ProviderStatus } from "../whatsapp/provider";
import { INSTAGRAM_CHANNEL_TYPE, INSTAGRAM_PROVIDER_ID, isInstagramConfigured } from "./instagram-core";

const notUsed = () => {
  throw new Error("يُربط حساب إنستغرام من «الجلسات ← إنستغرام» بتسجيل الدخول في إنستغرام.");
};

export const instagramProvider: IWhatsAppProvider = {
  id: INSTAGRAM_PROVIDER_ID,
  label: "Instagram",
  description: "حساب إنستغرام احترافي يُربط بتسجيل الدخول الرسمي",
  channelType: INSTAGRAM_CHANNEL_TYPE,
  skipRiskGuard: true,
  linkMode: "embedded_signup",
  isOfficial: true,
  capabilities: { ...NO_CAPABILITIES },
  isConfigured: () => isInstagramConfigured(),

  createInstance: async () => notUsed(),
  connectInstance: async () => notUsed(),
  configureWebhook: async () => undefined,

  async getStatus(externalRef): Promise<ProviderStatus> {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any).from("plugin_instagram_accounts").select("status").eq("ig_user_id", externalRef).maybeSingle();
    if (!data) return { state: "disconnected" };
    return { state: data.status === "connected" ? "connected" : "disconnected" };
  },

  async disconnect(externalRef) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any)
      .from("plugin_instagram_accounts")
      .update({ status: "disconnected", access_token_cipher: null, token_expires_at: null })
      .eq("ig_user_id", externalRef);
  },
  async deleteInstance(externalRef) {
    await instagramProvider.disconnect(externalRef);
  },

  async sendText(externalRef, toIdentifier, text) {
    const [{ supabaseAdmin }, { sendInstagramText }, { instagramDeps }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("./instagram-store"),
      import("./instagram.server"),
    ]);
    const sent = await sendInstagramText(supabaseAdmin as any, instagramDeps(), { igUserId: externalRef, to: toIdentifier, text });
    return { externalId: sent.externalId ?? undefined };
  },

  // Notifications come in through /api/public/instagram-webhook, not the WhatsApp event pipeline.
  normalizeWebhook: () => ({ accountRef: null, events: [] }),
};
