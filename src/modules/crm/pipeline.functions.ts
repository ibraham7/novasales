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

// Reads in chunks of 100 ids; the chunks are independent, so they run together.
async function readByIds(db: any, table: string, select: string, ids: string[], organizationId?: string, column = "id") {
  const unique = [...new Set(ids.filter(Boolean))];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 100) chunks.push(unique.slice(i, i + 100));
  const pages = await Promise.all(
    chunks.map((chunk) => {
      let query = db.from(table).select(select).in(column, chunk);
      if (organizationId) query = query.eq("organization_id", organizationId);
      return checkedRows(query);
    }),
  );
  return pages.flat();
}

export const getPipelinePageMeta = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin, getWorkspace } = await import("@/platform/workspace/workspace.server");
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const db = supabaseAdmin as any;
  const { listPipelines } = await import("./pipelines.functions");
  const { organizationId } = await getWorkspace();
  // The permission check runs alongside the reads; nothing is returned unless it passes.
  const { getOpportunityVisibility } = await import("@/platform/rbac/data-scope.server");
  const [access, pipelines, departments, memberships] = await Promise.all([
    requireAnyPermission(["crm.opportunities.view", "opportunities.view", "opportunities.view_department", "opportunities.view_own"]),
    listPipelines(),
    checkedRows(db.from("org_departments").select("id,name").eq("organization_id", organizationId).eq("is_active", true).order("name")),
    checkedRows(db.from("org_memberships").select("user_id").eq("organization_id", organizationId).eq("is_active", true)),
  ]);
  // What the board may filter by follows what the user can see: a member who sees only their own
  // opportunities gets no agent or department filter, a department supervisor only their departments.
  // The member list itself stays whole: chat transfer and assignment use it.
  const visibility = getOpportunityVisibility(access);
  const [profiles, departmentMembers] = await Promise.all([
    readByIds(db, "profiles", "id,full_name,avatar_url", memberships.map(m => m.user_id)),
    visibility === "department" && access.departmentIds.length
      ? checkedRows(db.from("org_department_members").select("user_id").eq("organization_id", organizationId).eq("is_active", true).in("department_id", access.departmentIds))
      : Promise.resolve([] as any[]),
  ]);
  const filterDepartmentIds = visibility === "all" ? null : visibility === "department" ? access.departmentIds : [];
  const filterMemberIds =
    visibility === "all" ? null : visibility === "department" ? Array.from(new Set([access.userId, ...departmentMembers.map((m: any) => m.user_id)])) : [];
  // The currency a new ticket's value is in (the platform default); a failure here must not break the board.
  const defaultCurrency: string = await import("@/modules/superadmin/settings.functions")
    .then((m: any) => m.getPublicPlatformSettings())
    .then((settings: any) => settings?.default_currency || "USD")
    .catch(() => "USD");
  return {
    defaultCurrency,
    pipelines,
    departments,
    members: profiles.map(p => ({ ...p, user_id: p.id, profile_name: p.full_name })),
    visibility,
    filterDepartmentIds,
    filterMemberIds,
  };
});

