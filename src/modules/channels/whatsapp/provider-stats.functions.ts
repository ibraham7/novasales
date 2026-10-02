import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

async function requireSuperAdmin() {
  const { getWorkspace } = await import("@/platform/workspace/workspace.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ws = await getWorkspace();
  const db = supabaseAdmin as any;
  const { data } = await db.rpc("has_role", { _user_id: ws.userId, _role: "admin" });
  if (data !== true) throw new Error("هذه البيانات متاحة للسوبر أدمن فقط");
  return { db, ...ws };
}

/**
 * إحصائيات مقارنة بين المحرّكات (Evolution / WAHA / Cloud API…):
 * عدد الجلسات، الرسائل، الأخطاء، والتقييدات لكل محرّك.
 */
export const getProviderStats = createServerFn({ method: "GET" }).handler(async () => {
  const { db } = await requireSuperAdmin();
  const { listAvailableProviders } = await import("./registry.server");

  const [{ data: channels }, { data: accounts }] = await Promise.all([
    db.from("msg_channels").select("id, provider, channel_type"),
    db.from("msg_channel_accounts").select("id, channel_id, status, provider_error_count, last_provider_error, last_webhook_at"),
  ]);

  const providerOfChannel = new Map<string, string>(
    ((channels ?? []) as any[]).map((c) => [c.id, (c.provider as string) ?? "evolution"]),
  );
  const accountProvider = new Map<string, string>(
    ((accounts ?? []) as any[]).map((a) => [a.id, providerOfChannel.get(a.channel_id) ?? "evolution"]),
  );

  // الرسائل حسب الجلسة → حساب القناة → المحرّك.
  const { data: sessions } = await db.from("msg_sessions").select("id, channel_account_id");
  const sessionAccount = new Map<string, string>(
    ((sessions ?? []) as any[]).map((s) => [s.id, s.channel_account_id]),
  );
  const { data: messages } = await db.from("msg_messages").select("session_id");
  const { data: restrictions } = await db
    .from("wa_number_restrictions")
    .select("channel_account_id, resolved_at");

  const base = () => ({
    sessions: 0,
    connected: 0,
    messages: 0,
    errors: 0,
    restrictions: 0,
    open_restrictions: 0,
    last_webhook_at: null as string | null,
    last_error: null as string | null,
  });
  const stats = new Map<string, ReturnType<typeof base>>();
  const bucket = (p: string) => {
    if (!stats.has(p)) stats.set(p, base());
    return stats.get(p)!;
  };
  for (const p of listAvailableProviders()) bucket(p.id);

  for (const a of (accounts ?? []) as any[]) {
    const b = bucket(accountProvider.get(a.id) ?? "evolution");
    b.sessions += 1;
    if (a.status === "connected") b.connected += 1;
    b.errors += a.provider_error_count ?? 0;
    if (a.last_provider_error && !b.last_error) b.last_error = a.last_provider_error;
    if (a.last_webhook_at && (!b.last_webhook_at || a.last_webhook_at > b.last_webhook_at)) {
      b.last_webhook_at = a.last_webhook_at;
    }
  }
  for (const m of (messages ?? []) as any[]) {
    const accId = sessionAccount.get(m.session_id);
    if (!accId) continue;
    bucket(accountProvider.get(accId) ?? "evolution").messages += 1;
  }
  for (const r of (restrictions ?? []) as any[]) {
    const p = accountProvider.get(r.channel_account_id);
    if (!p) continue;
    const b = bucket(p);
    b.restrictions += 1;
    if (!r.resolved_at) b.open_restrictions += 1;
  }

  return listAvailableProviders().map((p) => ({
    id: p.id,
    label: p.label,
    enabled: p.enabled,
    capabilities: p.capabilities,
    ...bucket(p.id),
  }));
});

/** لوحة تشخيص لرقم واحد: المحرّك، الجلسة، الـEngine، السيرفر، الاستجابة، الويبهوك. */
export const getNumberDebug = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { db } = await requireSuperAdmin();
    const { resolveAccountProvider } = await import("./registry.server");
    const ref = await resolveAccountProvider(data.accountId);

    const { data: acc } = await db
      .from("msg_channel_accounts")
      .select(
        "id, display_name, status, webhook_configured, last_webhook_at, provider_error_count, last_provider_error, provider_meta, health_state",
      )
      .eq("id", data.accountId)
      .maybeSingle();

    let info: any = null;
    let latencyMs: number | null = null;
    let probeError: string | null = null;
    if (ref.provider.isConfigured() && ref.provider.getDebugInfo) {
      const t0 = Date.now();
      try {
        info = await ref.provider.getDebugInfo(ref.externalRef);
        latencyMs = Date.now() - t0;
      } catch (e) {
        latencyMs = Date.now() - t0;
        probeError = e instanceof Error ? e.message : String(e);
      }
    }

    const meta = (acc?.provider_meta ?? {}) as Record<string, unknown>;
    return {
      accountId: ref.accountId,
      displayName: acc?.display_name ?? null,
      provider: ref.providerId,
      providerLabel: ref.provider.label,
      configured: ref.provider.isConfigured(),
      capabilities: ref.provider.capabilities,
      session: info?.sessionName ?? ref.externalRef,
      engine: info?.engine ?? (meta.engine as string | null) ?? null,
      server: info?.server ?? (meta.server as string | null) ?? null,
      state: info?.state ?? acc?.status ?? null,
      phoneNumber: info?.phoneNumber ?? null,
      profileName: info?.profileName ?? null,
      latencyMs: latencyMs ?? (meta.latency_ms as number | null) ?? null,
      webhookConfigured: Boolean(acc?.webhook_configured),
      lastWebhookAt: acc?.last_webhook_at ?? null,
      errorCount: acc?.provider_error_count ?? 0,
      lastError: probeError ?? acc?.last_provider_error ?? null,
      healthState: acc?.health_state ?? null,
      movedFrom: (meta.moved_from as string | null) ?? null,
    };
  });
