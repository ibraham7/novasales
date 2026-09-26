// WAHA HTTP client — تفصيل داخلي لمزوّد WAHA (لا يُستورد من خارج مجلد المزوّد).
// المرجع: https://waha.devlike.pro/docs/how-to/  (Core/Plus REST API)

function baseUrl(): string {
  return (process.env.WAHA_API_URL ?? "").replace(/\/$/, "");
}

function apiKey(): string {
  return process.env.WAHA_API_KEY ?? "";
}

export function isWahaConfigured(): boolean {
  return Boolean(baseUrl() && apiKey());
}

export function wahaServerHost(): string | null {
  return baseUrl().replace(/^https?:\/\//, "") || null;
}

async function request<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T | null> {
  if (!isWahaConfigured()) throw new Error("WAHA غير مُهيّأ: أضف WAHA_API_URL و WAHA_API_KEY.");
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      "X-Api-Key": apiKey(),
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WAHA ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** chatId بصيغة WAHA: 9665xxxxxxx@c.us */
export function toChatId(identifier: string): string {
  if (identifier.includes("@")) {
    return identifier.endsWith("@s.whatsapp.net")
      ? `${identifier.split("@")[0]}@c.us`
      : identifier;
  }
  return `${identifier.replace(/\D/g, "")}@c.us`;
}

const WEBHOOK_EVENTS = [
  "session.status",
  "message",
  "message.any",
  "message.ack",
  "message.reaction",
  "message.revoked",
];

export async function createSession(name: string, webhookUrl?: string) {
  return request("POST", "/api/sessions", {
    name,
    start: true,
    config: {
      ...(webhookUrl ? { webhooks: [{ url: webhookUrl, events: WEBHOOK_EVENTS }] } : {}),
    },
  });
}

export async function updateSessionWebhook(name: string, webhookUrl: string) {
  return request("PUT", `/api/sessions/${encodeURIComponent(name)}`, {
    config: { webhooks: [{ url: webhookUrl, events: WEBHOOK_EVENTS }] },
  });
}

export async function startSession(name: string) {
  return request("POST", `/api/sessions/${encodeURIComponent(name)}/start`, {});
}

export async function stopSession(name: string) {
  return request("POST", `/api/sessions/${encodeURIComponent(name)}/stop`, {});
}

export async function logoutSession(name: string) {
  return request("POST", `/api/sessions/${encodeURIComponent(name)}/logout`, {});
}

export async function deleteSession(name: string) {
  return request("DELETE", `/api/sessions/${encodeURIComponent(name)}`);
}

export type WahaSessionInfo = {
  name?: string;
  status?: string;
  me?: { id?: string; pushName?: string } | null;
  engine?: { engine?: string } | Record<string, unknown> | null;
  config?: { webhooks?: Array<{ url?: string }> } | null;
};

export async function getSession(name: string): Promise<WahaSessionInfo | null> {
  return request<WahaSessionInfo>("GET", `/api/sessions/${encodeURIComponent(name)}`);
}

export async function getQr(name: string): Promise<string | null> {
  const res = await request<{ mimetype?: string; data?: string }>(
    "GET",
    `/api/${encodeURIComponent(name)}/auth/qr?format=image`,
  );
  return res?.data ?? null;
}

export async function getQrValue(name: string): Promise<string | null> {
  const res = await request<{ value?: string }>(
    "GET",
    `/api/${encodeURIComponent(name)}/auth/qr?format=raw`,
  );
  return res?.value ?? null;
}

export async function sendText(name: string, identifier: string, text: string, replyTo?: string) {
  return request<Record<string, unknown>>("POST", "/api/sendText", {
    session: name,
    chatId: toChatId(identifier),
    text,
    ...(replyTo ? { reply_to: replyTo } : {}),
  });
}

export async function sendMedia(
  name: string,
  identifier: string,
  params: {
    mediatype: "image" | "video" | "document";
    media: string; // base64 أو URL
    mimetype?: string;
    fileName?: string;
    caption?: string;
    replyTo?: string;
  },
) {
  const endpoint =
    params.mediatype === "image" ? "/api/sendImage" : params.mediatype === "video" ? "/api/sendVideo" : "/api/sendFile";
  const isUrl = /^https?:\/\//i.test(params.media);
  return request<Record<string, unknown>>("POST", endpoint, {
    session: name,
    chatId: toChatId(identifier),
    ...(params.caption ? { caption: params.caption } : {}),
    ...(params.replyTo ? { reply_to: params.replyTo } : {}),
    file: {
      mimetype: params.mimetype ?? "application/octet-stream",
      filename: params.fileName ?? "file",
      ...(isUrl ? { url: params.media } : { data: params.media.replace(/^data:[^;]+;base64,/, "") }),
    },
  });
}

export async function sendVoice(name: string, identifier: string, audioBase64: string, replyTo?: string) {
  return request<Record<string, unknown>>("POST", "/api/sendVoice", {
    session: name,
    chatId: toChatId(identifier),
    ...(replyTo ? { reply_to: replyTo } : {}),
    file: {
      mimetype: "audio/ogg; codecs=opus",
      filename: "voice.ogg",
      data: audioBase64.replace(/^data:[^;]+;base64,/, ""),
    },
  });
}

export async function sendReaction(name: string, messageId: string, emoji: string) {
  return request("PUT", "/api/reaction", { session: name, messageId, reaction: emoji });
}

export async function editMessage(name: string, chatId: string, messageId: string, text: string) {
  return request(
    "PUT",
    `/api/${encodeURIComponent(name)}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
    { text },
  );
}

export async function deleteMessage(name: string, chatId: string, messageId: string) {
  return request(
    "DELETE",
    `/api/${encodeURIComponent(name)}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
  );
}

export async function sendSeen(name: string, chatId: string, messageId?: string) {
  return request("POST", "/api/sendSeen", {
    session: name,
    chatId,
    ...(messageId ? { messageId } : {}),
  });
}

export async function setTyping(name: string, identifier: string, on: boolean) {
  return request("POST", on ? "/api/startTyping" : "/api/stopTyping", {
    session: name,
    chatId: toChatId(identifier),
  });
}

export async function fetchMessages(name: string, chatId: string, limit = 100) {
  const res = await request<unknown[]>(
    "GET",
    `/api/${encodeURIComponent(name)}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&downloadMedia=false`,
  );
  return Array.isArray(res) ? res : [];
}

export async function getProfilePicture(name: string, identifier: string): Promise<string | null> {
  const res = await request<{ profilePictureURL?: string | null }>(
    "GET",
    `/api/contacts/profile-picture?session=${encodeURIComponent(name)}&contactId=${encodeURIComponent(toChatId(identifier))}`,
  ).catch(() => null);
  return res?.profilePictureURL ?? null;
}
