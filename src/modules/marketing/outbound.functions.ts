import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { createRateLimiter } from "@/modules/notifications/rate-limit";
import { MARKETING_COUNTRY_CODES, countryByCode } from "./countries";
import { DEFAULT_MAX_RECIPIENTS, DEFAULT_MAX_THROTTLE } from "./outbound-core";

const approveLimiter = createRateLimiter(5, 60_000);

type Mode = "manage" | "send" | "owner";
/** Marketing work needs campaign management; approving a send needs the send permission; settings need the owner's. */
async function access(mode: Mode = "manage") {
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const a = await requireAnyPermission([mode === "send" ? "cmp.campaigns.send" : mode === "owner" ? "org.manage" : "cmp.campaigns.manage"]);
  await (await import("./gate.server")).assertMarketingUser(a.userId);
  return { userId: a.userId, organizationId: a.organizationId, db: supabaseAdmin as any };
}

const maxRecipients = () => Number(process.env.OUTBOUND_MAX_RECIPIENTS) || DEFAULT_MAX_RECIPIENTS;
const maxThrottle = () => Number(process.env.OUTBOUND_MAX_THROTTLE) || DEFAULT_MAX_THROTTLE;

/** The organization's WhatsApp numbers, with whether each is an official (Meta) link or a QR link. */
async function loadAccounts(db: any, organizationId: string) {
  const [{ data: accounts, error }, { data: channels }] = await Promise.all([
    db.from("msg_channel_accounts").select("id,display_name,identifier,status,channel_id").eq("organization_id", organizationId).limit(200),
    db.from("msg_channels").select("id,provider").eq("organization_id", organizationId).limit(200),
  ]);
  if (error) throw new Error(error.message);
  const { getProvider } = await import("@/modules/channels/whatsapp/registry.server");
  const providerOf = new Map<string, string>((channels ?? []).map((c: any) => [c.id, c.provider]));
  return (accounts ?? []).map((a: any) => {
    const provider = providerOf.get(a.channel_id) ?? "";
    let official = false;
    let label = provider || "غير معروف";
    try {
      const p = getProvider(provider);
      official = p.isOfficial === true;
      label = p.label;
    } catch {
      /* an unknown provider is treated as unofficial */
    }
    return { id: a.id as string, name: (a.display_name || a.identifier || "رقم") as string, identifier: (a.identifier ?? "") as string, connected: a.status === "connected", official, providerLabel: label };
  });
}

export const getOutboundSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId, db } = await access("manage");
  const { loadSettings } = await import("./outbound-core");
  const settings = await loadSettings(db, organizationId);
  const { data } = await db.from("ob_org_settings").select("unofficial_accepted_by,unofficial_accepted_at").eq("organization_id", organizationId).maybeSingle();
  let acceptedByName: string | null = null;
  if (data?.unofficial_accepted_by) {
    const { data: profile } = await db.from("profiles").select("full_name").eq("id", data.unofficial_accepted_by).maybeSingle();
    acceptedByName = profile?.full_name ?? null;
  }
  return { ...settings, acceptedAt: data?.unofficial_accepted_at ?? null, acceptedByName, maxRecipients: maxRecipients(), maxThrottle: maxThrottle(), accounts: await loadAccounts(db, organizationId) };
});

export const saveOutboundSettings = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        allowUnofficial: z.boolean(),
        acceptRisk: z.boolean().optional(),
        optoutFooter: z.string().trim().min(5, "نص الإيقاف قصير جداً").max(200),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { userId, organizationId, db } = await access("owner");
    if (data.allowUnofficial && !data.acceptRisk) throw new Error("أكّد أنك فهمت مخاطر حظر الرقم قبل التفعيل");
    const { loadSettings, logEvent } = await import("./outbound-core");
    const before = await loadSettings(db, organizationId);
    const now = new Date().toISOString();
    const row: Record<string, unknown> = { organization_id: organizationId, allow_unofficial: data.allowUnofficial, optout_footer: data.optoutFooter, updated_at: now };
    if (data.allowUnofficial && !before.allow_unofficial) Object.assign(row, { unofficial_accepted_by: userId, unofficial_accepted_at: now });
    const { error } = await db.from("ob_org_settings").upsert(row, { onConflict: "organization_id" });
    if (error) throw new Error(error.message);
    if (before.allow_unofficial !== data.allowUnofficial) await logEvent(db, organizationId, userId, data.allowUnofficial ? "unofficial_enabled" : "unofficial_disabled", "settings", organizationId);
    return { ok: true };
  });

