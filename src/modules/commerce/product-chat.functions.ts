import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { formatProductCaption } from "./product-caption";

const SendProductInput = z.object({
  chatId: z.string().uuid(),
  productId: z.string().uuid(),
});

function stockOf(product: any) {
  const inventory = product?.sales_inventory;

  if (Array.isArray(inventory)) {
    return Number(inventory[0]?.quantity ?? 0);
  }

  return Number(inventory?.quantity ?? 0);
}


function guessImageMime(url: string) {
  const clean = url.toLowerCase().split("?")[0];

  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".gif")) return "image/gif";

  return "image/jpeg";
}

function guessVideoMime(url: string) {
  const clean = url.toLowerCase().split("?")[0];
  if (clean.endsWith(".webm")) return "video/webm";
  if (clean.endsWith(".mov")) return "video/quicktime";
  return "video/mp4";
}

// Pause between the product's messages so they arrive in order and WhatsApp does not read a burst
// of media as spam.
const BETWEEN_MEDIA_MS = 900;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
// The WhatsApp server refuses request bodies over about 1 MB (HTTP 413), and base64 grows a file by a
// third, so only images up to this size are sent as the file itself.
const MAX_INLINE_IMAGE_BYTES = 700 * 1024;

/** Images uploaded to our own storage have public links the WhatsApp server can always fetch. */
function isOwnStorageUrl(url: string) {
  return /^https:\/\/[^/]+\/storage\/v1\/object\/public\//i.test(url);
}

function isTooLarge(error: unknown) {
  return /\b413\b|too large/i.test(error instanceof Error ? error.message : String(error));
}

/** Fetches a product image for sending as a file; null when it is unreachable, not an image or too large. */
async function downloadProductImage(url: string) {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "follow" });
    if (!response.ok) return null;
    const declared = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const mimetype = declared.startsWith("image/") ? declared : guessImageMime(url);
    if (declared && !declared.startsWith("image/")) return null;
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_PRODUCT_IMAGE_BYTES) return null;
    const extension = mimetype === "image/png" ? "png" : mimetype === "image/webp" ? "webp" : mimetype === "image/gif" ? "gif" : "jpg";
    return {
      base64: Buffer.from(bytes).toString("base64"),
      mimetype,
      fileName: `product.${extension}`,
    };
  } catch (error) {
    console.warn("[product-chat] image download failed", error instanceof Error ? error.message : error);
    return null;
  }
}

