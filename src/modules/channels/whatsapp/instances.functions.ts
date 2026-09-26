import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadAccounts } from "./instances.server";

/** الويبهوك الموحّد: /api/public/wa-webhook/{provider}/{token} */
function webhookUrlFor(providerId: string): string | null {
  const appUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  const token = process.env.EVOLUTION_WEBHOOK_TOKEN ?? "";
  if (!appUrl || !token) return null;
  return `${appUrl}/api/public/wa-webhook/${providerId}/${token}`;
}

/** قناة واتساب لكل محرّك (msg_channels.provider) — تُنشأ عند أول استخدام. */
async function ensureProviderChannel(orgId: string, providerId: string): Promise<string> {
  const { supabaseAdmin, WHATSAPP_CHANNEL_ID } = await import("@/platform/workspace/workspace.server");
  const db = supabaseAdmin as any;
  const { data: existing } = await db
    .from("msg_channels")
    .select("id")
    .eq("organization_id", orgId)
    .eq("channel_type", "whatsapp")
    .eq("provider", providerId)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data: created, error } = await db
    .from("msg_channels")
    .insert({
      organization_id: orgId,
      channel_type: "whatsapp",
      provider: providerId,
      name: `WhatsApp (${providerId})`,
      is_active: true,
    })
    .select("id")
    .single();
  if (error || !created) return WHATSAPP_CHANNEL_ID;
  return created.id;
}

export const listInstances = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace } = await import("@/platform/workspace/workspace.server");
  const { userId, organizationId } = await getWorkspace();
  return loadAccounts(userId, organizationId);
});

/** المحرّكات المتاحة + قدراتها المعلنة (للواجهة). */
export const listProvidersFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listAvailableProviders } = await import("./registry.server");
  return listAvailableProviders();
});

/** قدرات محرّك رقم معيّن — الواجهة تعطّل ما هو غير مدعوم تلقائياً. */
export const getAccountCapabilitiesFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getAccountCapabilities } = await import("./registry.server");
    return getAccountCapabilities(data.id);
  });

/**
 * Channel accounts (WhatsApp numbers) that belong to the caller personally.
 * Used for notification targeting: alerts go only to the owner of the number.
 */
export const listMyOwnedAccountIds = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { userId, organizationId } = await getWorkspace();
  const { data } = await (supabaseAdmin as any)
    .from("msg_channel_accounts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("owner_user_id", userId);
  return { userId, accountIds: ((data ?? []) as Array<{ id: string }>).map((r) => r.id) };
});

export const getInstance = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace } = await import("@/platform/workspace/workspace.server");
    const { userId, organizationId } = await getWorkspace();
    const list = await loadAccounts(userId, organizationId);
    return list.find((i: { id: string }) => i.id === data.id) ?? null;
  });

export const createInstanceFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ displayName: z.string().min(1).max(80), provider: z.string().min(2).max(40).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { getProvider } = await import("./registry.server");
    const db = supabaseAdmin as any;
    const { userId, organizationId } = await getWorkspace();
    const providerId = data.provider ?? "evolution";
    const provider = getProvider(providerId);
    const webhookUrl = webhookUrlFor(providerId) ?? undefined;

    let externalRef = `w${userId.slice(0, 8)}-${Date.now().toString(36)}`;
    let providerMeta: Record<string, unknown> = {};
    let configured = false;
    if (provider.isConfigured()) {
      try {
        const created = await provider.createInstance({
          organizationId,
          displayName: data.displayName,
          webhookUrl,
        });
        externalRef = created.externalRef;
        providerMeta = { ...(created.meta ?? {}), provider: providerId };
        await provider.applyRecommendedSettings?.(externalRef).catch(() => {});
        configured = Boolean(webhookUrl);
      } catch (e) {
        throw new Error(
          `فشل إنشاء الجلسة في ${provider.label}: ${e instanceof Error ? e.message : "غير معروف"}`,
        );
      }
    }

    const channelId = await ensureProviderChannel(organizationId, providerId);
    const { data: acc, error } = await db
      .from("msg_channel_accounts")
      .insert({
        organization_id: organizationId,
        channel_id: channelId,
        owner_user_id: userId,
        display_name: data.displayName,
        identifier: externalRef,
        external_ref: externalRef,
        status: provider.isConfigured() ? "connecting" : "unconfigured",
        webhook_configured: configured,
        provider_meta: providerMeta,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await db.from("plugin_whatsapp_evolution_instances").insert({
      organization_id: organizationId,
      channel_account_id: acc.id,
      instance_name: externalRef,
    });

    return { instance: { id: acc.id, name: externalRef, provider: providerId } };
  });

