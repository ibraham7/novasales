// Server-only helper for Evolution API. Never import from client code.
// Filename `.server.ts` blocks client bundling.

const jsonHeaders = (apiKey: string) => ({
  "Content-Type": "application/json",
  apikey: apiKey,
});

function getConfig() {
  const url = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  if (!url || !key) {
    throw new Error(
      "Evolution API غير مُهيأ. يرجى إضافة EVOLUTION_API_URL و EVOLUTION_API_KEY في الأسرار."
    );
  }
  return { url: url.replace(/\/$/, ""), key };
}

const DEFAULT_TIMEOUT_MS = 8000;

async function evoFetch(path: string, init: RequestInit = {}, attempt = 0): Promise<unknown> {
  const { url, key } = getConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { ...jsonHeaders(key), ...(init.headers as Record<string, string> | undefined) },
    });
  } catch (e) {
    clearTimeout(timer);
    // One retry for timeouts / transient network failures (weak networks).
    if (attempt < 1) return evoFetch(path, init, attempt + 1);
    throw new Error(
      (e as Error)?.name === "AbortError"
        ? "Evolution API لم يستجب في الوقت المحدد"
        : ((e as Error)?.message ?? "Evolution API غير متاح"),
    );
  }
  clearTimeout(timer);
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    if (res.status >= 500 && attempt < 1) return evoFetch(path, init, attempt + 1);
    const msg =
      (body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : null) ?? `Evolution API خطأ ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

export async function createInstance(name: string, webhookUrl?: string) {
  return evoFetch("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName: name,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      ...(webhookUrl
        ? {
            webhook: {
              url: webhookUrl,
              webhook_by_events: false,
              events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CHATS_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
            },
          }
        : {}),
    }),
  });
}

export async function connectInstance(name: string) {
  return evoFetch(`/instance/connect/${encodeURIComponent(name)}`);
}

export async function fetchInstanceStatus(name: string) {
  return evoFetch(`/instance/connectionState/${encodeURIComponent(name)}`);
}

export async function logoutInstance(name: string) {
  return evoFetch(`/instance/logout/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export async function deleteInstance(name: string) {
  return evoFetch(`/instance/delete/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export type QuotedRef = {
  key: { id: string; remoteJid: string; fromMe: boolean; participant?: string };
  message: Record<string, unknown>;
};

export async function sendText(
  instance: string,
  number: string,
  text: string,
  quoted?: QuotedRef,
) {
  return evoFetch(`/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({ number, text, ...(quoted ? { quoted } : {}) }),
  });
}

export async function setWebhook(instance: string, webhookUrl: string) {
  return evoFetch(`/webhook/set/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({
      webhook: {
        url: webhookUrl,
        enabled: true,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CHATS_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
      },
    }),
  });
}

// Send image/video/document. `media` may be a public URL or base64 string.
// mediatype: "image" | "video" | "document"
export async function sendMedia(
  instance: string,
  number: string,
  params: {
    mediatype: "image" | "video" | "document";
    media: string; // URL or base64
    mimetype?: string;
    fileName?: string;
    caption?: string;
    quoted?: QuotedRef;
  },
) {
  return evoFetch(`/message/sendMedia/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({
      number,
      mediatype: params.mediatype,
      media: params.media,
      ...(params.mimetype ? { mimetype: params.mimetype } : {}),
      ...(params.fileName ? { fileName: params.fileName } : {}),
      ...(params.caption ? { caption: params.caption } : {}),
      ...(params.quoted ? { quoted: params.quoted } : {}),
    }),
  });
}

// Send a WhatsApp voice note (ptt). `audio` may be a public URL or base64.
export async function sendWhatsAppAudio(
  instance: string,
  number: string,
  audio: string,
  quoted?: QuotedRef,
) {
  return evoFetch(`/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({ number, audio, ...(quoted ? { quoted } : {}) }),
  });
}

export async function fetchProfilePictureUrl(instance: string, number: string) {
  try {
    const body = await evoFetch(`/chat/fetchProfilePictureUrl/${encodeURIComponent(instance)}`, {
      method: "POST",
      body: JSON.stringify({ number }),
    });
    return (body as { profilePictureUrl?: string } | null)?.profilePictureUrl ?? null;
  } catch (e) {
    console.warn("[evolution] fetchProfilePictureUrl failed", e);
    return null;
  }
}

// Fetch chat message history for a specific peer (Evolution v2 uses POST /chat/findMessages/{instance}).
export async function fetchMessagesHistory(
  instance: string,
  remoteJid: string,
  limit = 100,
): Promise<any[]> {
  try {
    const body = await evoFetch(`/chat/findMessages/${encodeURIComponent(instance)}`, {
      method: "POST",
      body: JSON.stringify({
        where: { key: { remoteJid } },
        limit,
      }),
    });
    // Evolution v2 returns { messages: { records: [...] } } or a plain array depending on version
    const anyBody: any = body;
    if (Array.isArray(anyBody)) return anyBody;
    if (Array.isArray(anyBody?.messages?.records)) return anyBody.messages.records;
    if (Array.isArray(anyBody?.messages)) return anyBody.messages;
    if (Array.isArray(anyBody?.records)) return anyBody.records;
    return [];
  } catch (e) {
    console.warn("[evolution] fetchMessagesHistory failed", e);
    return [];
  }
}

// Download media (image/video/audio/document) as base64 from an inbound message key.
export async function getBase64FromMediaMessage(
  instance: string,
  messageKey: { id: string; remoteJid: string; fromMe?: boolean },
): Promise<{ base64: string; mimetype?: string; fileName?: string } | null> {
  try {
    const body = await evoFetch(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`, {
      method: "POST",
      body: JSON.stringify({
        message: { key: messageKey },
        convertToMp4: false,
      }),
    });
    const anyBody: any = body;
    const b64: string | undefined = anyBody?.base64 ?? anyBody?.data?.base64 ?? anyBody?.buffer;
    if (!b64) return null;
    return {
      base64: b64,
      mimetype: anyBody?.mimetype ?? anyBody?.mediaType,
      fileName: anyBody?.fileName,
    };
  } catch (e) {
    console.warn("[evolution] getBase64FromMediaMessage failed", e);
    return null;
  }
}

