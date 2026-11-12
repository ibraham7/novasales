import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { createRateLimiter } from "@/modules/notifications/rate-limit";
import { MARKETING_COUNTRY_CODES, countryByCode } from "./countries";
import { compactFilters, normalizeFilters } from "./filters";
import { DEFAULT_PRICE_PER_1000_REQUESTS_USD, PLACES_MAX_RESULTS, estimateCostUsd, requestsFor } from "./search-input";
import { MANUAL_STATUSES, PROSPECT_STATUSES } from "./statuses";

const searchLimiter = createRateLimiter(6, 60_000);
const enrichLimiter = createRateLimiter(4, 60_000);
const DEFAULT_MONTHLY_REQUESTS = 300;

const searchSchema = z.object({
  what: z.string().trim().min(2, "اكتب نوع النشاط (مثل: عيادات أسنان)").max(120),
  keywords: z.string().trim().max(120).optional(),
  country: z.enum(MARKETING_COUNTRY_CODES),
  city: z.string().trim().max(80).optional(),
  language: z.enum(["any", "ar", "tr", "en"]).default("any"),
  minRating: z.number().min(0).max(5).default(0),
  maxResults: z.number().int().min(1).max(PLACES_MAX_RESULTS).default(20),
});

/** Marketing is for the people who manage campaigns. Checked here on the server, not only in the page. */
async function access() {
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const a = await requireAnyPermission(["cmp.campaigns.manage"]);
  await (await import("./gate.server")).assertMarketingUser(a.userId);
  return { userId: a.userId, organizationId: a.organizationId, db: supabaseAdmin as any };
}

const pricePer1000 = () => Number(process.env.PLACES_PRICE_PER_1000_USD) || DEFAULT_PRICE_PER_1000_REQUESTS_USD;
const monthlyCap = () => Number(process.env.MARKETING_MAX_REQUESTS_PER_MONTH) || DEFAULT_MONTHLY_REQUESTS;
const monthStart = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();

async function usedThisMonth(db: any, organizationId: string): Promise<number> {
  const { data, error } = await db.from("ob_searches").select("requests_count").eq("organization_id", organizationId).gte("created_at", monthStart());
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum: number, row: any) => sum + (row.requests_count ?? 0), 0);
}

/** Whether searching is set up, what a request costs (an estimate), and how much of this month's allowance is used. */
export const getMarketingStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId, db } = await access();
  return {
    configured: !!process.env.GOOGLE_PLACES_API_KEY?.trim(),
    pricePer1000: pricePer1000(),
    monthlyCap: monthlyCap(),
    usedThisMonth: await usedThisMonth(db, organizationId),
  };
});

export const runProspectSearch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => searchSchema.parse(data))
  .handler(async ({ data }) => {
    const { userId, organizationId, db } = await access();
    const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
    if (!key) throw new Error("البحث غير مُعدّ بعد: لم يُضبط مفتاح Google على الخادم (GOOGLE_PLACES_API_KEY)");
    if (!searchLimiter.allow(userId)) throw new Error("عمليات بحث كثيرة خلال دقيقة؛ انتظر قليلاً");

    // The search costs money, so the month's allowance is checked before it starts.
    const planned = requestsFor(data.maxResults);
    const used = await usedThisMonth(db, organizationId);
    if (used + planned > monthlyCap()) throw new Error(`تجاوزت الحد الشهري لطلبات البحث (${used} من ${monthlyCap()}). تواصل مع مدير النظام لرفعه`);

    const { data: search, error } = await db
      .from("ob_searches")
      .insert({ organization_id: organizationId, created_by: userId, params: data, status: "running" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    try {
      const { searchPlaces } = await import("./google-places");
      const { saveFoundPlaces } = await import("./prospects-core");
      const found = await searchPlaces(data, key);
      const saved = await saveFoundPlaces(db, {
        organizationId,
        searchId: search.id,
        country: data.country,
        dial: countryByCode(data.country)?.dial ?? "",
        city: data.city,
        places: found.places,
        minRating: data.minRating,
      });
      const cost = estimateCostUsd(found.requests, pricePer1000());
      await db
        .from("ob_searches")
        .update({ status: "done", requests_count: found.requests, estimated_cost_usd: cost, results_count: saved.kept, new_count: saved.created, finished_at: new Date().toISOString() })
        .eq("id", search.id);
      return { searchId: search.id as string, requests: found.requests, estimatedCostUsd: cost, ...saved };
    } catch (e) {
      const message = (e instanceof Error ? e.message : "تعذّر إكمال البحث").slice(0, 400);
      await db.from("ob_searches").update({ status: "failed", error: message, finished_at: new Date().toISOString() }).eq("id", search.id);
      throw new Error(message);
    }
  });

export const listMarketingProspects = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => {
    const raw: any = data ?? {};
    return {
      filters: normalizeFilters(raw.filters),
      page: z.number().int().min(1).max(1000).default(1).parse(raw.page ?? 1),
      pageSize: z.number().int().min(10).max(100).default(25).parse(raw.pageSize ?? 25),
    };
  })
  .handler(async ({ data }) => {
    const { organizationId, db } = await access();
    const { listProspects, countByStatus } = await import("./prospects-core");
    const [list, counts] = await Promise.all([listProspects(db, organizationId, { ...data.filters, page: data.page, pageSize: data.pageSize }), countByStatus(db, organizationId)]);
    return { ...list, counts };
  });

export const listSavedSearches = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId, db } = await access();
  const { data, error } = await db.from("ob_saved_searches").select("id,name,kind,filters,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ id: r.id as string, name: r.name as string, kind: r.kind as string, filters: normalizeFilters(r.filters) }));
});

