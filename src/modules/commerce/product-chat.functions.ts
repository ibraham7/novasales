import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

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

function formatProductCaption(product: any) {
  return [
    `📦 ${product.name}`,
    product.description?.trim() || null,
    `💰 السعر: ${Number(product.price)} ${product.currency}`,
    product.sku ? `🔖 SKU: ${product.sku}` : null,
    "✅ متوفر الآن",
  ]
    .filter(Boolean)
    .join("\n");
}

function guessImageMime(url: string) {
  const clean = url.toLowerCase().split("?")[0];

  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".gif")) return "image/gif";

  return "image/jpeg";
}

const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

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
    const [access, productRes, sessionRes, linkRes] =
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
            is_active,
            sales_inventory(quantity)
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
        imageUrl
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
      formatProductCaption(product);

    let externalId: string | null = null;
    let mediaSent = false;
    let usedTextFallback = false;
    let sendError: string | null = null;
    let outboundRecorded: Promise<unknown> =
      Promise.resolve();

    try {
      if (imageUrl) {
        // Download the image here and send the file itself: the WhatsApp server accepts a
        // link it later fails to fetch (e.g. search-engine thumbnails) and the customer gets nothing.
        if (image) {
          const response: any =
            await ops.opSendMedia(
              session.channel_account_id,
              number,
              {
                mediatype: "image",
                media: image.base64,
                mimetype: image.mimetype,
                fileName: image.fileName,
                caption,
              },
            );

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

    // Message row, chat preview, interaction and risk counters are independent writes.
    const messageInsert =
      db
        .from("msg_messages")
        .insert({
          organization_id:
            organizationId,

          session_id: data.chatId,

          external_id: externalId,

          direction: "outbound",

          message_type: mediaSent
            ? "image"
            : "text",

          content: caption,

          media_url: mediaSent
            ? imageUrl
            : null,

          media_meta: {
            source: "product",
            product_id: product.id,
            product_name: product.name,
            sku: product.sku,
            price: product.price,
            currency: product.currency,
          },

          status,

          sent_by_user_id: userId,
        })
        .select("id, created_at")
        .single();

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

    const [{ data: message, error: messageError }] =
      await Promise.all([
        messageInsert,
        previewUpdate,
        interactionInsert,
        outboundRecorded,
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
      messageId: message.id,
      mediaSent,
      usedTextFallback,
      productName: product.name,
    };
  });