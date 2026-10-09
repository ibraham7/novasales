import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

export const listStages = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const db = supabaseAdmin as any;
  const { data } = await db.from("opp_stages").select("*").order("ord", { ascending: true });
  return data ?? [];
});

// Read existing tables instead of relying on optional, undeployed RPCs.
async function checkedRows(query: any): Promise<any[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function readByIds(db: any, table: string, select: string, ids: string[], organizationId?: string) {
  const rows: any[] = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    let query = db.from(table).select(select).in("id", unique.slice(i, i + 100));
    if (organizationId) query = query.eq("organization_id", organizationId);
    rows.push(...await checkedRows(query));
  }
  return rows;
}

export const getPipelinePageMeta = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const access = await requireAnyPermission(["crm.opportunities.view", "opportunities.view", "opportunities.view_department", "opportunities.view_own"]);
  const db = supabaseAdmin as any;
  const { listPipelines } = await import("./pipelines.functions");
  const [pipelines, departments, memberships] = await Promise.all([
    listPipelines(),
    checkedRows(db.from("org_departments").select("id,name").eq("organization_id", access.organizationId).eq("is_active", true).order("name")),
    checkedRows(db.from("org_memberships").select("user_id").eq("organization_id", access.organizationId).eq("is_active", true)),
  ]);
  const profiles = await readByIds(db, "profiles", "id,full_name,avatar_url", memberships.map(m => m.user_id));
  return { pipelines, departments, members: profiles.map(p => ({ ...p, user_id: p.id, profile_name: p.full_name })) };
});

export const listOpportunitiesBoard = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({
      departmentId: z.string().uuid().optional(),
      ownerAgentId: z.string().uuid().optional(),
      /** يجلب كل التذاكر (وليس أحدث 500) — يُستخدم أثناء البحث */
      all: z.boolean().optional(),
    }).parse(d ?? {})
  )
  .handler(async ({ data }) => {

    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { getWorkspaceAccess, requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { getOpportunityVisibility } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    await requireAnyPermission(["crm.opportunities.view", "opportunities.view", "opportunities.view_department", "opportunities.view_own"]);
    const access = await getWorkspaceAccess();
    const visibility = getOpportunityVisibility(access);
    let ownerAgentId = data.ownerAgentId ?? null;
    let departmentIds: string[] | null = data.departmentId ? [data.departmentId] : null;

    if (visibility === "own") {
      ownerAgentId = access.userId;
      departmentIds = null;
    } else if (visibility === "department") {
      if (data.departmentId && !access.departmentIds.includes(data.departmentId)) return [];
      departmentIds = data.departmentId ? [data.departmentId] : access.departmentIds;
      if (departmentIds.length === 0) return [];
    }

    let query = db.from("opp_opportunities").select("*")
      .eq("organization_id", organizationId).is("deleted_at", null)
      .order("opened_at", { ascending: false }).order("id");
    if (ownerAgentId) query = query.eq("owner_agent_id", ownerAgentId);
    if (departmentIds) query = query.in("department_id", departmentIds);
    const rows: any[] = [];
    const limit = data.all ? 3000 : 500;
    for (let offset = 0; offset < limit; offset += 500) {
      const page = await checkedRows(query.range(offset, Math.min(offset + 499, limit - 1)));
      rows.push(...page);
      if (page.length < 500) break;
    }
    if (!rows.length) return [];
    const [contacts, owners] = await Promise.all([
      readByIds(db, "crm_contacts", "id,full_name,display_name,avatar_url", rows.map(o => o.contact_id), organizationId),
      readByIds(db, "profiles", "id,full_name,avatar_url", rows.map(o => o.owner_agent_id)),
    ]);
    const links: any[] = [];
    for (let i = 0; i < rows.length; i += 100) {
      links.push(...await checkedRows(db.from("crm_opportunity_sessions")
        .select("opportunity_id,session_ref,channel").eq("organization_id", organizationId)
        .in("opportunity_id", rows.slice(i, i + 100).map(o => o.id))));
    }
    const sessions = await readByIds(db, "msg_sessions", "id,channel_account_id,peer_identifier,unread_count,last_message_at,last_message_preview", links.map(l => l.session_ref), organizationId);
    const accounts = await readByIds(db, "msg_channel_accounts", "id,display_name,identifier", sessions.map(s => s.channel_account_id), organizationId);
    const contactsById = new Map(contacts.map(c => [c.id, c]));
    const ownersById = new Map(owners.map(o => [o.id, o]));
    const sessionsById = new Map(sessions.map(s => [s.id, s]));
    const accountsById = new Map(accounts.map(a => [a.id, a]));
    const linkedByOpportunity = new Map<string, any[]>();
    for (const link of links) {
      const session = sessionsById.get(link.session_ref);
      if (!session) continue;
      const list = linkedByOpportunity.get(link.opportunity_id) ?? [];
      list.push({ ...session, channel: link.channel });
      linkedByOpportunity.set(link.opportunity_id, list);
    }
    return rows.map(o => {
      const contact = contactsById.get(o.contact_id);
      const owner = ownersById.get(o.owner_agent_id);
      const linked = linkedByOpportunity.get(o.id) ?? [];
      linked.sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
      const latest = linked[0];
      const account = accountsById.get(latest?.channel_account_id);
      return {
        ...o, contact_name: contact?.display_name || contact?.full_name || o.title,
        contact_avatar: contact?.avatar_url, contact_phone: latest?.peer_identifier,
        owner_name: owner?.full_name, owner_avatar: owner?.avatar_url,
        channel: latest?.channel, account_name: account?.display_name,
        account_label: account?.display_name || account?.identifier,
        sessions_count: linked.length,
        unread_count: linked.reduce((total, session) => total + (session.unread_count ?? 0), 0),
        last_message: latest?.last_message_preview, last_message_at: latest?.last_message_at,
      };
    });
  });



export const moveOpportunityStage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      opportunityId: z.string().uuid(),
      stage: z.string().trim().min(1),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission, getWorkspaceAccess } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.opportunities.move", "crm.opportunities.update", "opportunities.manage"]);
    const { data: current } = await db
      .from("opp_opportunities")
      .select("id, owner_agent_id, department_id")
      .eq("id", data.opportunityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!current || !canAccessOpportunityRow(access ?? (await getWorkspaceAccess()), current)) throw new Error("لا تملك صلاحية تعديل هذه الفرصة");
    const { data: stage } = await db.from("opp_stages").select("key, is_terminal, won").eq("key", data.stage).maybeSingle();
    if (!stage) throw new Error("مرحلة غير معروفة");
    const patch: Record<string, unknown> = { stage: data.stage };
    if (stage.is_terminal) {
      patch.outcome = stage.won ? "won" : "lost";
      patch.closed_at = new Date().toISOString();
    } else {
      patch.outcome = null;
      patch.closed_at = null;
    }
    const { error } = await db.from("opp_opportunities").update(patch).eq("id", data.opportunityId);
    if (error) throw new Error(error.message);
    await db.from("domain_events").insert({
      organization_id: organizationId,
      event_type: "crm.opportunity.stage_changed",
      aggregate_type: "opportunity",
      aggregate_id: data.opportunityId,
      payload: { stage: data.stage },
    });
    return { ok: true };
  });