export const saveSearchFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ name: z.string().trim().min(1, "اكتب اسماً للبحث").max(100), filters: z.unknown() }).parse(data))
  .handler(async ({ data }) => {
    const { userId, organizationId, db } = await access();
    const filters = compactFilters(normalizeFilters(data.filters));
    // Saving under an existing name replaces it.
    const { error } = await db.from("ob_saved_searches").upsert({ organization_id: organizationId, name: data.name, kind: "companies", filters, created_by: userId }, { onConflict: "organization_id,kind,name" });
    if (error) throw new Error("تعذر حفظ البحث");
    return { ok: true };
  });

export const deleteSavedSearchFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { organizationId, db } = await access();
    const { error } = await db.from("ob_saved_searches").delete().eq("organization_id", organizationId).eq("id", data.id);
    if (error) throw new Error("تعذر حذف البحث");
    return { ok: true };
  });

export const updateMarketingProspects = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(200),
        status: z.enum(MANUAL_STATUSES).optional(),
        notes: z.string().max(2000).optional(),
      })
      .refine((v) => v.status !== undefined || v.notes !== undefined, "اختر حالة أو اكتب ملاحظة")
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { organizationId, db } = await access();
    const { updateProspects, countStillStopped } = await import("./prospects-core");
    const changed = await updateProspects(db, organizationId, data);
    // Said out loud, so «0 updated» is never a mystery.
    const stopped = data.status && changed < data.ids.length ? await countStillStopped(db, organizationId, data.ids) : 0;
    return { changed, stopped };
  });

export const deleteMarketingProspects = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).parse(data))
  .handler(async ({ data }) => {
    const { organizationId, db } = await access();
    const { deleteProspects } = await import("./prospects-core");
    return { deleted: await deleteProspects(db, organizationId, data.ids) };
  });

/** Moves replied / interested / approved businesses to the CRM as leads, owned by whoever moves them. */
export const promoteMarketingProspects = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).parse(data))
  .handler(async ({ data }) => {
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { userId, organizationId, db } = await access();
    // The CRM decides who may create leads; the check happens inside its own function too.
    await requireAnyPermission(["crm.leads.create"]);
    const { promoteProspects } = await import("./promote-core");
    const { logEvent } = await import("./outbound-core");
    const result = await promoteProspects(db, organizationId, data.ids, async (input) => {
      const { data: lead, error } = await db.rpc("crm_save_lead_atomic", { _org: organizationId, _actor: userId, _lead: null, _input: input });
      if (error) throw new Error(/[\u0600-\u06ff]/.test(error.message ?? "") ? error.message : "تعذر إنشاء العميل المحتمل");
      return lead;
    });
    await logEvent(db, organizationId, userId, "promoted_to_crm", "prospect", null, { ...result, failed: result.failed.length });
    return result;
  });

/** Reads each selected business's own website for emails, social pages and a WhatsApp link. */
export const enrichMarketingProspects = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(25) }).parse(data))
  .handler(async ({ data }) => {
    const { userId, organizationId, db } = await access();
    if (!enrichLimiter.allow(userId)) throw new Error("عمليات إثراء كثيرة خلال دقيقة؛ انتظر قليلاً");
    const { createPageFetcher } = await import("./site-fetch.server");
    const { enrichProspects } = await import("./enrich-core");
    return enrichProspects(db, organizationId, data.ids, createPageFetcher());
  });

export const listMarketingSearches = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId, db } = await access();
  const { data, error } = await db
    .from("ob_searches")
    .select("id,params,status,requests_count,estimated_cost_usd,results_count,new_count,error,created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return data ?? [];
});

/** Used by the sidebar: whether the signed-in user may see the marketing page at all. */
export const getMarketingAccess = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace } = await import("@/platform/workspace/workspace.server");
  const { canUseMarketing } = await import("./gate.server");
  const { userId } = await getWorkspace();
  return { allowed: await canUseMarketing(userId) };
});
