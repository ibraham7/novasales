/**
 * Sending an attachment (photo, video, voice note, document) is finished in the background: the request
 * answers once the file is stored and a «sending» message is in the chat, and this hands the file to
 * WhatsApp, then marks the message sent or failed. The database and the WhatsApp calls are passed in,
 * so it is tested without either.
 */
export type MediaDeliveryInput = {
  db: any;
  organizationId: string;
  accountId: string;
  messageId: string;
  kind: "image" | "video" | "audio" | "document";
  fileName: string;
  mimeType: string;
  caption?: string | null;
  base64: string;
  fileBytes: number;
  /** A link the WhatsApp server can fetch (signed link of the stored file), when there is one. */
  mediaUrl: string | null;
  number: string;
  quoted?: unknown;
  ops: {
    opSendAudioNote: (accountId: string, number: string, audio: string, quoted?: any) => Promise<any>;
    opSendMedia: (accountId: string, number: string, params: any) => Promise<any>;
    sentExternalId: (response: any) => string | null;
  };
  risk: { recordOutbound: (input: { orgId: string; accountId: string }) => Promise<unknown>; recordHealthEvent: (input: any) => Promise<unknown> };
  log?: Pick<Console, "warn" | "error">;
};

// The WhatsApp server refuses request bodies over about 1 MB (HTTP 413) and base64 grows a file by a
// third, so a larger file goes as its link first instead of failing once before the retry.
export const RAW_BASE64_LIMIT = 700 * 1024;

export async function deliverMedia(input: MediaDeliveryInput) {
  const { db, ops, risk, organizationId: org } = input;
  const log = input.log ?? console;
  const preferBase64 = input.fileBytes <= RAW_BASE64_LIMIT || !input.mediaUrl;

  async function trySend(useBase64: boolean) {
    if (input.kind === "audio") {
      const res = await ops.opSendAudioNote(input.accountId, input.number, useBase64 ? input.base64 : (input.mediaUrl ?? input.base64), input.quoted ?? undefined);
      return ops.sentExternalId(res);
    }
    const media = useBase64 ? input.base64 : input.mediaUrl;
    if (!media) throw new Error("تعذّر تحضير الملف للإرسال");
    const res = await ops.opSendMedia(input.accountId, input.number, {
      mediatype: input.kind,
      media,
      mimetype: input.mimeType,
      fileName: input.fileName,
      caption: input.caption ?? undefined,
      quoted: input.quoted ?? undefined,
    });
    return ops.sentExternalId(res);
  }

  let externalId: string | null = null;
  let error: string | null = null;
  try {
    try {
      externalId = await trySend(preferBase64);
    } catch (first) {
      // Fallback: swap strategy (link <-> file) once.
      log.warn("[sendMedia] first attempt failed, retrying", first instanceof Error ? first.message : first);
      externalId = await trySend(!preferBase64);
    }
    await risk.recordOutbound({ orgId: org, accountId: input.accountId }).catch((e) => log.error("[sendMedia] recordOutbound failed", e));
  } catch (e) {
    error = e instanceof Error ? e.message : "فشل الإرسال";
    await risk.recordHealthEvent({ orgId: org, accountId: input.accountId, eventType: "send_failed", detail: { error } }).catch(() => {});
  }

  const { error: updateError } = await db
    .from("msg_messages")
    .update(error ? { status: "failed" } : { status: "sent", external_id: externalId })
    .eq("id", input.messageId)
    .eq("organization_id", org);
  if (updateError) log.error("[sendMedia] updating the message failed", updateError.message);
  return { sent: !error, error };
}