export const listOpportunitiesBoard = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({
      departmentId: z.string().uuid().optional(),
      ownerAgentId: z.string().uuid().optional(),
      /** يجلب كل التذاكر (وليس أحدث 500) — يُستخدم أثناء البحث */
      all: z.boolean().optional(),
      /** يجلب أحدث N تذكرة فقط من كل مرحلة (الباقي بـ«عرض المزيد») */
      perStage: z.number().int().min(1).max(200).optional(),
      /** حدّ خاص بمراحل طلب المستخدم عرض المزيد منها */
      limits: z.record(z.number().int().min(1).max(500)).optional(),
      /** ترتيب التذاكر داخل كل مرحلة (الافتراضي: الأحدث أولاً) */
      sort: z.enum(["newest", "oldest", "value_desc", "value_asc", "manual"]).optional(),
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

    const build = (sort: string | undefined = data.sort) => {
      let q = db.from("opp_opportunities").select("*")
        .eq("organization_id", organizationId).is("deleted_at", null);
      // Tickets without a value always go last, whichever way the values are sorted.
      if (sort === "oldest") q = q.order("opened_at", { ascending: true });
      else if (sort === "value_desc") q = q.order("value", { ascending: false, nullsFirst: false }).order("opened_at", { ascending: false });
      else if (sort === "value_asc") q = q.order("value", { ascending: true, nullsFirst: false }).order("opened_at", { ascending: false });
      // The hand-made order; tickets never ordered by hand come after, newest first.
      else if (sort === "manual") q = q.order("board_pos", { ascending: true, nullsFirst: false }).order("opened_at", { ascending: false });
      else q = q.order("opened_at", { ascending: false });
      q = q.order("id");
      if (ownerAgentId) q = q.eq("owner_agent_id", ownerAgentId);
      if (departmentIds) q = q.in("department_id", departmentIds);
      return q;
    };
    const loadRows = async (sort: string | undefined) => {
      const out: any[] = [];
      if (data.perStage && !data.all) {
        // Only the newest few of each stage: a stage with hundreds of tickets no longer loads them all.
        const stageRows = await checkedRows(
          db.from("crm_pipeline_stages").select("id, crm_pipelines!inner(organization_id)").eq("crm_pipelines.organization_id", organizationId).limit(200),
        );
        const pages = await Promise.all(
          stageRows.map((st: any) => checkedRows(build(sort).eq("stage_id", st.id).limit(data.limits?.[st.id] ?? data.perStage!))),
        );
        for (const page of pages) out.push(...page);
      } else {
        const query = build(sort);
        const limit = data.all ? 3000 : 500;
        for (let offset = 0; offset < limit; offset += 500) {
          const page = await checkedRows(query.range(offset, Math.min(offset + 499, limit - 1)));
          out.push(...page);
          if (page.length < 500) break;
        }
      }
      return out;
    };
    let rows: any[];
    try {
      rows = await loadRows(data.sort);
    } catch (e) {
      // The hand-made order needs the board_pos column; until its SQL is run the board falls back to newest first.
      if (data.sort === "manual" && /board_pos/i.test((e as Error).message)) rows = await loadRows("newest");
      else throw e;
    }
    if (!rows.length) return [];
    // Contacts, owners and chat links depend only on the opportunities: one parallel round.
    const [contacts, owners, links] = await Promise.all([
      readByIds(db, "crm_contacts", "id,full_name,display_name,avatar_url", rows.map(o => o.contact_id), organizationId),
      readByIds(db, "profiles", "id,full_name,avatar_url", rows.map(o => o.owner_agent_id)),
      readByIds(db, "crm_opportunity_sessions", "opportunity_id,session_ref,channel", rows.map(o => o.id), organizationId, "opportunity_id"),
    ]);
    // Sessions carry their WhatsApp number (same organization through the session) in the same read.
    const sessionRows = await readByIds(db, "msg_sessions", "id,channel_account_id,peer_identifier,unread_count,last_message_at,last_message_preview,msg_channel_accounts(id,display_name,identifier)", links.map(l => l.session_ref), organizationId);
    const sessions = sessionRows.map(({ msg_channel_accounts: _account, ...session }) => session);
    const accounts = sessionRows
      .map((s) => (Array.isArray(s.msg_channel_accounts) ? s.msg_channel_accounts[0] : s.msg_channel_accounts))
      .filter(Boolean);
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
    // Labels are decoration: if their tables are not there yet the board still loads.
    const labelsByOpp = new Map<string, any[]>();
    try {
      const links = await readByIds(db, "opp_label_links", "opportunity_id,label_id", rows.map(o => o.id), organizationId, "opportunity_id");
      const defs = new Map((await readByIds(db, "opp_labels", "id,name,color", links.map(l => l.label_id), organizationId)).map(l => [l.id, l]));
      for (const link of links) {
        const def = defs.get(link.label_id);
        if (def) labelsByOpp.set(link.opportunity_id, [...(labelsByOpp.get(link.opportunity_id) ?? []), def]);
      }
    } catch {
      /* labels not installed yet */
    }
    // While searching, the notes are sent too so the search can find what was written in them.
    const notesByOpp = new Map<string, string>();
    if (data.all) {
      try {
        const notes = await readByIds(db, "opp_notes", "opportunity_id,body,created_at", rows.map(o => o.id), organizationId, "opportunity_id");
        notes.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
        for (const n of notes) notesByOpp.set(n.opportunity_id, `${notesByOpp.get(n.opportunity_id) ?? ""} ${n.body ?? ""}`.slice(0, 3000));
      } catch {
        /* notes not installed yet */
      }
    }
    return rows.map(o => {
      const contact = contactsById.get(o.contact_id);
      const owner = ownersById.get(o.owner_agent_id);
      const linked = linkedByOpportunity.get(o.id) ?? [];
      linked.sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
      const latest = linked[0];
      const account = accountsById.get(latest?.channel_account_id);
      return {
        ...o, labels: labelsByOpp.get(o.id) ?? [], notes_text: notesByOpp.get(o.id) ?? "", contact_name: contact?.display_name || contact?.full_name || o.title,
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



/** How many tickets each stage holds (for the badge and «عرض المزيد»), within what the viewer may see. */
export const getBoardStageCounts = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ departmentId: z.string().uuid().optional(), ownerAgentId: z.string().uuid().optional() }).parse(d ?? {})
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
      if (data.departmentId && !access.departmentIds.includes(data.departmentId)) return { counts: {} as Record<string, number>, sums: {} as Record<string, Record<string, number>> };
      departmentIds = data.departmentId ? [data.departmentId] : access.departmentIds;
      if (departmentIds.length === 0) return { counts: {} as Record<string, number>, sums: {} as Record<string, Record<string, number>> };
    }
    const counts: Record<string, number> = {};
    // The money in each stage, per currency, over ALL its tickets (the board only loads the newest few).
    const sums: Record<string, Record<string, number>> = {};
    for (let offset = 0; ; offset += 1000) {
      let q = db.from("opp_opportunities").select("stage_id,value,currency").eq("organization_id", organizationId).is("deleted_at", null).order("id");
      if (ownerAgentId) q = q.eq("owner_agent_id", ownerAgentId);
      if (departmentIds) q = q.in("department_id", departmentIds);
      const page = await checkedRows(q.range(offset, offset + 999));
      for (const r of page) {
        if (!r.stage_id) continue;
        counts[r.stage_id] = (counts[r.stage_id] ?? 0) + 1;
        const amount = Number(r.value ?? 0);
        if (Number.isFinite(amount) && amount > 0) {
          const currency = (r.currency as string | null) || "USD";
          const stage = (sums[r.stage_id] ??= {});
          stage[currency] = (stage[currency] ?? 0) + amount;
        }
      }
      if (page.length < 1000) break;
    }
    return { counts, sums };
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

/**
 * Adds a ticket straight into a chosen stage — for the case where the agent contacted the customer
 * first. Reuses the contact when the WhatsApp number is already known, so no duplicate is made.
 */
export const createOpportunityInStage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      stageId: z.string().uuid(),
      name: z.string().trim().min(1, "اكتب اسم العميل").max(120),
      /** Optional: a ticket can be opened before the customer's number is known. */
      phone: z.string().trim().max(30).optional().refine((v) => !v || v.replace(/\D/g, "").length >= 5, "اكتب رقم هاتف صحيحاً أو اتركه فارغاً"),
      title: z.string().trim().max(200).optional(),
      value: z.number().finite().min(0).max(1e12).optional(),
      /** ISO code such as USD or TRY; left out, the platform's default currency. */
      currency: z.string().regex(/^[A-Z]{3}$/, "اختر عملة صحيحة").optional(),
      notes: z.string().trim().max(5000).optional(),
      labelIds: z.array(z.string().uuid()).max(12).optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { normalizePhone } = await import("./contacts.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    // The sales-agent role can update opportunities but not "create" them, and adding a ticket to the board is part of their work.
    const access = await requireAnyPermission(["crm.opportunities.create", "crm.opportunities.update", "opportunities.manage"]);

    const { data: stage } = await db
      .from("crm_pipeline_stages")
      .select("id, pipeline_id, probability, is_won, is_lost, crm_pipelines!inner(organization_id)")
      .eq("id", data.stageId)
      .eq("crm_pipelines.organization_id", organizationId)
      .maybeSingle();
    if (!stage) throw new Error("المرحلة غير موجودة");

    const phone = data.phone ? normalizePhone(data.phone) : null;
    let contactId: string | null = null;
    const { data: point } = phone
      ? await db
          .from("crm_contact_points")
          .select("contact_id")
          .eq("organization_id", organizationId)
          .eq("channel_type", "whatsapp")
          .eq("identifier", phone)
          .maybeSingle()
      : { data: null };
    if (point?.contact_id) {
      contactId = point.contact_id;
    } else {
      const { data: created, error } = await db
        .from("crm_contacts")
        .insert({
          organization_id: organizationId,
          display_name: data.name,
          full_name: data.name,
          custom_fields: { created_by: access.userId },
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      contactId = created.id;
      const { error: pointError } = !phone ? { error: null } : await db.from("crm_contact_points").insert({
        organization_id: organizationId,
        contact_id: contactId,
        channel_type: "whatsapp",
        identifier: phone,
        is_primary: true,
        verified: false,
      });
      if (pointError) {
        await db.from("crm_contacts").delete().eq("id", contactId);
        throw new Error(pointError.message);
      }
    }

    const { getPublicPlatformSettings } = await import("@/modules/superadmin/settings.functions");
    const platform = await getPublicPlatformSettings();
    const terminal = stage.is_won || stage.is_lost;
    const { data: opp, error } = await db
      .from("opp_opportunities")
      .insert({
        organization_id: organizationId,
        contact_id: contactId,
        department_id: access.departmentIds?.[0] ?? null,
        owner_agent_id: access.userId,
        pipeline_id: stage.pipeline_id,
        stage_id: stage.id,
        stage: stage.is_won ? "won" : stage.is_lost ? "lost" : "new",
        outcome: stage.is_won ? "won" : stage.is_lost ? "lost" : null,
        closed_at: terminal ? new Date().toISOString() : null,
        title: data.title || data.name,
        source: "outbound_manual",
        value: data.value ?? 0,
        currency: data.currency ?? platform.default_currency,
        probability: stage.probability,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    // The notes and labels belong to the ticket. If either cannot be saved, the ticket is removed again,
    // so a retry does not leave a half-made duplicate behind.
    try {
      if (data.notes) {
        const { error: noteError } = await db.from("opp_notes").insert({ organization_id: organizationId, opportunity_id: opp.id, author_id: access.userId, body: data.notes });
        if (noteError) throw new Error(noteError.message);
      }
      if (data.labelIds?.length) {
        const wanted = [...new Set(data.labelIds)];
        const valid = await checkedRows(db.from("opp_labels").select("id").eq("organization_id", organizationId).in("id", wanted));
        if (valid.length) {
          const { error: linkError } = await db.from("opp_label_links").insert(valid.map((l: any) => ({ opportunity_id: opp.id, label_id: l.id, organization_id: organizationId })));
          if (linkError) throw new Error(linkError.message);
        }
      }
    } catch (e) {
      await db.from("opp_opportunities").delete().eq("id", opp.id).eq("organization_id", organizationId);
      throw e;
    }
    await db.from("domain_events").insert({
      organization_id: organizationId,
      event_type: "crm.opportunity.created",
      aggregate_type: "opportunity",
      aggregate_id: opp.id,
      payload: { stage_id: stage.id, source: "outbound_manual" },
    });
    return { id: opp.id as string };
  });

const LABEL_COLOR = /^#[0-9a-fA-F]{6}$/;

/** The organization's ticket labels. Empty (not an error) until the labels migration has been run. */
export const listOppLabels = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin, getWorkspace } = await import("@/platform/workspace/workspace.server");
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const db = supabaseAdmin as any;
  const { organizationId } = await getWorkspace();
  await requireAnyPermission(["crm.opportunities.view", "opportunities.view", "opportunities.view_department", "opportunities.view_own"]);
  const { data, error } = await db.from("opp_labels").select("id,name,color").eq("organization_id", organizationId).order("created_at", { ascending: true });
  if (error) return [] as { id: string; name: string; color: string }[];
  return (data ?? []) as { id: string; name: string; color: string }[];
});

export const createOppLabel = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ name: z.string().trim().min(1, "اكتب اسم الليبل").max(40), color: z.string().regex(LABEL_COLOR) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, getWorkspace } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.opportunities.create", "crm.opportunities.update", "opportunities.manage", "org.manage"]);
    const { data: row, error } = await db.from("opp_labels").insert({ organization_id: organizationId, name: data.name, color: data.color, created_by: access.userId }).select("id,name,color").single();
    if (error) throw new Error(error.code === "23505" ? "يوجد ليبل بهذا الاسم" : ["PGRST205", "42P01"].includes(error.code) ? "شغّل ملف SQL الخاص بالليبلز في Supabase أولاً" : error.message);
    return row as { id: string; name: string; color: string };
  });

