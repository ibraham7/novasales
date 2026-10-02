import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { matchesSearch } from "@/lib/fuzzy-search";
import { leadCreateSchema, leadUpdateSchema, LeadStatus } from "./lead-input";
import { leadError, readLeadRows, paginateLeads } from "./lead-data";
import { CURRENCY_CODES } from "@/modules/commerce/currencies";
const listSchema = z.object({
  status: LeadStatus.optional(),
  departmentId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(3000).default(200),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});
async function context(permission: string) {
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const access = await requireAnyPermission([permission]);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { access, db: supabaseAdmin as any };
}
async function row(db: any, access: any, id: string) {
  const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
  const { data, error } = await db
    .from("crm_leads")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw leadError(error);
  if (
    !data ||
    !canAccessOpportunityRow(access, {
      owner_agent_id: data.owner_user_id,
      department_id: data.department_id,
    })
  )
    throw new Error("العميل المحتمل غير موجود أو خارج نطاق صلاحياتك");
  return data;
}
function role(access: any) {
  return access.isSuperAdmin ||
    access.roleKeys.some((r: string) => ["owner", "org_owner", "admin"].includes(r))
    ? "owner"
    : access.roleKeys.some((r: string) => ["supervisor", "department_supervisor"].includes(r))
      ? "supervisor"
      : "agent";
}
async function loadRows(filters: z.infer<typeof listSchema>) {
  const { access, db } = await context("crm.leads.view");
  const { applyLeadScope } = await import("@/platform/rbac/data-scope.server");
  const query = () =>
    applyLeadScope(
      db
        .from("crm_leads")
        .select("*")
        .eq("organization_id", access.organizationId)
        .order("opened_at", { ascending: false })
        .order("id"),
      access,
      { departmentId: filters.departmentId, ownerId: filters.ownerId },
    );
  if (!query()) return [];
  const leads = await readLeadRows(() => {
    let q = query();
    if (filters.status) q = q.eq("status", filters.status);
    return q;
  });
  const ids = [...new Set<string>(leads.map((l) => l.contact_id))],
    contacts: any[] = [],
    points: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const results = await Promise.all([
      readLeadRows(() =>
        db
          .from("crm_contacts")
          .select("id,display_name,full_name")
          .eq("organization_id", access.organizationId)
          .in("id", batch)
          .order("id"),
      ),
      readLeadRows(() =>
        db
          .from("crm_contact_points")
          .select("id,contact_id,identifier,channel_type,is_primary")
          .eq("organization_id", access.organizationId)
          .in("contact_id", batch)
          .order("is_primary", { ascending: false })
          .order("id"),
      ),
    ]);
    contacts.push(...results[0]);
    points.push(...results[1]);
  }
  const map = new Map(contacts.map((c) => [c.id, c]));
  const byContact = new Map<string, any[]>();
  for (const p of points) {
    const list = byContact.get(p.contact_id) ?? [];
    list.push(p);
    byContact.set(p.contact_id, list);
  }
  const { loadFieldDefs, filterVisibleFields } = await import("./custom-fields.server");
  const defs = filterVisibleFields(
    await loadFieldDefs(access.organizationId, "lead"),
    role(access),
  );
  const keys = new Set(defs.map((d) => d.key));
  return leads
    .map((l) => {
      const c = map.get(l.contact_id),
        all = byContact.get(l.contact_id) ?? [];
      return {
        ...l,
        custom_fields: Object.fromEntries(
          Object.entries(l.custom_fields ?? {}).filter(([key]) => keys.has(key)),
        ),
        contact_name: c?.display_name ?? c?.full_name ?? "عميل غير مسمى",
        contact_phone:
          (
            all.find((p) => p.channel_type === "whatsapp") ??
            all.find((p) => ["phone", "sms"].includes(p.channel_type))
          )?.identifier ?? "",
        contact_email: all.find((p) => p.channel_type === "email")?.identifier ?? "",
        contact_phones: all.map((p) => p.identifier),
      };
    })
    .filter(
      (l) =>
        !filters.search ||
        matchesSearch(filters.search, [l.contact_name, l.source, ...l.contact_phones]),
    );
}
export const listLeads = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listSchema.parse(d ?? {}))
  .handler(async ({ data }) => (await loadRows(data)).slice(0, data.limit));
export const listLeadPage = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listSchema.parse(d ?? {}))
  .handler(async ({ data }) => paginateLeads(await loadRows(data), data.page, data.pageSize));
