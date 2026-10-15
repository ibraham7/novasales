import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

export const OPP_STAGES = ["new", "contacted", "qualified", "negotiation", "won", "lost"] as const;
export type OppStage = (typeof OPP_STAGES)[number];

export const STAGE_LABEL_AR: Record<string, string> = {
  new: "جديد",
  contacted: "تم التواصل",
  qualified: "مؤهل",
  negotiation: "تفاوض",
  won: "فوز",
  lost: "خسارة",
};

// Get the opportunity linked to a chat session, enriched with everything the workspace panel needs.
export const getOpportunityByChat = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ chatId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.opportunities.view", "opportunities.view", "opportunities.view_department", "opportunities.view_own"]);

    const { data: link } = await db
      .from("crm_opportunity_sessions")
      .select("opportunity_id")
      .eq("organization_id", organizationId)
      .eq("session_ref", data.chatId)
      .maybeSingle();
    if (!link?.opportunity_id) return null;

    const { data: opp } = await db
      .from("opp_opportunities")
      .select("*")
      .eq("id", link.opportunity_id)
      .maybeSingle();
    if (!opp) return null;
    if (!canAccessOpportunityRow(access, { owner_agent_id: opp.owner_agent_id, department_id: opp.department_id })) return null;

    const [{ data: contact }, { data: owner }, { data: dept }, { data: tagMap }] = await Promise.all([
      db.from("crm_contacts").select("*").eq("id", opp.contact_id).maybeSingle(),
      opp.owner_agent_id
        ? db.from("profiles").select("id, full_name").eq("id", opp.owner_agent_id).maybeSingle()
        : Promise.resolve({ data: null }),
      opp.department_id
        ? db.from("org_departments").select("id, name").eq("id", opp.department_id).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from("opp_tags_map").select("tag_id, opp_tags(id, name, color)").eq("opportunity_id", opp.id),
    ]);

    // Supervisor of department
    let supervisorName: string | null = null;
    if (opp.department_id) {
      const { data: sup } = await db
        .from("org_department_members")
        .select("user_id, display_name")
        .eq("department_id", opp.department_id)
        .eq("is_supervisor", true)
        .limit(1)
        .maybeSingle();
      if (sup?.display_name) supervisorName = sup.display_name;
      else if (sup?.user_id) {
        const { data: p } = await db.from("profiles").select("full_name").eq("id", sup.user_id).maybeSingle();
        supervisorName = p?.full_name ?? null;
      }
    }

    // Phone
    const { data: cp } = await db
      .from("crm_contact_points")
      .select("identifier, channel_type, is_primary")
      .eq("contact_id", opp.contact_id)
      .eq("organization_id", organizationId);
    const phone =
      (cp ?? []).find((x: any) => x.channel_type === "whatsapp" && x.is_primary)?.identifier ??
      (cp ?? [])[0]?.identifier ??
      null;

    const custom = (contact?.custom_fields ?? {}) as Record<string, unknown>;

    return {
      opportunity: {
        id: opp.id,
        stage: opp.stage as OppStage,
        source: opp.source ?? null,
        product_interest: opp.product_interest ?? null,
        priority: opp.priority ?? 0,
        opened_at: opp.opened_at,
        first_response_at: opp.first_response_at,
        outcome: opp.outcome ?? null,
        title: opp.title ?? null,
        value: opp.value ?? null,
        currency: opp.currency ?? null,
      },
      contact: contact
        ? {
          id: contact.id,
          name: contact.display_name ?? contact.full_name ?? null,
          phone,
          email: (custom.email as string | undefined) ?? null,
          country: contact.country ?? null,
          city: contact.city ?? null,
          notes: contact.notes ?? null,
        }
        : null,
      owner: opp.owner_agent_id
        ? { id: opp.owner_agent_id, name: (owner as any)?.full_name ?? null }
        : null,
      supervisor: supervisorName ? { name: supervisorName } : null,
      department: dept ? { id: (dept as any).id, name: (dept as any).name } : null,
      tags: (tagMap ?? [])
        .map((t: any) => t.opp_tags)
        .filter(Boolean)
        .map((t: any) => ({ id: t.id, name: t.name, color: t.color })),
    };
  });

