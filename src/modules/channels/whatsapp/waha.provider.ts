// WAHA implementation of IWhatsAppProvider — محرّك بديل لـEvolution.
// `waha-http.ts` تفصيل داخلي؛ لا يُستورد من خارج مجلد المزوّد.
import * as waha from "./waha-http";
import { mapWahaStatus, normalizeWahaWebhook } from "./waha.webhook";
import type {
  IWhatsAppProvider,
  CreateInstanceInput,
  CreateInstanceResult,
  MessageKeyRef,
  OutboundQuote,
  ProviderCapabilities,
  ProviderDebugInfo,
  ProviderStatus,
  QrPayload,
} from "./provider";

const capabilities: ProviderCapabilities = {
  supportsMedia: true,
  supportsAudioNote: true,
  supportsTyping: true,
  supportsPresence: true,
  supportsEdit: true,
  supportsDelete: true,
  supportsHistory: true,
  supportsReactions: true,
  supportsMarkRead: true,
  supportsPolls: false,
  supportsChannels: true,
  supportsCommunities: false,
  supportsCalls: false,
  supportsStories: false,
  supportsNewsletters: false,
  supportsStatus: true,
  supportsGroups: true,
  supportsQrLogin: true,
  supportsProfilePicture: true,
};

function chatIdOf(key: MessageKeyRef): string {
  return waha.toChatId(key.remoteJid);
}

function replyIdOf(quoted?: OutboundQuote): string | undefined {
  return quoted?.key?.id ?? undefined;
}

export const wahaProvider: IWhatsAppProvider = {
  id: "waha",
  label: "WAHA",
  capabilities,

  isConfigured() {
    return waha.isWahaConfigured();
  },

  async createInstance(input: CreateInstanceInput): Promise<CreateInstanceResult> {
    const externalRef = `w${input.organizationId.slice(0, 8)}-${Date.now().toString(36)}`;
    await waha.createSession(externalRef, input.webhookUrl);
    return { externalRef, meta: { engine: "WAHA" } };
  },

  async connectInstance(externalRef: string): Promise<QrPayload> {
    // 1) تأكد من وجود الجلسة، 2) شغّلها إن كانت متوقفة، 3) انتظر ظهور QR.
    let info = await waha.getSession(externalRef).catch(() => null);
    if (!info) {
      await waha.createSession(externalRef).catch(() => {});
      info = await waha.getSession(externalRef).catch(() => null);
    }
    const state = String(info?.status ?? "").toUpperCase();
    if (state === "STOPPED") {
      await waha.startSession(externalRef).catch(() => {});
    }
    for (let i = 0; i < 8; i++) {
      const cur = await waha.getSession(externalRef).catch(() => null);
      const st = String(cur?.status ?? "").toUpperCase();
      if (st === "WORKING") return { base64: null, pairingCode: null };
      if (st === "SCAN_QR_CODE") {
        const value = await waha.getQrValue(externalRef).catch(() => null);
        if (value) return { base64: null, value, pairingCode: null };
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    const value = await waha.getQrValue(externalRef).catch(() => null);
    return { base64: null, value, pairingCode: null };
  },


  async getStatus(externalRef: string): Promise<ProviderStatus> {
    const info = await waha.getSession(externalRef);
    return {
      state: mapWahaStatus(info?.status ?? null),
      phoneNumber: info?.me?.id ? String(info.me.id).split("@")[0] : null,
      meta: (info ?? {}) as Record<string, unknown>,
    };
  },

  async disconnect(externalRef: string) {
    await waha.logoutSession(externalRef);
  },

  async deleteInstance(externalRef: string) {
    await waha.deleteSession(externalRef);
  },

  async configureWebhook(externalRef: string, webhookUrl: string) {
    await waha.updateSessionWebhook(externalRef, webhookUrl);
  },

  async getDebugInfo(externalRef: string): Promise<ProviderDebugInfo | null> {
    const info = await waha.getSession(externalRef).catch(() => null);
    if (!info) return null;
    const engine = (info.engine as { engine?: string } | null)?.engine ?? null;
    const profilePicUrl = info.me?.id
      ? await waha.getProfilePicture(externalRef, String(info.me.id)).catch(() => null)
      : null;
    return {
      engine,
      server: waha.wahaServerHost(),
      sessionName: externalRef,
      state: info.status ?? null,
      phoneNumber: info.me?.id ? String(info.me.id).split("@")[0] ?? null : null,
      profileName: info.me?.pushName ?? null,
      profilePicUrl,
      webhookConfigured: Boolean(info.config?.webhooks?.length),
      raw: (info ?? {}) as Record<string, unknown>,
    };
  },

  async sendText(externalRef, toIdentifier, text, quoted) {
    const res = await waha.sendText(externalRef, toIdentifier, text, replyIdOf(quoted));
    return { externalId: (res?.id as string | undefined) ?? undefined };
  },

  async sendMedia(externalRef, toIdentifier, params) {
    const res = await waha.sendMedia(externalRef, toIdentifier, {
      mediatype: params.mediatype,
      media: params.media,
      ...(params.mimetype ? { mimetype: params.mimetype } : {}),
      ...(params.fileName ? { fileName: params.fileName } : {}),
      ...(params.caption ? { caption: params.caption } : {}),
      ...(replyIdOf(params.quoted) ? { replyTo: replyIdOf(params.quoted)! } : {}),
    });
    return { externalId: (res?.id as string | undefined) ?? undefined };
  },

  async sendAudioNote(externalRef, toIdentifier, audio, quoted) {
    const res = await waha.sendVoice(externalRef, toIdentifier, audio, replyIdOf(quoted));
    return { externalId: (res?.id as string | undefined) ?? undefined };
  },

  async sendReaction(externalRef, key, emoji) {
    await waha.sendReaction(externalRef, key.id, emoji);
  },

  async editMessage(externalRef, params) {
    await waha.editMessage(externalRef, waha.toChatId(params.number || params.key.remoteJid), params.key.id, params.text);
  },

  async deleteMessage(externalRef, key) {
    await waha.deleteMessage(externalRef, chatIdOf(key), key.id);
  },

  async markRead(externalRef, keys) {
    const last = keys[keys.length - 1];
    if (!last) return;
    await waha.sendSeen(externalRef, chatIdOf(last), last.id);
  },

  async setTyping(externalRef, toIdentifier, on) {
    await waha.setTyping(externalRef, toIdentifier, on);
  },

  async fetchHistory(externalRef, peer, limit = 100) {
    return waha.fetchMessages(externalRef, waha.toChatId(peer), limit);
  },

  async getProfilePicture(externalRef, identifier) {
    return waha.getProfilePicture(externalRef, identifier);
  },

  normalizeWebhook(payload: unknown) {
    return normalizeWahaWebhook(payload);
  },
};
