// Gives the abandoned tickets a fresh start (see redistribute-core.ts). Sends no message to anyone.
import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { createRateLimiter } from "@/modules/notifications/rate-limit";

const limiter = createRateLimiter(3, 60_000);
const MAX_TICKETS = 1000;

async function rows(query: any): Promise<any[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Reads every page, because the database returns at most 1000 rows per request. */
async function readAll(make: () => any): Promise<any[]> {
  const all: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rows(make().range(offset, offset + 999));
    all.push(...page);
    if (page.length < 1000) return all;
  }
}

export const redistributeLostTickets = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ stageId: z.string().uuid(), dryRun: z.boolean().default(true) }).parse(d))
  .handler(async ({ data }) => {
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { applyOpportunityScope } = await import("@/platform/rbac/data-scope.server");
    const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const db = supabaseAdmin as any;
    const access = await requireAnyPermission(["crm.leads.assign"]);
    const { organizationId, userId } = access;
    if (!data.dryRun && !limiter.allow(userId)) throw new Error("محاولات كثيرة خلال دقيقة؛ انتظر قليلاً");

    const { data: stage, error: stageError } = await db
      .from("crm_pipeline_stages")
      .select("id,name,pipeline_id,is_lost,is_won,crm_pipelines!inner(organization_id)")
      .eq("id", data.stageId)
      .eq("crm_pipelines.organization_id", organizationId)
      .maybeSingle();
    if (stageError) throw new Error(stageError.message);
    if (!stage) throw new Error("المرحلة غير موجودة");
    if (stage.is_won) throw new Error("لا يمكن إعادة توزيع تذاكر مرحلة الفوز");

    // The history table comes from a migration; refuse early, before anything moves, if it is not there yet.
    const probe = await db.from("opp_owner_history").select("id").limit(1);
    if (probe.error) throw new Error(["PGRST205", "42P01"].includes(probe.error.code) ? "جدول سجل التوزيع غير موجود؛ شغّل ملف SQL الخاص بإعادة التوزيع في Supabase أولاً" : probe.error.message);

    const open = await rows(db.from("crm_pipeline_stages").select("id,name,probability,pipeline_id").eq("pipeline_id", stage.pipeline_id).eq("is_won", false).eq("is_lost", false).neq("id", stage.id).order("ord", { ascending: true }).limit(1));
    const first = open[0];
    if (!first) throw new Error("لا توجد مرحلة مفتوحة في هذا القمع لإعادة التذاكر إليها");

    const query = applyOpportunityScope(
      db.from("opp_opportunities").select("id,lead_id,owner_agent_id,department_id").eq("organization_id", organizationId).eq("stage_id", stage.id).is("deleted_at", null).order("opened_at", { ascending: true }).order("id").limit(MAX_TICKETS + 1),
      access,
    );
    const found: any[] = query ? await rows(query) : [];
    const hasMore = found.length > MAX_TICKETS;
    const tickets = found.slice(0, MAX_TICKETS);

    const [members, active, salesApp, salesRbac] = await Promise.all([
      readAll(() => db.from("org_department_members").select("user_id,department_id").eq("organization_id", organizationId).eq("is_active", true).order("user_id")),
      readAll(() => db.from("org_memberships").select("user_id").eq("organization_id", organizationId).eq("is_active", true).order("user_id")),
      readAll(() => db.from("user_roles").select("user_id").eq("role", "sales").order("user_id")),
      readAll(() => db.from("rbac_user_roles").select("user_id,rbac_roles!inner(key)").eq("organization_id", organizationId).eq("rbac_roles.key", "sales").order("user_id")),
    ]);
    const { buildAgents, planRedistribution, applyRedistribution } = await import("./redistribute-core");
    const agents = buildAgents({
      members,
      activeUsers: new Set(active.map((m) => m.user_id)),
      salesUsers: new Set([...salesApp, ...salesRbac].map((m) => m.user_id)),
    });

    // The ticket's owners, oldest first: each move records who had it and who got it.
    const history = new Map<string, string[]>();
    const ticketIds = tickets.map((t) => t.id);
    for (let i = 0; i < ticketIds.length; i += 50) {
      const part = ticketIds.slice(i, i + 50);
      const list = await readAll(() => db.from("opp_owner_history").select("opportunity_id,from_user_id,to_user_id,created_at").eq("organization_id", organizationId).in("opportunity_id", part).order("created_at", { ascending: true }).order("id"));
      for (const h of list) {
        const seq = history.get(h.opportunity_id) ?? [];
        for (const user of [h.from_user_id, h.to_user_id]) if (user && seq[seq.length - 1] !== user) seq.push(user);
        history.set(h.opportunity_id, seq);
      }
    }

    const plan = planRedistribution({ tickets, history, agents });
    const ids = Object.keys(plan.perAgent);
    const profiles = ids.length ? await rows(db.from("profiles").select("id,full_name").in("id", ids)) : [];
    const names = new Map(profiles.map((p: any) => [p.id, (p.full_name as string | null) || "مندوب"]));
    const perAgent = ids.map((id) => ({ id, name: names.get(id) ?? "مندوب", count: plan.perAgent[id]! })).sort((a, b) => b.count - a.count);
    const summary = { stageName: stage.name as string, firstStageName: first.name as string, tickets: tickets.length, willMove: plan.moves.length, unassignable: plan.unassignable.length, agents: agents.all.length, hasMore, perAgent };
    if (data.dryRun) return { dryRun: true as const, ...summary };

    if (plan.moves.length === 0) return { dryRun: false as const, ...summary, moved: 0 };
    const { moved } = await applyRedistribution(db, { organizationId, actorId: userId, lostStageId: stage.id, first: { id: first.id, pipeline_id: first.pipeline_id, probability: first.probability ?? null }, moves: plan.moves });
    return { dryRun: false as const, ...summary, moved };
  });
