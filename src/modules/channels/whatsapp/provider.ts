/**
 * IWhatsAppProvider — عقد موحّد لكل محرّكات واتساب (Evolution، WAHA، Cloud API…)
 *
 * NovaSales لا يعرف أي محرّك يعمل تحته. كل شيء يمرّ عبر Registry الذي يجلب
 * المزوّد بناءً على `msg_channels.provider` (TEXT مفتوح — لا Enum).
 *
 * كل مزوّد يعلن قدراته في `capabilities`، والواجهات تُبنى على الإعلان
 * (Auto Detection) لا على اسم المزوّد.
 */

export type ProviderId = string; // "evolution" | "waha" | "cloud_api" | …

/** إعلان القدرات — أي ميزة جديدة تُضاف هنا فتظهر تلقائياً في الواجهة. */
export interface ProviderCapabilities {
  supportsMedia: boolean;
  supportsAudioNote: boolean;
  supportsTyping: boolean;
  supportsPresence: boolean;
  supportsEdit: boolean;
  supportsDelete: boolean;
  supportsHistory: boolean;
  supportsReactions: boolean;
  supportsMarkRead: boolean;
  supportsPolls: boolean;
  supportsChannels: boolean;
  supportsCommunities: boolean;
  supportsCalls: boolean;
  supportsStories: boolean;
  supportsNewsletters: boolean;
  supportsStatus: boolean;
  supportsGroups: boolean;
  supportsQrLogin: boolean;
  supportsProfilePicture: boolean;
}

export const NO_CAPABILITIES: ProviderCapabilities = {
  supportsMedia: false,
  supportsAudioNote: false,
  supportsTyping: false,
  supportsPresence: false,
  supportsEdit: false,
  supportsDelete: false,
  supportsHistory: false,
  supportsReactions: false,
  supportsMarkRead: false,
  supportsPolls: false,
  supportsChannels: false,
  supportsCommunities: false,
  supportsCalls: false,
  supportsStories: false,
  supportsNewsletters: false,
  supportsStatus: false,
  supportsGroups: false,
  supportsQrLogin: false,
  supportsProfilePicture: false,
};

export type CapabilityKey = keyof ProviderCapabilities;

/** أسماء عربية للقدرات — تُستخدم في رسائل "غير مدعوم في هذا المحرك". */
export const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  supportsMedia: "إرسال الوسائط",
  supportsAudioNote: "الرسائل الصوتية",
  supportsTyping: "مؤشر الكتابة",
  supportsPresence: "حالة التواجد",
  supportsEdit: "تعديل الرسائل",
  supportsDelete: "حذف الرسائل للجميع",
  supportsHistory: "جلب سجل المحادثات",
  supportsReactions: "التفاعلات بالإيموجي",
  supportsMarkRead: "تعليم كمقروء",
  supportsPolls: "الاستطلاعات",
  supportsChannels: "القنوات",
  supportsCommunities: "المجتمعات",
  supportsCalls: "المكالمات",
  supportsStories: "الحالات (Stories)",
  supportsNewsletters: "النشرات",
  supportsStatus: "حالة واتساب",
  supportsGroups: "المجموعات",
  supportsQrLogin: "الربط عبر QR",
  supportsProfilePicture: "صورة الملف الشخصي",
};

export interface QrPayload {
  base64?: string | null;
  /** قيمة الربط الخام عند توفرها؛ تُرسم كـ SVG لتجنب تشويش صور QR الصغيرة. */
  value?: string | null;
  pairingCode?: string | null;
}

export interface ProviderStatus {
  state: "connected" | "connecting" | "disconnected" | "unconfigured" | "unknown";
  phoneNumber?: string | null;
  meta?: Record<string, unknown>;
}

export interface CreateInstanceInput {
  organizationId: string;
  displayName: string;
  webhookUrl?: string;
  meta?: Record<string, unknown>;
}

export interface CreateInstanceResult {
  externalRef: string; // اسم/معرّف الجلسة عند المزوّد
  meta?: Record<string, unknown>;
}

/** بيانات تشخيص تُعرض في لوحة الأدمن (Debug). */
export interface ProviderDebugInfo {
  engine?: string | null; // WEBJS / GOWS / NOWEB / BAILEYS …
  server?: string | null; // اسم/عنوان سيرفر المزوّد
  sessionName?: string | null;
  state?: string | null;
  phoneNumber?: string | null;
  profileName?: string | null;
  profilePicUrl?: string | null;
  webhookConfigured?: boolean | null;
  raw?: Record<string, unknown>;
}

export type MessageKeyRef = {
  id: string;
  remoteJid: string;
  fromMe: boolean;
  participant?: string;
};

export type OutboundQuote = { key: MessageKeyRef; message: Record<string, unknown> };

export type MediaKind = "image" | "video" | "audio" | "document";