export const listOrgTags = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const db = supabaseAdmin as any;
  const { organizationId } = await getWorkspace();
  const { data } = await db
    .from("opp_tags")
    .select("id, name, color")
    .eq("organization_id", organizationId)
    .order("name");
  return data ?? [];
});

export const updateOpportunity = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        opportunityId: z.string().uuid(),
        stage: z.enum(OPP_STAGES).optional(),
        source: z.string().max(80).nullable().optional(),
        product_interest: z.string().max(160).nullable().optional(),
        priority: z.number().int().min(0).max(3).optional(),
        departmentId: z.string().uuid().nullable().optional(),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.opportunities.update", "opportunities.manage"]);
    const { data: current } = await db
      .from("opp_opportunities")
      .select("owner_agent_id, department_id, lead_id")
      .eq("id", data.opportunityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!current || !canAccessOpportunityRow(access, current)) throw new Error("لا تملك صلاحية تعديل هذه الفرصة");
    const patch: Record<string, unknown> = {};
    if (data.stage !== undefined) {
      patch.stage = data.stage;
      if (data.stage === "won" || data.stage === "lost") {
        patch.outcome = data.stage;
        patch.closed_at = new Date().toISOString();
      } else {
        patch.outcome = null;
        patch.closed_at = null;
      }
    }
    if (data.source !== undefined) patch.source = data.source;
    if (data.product_interest !== undefined) patch.product_interest = data.product_interest;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.departmentId !== undefined) {
      patch.department_id = data.departmentId;
      // Keep the lead's department in sync so subsequent scoping and assignments work.
      if (current.lead_id) {
        await db
          .from("crm_leads")
          .update({ department_id: data.departmentId })
          .eq("id", current.lead_id)
          .eq("organization_id", organizationId);
      }
    }
    const { error } = await db
      .from("opp_opportunities")
      .update(patch)
      .eq("id", data.opportunityId)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    if (data.stage) {
      await db.from("domain_events").insert({
        organization_id: organizationId,
        event_type: "crm.opportunity.stage_changed",
        aggregate_type: "opportunity",
        aggregate_id: data.opportunityId,
        payload: { stage: data.stage },
      });
    }
    return { ok: true };
  });

export const listOppNotes = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ opportunityId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.opportunities.view", "opportunities.view", "opportunities.view_department", "opportunities.view_own"]);
    const { data: opp } = await db
      .from("opp_opportunities")
      .select("owner_agent_id, department_id")
      .eq("id", data.opportunityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!opp || !canAccessOpportunityRow(access, opp)) return [];
    const { data: notes } = await db
      .from("opp_notes")
      .select("id, body, author_id, created_at")
      .eq("organization_id", organizationId)
      .eq("opportunity_id", data.opportunityId)
      .order("created_at", { ascending: false });
    const authorIds = Array.from(new Set((notes ?? []).map((n: any) => n.author_id).filter(Boolean)));
    const { data: profs } = authorIds.length
      ? await db.from("profiles").select("id, full_name").in("id", authorIds)
      : { data: [] };
    const pMap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
    return (notes ?? []).map((n: any) => ({
      id: n.id,
      body: n.body,
      author_name: n.author_id ? pMap.get(n.author_id) ?? null : null,
      created_at: n.created_at,
    }));
  });