export const getLeadOptions = createServerFn({ method: "GET" }).handler(async () => {
  const { access, db } = await context("crm.leads.view");
  const { getOpportunityVisibility } = await import("@/platform/rbac/data-scope.server");
  const scope = getOpportunityVisibility(access);
  const departments = await readLeadRows(() => {
    let q = db
      .from("org_departments")
      .select("id,name")
      .eq("organization_id", access.organizationId)
      .order("id");
    if (scope !== "all")
      q = q.in(
        "id",
        access.departmentIds.length
          ? access.departmentIds
          : ["00000000-0000-0000-0000-000000000000"],
      );
    return q;
  });
  const memberships = await readLeadRows(() =>
    db
      .from("org_memberships")
      .select("id,user_id")
      .eq("organization_id", access.organizationId)
      .eq("is_active", true)
      .order("id"),
  );
  const departmentMembers = await readLeadRows(() =>
    db
      .from("org_department_members")
      .select("id,user_id,department_id")
      .eq("organization_id", access.organizationId)
      .eq("is_active", true)
      .order("id"),
  );
  const allowedIds = memberships
    .map((m) => m.user_id)
    .filter(
      (id) =>
        scope === "all" ||
        (scope === "own" && id === access.userId) ||
        (scope === "department" &&
          departmentMembers.some(
            (m) => m.user_id === id && access.departmentIds.includes(m.department_id),
          )),
    );
  const users: any[] = [];
  for (let i = 0; i < allowedIds.length; i += 100)
    users.push(
      ...(await readLeadRows(() =>
        db
          .from("profiles")
          .select("id,full_name")
          .in("id", allowedIds.slice(i, i + 100))
          .order("id"),
      )),
    );
  const { loadFieldDefs, filterVisibleFields } = await import("./custom-fields.server");
  return {
    departments,
    users,
    departmentMembers: departmentMembers.filter(
      (m) => allowedIds.includes(m.user_id) && departments.some((d) => d.id === m.department_id),
    ),
    fields: filterVisibleFields(
      await loadFieldDefs(access.organizationId, "lead"),
      role(access),
    ).map((def) => ({ ...def, default_value: def.default_value as any })),
    permissions: access.permissions,
    isSuperAdmin: access.isSuperAdmin,
    userId: access.userId,
    scope,
  };
});
export const getLead = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ leadId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { access, db } = await context("crm.leads.view");
    const lead = await row(db, access, data.leadId);
    const { data: contact, error } = await db
      .from("crm_contacts")
      .select("*")
      .eq("id", lead.contact_id)
      .eq("organization_id", access.organizationId)
      .maybeSingle();
    if (error) throw leadError(error);
    const { applyOpportunityScope } = await import("@/platform/rbac/data-scope.server");
    const query = () =>
      applyOpportunityScope(
        db
          .from("opp_opportunities")
          .select("*")
          .eq("lead_id", lead.id)
          .eq("organization_id", access.organizationId)
          .is("deleted_at", null)
          .order("id"),
        access,
      );
    const { filterVisibleFields, loadFieldDefs } = await import("./custom-fields.server");
    const fields = filterVisibleFields(
      await loadFieldDefs(access.organizationId, "lead"),
      role(access),
    );
    const keys = new Set(fields.map((f) => f.key));
    return {
      ...lead,
      custom_fields: Object.fromEntries(
        Object.entries(lead.custom_fields ?? {}).filter(([k]) => keys.has(k)),
      ),
      contact,
      opportunities: query() ? await readLeadRows(query) : [],
    };
  });
async function saveLead(data: any, editing: boolean) {
  const { access, db } = await context(editing ? "crm.leads.update" : "crm.leads.create");
  const existing = editing ? await row(db, access, data.leadId) : null;
  const { validateAndApplyCustomFields } = await import("./custom-fields.server");
  const fields = await validateAndApplyCustomFields(
    access.organizationId,
    "lead",
    data.customFields ?? {},
    { existing: existing?.custom_fields ?? {}, role: role(access) },
  );
  const { error, data: result } = await db.rpc("crm_save_lead_atomic", {
    _org: access.organizationId,
    _actor: access.userId,
    _lead: existing?.id ?? null,
    _input: { ...data, customFields: fields },
  });
  if (error) throw leadError(error);
  return result;
}
export const createLead = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => leadCreateSchema.parse(d))
  .handler(async ({ data }) => saveLead(data, false));
export const updateLead = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => leadUpdateSchema.parse(d))
  .handler(async ({ data }) => saveLead(data, true));
export const convertLeadToOpportunity = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        leadId: z.string().uuid(),
        title: z.string().trim().min(1).max(200).optional(),
        amount: z.number().finite().min(0).optional(),
        currency: z
          .string()
          .refine((v) => CURRENCY_CODES.includes(v), "اختر عملة صحيحة")
          .optional(),
        expectedCloseDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { access, db } = await context("crm.leads.update");
    if (!access.isSuperAdmin && !access.permissions.includes("crm.opportunities.create"))
      throw new Error("تحتاج صلاحية إنشاء الفرص لإتمام التحويل");
    await row(db, access, data.leadId);
    const { getPublicPlatformSettings } = await import("@/modules/superadmin/settings.functions");
    const platform = await getPublicPlatformSettings();
    const { data: opp, error } = await db.rpc("crm_convert_lead_atomic", {
      _org: access.organizationId,
      _actor: access.userId,
      _lead: data.leadId,
      _input: { ...data, currency: data.currency ?? platform.default_currency },
    });
    if (error) throw leadError(error);
    return opp;
  });
export const deleteLead = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ leadId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { access, db } = await context("crm.leads.delete");
    await row(db, access, data.leadId);
    const { error } = await db.rpc("crm_delete_lead_atomic", {
      _org: access.organizationId,
      _actor: access.userId,
      _lead: data.leadId,
    });
    if (error) throw leadError(error);
    return { ok: true };
  });
