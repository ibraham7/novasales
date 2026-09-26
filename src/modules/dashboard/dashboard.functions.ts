import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const filtersSchema = z.object({
  from: z.string(),
  to: z.string(),
  departmentId: z.string().uuid().optional(),
  pipelineId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
});

async function orgId() {
  const { getWorkspace } = await import("@/platform/workspace/workspace.server");
  const { organizationId } = await getWorkspace();
  return organizationId;
}

async function scopedFilters(data: z.infer<typeof filtersSchema>) {
  const { getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");
  const { scopedDashboardFilters } = await import("@/platform/rbac/data-scope.server");
  return scopedDashboardFilters(await getWorkspaceAccess(), data);
}

export const getDashboardStats = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");
  const { applyOpportunityScope, getOpportunityVisibility } = await import("@/platform/rbac/data-scope.server");
  const db = supabaseAdmin as any;
  const { organizationId } = await getWorkspace();
  const access = await getWorkspaceAccess();
  if (getOpportunityVisibility(access) !== "all") {
    let oppQ = db
      .from("opp_opportunities")
      .select("id, contact_id")
      .eq("organization_id", organizationId)
      .limit(1000);
    oppQ = applyOpportunityScope(oppQ, access);
    const { data: opps } = oppQ ? await oppQ : { data: [] };
    const oppIds = (opps ?? []).map((opp: any) => opp.id);
    const contactIds = Array.from(new Set((opps ?? []).map((opp: any) => opp.contact_id).filter(Boolean)));
    const { data: links } = oppIds.length
      ? await db.from("crm_opportunity_sessions").select("session_ref").in("opportunity_id", oppIds).eq("organization_id", organizationId)
      : { data: [] };
    const sessionIds = Array.from(new Set((links ?? []).map((link: any) => link.session_ref).filter(Boolean)));
    const [{ count: messagesCount }, accounts] = await Promise.all([
      sessionIds.length
        ? db.from("msg_messages").select("id", { count: "exact", head: true }).in("session_id", sessionIds).eq("organization_id", organizationId)
        : Promise.resolve({ count: 0 }),
      db.from("msg_channel_accounts").select("id, status").eq("organization_id", organizationId),
    ]);
    const connected = ((accounts.data ?? []) as Array<{ status: string }>).filter((i) => i.status === "connected").length;
    return {
      instancesTotal: (accounts.data ?? []).length,
      instancesConnected: connected,
      contactsTotal: contactIds.length,
      chatsTotal: sessionIds.length,
      messagesTotal: messagesCount ?? 0,
    };
  }
  const [accounts, contacts, sessions, messages] = await Promise.all([
    db.from("msg_channel_accounts").select("id, status").eq("organization_id", organizationId),
    db.from("crm_contacts").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    db.from("msg_sessions").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    db.from("msg_messages").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
  ]);
  const connected =
    ((accounts.data ?? []) as Array<{ status: string }>).filter((i) => i.status === "connected").length;
  return {
    instancesTotal: (accounts.data ?? []).length,
    instancesConnected: connected,
    contactsTotal: contacts.count ?? 0,
    chatsTotal: sessions.count ?? 0,
    messagesTotal: messages.count ?? 0,
  };
});

export const getDashboardKpis = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => filtersSchema.parse(d))
  .handler(async ({ data }) => {
    const { getKpis } = await import("./dashboard.server");
    return getKpis(await orgId(), await scopedFilters(data));
  });

export const getDashboardRevenueTrend = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => filtersSchema.parse(d))
  .handler(async ({ data }) => {
    const { getRevenueTrend } = await import("./dashboard.server");
    return getRevenueTrend(await orgId(), await scopedFilters(data));
  });

export const getDashboardStageDistribution = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => filtersSchema.parse(d))
  .handler(async ({ data }) => {
    const { getStageDistribution } = await import("./dashboard.server");
    return getStageDistribution(await orgId(), await scopedFilters(data));
  });

export const getDashboardActivityBreakdown = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => filtersSchema.parse(d))
  .handler(async ({ data }) => {
    const { getActivityBreakdown } = await import("./dashboard.server");
    return getActivityBreakdown(await orgId(), await scopedFilters(data));
  });

export const getDashboardAgentPerformance = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => filtersSchema.parse(d))
  .handler(async ({ data }) => {
    const { getAgentPerformance } = await import("./dashboard.server");
    return getAgentPerformance(await orgId(), await scopedFilters(data));
  });

export const getDashboardDepartmentPerformance = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => filtersSchema.parse(d))
  .handler(async ({ data }) => {
    const { getDepartmentPerformance } = await import("./dashboard.server");
    return getDepartmentPerformance(await orgId(), await scopedFilters(data));
  });

export const getDashboardRecentActivities = createServerFn({ method: "GET" }).handler(async () => {
  const { getRecentActivities } = await import("./dashboard.server");
  return getRecentActivities(await orgId(), 10);
});

export const getDashboardUpcomingTasks = createServerFn({ method: "GET" }).handler(async () => {
  const { getUpcomingTasks } = await import("./dashboard.server");
  return getUpcomingTasks(await orgId(), 10);
});

export const getDashboardOverdueTasks = createServerFn({ method: "GET" }).handler(async () => {
  const { getOverdueTasks } = await import("./dashboard.server");
  return getOverdueTasks(await orgId(), 10);
});