export const addOppNote = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ opportunityId: z.string().uuid(), body: z.string().trim().min(1).max(4000) }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId, userId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.opportunities.update", "crm.activities.create"]);
    const { data: opp } = await db
      .from("opp_opportunities")
      .select("owner_agent_id, department_id")
      .eq("id", data.opportunityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!opp || !canAccessOpportunityRow(access, opp)) throw new Error("لا تملك صلاحية إضافة ملاحظة لهذه الفرصة");
    const { error } = await db.from("opp_notes").insert({
      organization_id: organizationId,
      opportunity_id: data.opportunityId,
      author_id: userId,
      body: data.body,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listOppActivity = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ opportunityId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.opportunities.view", "opportunities.view", "opportunities.view_department", "opportunities.view_own"]);
    const { data: opp } = await db
      .from("opp_opportunities")
      .select("owner_agent_id, department_id")
      .eq("id", data.opportunityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!opp || !canAccessOpportunityRow(access, opp)) return [];
    const { data: rows } = await db
      .from("domain_events")
      .select("id, event_type, payload, created_at, actor_user_id")
      .eq("organization_id", organizationId)
      .eq("aggregate_type", "opportunity")
      .eq("aggregate_id", data.opportunityId)
      .order("created_at", { ascending: false })
      .limit(100);
    return rows ?? [];
  });

export const addOppTag = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        opportunityId: z.string().uuid(),
        name: z.string().trim().min(1).max(40),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.tags.manage", "crm.opportunities.update"]);
    const { data: opp } = await db
      .from("opp_opportunities")
      .select("owner_agent_id, department_id")
      .eq("id", data.opportunityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!opp || !canAccessOpportunityRow(access, opp)) throw new Error("لا تملك صلاحية تعديل وسوم هذه الفرصة");
    const name = data.name.trim();
    const { data: existing } = await db
      .from("opp_tags")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("name", name)
      .maybeSingle();
    let tagId = existing?.id as string | undefined;
    if (!tagId) {
      const { data: t, error } = await db
        .from("opp_tags")
        .insert({ organization_id: organizationId, name, color: "#94a3b8" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      tagId = t.id;
    }
    await db
      .from("opp_tags_map")
      .insert({ opportunity_id: data.opportunityId, tag_id: tagId })
      .select()
      .maybeSingle()
      .then(() => { }, () => { });
    return { ok: true };
  });

export const removeOppTag = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ opportunityId: z.string().uuid(), tagId: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.tags.manage", "crm.opportunities.update"]);
    const { data: opp } = await db
      .from("opp_opportunities")
      .select("owner_agent_id, department_id")
      .eq("id", data.opportunityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!opp || !canAccessOpportunityRow(access, opp)) throw new Error("لا تملك صلاحية تعديل وسوم هذه الفرصة");
    await db
      .from("opp_tags_map")
      .delete()
      .eq("opportunity_id", data.opportunityId)
      .eq("tag_id", data.tagId);
    return { ok: true };
  });

// Enriched chat rows for the chat list.
type ChatListRow = {
  id: string;
  peer_identifier: string | null;
  channel_account_id: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
  opportunity_id: string | null;
  contact_id: string | null;
  stage: string | null;
  source: string | null;
  priority: number;
  department_id: string | null;
  owner_agent_id: string | null;
  contact_name: string | null;
  department_name: string | null;
  owner_name: string | null;
};

