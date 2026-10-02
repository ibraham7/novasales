import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { CURRENCY_CODES } from "@/modules/commerce/currencies";
const filtersSchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    departmentId: z.string().uuid().optional(),
    pipelineId: z.string().uuid().optional(),
    ownerId: z.string().uuid().optional(),
    currency: z
      .string()
      .refine((v) => CURRENCY_CODES.includes(v), "اختر عملة صحيحة")
      .optional(),
  })
  .refine((f) => Date.parse(f.from) < Date.parse(f.to), "تاريخ البداية يجب أن يسبق تاريخ النهاية")
  .refine(
    (f) => Date.parse(f.to) - Date.parse(f.from) <= 367 * 86400000,
    "الفترة يجب ألا تتجاوز سنة",
  );
async function dashboardAccess() {
  const { getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");
  const access = await getWorkspaceAccess();
  if (
    !access.isSuperAdmin &&
    !["reports.view", "reports.view_department", "org.manage"].some((p) =>
      access.permissions.includes(p),
    )
  )
    throw new Error("ليس لديك صلاحية الاطلاع على لوحة التحكم");
  return access;
}
export const getDashboardOverview = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => filtersSchema.parse(d))
  .handler(async ({ data }) => {
    const access = await dashboardAccess();
    const { getDashboardOverviewServer } = await import("./dashboard.server");
    return getDashboardOverviewServer(access, data);
  });
export const getDashboardStats = createServerFn({ method: "GET" }).handler(async () => {
  const access = await dashboardAccess();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { dashboardRows } = await import("./dashboard.server");
  const { applyOpportunityScope } = await import("@/platform/rbac/data-scope.server");
  const db = supabaseAdmin as any;
  const { getOpportunityVisibility } = await import("@/platform/rbac/data-scope.server");
  if (getOpportunityVisibility(access) === "all") {
    const accounts = await dashboardRows(() =>
      db
        .from("msg_channel_accounts")
        .select("id,status")
        .eq("organization_id", access.organizationId)
        .order("id"),
    );
    const counts = await Promise.all(
      ["crm_contacts", "msg_sessions", "msg_messages"].map((table) =>
        db
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("organization_id", access.organizationId),
      ),
    );
    if (counts.some((r) => r.error)) throw new Error("تعذر تحميل إحصاءات لوحة التحكم");
    return {
      instancesTotal: accounts.length,
      instancesConnected: accounts.filter((a) => a.status === "connected").length,
      contactsTotal: counts[0].count ?? 0,
      chatsTotal: counts[1].count ?? 0,
      messagesTotal: counts[2].count ?? 0,
    };
  }
  if (getOpportunityVisibility(access) === "department" && !access.departmentIds.length)
    return {
      instancesTotal: 0,
      instancesConnected: 0,
      contactsTotal: 0,
      chatsTotal: 0,
      messagesTotal: 0,
    };
  const opps = await dashboardRows(() =>
    applyOpportunityScope(
      db
        .from("opp_opportunities")
        .select("id,contact_id")
        .eq("organization_id", access.organizationId)
        .is("deleted_at", null)
        .order("id"),
      access,
    ),
  );
  const ids = opps.map((o) => o.id),
    sessionIds = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const links = await dashboardRows(() =>
      db
        .from("crm_opportunity_sessions")
        .select("id,session_ref")
        .eq("organization_id", access.organizationId)
        .in("opportunity_id", ids.slice(i, i + 100))
        .order("id"),
    );
    for (const l of links) if (l.session_ref) sessionIds.add(l.session_ref);
  }
  let messagesTotal = 0;
  const sessions = [...sessionIds];
  for (let i = 0; i < sessions.length; i += 100) {
    const { count, error } = await db
      .from("msg_messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", access.organizationId)
      .in("session_id", sessions.slice(i, i + 100));
    if (error) throw new Error("تعذر تحميل إحصاءات الرسائل");
    messagesTotal += count ?? 0;
  }
  const accounts = await dashboardRows(() =>
    db
      .from("msg_channel_accounts")
      .select("id,status")
      .eq("organization_id", access.organizationId)
      .order("id"),
  );
  return {
    instancesTotal: accounts.length,
    instancesConnected: accounts.filter((a) => a.status === "connected").length,
    contactsTotal: new Set(opps.map((o) => o.contact_id).filter(Boolean)).size,
    chatsTotal: sessionIds.size,
    messagesTotal,
  };
});
