/**
 * Sending a product to a chat happens in the background: the request answers as soon as the checks
 * pass and a «sending» message is in the chat, and this finishes the job (photos, videos, details)
 * and then marks the message sent or failed. The database and the WhatsApp calls are passed in, so it
 * is tested without either.
 */
export type MediaItem = { url: string; kind: "image" | "video" };

export type DeliveryInput = {
  db: any;
  organizationId: string;
  userId: string;
  chatId: string;
  accountId: string;
  /** The «sending» message that stands for the main photo with the details. */
  placeholderId: string;
  startedAt: number;
  media: MediaItem[];
  coverUrl: string | undefined;
  caption: string;
  product: { id: string; name: string; sku: string | null; price: number | string; currency: string };
  opportunity: { id: string; contact_id: string | null } | null;
  ops: { opSendText: (accountId: string, number: string, text: string) => Promise<any>; sentExternalId: (response: any) => string | null };
  number: string;
  /** Sends a photo or video (with the caption on the main photo); throws when it cannot. */
  sendMedia: (item: MediaItem, caption?: string) => Promise<any>;
  risk: { recordOutbound: (input: { orgId: string; accountId: string }) => Promise<unknown>; recordHealthEvent: (input: any) => Promise<unknown> };
  pauseMs: number;
  sleep: (ms: number) => Promise<unknown>;
  log?: Pick<Console, "warn" | "error">;
};

export async function deliverProduct(input: DeliveryInput) {
  const { db, organizationId: org, ops, risk } = input;
  const log = input.log ?? console;
  const productMeta = { source: "product", product_id: input.product.id, product_name: input.product.name, sku: input.product.sku, price: input.product.price, currency: input.product.currency };
  const outbound: Promise<unknown>[] = [];
  // Counting must never turn a message WhatsApp already accepted into a failure.
  const count = () => outbound.push(risk.recordOutbound({ orgId: org, accountId: input.accountId }).catch((e) => log.error("[product-chat] recordOutbound failed", e)));

  let imagesSent = 0;
  let videosSent = 0;
  let mediaFailed = 0;
  // The other photos and the videos go first; each appears in the chat as it is sent.
  for (const [i, item] of input.media.entries()) {
    if (i > 0) await input.sleep(input.pauseMs);
    try {
      const response = await input.sendMedia(item);
      count();
      if (item.kind === "image") imagesSent++;
      else videosSent++;
      const { error } = await db.from("msg_messages").insert({
        organization_id: org,
        session_id: input.chatId,
        external_id: ops.sentExternalId(response),
        direction: "outbound",
        message_type: item.kind,
        content: "",
        media_url: item.url,
        media_meta: productMeta,
        status: "sent",
        sent_by_user_id: input.userId,
        created_at: new Date(input.startedAt + i * 10).toISOString(),
      });
      if (error) log.error("[product-chat] saving a media message failed", error.message);
    } catch (error) {
      mediaFailed++;
      log.warn("[product-chat] media failed", item.kind, error instanceof Error ? error.message : error);
    }
  }

  // Last: the main photo with the details; if the photo cannot go, the details alone.
  let externalId: string | null = null;
  let coverSent = false;
  let sendError: string | null = null;
  try {
    if (input.media.length) await input.sleep(input.pauseMs);
    let response: any = null;
    if (input.coverUrl) {
      try {
        response = await input.sendMedia({ url: input.coverUrl, kind: "image" }, input.caption);
        coverSent = true;
      } catch (error) {
        log.warn("[product-chat] main photo failed", error instanceof Error ? error.message : error);
      }
    }
    if (!coverSent) response = await ops.opSendText(input.accountId, input.number, input.caption);
    externalId = ops.sentExternalId(response);
    count();
  } catch (error) {
    sendError = error instanceof Error ? error.message : "فشل إرسال المنتج";
    await risk.recordHealthEvent({ orgId: org, accountId: input.accountId, eventType: "send_failed", detail: { error: sendError, source: "product" } }).catch(() => {});
  }

  const patch = sendError ? { status: "failed" } : { status: "sent", external_id: externalId, ...(coverSent ? {} : { message_type: "text", media_url: null }) };
  const { error: updateError } = await db.from("msg_messages").update(patch).eq("id", input.placeholderId).eq("organization_id", org);
  if (updateError) log.error("[product-chat] updating the message failed", updateError.message);

  if (!sendError) {
    await db.from("sales_product_interactions").insert({
      organization_id: org,
      product_id: input.product.id,
      session_id: input.chatId,
      opportunity_id: input.opportunity?.id ?? null,
      contact_id: input.opportunity?.contact_id ?? null,
      user_id: input.userId,
      interaction_type: "sent",
    });
  }
  await Promise.all(outbound);
  return { sent: !sendError, error: sendError, coverSent, imagesSent: imagesSent + (coverSent ? 1 : 0), videosSent, mediaFailed };
}