/** What the quick-edit window shows for a ticket: the customer's name and number, and the labels on it. */
export const getTicketQuickEdit = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ opportunityId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, getWorkspace } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.opportunities.view", "opportunities.view", "opportunities.view_department", "opportunities.view_own"]);
    const { data: opp } = await db.from("opp_opportunities").select("id,contact_id,owner_agent_id,department_id,value,currency").eq("id", data.opportunityId).eq("organization_id", organizationId).is("deleted_at", null).maybeSingle();
    if (!opp || !canAccessOpportunityRow(access, opp)) throw new Error("التذكرة غير موجودة أو غير مسموحة");
    const [{ data: contact }, { data: points }, links] = await Promise.all([
      db.from("crm_contacts").select("display_name,full_name").eq("id", opp.contact_id).eq("organization_id", organizationId).maybeSingle(),
      db.from("crm_contact_points").select("identifier,is_primary").eq("organization_id", organizationId).eq("contact_id", opp.contact_id).eq("channel_type", "whatsapp"),
      db.from("opp_label_links").select("label_id").eq("organization_id", organizationId).eq("opportunity_id", opp.id),
    ]);
    const point = (points ?? []).find((p: any) => p.is_primary) ?? (points ?? [])[0];
    return {
      name: (contact?.display_name || contact?.full_name || "") as string,
      phone: (point?.identifier ?? "") as string,
      // Labels are optional decoration: without their table the list is simply empty.
      labelIds: (links.error ? [] : (links.data ?? []).map((l: any) => l.label_id)) as string[],
      value: Number(opp.value ?? 0),
      currency: (opp.currency as string | null) || "USD",
    };
  });

