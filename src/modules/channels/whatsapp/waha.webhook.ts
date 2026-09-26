// تطبيع أحداث WAHA إلى الأحداث الموحّدة (NormalizedEvent).
// كل ما هو خاص بشكل payload الخاص بـWAHA يبقى هنا فقط.
import type { MediaKind, NormalizedEvent, NormalizedMessage, NormalizedWebhook, ProviderStatus } from "./provider";

const STATE_MAP: Record<string, ProviderStatus["state"]> = {
  WORKING: "connected",
  STARTING: "connecting",
  SCAN_QR_CODE: "connecting",
  STOPPED: "disconnected",
  FAILED: "disconnected",
};

export function mapWahaStatus(status?: string | null): ProviderStatus["state"] {
  if (!status) return "unknown";
  return STATE_MAP[String(status).toUpperCase()] ?? "unknown";
}

function isDirectChat(jid?: string | null): boolean {
  if (!jid) return false;
  return !(jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid === "status@broadcast");
}

function normalizeJid(jid: string): string {
  return jid.endsWith("@c.us") ? `${jid.split("@")[0]}@s.whatsapp.net` : jid;
}

function mediaKindOf(mimetype?: string | null, isPtt?: boolean): { kind: MediaKind | null; ptt?: boolean } {
  if (!mimetype) return { kind: null };
  if (mimetype.startsWith("image/")) return { kind: "image" };
  if (mimetype.startsWith("video/")) return { kind: "video" };
  if (mimetype.startsWith("audio/")) return { kind: "audio", ptt: isPtt ? true : undefined };
  return { kind: "document" };
}

function buildMessage(p: any): NormalizedMessage | null {
  const fromMe = Boolean(p?.fromMe);
  const rawPeer: string | undefined = fromMe ? p?.to : p?.from;
  if (!rawPeer || !isDirectChat(rawPeer)) return null;
  if (p?.participant) return null; // مجموعات

  const media = p?.media ?? null;
  const mime: string | undefined = media?.mimetype ?? p?._data?.mimetype;
  const { kind, ptt } = mediaKindOf(mime, Boolean(p?._data?.isPtt ?? p?._data?.ptt));
  const peer = normalizeJid(rawPeer);
  const externalId: string | null = typeof p?.id === "string" ? p.id : null;
  const tsRaw = Number(p?.timestamp ?? 0);
  const occurredAt = tsRaw
    ? new Date(tsRaw > 1e12 ? tsRaw : tsRaw * 1000).toISOString()
    : new Date().toISOString();

  return {
    externalId,
    peer,
    identifier: peer.split("@")[0] ?? "",
    fromMe,
    text: typeof p?.body === "string" ? p.body : "",
    mediaKind: kind,
    mediaMime: mime,
    mediaFileName: media?.filename ?? p?._data?.filename ?? undefined,
    ptt,
    pushName:
      (typeof p?.notifyName === "string" && p.notifyName) ||
      (typeof p?._data?.notifyName === "string" && p._data.notifyName) ||
      null,
    profilePicUrl: null,
    occurredAt,
  };
}

export function normalizeWahaWebhook(payload: unknown): NormalizedWebhook {
  const body = payload as any;
  const accountRef: string | null = typeof body?.session === "string" ? body.session : null;
  const events: NormalizedEvent[] = [];
  if (!body) return { accountRef, events };

  const event = String(body.event ?? "").toLowerCase();
  const p = body.payload ?? {};

  if (event === "session.status") {
    const rawState = String(p?.status ?? "");
    events.push({ kind: "connection.state", state: mapWahaStatus(rawState), rawState, raw: p });
    return { accountRef, events };
  }

  if (event === "message" || event === "message.any") {
    const items = Array.isArray(p) ? p : [p];
    for (const item of items) {
      const msg = buildMessage(item);
      if (!msg) continue;
      events.push({ kind: msg.fromMe ? "message.out" : "message.in", message: msg });
    }
    return { accountRef, events };
  }

  if (event === "message.reaction") {
    const messageId = p?.reaction?.messageId ?? p?.reaction?.id;
    const emoji = p?.reaction?.text ?? "";
    const rawPeer = p?.from ?? p?.to;
    if (messageId && isDirectChat(rawPeer)) {
      events.push({
        kind: "message.reaction",
        targetExternalId: String(messageId),
        emoji: String(emoji),
        peer: normalizeJid(String(rawPeer)),
        actorName: typeof p?.notifyName === "string" ? p.notifyName : null,
      });
    }
    return { accountRef, events };
  }

  if (event === "message.ack") {
    const ackName = String(p?.ackName ?? "").toUpperCase();
    const map: Record<string, "sent" | "delivered" | "read"> = {
      SERVER: "sent",
      SENT: "sent",
      DEVICE: "delivered",
      DELIVERED: "delivered",
      READ: "read",
      PLAYED: "read",
    };
    const status = map[ackName];
    const externalId = typeof p?.id === "string" ? p.id : null;
    if (status && externalId) events.push({ kind: "message.status", externalId, status });
    return { accountRef, events };
  }

  return { accountRef, events };
}