export const sendProductToChatFn = createServerFn({
  method: "POST",
})
  .inputValidator((d: unknown) =>
    SendProductInput.parse(d),
  )
  .handler(async ({ data }) => {
    const [
      { getWorkspace, supabaseAdmin },
      { requireAnyPermission },
      scope,
    ] = await Promise.all([
      import("@/platform/workspace/workspace.server"),
      import("@/platform/rbac/rbac.server"),
      import("@/platform/rbac/data-scope.server"),
    ]);

    const db = supabaseAdmin as any;

    const { organizationId, userId } =
      await getWorkspace();

    // Permission and the three reads are independent: one parallel round.
    const [access, productRes, sessionRes, linkRes, definitionsRes] =
      await Promise.all([
        requireAnyPermission([
          "messaging.send",
        ]),

        db
          .from("sales_products")
          .select(`
            id,
            name,
            sku,
            description,
            price,
            currency,
            images,
            videos,
            attributes,
            is_active,
            sales_inventory(quantity),
            sales_product_variants!sales_variants_product_scope_fk(id, attributes),
            sales_stock_batches!sales_stock_batches_product_id_fkey(variant_id, quantity, expires_on)
          `)
          .eq("id", data.productId)
          .eq(
            "organization_id",
            organizationId,
          )
          .maybeSingle(),

        db
          .from("msg_sessions")
          .select(
            "id, channel_account_id, peer_identifier",
          )
          .eq("id", data.chatId)
          .eq(
            "organization_id",
            organizationId,
          )
          .maybeSingle(),

        db
          .from("crm_opportunity_sessions")
          .select(
            "opportunity_id, opp_opportunities(id, contact_id, owner_agent_id, department_id, organization_id)",
          )
          .eq(
            "organization_id",
            organizationId,
          )
          .eq("session_ref", data.chatId)
          .maybeSingle(),

        // Property names for the caption (fabric, sizes…).
        db
          .from("sales_product_attributes")
          .select("id, name, kind, scope, is_archived, is_price_floor")
          .eq("organization_id", organizationId),
      ]);

    if (
      !access.isSuperAdmin &&
      !access.permissions.includes("products.view")
    ) {
      throw new Error(
        "لا تملك صلاحية عرض المنتجات",
      );
    }

    const product = productRes?.data;
    const session = sessionRes?.data;
    const chatLink = linkRes?.data;

    if (!product) {
      throw new Error("المنتج غير موجود");
    }

    if (!product.is_active) {
      throw new Error("هذا المنتج غير نشط");
    }

    if (stockOf(product) <= 0) {
      throw new Error(
        "هذا المنتج غير متوفر في المخزون",
      );
    }

    if (!session) {
      throw new Error("المحادثة غير موجودة");
    }

    let opportunity: any = null;

    if (chatLink?.opportunity_id) {
      const embedded = chatLink.opp_opportunities;
      const linked = Array.isArray(embedded) ? embedded[0] : embedded;
      const opp =
        linked?.organization_id === organizationId
          ? linked
          : null;

      opportunity = opp;

      if (
        !opp ||
        !scope.canAccessOpportunityRow(
          access,
          opp,
        )
      ) {
        throw new Error(
          "لا تملك صلاحية الإرسال في هذه المحادثة",
        );
      }
    } else if (
      scope.getOpportunityVisibility(access) !==
      "all"
    ) {
      throw new Error(
        "هذه المحادثة غير مرتبطة بفرصة مبيعات",
      );
    }

    const [{ resolveAccountProvider }, ops, risk] =
      await Promise.all([
        import(
          "@/modules/channels/whatsapp/registry.server"
        ),
        import(
          "@/modules/channels/whatsapp/channel-ops.server"
        ),
        import("@/modules/risk/risk.server"),
      ]);

    const imageUrl =
      Array.isArray(product.images) &&
      product.images.length
        ? String(product.images[0])
        : null;

    // Permission is confirmed above: fetch the image while the engine and risk checks run.
    const [providerRef, guard, image] =
      await Promise.all([
        resolveAccountProvider(
          session.channel_account_id,
        ),
        risk.riskGuard({
          orgId: organizationId,
          accountId: session.channel_account_id,
          source: "manual",
          peer: session.peer_identifier,
        }),
        imageUrl && !isOwnStorageUrl(imageUrl)
          ? downloadProductImage(imageUrl)
          : Promise.resolve(null),
      ]);

    if (!providerRef.provider.isConfigured()) {
      throw new Error(
        `محرّك ${providerRef.provider.label} غير مُهيأ.`,
      );
    }

    if (!guard.allowed) {
      throw new Error(
        guard.message ??
          "تم إيقاف الإرسال من هذا الرقم مؤقتاً لحمايته.",
      );
    }

    const number = String(
      session.peer_identifier,
    ).split("@")[0];

    const caption =
      formatProductCaption(product, definitionsRes?.data ?? []);

    let externalId: string | null = null;
    let mediaSent = false;
    let usedTextFallback = false;
    let sendError: string | null = null;
    let outboundRecorded: Promise<unknown> =
      Promise.resolve();

    try {
      const sendImageLink = (url: string) =>
        ops.opSendMedia(session.channel_account_id, number, {
          mediatype: "image",
          media: url,
          mimetype: guessImageMime(url),
          fileName: `product.${guessImageMime(url).split("/")[1].replace("jpeg", "jpg")}`,
          caption,
        });

      if (imageUrl && isOwnStorageUrl(imageUrl)) {
        // Our own storage link is always reachable, so the WhatsApp server fetches it itself and the
        // request stays small whatever the image size.
        const response: any = await sendImageLink(imageUrl);
        externalId = ops.sentExternalId(response);
        mediaSent = true;
      } else if (imageUrl) {
        // Other links: download the image here and send the file itself, since the WhatsApp server
        // accepts a link it later fails to fetch (e.g. search-engine thumbnails) and the customer
        // gets nothing. A file too large for its request limit is sent as the link instead.
        if (image) {
          const tooLargeInline = Buffer.byteLength(image.base64, "base64") > MAX_INLINE_IMAGE_BYTES;
          let response: any;
          if (tooLargeInline) {
            response = await sendImageLink(imageUrl);
          } else {
            try {
              response = await ops.opSendMedia(session.channel_account_id, number, {
                mediatype: "image",
                media: image.base64,
                mimetype: image.mimetype,
                fileName: image.fileName,
                caption,
              });
            } catch (error) {
              if (!isTooLarge(error)) throw error;
              response = await sendImageLink(imageUrl);
            }
          }

          externalId =
            ops.sentExternalId(response);

          mediaSent = true;
        } else {
          const response: any =
            await ops.opSendText(
              session.channel_account_id,
              number,
              caption,
            );

          externalId =
            ops.sentExternalId(response);

          usedTextFallback = true;
        }
      } else {
        const response: any =
          await ops.opSendText(
            session.channel_account_id,
            number,
            caption,
          );

        externalId =
          ops.sentExternalId(response);
      }

      // Counting must never turn a product WhatsApp already accepted into a failure.
      outboundRecorded = risk
        .recordOutbound({
          orgId: organizationId,
          accountId:
            session.channel_account_id,
        })
        .catch((e) =>
          console.error(
            "[product-chat] recordOutbound failed",
            e,
          ),
        );
    } catch (error) {
      sendError =
        error instanceof Error
          ? error.message
          : "فشل إرسال المنتج";

      await risk.recordHealthEvent({
        orgId: organizationId,
        accountId:
          session.channel_account_id,
        eventType: "send_failed",
        detail: {
          error: sendError,
          source: "product",
        },
      });
    }

    const status = sendError
      ? "failed"
      : "sent";

    // After the first message (the first image with the details), the product's other images and then
    // its videos follow, each as its own message. One of them failing does not undo what was sent.
    const extraMedia: { url: string; kind: "image" | "video" }[] = sendError
      ? []
      : [
          ...(Array.isArray(product.images) ? product.images.slice(imageUrl ? 1 : 0) : []).map((u: unknown) => ({
            url: String(u),
            kind: "image" as const,
          })),
          ...(Array.isArray(product.videos) ? product.videos : []).map((u: unknown) => ({
            url: String(u),
            kind: "video" as const,
          })),
        ].filter((m) => /^https?:\/\//i.test(m.url));
    const extraSent: { url: string; kind: "image" | "video"; externalId: string | null }[] = [];
    let extraFailed = 0;
    const extraOutbound: Promise<unknown>[] = [];
    for (const media of extraMedia) {
      await sleep(BETWEEN_MEDIA_MS);
      try {
        let response: any;
        if (media.kind === "video" || isOwnStorageUrl(media.url)) {
          // Our storage links (and any video) go as links: the WhatsApp server fetches them itself.
          const mimetype = media.kind === "video" ? guessVideoMime(media.url) : guessImageMime(media.url);
          response = await ops.opSendMedia(session.channel_account_id, number, {
            mediatype: media.kind,
            media: media.url,
            mimetype,
            fileName: `product.${mimetype.split("/")[1].replace("jpeg", "jpg").replace("quicktime", "mov")}`,
          });
        } else {
          const file = await downloadProductImage(media.url);
          if (!file) throw new Error("تعذر تنزيل الصورة");
          const inline = Buffer.byteLength(file.base64, "base64") <= MAX_INLINE_IMAGE_BYTES;
          response = await ops.opSendMedia(session.channel_account_id, number, {
            mediatype: "image",
            media: inline ? file.base64 : media.url,
            mimetype: file.mimetype,
            fileName: file.fileName,
          });
        }
        extraSent.push({ ...media, externalId: ops.sentExternalId(response) });
        extraOutbound.push(
          risk
            .recordOutbound({ orgId: organizationId, accountId: session.channel_account_id })
            .catch((e) => console.error("[product-chat] recordOutbound failed", e)),
        );
      } catch (error) {
        extraFailed++;
        console.warn("[product-chat] extra media failed", media.kind, error instanceof Error ? error.message : error);
      }
    }

    const productMeta = {
      source: "product",
      product_id: product.id,
      product_name: product.name,
      sku: product.sku,
      price: product.price,
      currency: product.currency,
    };
    // One insert with increasing times keeps the chat in the order the customer received them.
    const startedAt = Date.now();
    const messageInsert = db
      .from("msg_messages")
      .insert([
        {
          organization_id: organizationId,
          session_id: data.chatId,
          external_id: externalId,
          direction: "outbound",
          message_type: mediaSent ? "image" : "text",
          content: caption,
          media_url: mediaSent ? imageUrl : null,
          media_meta: productMeta,
          status,
          sent_by_user_id: userId,
          created_at: new Date(startedAt).toISOString(),
        },
        ...extraSent.map((media, i) => ({
          organization_id: organizationId,
          session_id: data.chatId,
          external_id: media.externalId,
          direction: "outbound",
          message_type: media.kind,
          content: "",
          media_url: media.url,
          media_meta: productMeta,
          status: "sent",
          sent_by_user_id: userId,
          created_at: new Date(startedAt + (i + 1) * 10).toISOString(),
        })),
      ])
      .select("id, created_at");

    const previewUpdate = db
      .from("msg_sessions")
      .update({
        last_message_preview:
          `📦 ${product.name} — ${Number(
            product.price,
          )} ${product.currency}`,

        last_message_at:
          new Date().toISOString(),
      })
      .eq("id", data.chatId)
      .eq(
        "organization_id",
        organizationId,
      );

    const interactionInsert = sendError
      ? Promise.resolve()
      : db
        .from(
          "sales_product_interactions",
        )
        .insert({
          organization_id:
            organizationId,

          product_id: product.id,

          session_id: data.chatId,

          opportunity_id:
            opportunity?.id ?? null,

          contact_id:
            opportunity?.contact_id ??
            null,

          user_id: userId,

          interaction_type: "sent",
        });

    const [{ data: messages, error: messageError }] =
      await Promise.all([
        messageInsert,
        previewUpdate,
        interactionInsert,
        outboundRecorded,
        ...extraOutbound,
      ]);

    if (messageError) {
      throw new Error(
        messageError.message,
      );
    }

    if (sendError) {
      throw new Error(sendError);
    }

    return {
      ok: true,
      messageId: messages?.[0]?.id,
      mediaSent,
      usedTextFallback,
      productName: product.name,
      imagesSent: (mediaSent ? 1 : 0) + extraSent.filter((m) => m.kind === "image").length,
      videosSent: extraSent.filter((m) => m.kind === "video").length,
      mediaFailed: extraFailed,
    };
  });