/** Sessions joined with their opportunity, contact, department and owner — one round trip via SQL. */
async function loadChatListRows(db: any, organizationId: string, limit: number): Promise<ChatListRow[]> {
  const { data, error } = await db.rpc("list_chat_rows", { _organization_id: organizationId, _limit: limit });
  if (!error) return data ?? [];
  // Fallback while the database function is not deployed: the same rows from sequential reads.
  const { data: sessions } = await db
    .from("msg_sessions")
    .select("*")
    .eq("organization_id", organizationId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  const rows = sessions ?? [];
  if (!rows.length) return [];
  const { data: links } = await db
    .from("crm_opportunity_sessions")
    .select("opportunity_id, session_ref")
    .eq("organization_id", organizationId)
    .in("session_ref", rows.map((s: any) => s.id));
  const linkMap = new Map((links ?? []).map((l: any) => [l.session_ref, l.opportunity_id]));
  const oppIds = Array.from(new Set((links ?? []).map((l: any) => l.opportunity_id)));
  const { data: opps } = oppIds.length
    ? await db
        .from("opp_opportunities")
        .select("id, contact_id, stage, source, priority, department_id, owner_agent_id")
        .in("id", oppIds)
    : { data: [] };
  const oppMap = new Map((opps ?? []).map((o: any) => [o.id, o]));
  const ids = (key: string) => Array.from(new Set((opps ?? []).map((o: any) => o[key]).filter(Boolean)));
  const [{ data: contacts }, { data: depts }, { data: owners }] = await Promise.all([
    ids("contact_id").length
      ? db.from("crm_contacts").select("id, display_name, full_name").in("id", ids("contact_id"))
      : { data: [] },
    ids("department_id").length
      ? db.from("org_departments").select("id, name").in("id", ids("department_id"))
      : { data: [] },
    ids("owner_agent_id").length
      ? db.from("profiles").select("id, full_name").in("id", ids("owner_agent_id"))
      : { data: [] },
  ]);
  const cMap = new Map((contacts ?? []).map((c: any) => [c.id, c.display_name ?? c.full_name]));
  const dMap = new Map((depts ?? []).map((d: any) => [d.id, d.name]));
  const oMap = new Map((owners ?? []).map((o: any) => [o.id, o.full_name]));
  return rows.map((s: any) => {
    const opp: any = oppMap.get(linkMap.get(s.id) as string);
    return {
      id: s.id,
      peer_identifier: s.peer_identifier,
      channel_account_id: s.channel_account_id,
      last_message_preview: s.last_message_preview,
      last_message_at: s.last_message_at,
      unread_count: s.unread_count ?? 0,
      opportunity_id: opp?.id ?? null,
      contact_id: opp?.contact_id ?? null,
      stage: opp?.stage ?? null,
      source: opp?.source ?? null,
      priority: opp?.priority ?? 0,
      department_id: opp?.department_id ?? null,
      owner_agent_id: opp?.owner_agent_id ?? null,
      contact_name: (cMap.get(opp?.contact_id) as string) ?? null,
      department_name: (dMap.get(opp?.department_id) as string) ?? null,
      owner_name: (oMap.get(opp?.owner_agent_id) as string) ?? null,
    };
  });
}

export const listChatsEnriched = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ all: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow, getOpportunityVisibility } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();

    // Permissions, the joined rows and the number-to-department links are independent: one parallel round.
    const [access, rows, accountLinks]: [
      Awaited<ReturnType<typeof requireAnyPermission>>,
      ChatListRow[],
      { account_id: string; department_id: string }[],
    ] = await Promise.all([
      requireAnyPermission(["messaging.send", "crm.opportunities.view", "opportunities.view", "opportunities.view_department", "opportunities.view_own"]),
      loadChatListRows(db, organizationId, data.all ? 3000 : 200),
      db
        .from("msg_channel_account_departments")
        .select("account_id, department_id")
        .eq("organization_id", organizationId)
        .then((result: any) => {
          if (result.error) throw new Error(result.error.message);
          return (result.data ?? []) as { account_id: string; department_id: string }[];
        }),
    ]);

    // نطاق الرؤية: الرقم (حساب القناة) المرتبط بأقسام المستخدم.
    const seesAll = getOpportunityVisibility(access) === "all";
    const allowedAccounts = new Set(
      seesAll
        ? []
        : accountLinks
            .filter((link) => access.departmentIds.includes(link.department_id))
            .map((link) => link.account_id),
    );

    return rows.flatMap((s) => {
      const opp = s.opportunity_id
        ? { owner_agent_id: s.owner_agent_id, department_id: s.department_id }
        : null;
      const accountAllowed = seesAll || (!!s.channel_account_id && allowedAccounts.has(s.channel_account_id));
      if (!accountAllowed && opp && !canAccessOpportunityRow(access, opp)) return [];
      if (!accountAllowed && !opp) return [];

      const phone = String(s.peer_identifier ?? "").split("@")[0];
      return [
        {
          id: s.id,
          title: s.contact_name ?? phone,
          phone,
          last_message_text: s.last_message_preview,
          last_message_at: s.last_message_at,
          unread_count: s.unread_count ?? 0,
          stage: (s.stage as OppStage | null) ?? null,
          source: s.source ?? null,
          priority: s.priority ?? 0,
          department_name: s.department_name ?? null,
          owner_name: s.owner_name ?? null,
          owner_id: s.owner_agent_id ?? null,
          is_assigned: !!s.owner_agent_id,
        },
      ];
    });
  });

