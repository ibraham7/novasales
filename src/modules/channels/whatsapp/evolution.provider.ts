// Evolution API implementation of IWhatsAppProvider — التنفيذ الكامل للعقد الموحّد.
// `evolution-http.ts` تفصيل داخلي؛ لا يُستورد من خارج مجلد المزوّد.
import * as evo from "./evolution-http";
import { normalizeEvolutionWebhook } from "./evolution.webhook";
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
  supportsChannels: false,
  supportsCommunities: false,
  supportsCalls: false,
  supportsStories: false,
  supportsNewsletters: false,
  supportsStatus: false,
  supportsGroups: false,
  supportsQrLogin: true,
  supportsProfilePicture: true,
};

export const evolutionProvider: IWhatsAppProvider = {
  id: "evolution",
  label: "Evolution API",
  capabilities,

  isConfigured() {
    return evo.isEvolutionConfigured();
  },

  async createInstance(input: CreateInstanceInput): Promise<CreateInstanceResult> {
    const externalRef = `w${input.organizationId.slice(0, 8)}-${Date.now().toString(36)}`;
    await evo.createInstance(externalRef, input.webhookUrl);
    return { externalRef, meta: { engine: "BAILEYS" } };
  },

  async connectInstance(externalRef: string): Promise<QrPayload> {
    const result = (await evo.connectInstance(externalRef)) as Record<string, unknown>;
    const base64 =
      (result?.base64 as string | undefined) ??
      (result?.qrcode as { base64?: string } | undefined)?.base64 ??
      null;
    const pairingCode = (result?.pairingCode as string | undefined) ?? null;
    return { base64, pairingCode };
  },

  async getStatus(externalRef: string): Promise<ProviderStatus> {
    const result = (await evo.fetchInstanceStatus(externalRef)) as Record<string, unknown>;
    const state = String(
      (result?.instance as { state?: string } | undefined)?.state ??
        (result?.state as string | undefined) ??
        "unknown",
    );
    const map: Record<string, ProviderStatus["state"]> = {
      open: "connected",
      close: "disconnected",
      connecting: "connecting",
    };
    return { state: map[state] ?? "unknown", meta: result };
  },

  async disconnect(externalRef: string) {
    await evo.logoutInstance(externalRef);
  },

  async deleteInstance(externalRef: string) {
    await evo.deleteInstance(externalRef);
  },

  async configureWebhook(externalRef: string, webhookUrl: string) {
    await evo.setWebhook(externalRef, webhookUrl);
  },

  async applyRecommendedSettings(externalRef: string) {
    await evo.setInstanceSettings(externalRef);
  },

  async getDebugInfo(externalRef: string): Promise<ProviderDebugInfo | null> {
    const info = await evo.fetchInstanceInfo(externalRef);
    if (!info) return null;
    return {
      engine: "BAILEYS",
      server: (process.env.EVOLUTION_API_URL ?? "").replace(/^https?:\/\//, "") || null,
      sessionName: externalRef,
      state: info.state,
      phoneNumber: info.phone,
      profileName: info.profileName,
      profilePicUrl: info.profilePicUrl,
      raw: { ownerJid: info.ownerJid },
    };
  },

  async sendText(externalRef: string, toIdentifier: string, text: string, quoted?: OutboundQuote) {
    const res = (await evo.sendText(externalRef, toIdentifier, text, quoted as never)) as Record<string, unknown>;
    const externalId =
      (res?.key as { id?: string } | undefined)?.id ?? (res?.id as string | undefined);
    return { externalId };
  },

  async sendMedia(externalRef, toIdentifier, params) {
    const res = (await evo.sendMedia(externalRef, toIdentifier, params as never)) as Record<string, unknown>;
    const externalId =
      (res?.key as { id?: string } | undefined)?.id ?? (res?.id as string | undefined);
    return { externalId };
  },

  async sendAudioNote(externalRef, toIdentifier, audio, quoted) {
    const res = (await evo.sendWhatsAppAudio(externalRef, toIdentifier, audio, quoted as never)) as Record<
      string,
      unknown
    >;
    const externalId =
      (res?.key as { id?: string } | undefined)?.id ?? (res?.id as string | undefined);
    return { externalId };
  },

  async sendReaction(externalRef: string, key: MessageKeyRef, emoji: string) {
    await evo.sendReaction(externalRef, key, emoji);
  },

  async editMessage(externalRef, params) {
    await evo.updateMessage(externalRef, params);
  },

  async deleteMessage(externalRef: string, key: MessageKeyRef) {
    await evo.deleteMessageForEveryone(externalRef, key);
  },

  async markRead(externalRef: string, keys: MessageKeyRef[]) {
    await evo.markMessagesAsRead(externalRef, keys);
  },

  async setTyping(externalRef: string, toIdentifier: string, on: boolean) {
    await evo.setPresence(externalRef, toIdentifier, on ? "composing" : "paused");
  },

  async fetchHistory(externalRef: string, peer: string, limit = 100) {
    return evo.fetchMessagesHistory(externalRef, peer, limit);
  },

  async downloadMedia(externalRef: string, key: MessageKeyRef) {
    return evo.getBase64FromMediaMessage(externalRef, key);
  },

  async getProfilePicture(externalRef: string, identifier: string) {
    return evo.fetchProfilePictureUrl(externalRef, identifier);
  },

  normalizeWebhook(payload: unknown) {
    return normalizeEvolutionWebhook(payload);
  },
};
