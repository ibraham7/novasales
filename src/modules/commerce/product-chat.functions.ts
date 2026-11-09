import { createServerFn } from "@tanstack/react-start";
import { sendTarget } from "@/modules/channels/whatsapp/recipient";
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

    const [providerRef, guard] =
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

    const number = sendTarget(session.peer_identifier);

    const caption =
      formatProductCaption(product, definitionsRes?.data ?? []);

    // The other photos and the videos go first, and the main photo with the details last, so the
    // details are the last thing the customer reads. Photos sent one after another with no text
    // between them are grouped by WhatsApp into an album.
    const links = (list: unknown) =>
      (Array.isArray(list) ? list : []).map(String).filter((u) => /^https?:\/\//i.test(u));
    const [coverUrl, ...otherImages] = links(product.images);
    const media: { url: string; kind: "image" | "video" }[] = [
      ...otherImages.map((url) => ({ url, kind: "image" as const })),
      ...links(product.videos).map((url) => ({ url, kind: "video" as const })),
    ];
    const sendMedia = async (item: { url: string; kind: "image" | "video" }, text?: string): Promise<any> => {
      if (item.kind === "video" || isOwnStorageUrl(item.url)) {
        // Our storage links (and any video) go as links: the WhatsApp server fetches them itself and
        // the request stays small whatever the file size.
        const mimetype = item.kind === "video" ? guessVideoMime(item.url) : guessImageMime(item.url);
        return ops.opSendMedia(session.channel_account_id, number, {
          mediatype: item.kind,
          media: item.url,
          mimetype,
          fileName: `product.${mimetype.split("/")[1].replace("jpeg", "jpg").replace("quicktime", "mov")}`,
          caption: text,
        });
      }
      // Other links: download the image here and send the file itself, since the WhatsApp server
      // accepts a link it later fails to fetch (e.g. search-engine thumbnails) and the customer
      // gets nothing. A file too large for its request limit is sent as the link instead.
      const file = await downloadProductImage(item.url);
      if (!file) throw new Error("تعذر تنزيل الصورة");
      const linkOnly = { mediatype: "image" as const, media: item.url, mimetype: file.mimetype, fileName: file.fileName, caption: text };
      if (Buffer.byteLength(file.base64, "base64") > MAX_INLINE_IMAGE_BYTES) {
        return ops.opSendMedia(session.channel_account_id, number, linkOnly);
      }
      try {
        return await ops.opSendMedia(session.channel_account_id, number, { ...linkOnly, media: file.base64 });
      } catch (error) {
        if (!isTooLarge(error)) throw error;
        return ops.opSendMedia(session.channel_account_id, number, linkOnly);
      }
    };

    const productMeta = {
      source: "product",
      product_id: product.id,
      product_name: product.name,
      sku: product.sku,
      price: product.price,
      currency: product.currency,
    };
    // The message stands in the chat at once as «sending»; one write for it and one for the chat list preview.
    const startedAt = Date.now();
    const [placeholderRes] = await Promise.all([
      db
        .from("msg_messages")
        .insert({
          organization_id: organizationId,
          session_id: data.chatId,
          direction: "outbound",
          message_type: coverUrl ? "image" : "text",
          content: caption,
          media_url: coverUrl ?? null,
          media_meta: productMeta,
          status: "sending",
          sent_by_user_id: userId,
          created_at: new Date(startedAt + (media.length + 1) * 10).toISOString(),
        })
        .select("id")
        .single(),
      db
        .from("msg_sessions")
        .update({
          last_message_preview: `📦 ${product.name} — ${Number(product.price)} ${product.currency}`,
          last_message_at: new Date().toISOString(),
        })
        .eq("id", data.chatId)
        .eq("organization_id", organizationId),
    ]);
    if (placeholderRes.error || !placeholderRes.data) {
      throw new Error(placeholderRes.error?.message ?? "تعذر تجهيز رسالة المنتج");
    }
    const placeholderId: string = placeholderRes.data.id;

    // The photos, videos and details are sent in the background (the server keeps running after it
    // answers), so the button answers at once even when WhatsApp is slow or a photo has to be downloaded.
    const { deliverProduct } = await import("./product-delivery");
    void deliverProduct({
      db,
      organizationId,
      userId,
      chatId: data.chatId,
      accountId: session.channel_account_id,
      placeholderId,
      startedAt,
      media,
      coverUrl,
      caption,
      product,
      opportunity,
      ops,
      number,
      sendMedia,
      risk,
      pauseMs: BETWEEN_MEDIA_MS,
      sleep,
    }).catch(async (error) => {
      console.error("[product-chat] background send crashed", error);
      await db.from("msg_messages").update({ status: "failed" }).eq("id", placeholderId).eq("organization_id", organizationId).eq("status", "sending");
    });

    return {
      ok: true,
      queued: true,
      messageId: placeholderId,
      mediaSent: true,
      usedTextFallback: false,
      productName: product.name,
      imagesSent: media.filter((m) => m.kind === "image").length + (coverUrl ? 1 : 0),
      videosSent: media.filter((m) => m.kind === "video").length,
      mediaFailed: 0,
    };
  });