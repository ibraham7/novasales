import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// List opportunities awaiting supervisor assignment (owner_agent_id IS NULL)
export const listUnassigned = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ departmentId: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { applyOpportunityScope } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.leads.assign", "opportunities.assign"]);
    let q = db
      .from("opp_opportunities")
      .select("*")
      .eq("organization_id", organizationId)
      .is("owner_agent_id", null)
      .is("outcome", null)
      .order("opened_at", { ascending: false })
      .limit(200);
    q = applyOpportunityScope(q, access, { departmentId: data.departmentId });
    if (!q) return [];
    const { data: opps, error } = await q;
    if (error) throw new Error(error.message);
    const oppIds = (opps ?? []).map((o: any) => o.id);
    const contactIds = Array.from(new Set((opps ?? []).map((o: any) => o.contact_id)));
    // last session linked per opp
    const [{ data: links }, { data: contacts }] = await Promise.all([
      oppIds.length
        ? db.from("crm_opportunity_sessions").select("opportunity_id, session_ref").in("opportunity_id", oppIds)
        : Promise.resolve({ data: [] }),
      contactIds.length
        ? db.from("crm_contacts").select("id, display_name, full_name").in("id", contactIds)
        : Promise.resolve({ data: [] }),
    ]);
    const sessionIds = Array.from(new Set((links ?? []).map((l: any) => l.session_ref)));
    const { data: sessions } = sessionIds.length
      ? await db
          .from("msg_sessions")
          .select("id, peer_identifier, last_message_preview, last_message_at, channel_account_id")
          .in("id", sessionIds)
      : { data: [] };
    const sMap = new Map((sessions ?? []).map((s: any) => [s.id, s]));
    const lMap = new Map((links ?? []).map((l: any) => [l.opportunity_id, l.session_ref]));
    const cMap = new Map((contacts ?? []).map((c: any) => [c.id, c]));
    return (opps ?? []).map((o: any) => {
      const sid = lMap.get(o.id);
      const s: any = sid ? sMap.get(sid) : null;
      const c: any = cMap.get(o.contact_id);
      return {
        id: o.id,
        contact_id: o.contact_id,
        contact_name: c?.display_name ?? c?.full_name ?? null,
        department_id: o.department_id,
        opened_at: o.opened_at,
        source: o.source,
        session_id: sid ?? null,
        peer: s?.peer_identifier ?? null,
        last_message: s?.last_message_preview ?? null,
        last_message_at: s?.last_message_at ?? null,
        channel_account_id: s?.channel_account_id ?? null,
      };
    });
  });

export const getWelcomeTemplate = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const db = supabaseAdmin as any;
  const { organizationId } = await getWorkspace();
  await requireAnyPermission(["crm.leads.assign", "opportunities.assign", "messaging.send"]);
  const { data } = await db
    .from("plugin_settings")
    .select("value")
    .eq("plugin_id", "crm")
    .eq("organization_id", organizationId)
    .eq("key", "welcome_template")
    .maybeSingle();
  return {
    text: (data?.value as { text?: string } | null)?.text ??
      "مرحباً {{contact_name}} 👋\nمعك {{rep_name}} من فريق المبيعات وسأتابع طلبك.",
  };
});

export const saveWelcomeTemplate = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ text: z.string().min(1).max(2000) }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    await requireAnyPermission(["crm.leads.assign", "opportunities.assign"]);
    await db
      .from("plugin_settings")
      .upsert(
        {
          plugin_id: "crm",
          organization_id: organizationId,
          key: "welcome_template",
          value: { text: data.text },
        },
        { onConflict: "plugin_id,organization_id,key" }
      );
    return { ok: true };
  });

// Assign an opportunity to a rep + send welcome message from rep's channel account
export const assignOpportunity = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      opportunityId: z.string().uuid(),
      memberId: z.string().uuid(),
      sendingAccountId: z.string().uuid(),
      welcomeText: z.string().min(1).max(2000),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId, userId: actorId } = await getWorkspace();
    const access = await requireAnyPermission(["crm.leads.assign", "opportunities.assign"]);

    const { data: member, error: memErr } = await db
      .from("org_department_members")
      .select("id, user_id, display_name, department_id")
      .eq("id", data.memberId)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .maybeSingle();
    if (memErr || !member) throw new Error("المندوب غير موجود");

    const { data: opp, error: oppErr } = await db
      .from("opp_opportunities")
      .select("id, contact_id, department_id, lead_id")
      .eq("id", data.opportunityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (oppErr || !opp) throw new Error("الفرصة غير موجودة");
    if (!canAccessOpportunityRow(access, { owner_agent_id: null, department_id: opp.department_id })) {
      throw new Error("لا تملك صلاحية توزيع هذه الفرصة");
    }
    if (opp.department_id && member.department_id !== opp.department_id) {
      throw new Error("يجب اختيار مندوب من نفس قسم الفرصة");
    }

    // رقم الإرسال يجب أن يكون مستقراً — لا عملاء جدد لرقم تحت المراقبة/مقيّد/موقوف.
    const { assertAccountEligibleForNewLead } = await import("@/modules/risk/eligibility.server");
    await assertAccountEligibleForNewLead(organizationId, data.sendingAccountId);


    // Lead is the source of truth for ownership. Update it → trigger syncs opp.
    if (opp.lead_id) {
      await db
        .from("crm_leads")
        .update({ owner_user_id: member.user_id })
        .eq("id", opp.lead_id);
      await db.from("crm_lead_assignments").insert({
        organization_id: organizationId,
        lead_id: opp.lead_id,
        opportunity_id: opp.id,
        from_user_id: null,
        to_user_id: member.user_id,
        action: "assign",
        strategy: "manual",
        department_id: opp.department_id ?? member.department_id,
        assigned_by: actorId,
      });
    }

    // Contact for template rendering
    const { data: contact } = await db
      .from("crm_contacts")
      .select("display_name, full_name")
      .eq("id", opp.contact_id)
      .maybeSingle();
    const contactName = contact?.display_name ?? contact?.full_name ?? "عزيزي";
    const repName = member.display_name ?? "المندوب";
    const rendered = data.welcomeText
      .replaceAll("{{contact_name}}", contactName)
      .replaceAll("{{rep_name}}", repName);

    // Update opportunity metadata (owner is synced automatically by trigger from lead)
    const { error: updErr } = await db
      .from("opp_opportunities")
      .update({
        owner_agent_id: member.user_id,
        stage: "contacted",
        department_id: opp.department_id ?? member.department_id,
        first_response_at: new Date().toISOString(),
      })
      .eq("id", opp.id);
    if (updErr) throw new Error(updErr.message);

    // Assignment audit row
    await db.from("asg_assignments").insert({
      organization_id: organizationId,
      opportunity_id: opp.id,
      department_id: opp.department_id ?? member.department_id,
      offered_by: actorId,
      offered_to: member.user_id,
      status: "accepted",
      responded_at: new Date().toISOString(),
    });

    // Delegate WhatsApp send + session/message recording to messaging helper.
    const { sendWelcomeMessage } = await import("@/modules/messaging/welcome-send.server");
    await sendWelcomeMessage({
      organizationId,
      opportunityId: opp.id,
      contactId: opp.contact_id,
      sendingAccountId: data.sendingAccountId,
      renderedText: rendered,
    });

    // Domain event
    await db.from("domain_events").insert({
      organization_id: organizationId,
      event_type: "crm.opportunity.assigned",
      aggregate_type: "opportunity",
      aggregate_id: opp.id,
      payload: { rep_user_id: member.user_id, member_id: member.id, welcome_sent: true },
    });

    return { ok: true };
  });