/** رسالة موحّدة بعد تطبيع أي payload من أي مزوّد. */
export interface NormalizedMessage {
  externalId: string | null;
  peer: string; // remoteJid أو ما يعادله
  identifier: string; // أرقام فقط
  fromMe: boolean;
  text: string;
  mediaKind: MediaKind | null;
  /** معرّف وسائط مستقل عند المزوّدين الرسميين (Cloud API) — يُستخدم للتنزيل. */
  mediaId?: string | undefined;
  mediaMime?: string | undefined;
  mediaFileName?: string | undefined;
  ptt?: boolean | undefined;
  pushName?: string | null;
  profilePicUrl?: string | null;
  occurredAt: string;
}

/** أحداث موحّدة يفهمها النظام — كل مزوّد يترجم أحداثه الخاصة إليها. */
export type NormalizedEvent =
  | {
      kind: "connection.state";
      state: ProviderStatus["state"];
      rawState?: string;
      statusReason?: unknown;
      raw?: Record<string, unknown>;
    }
  | { kind: "qr.updated"; base64: string }
  | { kind: "message.in" | "message.out"; message: NormalizedMessage }
  | {
      kind: "message.reaction";
      targetExternalId: string;
      emoji: string;
      peer: string;
      actorName?: string | null;
    }
  | { kind: "message.status"; externalId: string; status: "sent" | "delivered" | "read"; inboundRead?: boolean }
  | { kind: "chat.read"; peer: string };

export interface NormalizedWebhook {
  /** external_ref للجلسة عند المزوّد (اسم الـ instance / session). */
  accountRef: string | null;
  events: NormalizedEvent[];
}

/**
 * طريقة ربط الرقم:
 * - `qr`: مسح رمز من تطبيق واتساب (Evolution / WAHA).
 * - `embedded_signup`: ربط رسمي عبر Meta (Cloud API / Coexistence) بلا QR.
 */
export type ProviderLinkMode = "qr" | "embedded_signup";

export interface IWhatsAppProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  readonly linkMode?: ProviderLinkMode;
  /** وصف قصير يظهر في واجهة اختيار المحرّك. */
  readonly description?: string;
  /** هل الربط رسمي معتمد من Meta (يُستثنى من مخاطر Baileys). */
  readonly isOfficial?: boolean;
  isConfigured(): boolean;


  // ── دورة حياة الجلسة ─────────────────────────────────────────
  createInstance(input: CreateInstanceInput): Promise<CreateInstanceResult>;
  connectInstance(externalRef: string): Promise<QrPayload>;
  getStatus(externalRef: string): Promise<ProviderStatus>;
  disconnect(externalRef: string): Promise<void>;
  deleteInstance(externalRef: string): Promise<void>;
  configureWebhook(externalRef: string, webhookUrl: string): Promise<void>;
  applyRecommendedSettings?(externalRef: string): Promise<void>;
  getDebugInfo?(externalRef: string): Promise<ProviderDebugInfo | null>;

  // ── الإرسال ──────────────────────────────────────────────────
  sendText(
    externalRef: string,
    toIdentifier: string,
    text: string,
    quoted?: OutboundQuote,
  ): Promise<{ externalId?: string }>;
  sendMedia?(
    externalRef: string,
    toIdentifier: string,
    params: {
      mediatype: "image" | "video" | "document";
      media: string;
      mimetype?: string;
      fileName?: string;
      caption?: string;
      quoted?: OutboundQuote;
    },
  ): Promise<{ externalId?: string }>;
  sendAudioNote?(
    externalRef: string,
    toIdentifier: string,
    audio: string,
    quoted?: OutboundQuote,
  ): Promise<{ externalId?: string }>;
  sendReaction?(externalRef: string, key: MessageKeyRef, emoji: string): Promise<void>;
  editMessage?(
    externalRef: string,
    params: { number: string; text: string; key: MessageKeyRef },
  ): Promise<void>;
  deleteMessage?(externalRef: string, key: MessageKeyRef): Promise<void>;
  markRead?(externalRef: string, keys: MessageKeyRef[]): Promise<void>;
  setTyping?(externalRef: string, toIdentifier: string, on: boolean): Promise<void>;
  /** إرسال قالب معتمد — مطلوب لبدء محادثة بعد 24 ساعة في المزوّد الرسمي. */
  sendTemplate?(
    externalRef: string,
    toIdentifier: string,
    template: { name: string; language: string; components?: unknown[] },
  ): Promise<{ externalId?: string }>;

  // ── القراءة ──────────────────────────────────────────────────
  fetchHistory?(externalRef: string, peer: string, limit?: number): Promise<unknown[]>;
  downloadMedia?(
    externalRef: string,
    key: MessageKeyRef,
  ): Promise<{ base64: string; mimetype?: string; fileName?: string } | null>;
  getProfilePicture?(externalRef: string, identifier: string): Promise<string | null>;

  // ── الويبهوك ─────────────────────────────────────────────────
  /** يحوّل payload الخام إلى أحداث موحّدة يفهمها النظام. */
  normalizeWebhook(payload: unknown): NormalizedWebhook;
}