// Delete a message for everyone on WhatsApp.
export async function deleteMessageForEveryone(
  instance: string,
  messageKey: { id: string; remoteJid: string; fromMe: boolean; participant?: string },
) {
  // Evolution v2 endpoint: /chat/deleteMessageForEveryone/{instance}
  return evoFetch(`/chat/deleteMessageForEveryone/${encodeURIComponent(instance)}`, {
    method: "DELETE",
    body: JSON.stringify(messageKey),
  });
}

// React to a message with an emoji ("" removes the reaction).
export async function sendReaction(
  instance: string,
  messageKey: { id: string; remoteJid: string; fromMe: boolean; participant?: string },
  reaction: string,
) {
  return evoFetch(`/message/sendReaction/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({ key: messageKey, reaction }),
  });
}

export function isEvolutionConfigured() {
  return Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY);
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function phoneFromJid(value: unknown) {
  if (typeof value !== "string") return null;
  const left = value.split("@")[0]?.replace(/\D/g, "") ?? "";
  return left.length >= 7 ? left : null;
}

function directPhone(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

// Fetch instance info (phone/profile) by name from Evolution.
export async function fetchInstanceInfo(name: string): Promise<{
  phone: string | null;
  profileName: string | null;
  profilePicUrl: string | null;
  state: string | null;
  ownerJid: string | null;
} | null> {
  try {
    const body = await evoFetch(
      `/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`,
    );
    const anyBody: any = body;
    const records = anyBody?.instances ?? anyBody?.data ?? anyBody?.response ?? body;
    const arr = Array.isArray(records) ? records : [records];
    const found =
      arr.find((x: any) =>
        [x?.name, x?.instanceName, x?.instance?.name, x?.instance?.instanceName, x?.instance?.instanceId].includes(name),
      ) ?? arr[0];
    const inst = (found as any)?.instance ?? found;
    if (!inst) return null;
    const jid = firstText(
      inst.ownerJid,
      inst.owner,
      inst.jid,
      inst.me?.id,
      inst.me?.jid,
      inst.account?.id,
      inst.account?.jid,
      found?.ownerJid,
    );
    const profilePicUrl = firstText(
      inst.profilePicUrl,
      inst.profilePictureUrl,
      inst.profilePicture,
      inst.pictureUrl,
      inst.avatar,
      inst.me?.profilePictureUrl,
    );
    return {
      phone:
        directPhone(inst.number) ??
        directPhone(inst.phone) ??
        directPhone(inst.owner) ??
        directPhone(inst.me?.id) ??
        directPhone(inst.me?.lid) ??
        phoneFromJid(jid),
      profileName: firstText(inst.profileName, inst.name, inst.me?.name, inst.account?.name),
      profilePicUrl,
      state: inst.connectionStatus ?? inst.state ?? inst.status ?? null,
      ownerJid: jid,
    };
  } catch (e) {
    console.warn("[evolution] fetchInstanceInfo failed", e);
    return null;
  }
}

// Instance behaviour settings. Keeping alwaysOnline/readMessages disabled is what
// allows WhatsApp to keep pushing notifications to the owner's phone.
export async function setInstanceSettings(
  instance: string,
  overrides: Partial<{
    rejectCall: boolean;
    msgCall: string;
    groupsIgnore: boolean;
    alwaysOnline: boolean;
    readMessages: boolean;
    readStatus: boolean;
    syncFullHistory: boolean;
  }> = {},
) {
  const body = {
    rejectCall: false,
    msgCall: "",
    groupsIgnore: true,
    alwaysOnline: false,
    readMessages: false,
    readStatus: false,
    syncFullHistory: false,
    ...overrides,
  };
  return evoFetch(`/settings/set/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Edit an already-sent text message (WhatsApp allows this within ~15 minutes).
export async function updateMessage(
  instance: string,
  params: {
    number: string;
    text: string;
    key: { id: string; remoteJid: string; fromMe: boolean; participant?: string };
  },
) {
  return evoFetch(`/chat/updateMessage/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// Mark inbound messages as read on WhatsApp (syncs the phone's unread state).
export async function markMessagesAsRead(
  instance: string,
  keys: Array<{ id: string; remoteJid: string; fromMe: boolean; participant?: string }>,
) {
  if (!keys.length) return null;
  return evoFetch(`/chat/markMessageAsRead/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({ readMessages: keys }),
  });
}

// Typing / recording indicator for a chat.
export async function setPresence(
  instance: string,
  number: string,
  presence: "composing" | "recording" | "paused" | "available" | "unavailable",
) {
  return evoFetch(`/chat/sendPresence/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({ number, presence, delay: 800 }),
  });
}
