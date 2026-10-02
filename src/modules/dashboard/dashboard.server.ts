import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  calculateDashboard,
  inRange,
  scopedRelatedRecords,
  visibleLead,
  visibleOpportunity,
  type DashboardFilters,
  type DashboardScope,
} from "./dashboard-model";
import type { WorkspaceAccess } from "@/platform/rbac/rbac.server";
import { getOpportunityVisibility } from "@/platform/rbac/data-scope.server";
// No process-wide cache: data cannot be reused across users or stale permissions.
export function invalidateDashboardCache(_orgId: string) {}
export { dashboardRows } from "./dashboard-query";
import { dashboardRows } from "./dashboard-query";
export async function getDashboardOverviewServer(access: WorkspaceAccess, f: DashboardFilters) {
  const db = supabaseAdmin as any;
  const scope: DashboardScope = {
    kind: getOpportunityVisibility(access),
    userId: access.userId,
    departmentIds: access.departmentIds,
  };
  const base = (table: string, columns = "*") =>
    db.from(table).select(columns).eq("organization_id", access.organizationId).order("id");
  const scopeQuery = (query: any, owner: string) => {
    if (scope.kind === "own") query = query.eq(owner, scope.userId);
    if (scope.kind === "department")
      query = query.in(
        "department_id",
        scope.departmentIds.length ? scope.departmentIds : ["00000000-0000-0000-0000-000000000000"],
      );
    if (f.departmentId) query = query.eq("department_id", f.departmentId);
    if (f.ownerId) query = query.eq(owner, f.ownerId);
    return query;
  };
  const [rawOpps, rawLeads, activities, tasks, timeline, deps, pips, members] = await Promise.all([
    dashboardRows(() => {
      let q = scopeQuery(
        base(
          "opp_opportunities",
          "id,lead_id,contact_id,value,currency,stage,stage_id,outcome,opened_at,closed_at,first_response_at,department_id,owner_agent_id,pipeline_id,probability,deleted_at",
        ).is("deleted_at", null),
        "owner_agent_id",
      );
      if (f.pipelineId) q = q.eq("pipeline_id", f.pipelineId);
      return q;
    }),
    dashboardRows(() =>
      scopeQuery(
        base(
          "crm_leads",
          "id,contact_id,status,opened_at,converted_at,department_id,owner_user_id",
        ),
        "owner_user_id",
      ),
    ),
    dashboardRows(() =>
      base(
        "crm_activities",
        "id,entity_type,entity_id,activity_type,subject,direction,actor_user_id,occurred_at",
      ).lt("occurred_at", f.to),
    ),
    dashboardRows(() =>
      base(
        "crm_tasks",
        "id,entity_type,entity_id,title,due_at,priority,status,assignee_user_id,created_by,completed_at",
      ),
    ),
    dashboardRows(() =>
      base("crm_timeline", "id,entity_type,entity_id,title,occurred_at,actor_user_id")
        .gte("occurred_at", f.from)
        .lt("occurred_at", f.to),
    ),
    dashboardRows(() => base("org_departments", "id,name")),
    dashboardRows(() => base("crm_pipelines", "id,name")),
    dashboardRows(() => base("org_department_members", "id,user_id,department_id")),
  ]);
  if (scope.kind === "department" || f.departmentId) {
    const allowedDepartments = f.departmentId
      ? scope.kind !== "department" || scope.departmentIds.includes(f.departmentId)
        ? [f.departmentId]
        : []
      : scope.departmentIds;
    scope.departmentUserIds = members
      .filter((m) => allowedDepartments.includes(m.department_id))
      .map((m) => m.user_id);
  }
  const stages: any[] = [];
  for (let i = 0; i < pips.length; i += 100)
    stages.push(
      ...(await dashboardRows(() =>
        db
          .from("crm_pipeline_stages")
          .select("id,name")
          .in(
            "pipeline_id",
            pips.slice(i, i + 100).map((p) => p.id),
          )
          .order("id"),
      )),
    );
  const opps = rawOpps.filter((o) => visibleOpportunity(o, scope, f));
  const linkedLeads = new Set<string>(opps.map((o) => o.lead_id));
  const leads = rawLeads.filter((l) => visibleLead(l, scope, f, linkedLeads));
  const {
    activities: scopedActivities,
    tasks: scopedTasks,
    timeline: scopedTimeline,
  } = scopedRelatedRecords(activities, tasks, timeline, opps, leads, scope, f);
  const currencies = [...new Set(opps.map((o) => o.currency).filter(Boolean))].sort() as string[];
  const currency = f.currency ?? currencies[0] ?? "USD";
  const results = calculateDashboard(opps, leads, scopedActivities, scopedTasks, {
    ...f,
    currency,
  });
  const profiles: any[] = [];
  for (let i = 0; i < results.agents.length; i += 100)
    profiles.push(
      ...(await dashboardRows(() =>
        db
          .from("profiles")
          .select("id,full_name")
          .order("id")
          .in(
            "id",
            results.agents.slice(i, i + 100).map((a) => a.user_id),
          ),
      )),
    );
  const names = new Map(profiles.map((p) => [p.id, p.full_name])),
    depNames = new Map(deps.map((d) => [d.id, d.name])),
    stageNames = new Map(stages.map((s) => [s.id, s.name]));
  const activityNames: Record<string, string> = {
    call: "مكالمة",
    meeting: "اجتماع",
    message: "رسالة",
    email: "بريد إلكتروني",
    note: "ملاحظة",
    system: "حدث نظام",
    custom: "نشاط مخصص",
  };
  const recent = [
    ...scopedTimeline,
    ...scopedActivities
      .filter((a) => inRange(a.occurred_at, f.from, f.to))
      .map((a) => ({
        id: `activity-${a.id}`,
        title: a.subject || activityNames[a.activity_type] || "نشاط",
        occurred_at: a.occurred_at,
      })),
  ]
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
    .slice(0, 10);
  const now = new Date().toISOString();
  const activeTasks = scopedTasks.filter((t) => t.status === "open" || t.status === "in_progress");
  return {
    ...results,
    activityBreak: results.activityBreak.map((a) => ({
      ...a,
      type: activityNames[a.type] ?? a.type,
    })),
    currency,
    currencies,
    departmentOptions: deps.filter(
      (d) => scope.kind === "all" || scope.departmentIds.includes(d.id),
    ),
    pipelineOptions: pips,
    agents: results.agents.map((a) => ({ ...a, name: names.get(a.user_id) ?? "مستخدم غير مسمى" })),
    departments: results.departments.map((d) => ({
      ...d,
      name: depNames.get(d.department_id) ?? "قسم غير مسمى",
    })),
    stageDist: results.stageDist.map((s) => ({
      ...s,
      stage:
        stageNames.get(s.stageId) ??
        ({ new: "جديدة", won: "ناجحة", lost: "مفقودة" } as Record<string, string>)[s.stageId] ??
        s.stageId,
    })),
    recent,
    upcoming: activeTasks
      .filter((t) => t.due_at && Date.parse(t.due_at) >= Date.parse(now))
      .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))
      .slice(0, 10),
    overdue: activeTasks
      .filter((t) => t.due_at && Date.parse(t.due_at) < Date.parse(now))
      .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))
      .slice(0, 10),
  };
}