/** Saves the quick-edit window: the customer's name and number, the ticket's labels, and an optional new note. */
export const saveTicketQuickEdit = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      opportunityId: z.string().uuid(),
      name: z.string().trim().min(1, "اكتب اسم العميل").max(120),
      /** Left empty, the customer's current number stays as it is. */
      phone: z.string().trim().max(30).optional().refine((v) => !v || v.replace(/\D/g, "").length >= 5, "اكتب رقم هاتف صحيحاً أو اتركه فارغاً"),
      labelIds: z.array(z.string().uuid()).max(12).default([]),
      /** The ticket's value in its own currency; left out, it stays as it is. */
      value: z.number().finite().min(0).max(1e12).optional(),
      currency: z.string().regex(/^[A-Z]{3}$/, "اختر عملة صحيحة").optional(),
      note: z.string().trim().max(5000).optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, getWorkspace } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const { normalizePhone } = await import("./contacts.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.opportunities.update", "opportunities.manage", "org.manage"]);
    const { data: opp } = await db.from("opp_opportunities").select("id,contact_id,owner_agent_id,department_id").eq("id", data.opportunityId).eq("organization_id", organizationId).is("deleted_at", null).maybeSingle();
    if (!opp || !canAccessOpportunityRow(access, opp)) throw new Error("التذكرة غير موجودة أو غير مسموحة");

    // The number first: refuse before anything changes if it belongs to another customer.
    const phone = data.phone ? normalizePhone(data.phone) : null;
    let pointToUpdate: { id: string } | null = null;
    let insertPoint = false;
    if (phone) {
      const { data: mine } = await db.from("crm_contact_points").select("id,is_primary,identifier").eq("organization_id", organizationId).eq("contact_id", opp.contact_id).eq("channel_type", "whatsapp");
      // Tickets that came in from WhatsApp keep the identifier WhatsApp gave (it can carry a suffix or be an internal id).
      // Saving the same digits back must not rewrite it.
      const unchanged = (mine ?? []).some((p: any) => normalizePhone(String(p.identifier ?? "")) === phone);
      if (!unchanged) {
        const { data: owner } = await db.from("crm_contact_points").select("id,contact_id").eq("organization_id", organizationId).eq("channel_type", "whatsapp").eq("identifier", phone).maybeSingle();
        if (owner && owner.contact_id !== opp.contact_id) throw new Error("هذا الرقم مسجّل لعميل آخر");
        if (!owner) {
          const current = (mine ?? []).find((p: any) => p.is_primary) ?? (mine ?? [])[0];
          if (current) pointToUpdate = { id: current.id };
          else insertPoint = true;
        }
      }
    }

    const { error: nameError } = await db.from("crm_contacts").update({ display_name: data.name, full_name: data.name }).eq("id", opp.contact_id).eq("organization_id", organizationId);
    if (nameError) throw new Error(nameError.message);
    if (pointToUpdate) {
      const { error } = await db.from("crm_contact_points").update({ identifier: phone }).eq("id", pointToUpdate.id).eq("organization_id", organizationId);
      if (error) throw new Error(error.message);
    } else if (insertPoint) {
      const { error } = await db.from("crm_contact_points").insert({ organization_id: organizationId, contact_id: opp.contact_id, channel_type: "whatsapp", identifier: phone, is_primary: true, verified: false });
      if (error) throw new Error(error.message);
    }

    // Labels: exactly the chosen set (only this organization's labels count).
    const wanted = [...new Set(data.labelIds)];
    const valid = wanted.length ? await checkedRows(db.from("opp_labels").select("id").eq("organization_id", organizationId).in("id", wanted)) : [];
    const keep = new Set(valid.map((l: any) => l.id as string));
    const existing = await checkedRows(db.from("opp_label_links").select("label_id").eq("organization_id", organizationId).eq("opportunity_id", opp.id));
    const have = new Set(existing.map((l: any) => l.label_id as string));
    const remove = [...have].filter((id) => !keep.has(id));
    const add = [...keep].filter((id) => !have.has(id));
    if (remove.length) {
      const { error } = await db.from("opp_label_links").delete().eq("organization_id", organizationId).eq("opportunity_id", opp.id).in("label_id", remove);
      if (error) throw new Error(error.message);
    }
    if (add.length) {
      const { error } = await db.from("opp_label_links").insert(add.map((id) => ({ opportunity_id: opp.id, label_id: id, organization_id: organizationId })));
      if (error) throw new Error(error.message);
    }

    if (data.value !== undefined || data.currency !== undefined) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (data.value !== undefined) patch.value = data.value;
      if (data.currency !== undefined) patch.currency = data.currency;
      const { error } = await db.from("opp_opportunities").update(patch).eq("id", opp.id).eq("organization_id", organizationId);
      if (error) throw new Error(error.message);
    }
    if (data.note) {
      const { error } = await db.from("opp_notes").insert({ organization_id: organizationId, opportunity_id: opp.id, author_id: access.userId, body: data.note });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/**
 * Saves the hand-made order of one column. `orderedIds` is the column as the agent now sees it, top to
 * bottom; tickets of the stage that were not on screen follow in their old order. The whole column is
 * written in one statement (opp_set_board_order), so a big column costs one round trip.
 */
export const reorderBoardColumn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ stageId: z.string().uuid(), orderedIds: z.array(z.string().uuid()).min(1).max(1000) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, getWorkspace } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.opportunities.update", "opportunities.manage", "org.manage"]);
    const { data: stage } = await db
      .from("crm_pipeline_stages")
      .select("id, crm_pipelines!inner(organization_id)")
      .eq("id", data.stageId)
      .eq("crm_pipelines.organization_id", organizationId)
      .maybeSingle();
    if (!stage) throw new Error("المرحلة غير موجودة");
    // Only tickets of this stage that the user may touch are placed by hand.
    const wanted = [...new Set(data.orderedIds)];
    const rows = await readByIds(db, "opp_opportunities", "id,owner_agent_id,department_id,stage_id,deleted_at", wanted, organizationId);
    const allowed = new Set(rows.filter((r: any) => !r.deleted_at && r.stage_id === data.stageId && canAccessOpportunityRow(access, r)).map((r: any) => r.id as string));
    const ordered = wanted.filter((id) => allowed.has(id));
    if (!ordered.length) return { ok: true, placed: 0 };
    const rest = await checkedRows(
      db.from("opp_opportunities").select("id").eq("organization_id", organizationId).eq("stage_id", data.stageId).is("deleted_at", null)
        .order("board_pos", { ascending: true, nullsFirst: false }).order("opened_at", { ascending: false }).order("id").limit(5000),
    ).catch((e: Error) => {
      throw new Error(/board_pos/i.test(e.message) ? "شغّل ملف SQL الخاص بترتيب التذاكر في Supabase أولاً" : e.message);
    });
    const placed = new Set(ordered);
    const column = [...ordered, ...rest.map((r: any) => r.id as string).filter((id: string) => !placed.has(id))];
    const { error } = await db.rpc("opp_set_board_order", { _org: organizationId, _stage: data.stageId, _ids: column });
    if (error) throw new Error(["PGRST202", "42883", "42703"].includes(error.code) ? "شغّل ملف SQL الخاص بترتيب التذاكر في Supabase أولاً" : error.message);
    return { ok: true, placed: ordered.length };
  });