export const addMarketingProspect = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        name: z.string().trim().min(2, "اكتب اسم الجهة").max(200),
        phone: z.string().trim().min(5, "اكتب رقم الهاتف").max(40),
        country: z.enum(MARKETING_COUNTRY_CODES),
        category: z.string().trim().max(120).optional(),
        city: z.string().trim().max(80).optional(),
        website: z.string().trim().max(300).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { organizationId, db } = await access("manage");
    const { addManualProspect } = await import("./outbound-core");
    return addManualProspect(db, organizationId, { ...data, dial: countryByCode(data.country)?.dial ?? "", countryCode: data.country });
  });

/** Who would receive a campaign now, and who is left out and why. Sends nothing. */
export const previewOutbound = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ prospectIds: z.array(z.string().uuid()).max(5000).optional() }).parse(data ?? {}))
  .handler(async ({ data }) => {
    const { organizationId, db } = await access("manage");
    const { previewAudience } = await import("./outbound-core");
    const preview = await previewAudience(db, organizationId, data.prospectIds);
    return { eligibleCount: preview.eligible.length, sample: preview.eligible.slice(0, 8), excluded: preview.excluded, approved: preview.approved, maxRecipients: maxRecipients() };
  });

export const approveOutboundCampaign = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        name: z.string().trim().min(2, "اكتب اسم الحملة").max(200),
        body: z.string().trim().min(1, "اكتب نص الرسالة").max(900),
        accountId: z.string().uuid(),
        prospectIds: z.array(z.string().uuid()).max(5000).optional(),
        scheduledAt: z.string().max(40).optional().nullable(),
        throttlePerMinute: z.number().int().min(1).max(60).default(5),
        acknowledgments: z.object({ b2b: z.boolean(), optOut: z.boolean(), review: z.boolean() }),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { userId, organizationId, db } = await access("send");
    if (!approveLimiter.allow(userId)) throw new Error("محاولات اعتماد كثيرة خلال دقيقة؛ انتظر قليلاً");
    const { createOutboundCampaign } = await import("./outbound-core");
    const accounts = await loadAccounts(db, organizationId);
    return createOutboundCampaign(
      db,
      {
        account: async (id) => {
          const a = accounts.find((x: any) => x.id === id);
          return a ? { organizationId, connected: a.connected, isOfficial: a.official, label: `${a.name} (${a.providerLabel})` } : null;
        },
        maxRecipients: maxRecipients(),
        maxThrottle: maxThrottle(),
      },
      { ...data, organizationId, userId },
    );
  });

/** Outbound campaigns with what happened to their messages. */
export const listOutboundCampaigns = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId, db } = await access("manage");
  const { data: campaigns, error } = await db
    .from("cmp_campaigns")
    .select("id,name,status,scheduled_at,started_at,finished_at,throttle_per_minute,error,created_at,approved_at,compliance_snapshot")
    .eq("organization_id", organizationId)
    .eq("kind", "outbound")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  const ids = (campaigns ?? []).map((c: any) => c.id);
  const stats = new Map<string, Record<string, number>>();
  if (ids.length) {
    const { data: recipients } = await db.from("cmp_recipients").select("campaign_id,status,replied_at").eq("organization_id", organizationId).in("campaign_id", ids).limit(20000);
    for (const r of recipients ?? []) {
      const s = stats.get(r.campaign_id) ?? { total: 0, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, replied: 0 };
      s.total++;
      if (r.status === "sending") s.queued++;
      else s[r.status] = (s[r.status] ?? 0) + 1;
      if (r.replied_at) s.replied++;
      stats.set(r.campaign_id, s);
    }
  }
  return (campaigns ?? []).map((c: any) => ({ ...c, stats: stats.get(c.id) ?? { total: 0, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, replied: 0 } }));
});

export const listSuppressions = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId, db } = await access("manage");
  const { data, error } = await db.from("ob_suppressions").select("id,identifier,reason,source,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const addSuppressionNumber = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ phone: z.string().trim().min(5, "اكتب الرقم").max(40), country: z.enum(MARKETING_COUNTRY_CODES).default("TR"), reason: z.string().trim().max(200).optional() }).parse(data))
  .handler(async ({ data }) => {
    const { userId, organizationId, db } = await access("manage");
    const { addSuppression, logEvent } = await import("./outbound-core");
    const phone = await addSuppression(db, organizationId, data.phone, { source: "manual", reason: data.reason, userId, dial: countryByCode(data.country)?.dial ?? "" });
    await logEvent(db, organizationId, userId, "suppression_added", "suppression", phone);
    return { phone };
  });

export const removeSuppressionNumber = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { userId, organizationId, db } = await access("manage");
    const { logEvent, removeSuppression } = await import("./outbound-core");
    await removeSuppression(db, organizationId, data.id);
    await logEvent(db, organizationId, userId, "suppression_removed", "suppression", data.id);
    return { ok: true };
  });
