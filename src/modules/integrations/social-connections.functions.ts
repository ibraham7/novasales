import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { SOCIAL_PLATFORM_KEYS, cleanPixelId, type SocialPlatform } from "./social-platforms";

const platform = z.enum(SOCIAL_PLATFORM_KEYS as [SocialPlatform, ...SocialPlatform[]]);

async function context() {
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const access = await requireAnyPermission(["org.manage", "crm.pipelines.manage"]);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { organizationId: access.organizationId, db: supabaseAdmin as any };
}

/** The organization's connections. Tokens never leave the server; only whether one is saved. */
export const getSocialConnections = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId, db } = await context();
  const [pixels, waiting, sent, failed, lastError] = await Promise.all([
    db
      .from("org_marketing_pixels")
      .select("platform,pixel_id,access_token,test_event_code,connected_via,connected_at,updated_at")
      .eq("organization_id", organizationId),
    ...["awaiting_connection", "sent", "failed"].map((state) =>
      db
        .from("crm_conversion_events")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("delivery_state", state),
    ),
    db
      .from("crm_conversion_events")
      .select("delivery_error,occurred_at")
      .eq("organization_id", organizationId)
      .not("delivery_error", "is", null)
      .in("delivery_state", ["awaiting_connection", "failed"])
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (pixels.error) throw new Error(pixels.error.message);
  const { metaPublicConfig } = await import("@/modules/channels/whatsapp/cloud-http");
  const meta = metaPublicConfig();
  const socialConfigId = process.env.META_SOCIAL_CONFIG_ID ?? null;
  return {
    connections: (pixels.data ?? []).map(({ access_token, ...row }: any) => ({ ...row, has_token: !!access_token })),
    delivery: {
      waiting: waiting.count ?? 0,
      sent: sent.count ?? 0,
      failed: failed.count ?? 0,
      lastError: lastError.data?.delivery_error ?? null,
    },
    metaLogin: {
      available: Boolean(meta.appId && socialConfigId && process.env.META_APP_SECRET),
      appId: meta.appId,
      configId: socialConfigId,
      graphVersion: meta.graphVersion,
    },
  };
});

/** Saves a platform's id (and for Meta its Conversions API token, checked against the pixel first). */
export const saveSocialPixel = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        platform,
        pixelId: z.string().max(120),
        accessToken: z.string().trim().max(1000).optional(),
        testEventCode: z.string().trim().max(40).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { organizationId, db } = await context();
    const pixelId = cleanPixelId(data.platform, data.pixelId);
    const row: Record<string, unknown> = {
      organization_id: organizationId,
      platform: data.platform,
      pixel_id: pixelId,
      updated_at: new Date().toISOString(),
    };
    let pixelName: string | null = null;
    if (data.platform === "facebook") {
      row.test_event_code = data.testEventCode || null;
      if (data.accessToken) {
        const { metaGraph } = await import("./meta-capi.server");
        const pixel = await metaGraph<{ id: string; name?: string }>(`${pixelId}?fields=id,name`, data.accessToken).catch(
          (e: Error) => {
            throw new Error(`لم تقبل Meta الرمز مع هذا البكسل: ${e.message}`);
          },
        );
        pixelName = pixel.name ?? null;
        const { encryptToken } = await import("@/modules/channels/whatsapp/cloud-http");
        row.access_token = await encryptToken(data.accessToken);
        row.connected_via = "manual";
        row.connected_at = new Date().toISOString();
      } else {
        // A different pixel needs its own token.
        const { data: old } = await db
          .from("org_marketing_pixels")
          .select("pixel_id")
          .eq("organization_id", organizationId)
          .eq("platform", "facebook")
          .maybeSingle();
        if (old && old.pixel_id !== pixelId) row.access_token = null;
      }
    }
    const { error } = await db.from("org_marketing_pixels").upsert(row, { onConflict: "organization_id,platform" });
    if (error) throw new Error(error.message);
    return { ok: true, pixelName };
  });