// Full workspace payload for the 3-column pipeline detail view.
    export const getOpportunityWorkspace = createServerFn({ method: "GET" })
      .inputValidator((d: unknown) => z.object({ opportunityId: z.string().uuid() }).parse(d))
      .handler(async ({ data }) => {
        const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
        const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
        const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
        const db = supabaseAdmin as any;
        const { organizationId } = await getWorkspace();
        const access = await requireAnyPermission(["crm.opportunities.view", "opportunities.view", "opportunities.view_department", "opportunities.view_own"]);

        const { data: opp } = await db
          .from("opp_opportunities")
          .select("*")
          .eq("id", data.opportunityId)
          .eq("organization_id", organizationId)
          .is("deleted_at", null)
          .maybeSingle();
        if (!opp) return null;
        if (!canAccessOpportunityRow(access, { owner_agent_id: opp.owner_agent_id, department_id: opp.department_id })) return null;

        const [{ data: contact }, { data: owner }, { data: dept }, { data: stage }, { data: link }] = await Promise.all([
          db.from("crm_contacts").select("*").eq("id", opp.contact_id).maybeSingle(),
          opp.owner_agent_id
            ? db.from("profiles").select("id, full_name, avatar_url, phone").eq("id", opp.owner_agent_id).maybeSingle()
            : Promise.resolve({ data: null }),
          opp.department_id
            ? db.from("org_departments").select("id, name").eq("id", opp.department_id).maybeSingle()
            : Promise.resolve({ data: null }),
          opp.stage_id
            ? db.from("crm_pipeline_stages").select("id, name, color, probability").eq("id", opp.stage_id).maybeSingle()
            : Promise.resolve({ data: null }),
          db
            .from("crm_opportunity_sessions")
            .select("session_ref, channel")
            .eq("organization_id", organizationId)
            .eq("opportunity_id", opp.id)
            .maybeSingle(),
        ]);

        // Session avatar / push_name
        let sessionAvatar: string | null = null;
        let sessionPushName: string | null = null;
        if ((link as any)?.session_ref) {
          const { data: sess } = await db
            .from("msg_sessions")
            .select("profile_pic_url, push_name")
            .eq("id", (link as any).session_ref)
            .maybeSingle();
          sessionAvatar = (sess as any)?.profile_pic_url ?? null;
          sessionPushName = (sess as any)?.push_name ?? null;
        }


        const { data: cp } = await db
          .from("crm_contact_points")
          .select("identifier, channel_type, is_primary")
          .eq("contact_id", opp.contact_id)
          .eq("organization_id", organizationId);
        const phone =
          (cp ?? []).find((x: any) => x.channel_type === "whatsapp" && x.is_primary)?.identifier ??
          (cp ?? [])[0]?.identifier ??
          null;

        // Siblings: other opps in same stage
        const siblings: any[] = [];
        if (opp.stage_id) {
          const { data: sibs } = await db
            .from("opp_opportunities")
            .select("id, contact_id, owner_agent_id, opened_at, source, value")
            .eq("organization_id", organizationId)
            .eq("stage_id", opp.stage_id)
            .neq("id", opp.id)
            .is("deleted_at", null)
            .order("opened_at", { ascending: false })
            .limit(100);
          const visibleSibs = (sibs ?? []).filter((sib: any) => canAccessOpportunityRow(access, sib));
          const cids = Array.from(new Set(visibleSibs.map((s: any) => s.contact_id)));
          const oids = Array.from(new Set(visibleSibs.map((s: any) => s.owner_agent_id).filter(Boolean)));
          const [{ data: cs }, { data: ps }] = await Promise.all([
            cids.length
              ? db.from("crm_contacts").select("id, display_name, full_name").in("id", cids)
              : Promise.resolve({ data: [] }),
            oids.length
              ? db.from("profiles").select("id, full_name").in("id", oids)
              : Promise.resolve({ data: [] }),
          ]);
          const cm = new Map((cs ?? []).map((x: any) => [x.id, x]));
          const pm = new Map((ps ?? []).map((x: any) => [x.id, x.full_name]));
          for (const s of visibleSibs) {
            const c: any = cm.get(s.contact_id);
            siblings.push({
              id: s.id,
              contact_name: c?.display_name ?? c?.full_name ?? "—",
              owner_name: s.owner_agent_id ? pm.get(s.owner_agent_id) ?? null : null,
              opened_at: s.opened_at,
              source: s.source,
              value: s.value,
            });
          }
        }

        const custom = ((contact as any)?.custom_fields ?? {}) as Record<string, unknown>;
        return {
          opportunity: {
            id: opp.id,
            lead_id: opp.lead_id,
            stage_id: opp.stage_id,
            stage_name: (stage as any)?.name ?? null,
            stage_color: (stage as any)?.color ?? null,
            probability: opp.probability ?? (stage as any)?.probability ?? null,
            source: opp.source ?? null,
            value: opp.value ?? null,
            currency: opp.currency ?? "USD",
            priority: opp.priority ?? 0,
            opened_at: opp.opened_at,
            title: opp.title ?? null,
          },
          contact: contact
            ? {
              id: (contact as any).id,
              name: (contact as any).display_name ?? (contact as any).full_name ?? sessionPushName ?? null,
              push_name: sessionPushName,
              avatar_url: (contact as any).avatar_url ?? sessionAvatar,
              phone,
              email: (custom.email as string | undefined) ?? null,
              country: (contact as any).country ?? null,
              city: (contact as any).city ?? null,
              notes: (contact as any).notes ?? null,
            }
            : null,
          owner: opp.owner_agent_id
            ? {
              id: opp.owner_agent_id,
              name: (owner as any)?.full_name ?? null,
              avatar_url: (owner as any)?.avatar_url ?? null,
              phone: (owner as any)?.phone ?? null,
            }
            : null,
          department: dept ? { id: (dept as any).id, name: (dept as any).name } : null,
          channel: (link as any)?.channel ?? null,
          session_id: (link as any)?.session_ref ?? null,
          siblings,
        };
      });


    /* ------------------------ Trash (Soft Delete) ------------------------ */

    const DELETE_PERMS = ["crm.opportunities.delete", "opportunities.delete", "opportunities.manage"];

    export const softDeleteOpportunity = createServerFn({ method: "POST" })
      .inputValidator((d: unknown) => z.object({ opportunityId: z.string().uuid() }).parse(d))
      .handler(async ({ data }) => {
        const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
        const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
        const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
        const db = supabaseAdmin as any;
        const { organizationId, userId } = await getWorkspace();
        const access = await requireAnyPermission(DELETE_PERMS);
        const { data: current } = await db
          .from("opp_opportunities")
          .select("owner_agent_id, department_id")
          .eq("id", data.opportunityId)
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (!current || !canAccessOpportunityRow(access, current)) throw new Error("لا تملك صلاحية حذف هذه الفرصة");
        const { error } = await db
          .from("opp_opportunities")
          .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
          .eq("id", data.opportunityId)
          .eq("organization_id", organizationId);
        if (error) throw new Error(error.message);
        return { ok: true };
      });

    export const restoreOpportunity = createServerFn({ method: "POST" })
      .inputValidator((d: unknown) => z.object({ opportunityId: z.string().uuid() }).parse(d))
      .handler(async ({ data }) => {
        const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
        const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
        const db = supabaseAdmin as any;
        const { organizationId } = await getWorkspace();
        await requireAnyPermission(DELETE_PERMS);
        const { error } = await db
          .from("opp_opportunities")
          .update({ deleted_at: null, deleted_by: null })
          .eq("id", data.opportunityId)
          .eq("organization_id", organizationId);
        if (error) throw new Error(error.message);
        return { ok: true };
      });

    export const purgeOpportunity = createServerFn({ method: "POST" })
      .inputValidator((d: unknown) => z.object({ opportunityId: z.string().uuid() }).parse(d))
      .handler(async ({ data }) => {
        const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
        const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
        const db = supabaseAdmin as any;
        const { organizationId } = await getWorkspace();
        await requireAnyPermission(DELETE_PERMS);

        const { data: current } = await db
          .from("opp_opportunities")
          .select("id, deleted_at")
          .eq("id", data.opportunityId)
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (!current) throw new Error("الفرصة غير موجودة");
        if (!current.deleted_at) throw new Error("يمكن الحذف النهائي فقط للتذاكر الموجودة في المهملات");

        // حذف السجلات المرتبطة أولاً
        await db.from("opp_notes").delete().eq("opportunity_id", data.opportunityId);
        await db.from("opp_tags_map").delete().eq("opportunity_id", data.opportunityId);
        await db.from("crm_opportunity_sessions").delete().eq("opportunity_id", data.opportunityId);
        await db
          .from("crm_files")
          .delete()
          .eq("organization_id", organizationId)
          .eq("entity_type", "opportunity")
          .eq("entity_id", data.opportunityId);
        await db
          .from("crm_timeline")
          .delete()
          .eq("organization_id", organizationId)
          .eq("entity_type", "opportunity")
          .eq("entity_id", data.opportunityId);
        await db
          .from("crm_activities")
          .delete()
          .eq("organization_id", organizationId)
          .eq("entity_type", "opportunity")
          .eq("entity_id", data.opportunityId);

        const { error } = await db
          .from("opp_opportunities")
          .delete()
          .eq("id", data.opportunityId)
          .eq("organization_id", organizationId);
        if (error) throw new Error(error.message);
        return { ok: true };
      });

    export const listTrashedOpportunities = createServerFn({ method: "GET" })
      .handler(async () => {
        const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
        const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
        const db = supabaseAdmin as any;
        const { organizationId } = await getWorkspace();
        await requireAnyPermission(DELETE_PERMS);
        const { data: opps } = await db
          .from("opp_opportunities")
          .select("id, contact_id, source, value, currency, deleted_at, deleted_by, stage_id, owner_agent_id")
          .eq("organization_id", organizationId)
          .not("deleted_at", "is", null)
          .order("deleted_at", { ascending: false })
          .limit(200);
        const contactIds = Array.from(new Set((opps ?? []).map((o: any) => o.contact_id)));
        const userIds = Array.from(new Set((opps ?? []).map((o: any) => o.deleted_by).filter(Boolean)));
        const [{ data: cs }, { data: ps }] = await Promise.all([
          contactIds.length
            ? db.from("crm_contacts").select("id, display_name, full_name, avatar_url").in("id", contactIds)
            : Promise.resolve({ data: [] }),
          userIds.length
            ? db.from("profiles").select("id, full_name").in("id", userIds)
            : Promise.resolve({ data: [] }),
        ]);
        const cm = new Map((cs ?? []).map((c: any) => [c.id, c]));
        const pm = new Map((ps ?? []).map((p: any) => [p.id, p.full_name]));
        return (opps ?? []).map((o: any) => {
          const c: any = cm.get(o.contact_id);
          return {
            id: o.id,
            contact_name: c?.display_name ?? c?.full_name ?? "—",
            contact_avatar: c?.avatar_url ?? null,
            source: o.source,
            value: o.value,
            currency: o.currency,
            deleted_at: o.deleted_at,
            deleted_by_name: o.deleted_by ? pm.get(o.deleted_by) ?? null : null,
          };
        });
      });
