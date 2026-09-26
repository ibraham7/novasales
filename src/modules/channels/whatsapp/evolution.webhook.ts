// تطبيع أحداث Evolution API إلى الأحداث الموحّدة (NormalizedEvent).
// كل ما هو خاص بشكل payload الخاص بـEvolution يبقى هنا فقط.
import type { MediaKind, NormalizedEvent, NormalizedMessage, NormalizedWebhook, ProviderStatus } from "./provider";

const STATE_MAP: Record<string, ProviderStatus["state"]> = {
  open: "connected",
  close: "disconnected",
  connecting: "connecting",
};

function accountRefOf(payload: any): string | null {
  const raw = payload?.instance;
  if (typeof raw === "string" && raw) return raw;
  const name = raw?.instanceName ?? raw?.name;
  return typeof name === "string" && name ? name : null;
}

function buildMessage(data: any): NormalizedMessage | null {
  const key = (data?.key ?? {}) as {
    remoteJid?: string;
    fromMe?: boolean;
    id?: string;
    participant?: string;
  };
  const remoteJid = key.remoteJid;
  if (!remoteJid) return null;
  // مجموعات / بث / حالات → ليست محادثات 1:1
  if (
    remoteJid.endsWith("@g.us") ||
    remoteJid.endsWith("@broadcast") ||
    remoteJid === "status@broadcast" ||
    key.participant
  ) {
    return null;
  }
  const message = (data?.message ?? {}) as Record<string, any>;
  const imageMsg = message.imageMessage;
  const videoMsg = message.videoMessage;
  const audioMsg = message.audioMessage;
  const docMsg = message.documentMessage;
  const stickerMsg = message.stickerMessage;
  const externalId = key.id ?? null;

  let mediaKind: MediaKind | null = null;
  let mediaMime: string | undefined;
  let mediaFileName: string | undefined;
  if (imageMsg) {
    mediaKind = "image";
    mediaMime = imageMsg.mimetype;
    mediaFileName = `image-${externalId ?? Date.now()}.jpg`;
  } else if (videoMsg) {
    mediaKind = "video";
    mediaMime = videoMsg.mimetype;
    mediaFileName = `video-${externalId ?? Date.now()}.mp4`;
  } else if (audioMsg) {
    mediaKind = "audio";
    mediaMime = audioMsg.mimetype;
    mediaFileName = `audio-${externalId ?? Date.now()}.ogg`;
  } else if (docMsg) {
    mediaKind = "document";
    mediaMime = docMsg.mimetype;
    mediaFileName = docMsg.fileName ?? docMsg.title ?? `file-${externalId ?? Date.now()}`;
  } else if (stickerMsg) {
    mediaKind = "image";
    mediaMime = stickerMsg.mimetype;
    mediaFileName = `sticker-${externalId ?? Date.now()}.webp`;
  }

  const text: string =
    message.conversation ??
    message.extendedTextMessage?.text ??
    imageMsg?.caption ??
    videoMsg?.caption ??
    docMsg?.caption ??
    "";

  const profilePicUrl =
    data?.profilePicUrl ?? data?.profilePictureUrl ?? data?.contact?.profilePicUrl ?? data?.contact?.profilePictureUrl ?? null;

  return {
    externalId,
    peer: remoteJid,
    identifier: remoteJid.split("@")[0] ?? "",
    fromMe: Boolean(key.fromMe),
    text: typeof text === "string" ? text : "",
    mediaKind,
    mediaMime,
    mediaFileName,
    ptt: audioMsg?.ptt ? true : undefined,
    pushName: typeof data?.pushName === "string" ? data.pushName : null,
    profilePicUrl,
    occurredAt: data?.messageTimestamp
      ? new Date(Number(data.messageTimestamp) * 1000).toISOString()
      : new Date().toISOString(),
  };
}

export function normalizeEvolutionWebhook(payload: unknown): NormalizedWebhook {
  const p = payload as any;
  const accountRef = accountRefOf(p);
  const events: NormalizedEvent[] = [];
  if (!p) return { accountRef, events };

  const event = String(p.event ?? "").toUpperCase().replace(/[.\-]/g, "_");
  const data = (p.data ?? {}) as any;

  if (event === "CONNECTION_UPDATE") {
    const rawState = String(data.state ?? "");
    events.push({
      kind: "connection.state",
      state: STATE_MAP[rawState] ?? "unknown",
      rawState,
      statusReason: data.statusReason,
      raw: data,
    });
    return { accountRef, events };
  }

  if (event === "QRCODE_UPDATED") {
    const base64 = data?.qrcode?.base64 ?? data?.base64;
    if (typeof base64 === "string") events.push({ kind: "qr.updated", base64 });
    return { accountRef, events };
  }

  if (event === "MESSAGES_UPSERT") {
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      const reaction = item?.message?.reactionMessage;
      if (reaction?.key?.id) {
        events.push({
          kind: "message.reaction",
          targetExternalId: String(reaction.key.id),
          emoji: String(reaction.text ?? ""),
          peer: String(item?.key?.remoteJid ?? ""),
          actorName: item?.pushName ?? null,
        });
        continue;
      }
      const msg = buildMessage(item);
      if (!msg) continue;
      events.push({ kind: msg.fromMe ? "message.out" : "message.in", message: msg });
    }
    return { accountRef, events };
  }

  if (event === "MESSAGES_UPDATE" || event === "MESSAGE_UPDATE") {
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      const id = item?.key?.id;
      if (!id) continue;
      const status = String(item?.status ?? item?.update?.status ?? "").toUpperCase();
      const isRead = status === "READ" || status === "PLAYED";
      const isDelivered = status === "DELIVERY_ACK" || status === "DELIVERED";
      const isSent = status === "SERVER_ACK";
      if (!isRead && !isDelivered && !isSent) continue;
      events.push({
        kind: "message.status",
        externalId: String(id),
        status: isRead ? "read" : isDelivered ? "delivered" : "sent",
        inboundRead: isRead,
      });
    }
    return { accountRef, events };
  }

  if (event === "CHATS_UPDATE" || event === "CHAT_UPDATE") {
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      const jid = String(item?.id ?? item?.remoteJid ?? "");
      const unread = item?.unreadCount;
      if (jid && (unread === 0 || unread === "0")) events.push({ kind: "chat.read", peer: jid });
    }
    return { accountRef, events };
  }

  return { accountRef, events };
}