export const removeSocialPixel = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ platform }).parse(data))
  .handler(async ({ data }) => {
    const { organizationId, db } = await context();
    const { error } = await db
      .from("org_marketing_pixels")
      .delete()
      .eq("organization_id", organizationId)
      .eq("platform", data.platform);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function metaConnection(organizationId: string, db: any) {
  const { data, error } = await db
    .from("org_marketing_pixels")
    .select("organization_id,pixel_id,access_token,test_event_code")
    .eq("organization_id", organizationId)
    .eq("platform", "facebook")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.access_token) throw new Error("أدخل Pixel ID ورمز الوصول (Access Token) لميتا أولًا");
  return data;
}

/** A test «Lead» event, shown only under Test events in Events Manager. */
export const sendMetaTestEvent = createServerFn({ method: "POST" }).handler(async () => {
  const { organizationId, db } = await context();
  const connection = await metaConnection(organizationId, db);
  if (!connection.test_event_code)
    throw new Error("أدخل Test Event Code من Events Manager ← Test events حتى لا يُحسب الحدث التجريبي تحويلًا حقيقيًا");
  const { sendMetaEvents } = await import("./meta-capi.server");
  const { sha256 } = await import("./meta-capi");
  const received = await sendMetaEvents(connection, [
    {
      event_name: "Lead",
      event_time: Math.floor(Date.now() / 1000),
      event_id: `test:${crypto.randomUUID()}`,
      action_source: "system_generated",
      user_data: { external_id: [await sha256(`novasales-test-${organizationId}`)] },
      custom_data: { event_source: "crm", lead_event_source: "NovaSales", stage_name: "اختبار" },
    },
  ]);
  return { received };
});

/** Sends this organization's waiting events now instead of waiting for the next minute. */
export const deliverConversionsNow = createServerFn({ method: "POST" }).handler(async () => {
  const { organizationId, db } = await context();
  await metaConnection(organizationId, db);
  const { deliverMetaConversions } = await import("./meta-capi.server");
  return deliverMetaConversions(organizationId);
});

/** «الربط بواسطة ميتا»: exchanges the login code and lists the pixels the person can use. */
export const startMetaSocialLink = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ code: z.string().min(10).max(2000), redirectUri: z.string().url().max(500) }).parse(data),
  )
  .handler(async ({ data }) => {
    await context();
    if (!process.env.META_SOCIAL_CONFIG_ID) throw new Error("الربط بواسطة ميتا غير مفعّل بعد على الخادم");
    const { exchangeCodeForToken, encryptToken } = await import("@/modules/channels/whatsapp/cloud-http");
    const { metaGraph } = await import("./meta-capi.server");
    const { token } = await exchangeCodeForToken(data.code, data.redirectUri);
    const accounts = await metaGraph<{ data?: { name?: string; adspixels?: { data?: { id: string; name?: string }[] } }[] }>(
      "me/adaccounts?fields=name,adspixels{id,name}&limit=100",
      token,
    );
    const pixels = new Map<string, { id: string; name: string; account: string }>();
    for (const account of accounts.data ?? [])
      for (const pixel of account.adspixels?.data ?? [])
        pixels.set(pixel.id, { id: pixel.id, name: pixel.name ?? pixel.id, account: account.name ?? "" });
    // The token goes back sealed (encrypted with the server key); the browser cannot read it.
    return { pixels: [...pixels.values()], sealed: await encryptToken(token) };
  });

export const finishMetaSocialLink = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ pixelId: z.string().max(40), sealed: z.string().min(20).max(4000) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { organizationId, db } = await context();
    const pixelId = cleanPixelId("facebook", data.pixelId);
    const { decryptToken } = await import("@/modules/channels/whatsapp/cloud-http");
    const { metaGraph } = await import("./meta-capi.server");
    const token = await decryptToken(data.sealed).catch(() => {
      throw new Error("انتهت جلسة الربط؛ أعد المحاولة");
    });
    await metaGraph(`${pixelId}?fields=id`, token);
    const now = new Date().toISOString();
    const { error } = await db.from("org_marketing_pixels").upsert(
      {
        organization_id: organizationId,
        platform: "facebook",
        pixel_id: pixelId,
        access_token: data.sealed,
        connected_via: "oauth",
        connected_at: now,
        updated_at: now,
      },
      { onConflict: "organization_id,platform" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