async function loadAcc(orgId: string, id: string) {
  const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const db = supabaseAdmin as any;
  // Scoped visibility: an agent may only act on their own sessions.
  const visible = await loadAccounts("", orgId);
  if (!visible.some((a: { id: string }) => a.id === id)) return null;
  const { data: acc } = await db
    .from("msg_channel_accounts")
    .select("id, external_ref, webhook_configured, channel_id, display_name, provider_meta")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  return acc;
}

async function ensureWebhook(accountId: string) {
  const { resolveAccountProvider } = await import("./registry.server");
  const ref = await resolveAccountProvider(accountId);
  const url = webhookUrlFor(ref.providerId);
  if (!url) return false;
  try {
    await ref.provider.configureWebhook(ref.externalRef, url);
    const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    await (supabaseAdmin as any)
      .from("msg_channel_accounts")
      .update({ webhook_configured: true })
      .eq("id", accountId);
    return true;
  } catch (e) {
    console.warn("[instances] ensureWebhook failed", e);
    return false;
  }
}

export const connectInstanceFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { resolveAccountProvider } = await import("./registry.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const acc = await loadAcc(organizationId, data.id);
    if (!acc) throw new Error("جلسة غير موجودة");
    const ref = await resolveAccountProvider(acc.id);
    if (!ref.provider.isConfigured()) throw new Error(`${ref.provider.label} غير مُهيّأ بعد.`);
    const qr = await ref.provider.connectInstance(ref.externalRef);
    const qrCode = qr.base64 ?? null;
    if (qrCode) {
      await db
        .from("plugin_whatsapp_evolution_instances")
        .update({ qr_code: qrCode })
        .eq("channel_account_id", acc.id);
      await db.from("msg_channel_accounts").update({ status: "connecting" }).eq("id", acc.id);
    }
    await ensureWebhook(acc.id);
    return { qrCode, qrValue: qr.value ?? null, pairingCode: qr.pairingCode ?? null };
  });

export const refreshInstanceStatusFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { resolveAccountProvider } = await import("./registry.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const acc = await loadAcc(organizationId, data.id);
    if (!acc) throw new Error("جلسة غير موجودة");
    const ref = await resolveAccountProvider(acc.id);
    if (!ref.provider.isConfigured()) return { status: "unconfigured" };

    const startedAt = Date.now();
    const info = (await ref.provider.getDebugInfo?.(ref.externalRef)) ?? null;
    const latencyMs = Date.now() - startedAt;
    // نعتمد الحالة المُطبّعة من المزوّد (WAHA يرجّع WORKING/SCAN_QR_CODE خامة).
    const state = (await ref.provider.getStatus(ref.externalRef)).state;
    const map: Record<string, string> = { open: "connected", close: "disconnected", connecting: "connecting" };
    const status = map[state] ?? state;


    await db
      .from("msg_channel_accounts")
      .update({
        status,
        provider_meta: {
          ...(acc.provider_meta ?? {}),
          provider: ref.providerId,
          engine: info?.engine ?? null,
          server: info?.server ?? null,
          session_name: info?.sessionName ?? ref.externalRef,
          latency_ms: latencyMs,
          checked_at: new Date().toISOString(),
        },
      })
      .eq("id", acc.id);

    const pluginPatch: Record<string, unknown> = {};
    if (info?.phoneNumber) pluginPatch.phone_number = info.phoneNumber;
    if (info) {
      pluginPatch.raw_state = {
        phone: info.phoneNumber ?? null,
        profileName: info.profileName ?? null,
        profilePicUrl: info.profilePicUrl ?? null,
        state: info.state ?? null,
        syncedAt: new Date().toISOString(),
      };
    }
    if (Object.keys(pluginPatch).length > 0) {
      await db.from("plugin_whatsapp_evolution_instances").update(pluginPatch).eq("channel_account_id", acc.id);
    }
    if (status === "connected") {
      await db
        .from("plugin_whatsapp_evolution_instances")
        .update({ qr_code: null })
        .eq("channel_account_id", acc.id);
    }

    await ensureWebhook(acc.id);

    return { status, latencyMs };
  });

export const updateInstanceNameFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), displayName: z.string().min(1).max(80) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const acc = await loadAcc(organizationId, data.id);
    if (!acc) throw new Error("جلسة غير موجودة");
    const { error } = await db
      .from("msg_channel_accounts")
      .update({ display_name: data.displayName })
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const logoutInstanceFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { resolveAccountProvider } = await import("./registry.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const acc = await loadAcc(organizationId, data.id);
    if (!acc) throw new Error("جلسة غير موجودة");
    const ref = await resolveAccountProvider(acc.id);
    if (!ref.provider.isConfigured()) throw new Error(`${ref.provider.label} غير مُهيّأ بعد.`);
    await ref.provider.disconnect(ref.externalRef);
    await db.from("msg_channel_accounts").update({ status: "disconnected" }).eq("id", acc.id);
    return { ok: true };
  });