const FOLLOWUP_SQL_HINT = "شغّل ملف SQL الخاص بعدّاد المتابعة في Supabase أولاً";

async function followupContext(opportunityId: string) {
  const { supabaseAdmin, getWorkspace } = await import("@/platform/workspace/workspace.server");
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
  const db = supabaseAdmin as any;
  const { organizationId } = await getWorkspace();
  const access = await requireAnyPermission(["crm.opportunities.update", "opportunities.manage", "org.manage"]);
  const { data: opp } = await db.from("opp_opportunities").select("id,owner_agent_id,department_id").eq("id", opportunityId).eq("organization_id", organizationId).is("deleted_at", null).maybeSingle();
  if (!opp || !canAccessOpportunityRow(access, opp)) throw new Error("التذكرة غير موجودة أو غير مسموحة");
  return { db, organizationId, userId: access.userId as string };
}

/** One more follow-up on a ticket (the counter button on its board card). Returns the ticket's new total. */
export const addTicketFollowup = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ opportunityId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { db, organizationId, userId } = await followupContext(data.opportunityId);
    const { data: count, error } = await db.rpc("opp_add_followup", { _org: organizationId, _opp: data.opportunityId, _user: userId });
    if (error) throw new Error(["PGRST202", "42883", "42703", "42P01"].includes(error.code) ? FOLLOWUP_SQL_HINT : error.message);
    return { count: Number(count) };
  });

/** Takes back the caller's latest follow-up on the ticket (a press by mistake). */
export const undoTicketFollowup = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ opportunityId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { db, organizationId, userId } = await followupContext(data.opportunityId);
    const { data: count, error } = await db.rpc("opp_undo_followup", { _org: organizationId, _opp: data.opportunityId, _user: userId });
    if (error) throw new Error(["PGRST202", "42883", "42703", "42P01"].includes(error.code) ? FOLLOWUP_SQL_HINT : error.message);
    return { count: Number(count) };
  });
