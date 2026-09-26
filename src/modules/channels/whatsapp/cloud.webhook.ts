/**
 * تطبيع ويبهوك Meta (Cloud API / Coexistence) إلى NormalizedEvent الموحّد.
 * لا يعرف شيئاً عن قاعدة البيانات — تحويل بيانات خالص.
 */
import type { MediaKind, NormalizedEvent, NormalizedMessage, NormalizedWebhook } from "./provider";

type AnyRec = Record<string, any>;

const MEDIA_KINDS: Record<string, MediaKind> = {
  image: "image",
  video: "video",
  audio: "audio",
  voice: "audio",
  document: "document",
  sticker: "image",
};

function isoFrom(ts: unknown): string {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

function jidOf(waId: string) {
  return `${String(waId).replace(/\D/g, "")}@s.whatsapp.net`;
}

function textOf(msg: AnyRec): string {
  if (msg.type === "text") return String(msg.text?.body ?? "");
  if (msg.type === "button") return String(msg.button?.text ?? "");
  if (msg.type === "interactive") {
    return String(
      msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? "",
    );
  }
  const media = msg[msg.type];
  return String(media?.caption ?? "");
}

function toNormalizedMessage(msg: AnyRec, contacts: AnyRec[], fromMe: boolean): NormalizedMessage | null {
  const peerId = fromMe ? msg.to ?? msg.recipient_id : msg.from;
  if (!peerId) return null;
  const digits = String(peerId).replace(/\D/g, "");
  const kind = MEDIA_KINDS[String(msg.type)] ?? null;
  const media = kind ? msg[msg.type] ?? {} : {};
  const contact = contacts.find((c) => String(c?.wa_id ?? "").replace(/\D/g, "") === digits);

  return {
    externalId: msg.id ? String(msg.id) : null,
    peer: jidOf(digits),
    identifier: digits,
    fromMe,
    text: textOf(msg),
    mediaKind: kind,
    ...(kind ? { mediaId: media.id ? String(media.id) : undefined } : {}),
    mediaMime: media.mime_type ? String(media.mime_type) : undefined,
    mediaFileName: media.filename ? String(media.filename) : undefined,
    ptt: msg.type === "audio" ? Boolean(media.voice) : undefined,
    pushName: contact?.profile?.name ? String(contact.profile.name) : null,
    profilePicUrl: null,
    occurredAt: isoFrom(msg.timestamp),
  };
}

/**
 * accountRef للمزوّد الرسمي هو `phone_number_id` — ثابت لا يتغير بإعادة الربط.
 */
export function normalizeCloudWebhook(payload: unknown): NormalizedWebhook {
  const root = (payload ?? {}) as AnyRec;
  const events: NormalizedEvent[] = [];
  let accountRef: string | null = null;

  for (const entry of (root.entry ?? []) as AnyRec[]) {
    for (const change of (entry.changes ?? []) as AnyRec[]) {
      const value = (change.value ?? {}) as AnyRec;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (phoneNumberId) accountRef = String(phoneNumberId);

      // رسائل واردة + صدى الرسائل الصادرة من تطبيق واتساب بزنس (Coexistence)
      for (const msg of (value.messages ?? []) as AnyRec[]) {
        if (msg.type === "reaction" && msg.reaction?.message_id) {
          events.push({
            kind: "message.reaction",
            targetExternalId: String(msg.reaction.message_id),
            emoji: String(msg.reaction.emoji ?? ""),
            peer: jidOf(msg.from ?? ""),
            actorName: null,
          });
          continue;
        }
        const selfNumber = String(value?.metadata?.display_phone_number ?? "").replace(/\D/g, "");
        const fromDigits = String(msg.from ?? "").replace(/\D/g, "");
        const fromMe = Boolean(selfNumber) && fromDigits === selfNumber;
        const normalized = toNormalizedMessage(msg, (value.contacts ?? []) as AnyRec[], fromMe);
        if (normalized) events.push({ kind: fromMe ? "message.out" : "message.in", message: normalized });
      }

      // Coexistence: صدى الرسائل التي أرسلها الموظف من تطبيق WhatsApp Business على جواله
      const echoes = (value.message_echoes ?? value.smb_message_echoes ?? []) as AnyRec[];
      for (const echo of echoes) {
        const normalized = toNormalizedMessage(echo, (value.contacts ?? []) as AnyRec[], true);
        if (normalized) events.push({ kind: "message.out", message: normalized });
      }

      // Coexistence: سجل المحادثات الذي ترسله Meta بعد الربط (آخر ٦ أشهر تدريجياً)
      for (const chunk of (value.history ?? []) as AnyRec[]) {
        const selfNumber = String(value?.metadata?.display_phone_number ?? "").replace(/\D/g, "");
        for (const thread of (chunk.threads ?? []) as AnyRec[]) {
          for (const msg of (thread.messages ?? []) as AnyRec[]) {
            const fromDigits = String(msg.from ?? "").replace(/\D/g, "");
            const fromMe = Boolean(selfNumber) && fromDigits === selfNumber;
            const normalized = toNormalizedMessage(
              { ...msg, to: msg.to ?? thread.id },
              (value.contacts ?? []) as AnyRec[],
              fromMe,
            );
            if (normalized) events.push({ kind: fromMe ? "message.out" : "message.in", message: normalized });
          }
        }
      }



      // حالات التسليم/القراءة + أخطاء الإرسال
      for (const st of (value.statuses ?? []) as AnyRec[]) {
        const raw = String(st.status ?? "");
        if (raw === "sent" || raw === "delivered" || raw === "read") {
          if (st.id) events.push({ kind: "message.status", externalId: String(st.id), status: raw });
        }
        if (raw === "failed") {
          const err = (st.errors ?? [])[0] ?? {};
          events.push({
            kind: "connection.state",
            state: "connected",
            rawState: "send_failed",
            statusReason: err.code ?? null,
            raw: { title: err.title ?? null, details: err.error_data?.details ?? null },
          });
        }
      }

      // تغيّرات حالة الرقم/الحساب من Meta
      if (change.field === "account_update" || change.field === "phone_number_quality_update") {
        const eventName = String(value.event ?? value.current_limit ?? "");
        const banned = /ban|disable|restrict/i.test(eventName);
        events.push({
          kind: "connection.state",
          state: banned ? "disconnected" : "connected",
          rawState: eventName || change.field,
          statusReason: banned ? "restricted" : null,
          raw: value,
        });
      }
    }
  }

  return { accountRef, events };
}