export const syncWebhookFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace } = await import("@/platform/workspace/workspace.server");
    const { resolveAccountProvider } = await import("./registry.server");
    const { organizationId } = await getWorkspace();
    const acc = await loadAcc(organizationId, data.id);
    if (!acc) throw new Error("جلسة غير موجودة");
    const ref = await resolveAccountProvider(acc.id);
    const url = webhookUrlFor(ref.providerId);
    if (!url) throw new Error("PUBLIC_APP_URL أو EVOLUTION_WEBHOOK_TOKEN غير مضبوط.");
    await ensureWebhook(acc.id);
    await ref.provider.applyRecommendedSettings?.(ref.externalRef).catch(() => {});
    return { ok: true, url };
  });

/**
 * نقل الجلسة إلى محرّك آخر (Move Session).
 * تبقى كل بيانات النظام كما هي (نفس msg_channel_accounts.id): التذاكر،
 * الرسائل، العملاء، الأقسام، الملكية وسجل المخاطر. المطلوب فقط إعادة مسح QR.
 */
export const moveSessionProviderFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), targetProvider: z.string().min(2).max(40) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { resolveAccountProvider, getProvider } = await import("./registry.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const acc = await loadAcc(organizationId, data.id);
    if (!acc) throw new Error("جلسة غير موجودة");

    const current = await resolveAccountProvider(acc.id);
    if (current.providerId === data.targetProvider) throw new Error("الجلسة على هذا المحرّك بالفعل.");
    const target = getProvider(data.targetProvider);
    if (!target.isConfigured()) throw new Error(`${target.label} غير مُهيّأ بعد.`);

    const webhookUrl = webhookUrlFor(target.id) ?? undefined;
    const created = await target.createInstance({
      organizationId,
      displayName: acc.display_name ?? "جلسة واتساب",
      webhookUrl,
    });
    const channelId = await ensureProviderChannel(organizationId, target.id);

    const { error } = await db
      .from("msg_channel_accounts")
      .update({
        channel_id: channelId,
        external_ref: created.externalRef,
        identifier: created.externalRef,
        status: "connecting",
        webhook_configured: Boolean(webhookUrl),
        provider_meta: { ...(created.meta ?? {}), provider: target.id, moved_from: current.providerId },
        // إعادة الربط تعني بدء فترة مراقبة جديدة للرقم.
        observation_started_at: new Date().toISOString(),
        observation_source: "auto",
        health_state: "observation",
        last_relinked_at: new Date().toISOString(),
      })
      .eq("id", acc.id)
      .eq("organization_id", organizationId);
    if (error) {
      // Rollback: لا نترك جلسة يتيمة على المحرّك الجديد.
      await target.deleteInstance(created.externalRef).catch(() => {});
      throw new Error(error.message);
    }

    await db
      .from("plugin_whatsapp_evolution_instances")
      .update({ instance_name: created.externalRef, qr_code: null, raw_state: {} })
      .eq("channel_account_id", acc.id);

    // إغلاق الجلسة القديمة على المحرّك السابق (لا يؤثر على بيانات النظام).
    await current.provider.disconnect(current.externalRef).catch(() => {});
    await current.provider.deleteInstance(current.externalRef).catch(() => {});

    const { recordHealthEvent } = await import("@/modules/risk/risk.server");
    await recordHealthEvent({
      orgId: organizationId,
      accountId: acc.id,
      eventType: "provider_moved",
      detail: { from: current.providerId, to: target.id },
    });

    await ensureWebhook(acc.id);
    const qr = await target.connectInstance(created.externalRef).catch(() => ({ base64: null }));
    if (qr?.base64) {
      await db
        .from("plugin_whatsapp_evolution_instances")
        .update({ qr_code: qr.base64 })
        .eq("channel_account_id", acc.id);
    }
    return { ok: true, provider: target.id, qrCode: qr?.base64 ?? null };
  });

export const deleteInstanceFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { resolveAccountProvider } = await import("./registry.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const acc = await loadAcc(organizationId, data.id);
    if (acc) {
      const ref = await resolveAccountProvider(acc.id).catch(() => null);
      if (ref?.provider.isConfigured()) {
        await ref.provider.disconnect(ref.externalRef).catch(() => {});
        await ref.provider.deleteInstance(ref.externalRef).catch(() => {});
      }
    }
    await db.from("plugin_whatsapp_evolution_instances").delete().eq("channel_account_id", data.id);
    const { error } = await db.from("msg_channel_accounts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
