import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { shapeSessionRow } from "./chats.server";

export const listChats = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
  const { canAccessOpportunityRow, getOpportunityVisibility } = await import("@/platform/rbac/data-scope.server");
  const db = supabaseAdmin as any;
  const { organizationId } = await getWorkspace();
  const access = await requireAnyPermission(["messaging.send", "crm.opportunities.view", "opportunities.view", "opportunities.view_department", "opportunities.view_own"]);
  const { data, error } = await db
    .from("msg_sessions")
    .select("*")
    .eq("organization_id", organizationId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const sessionIds = (data ?? []).map((session: any) => session.id);
  const { data: links } = sessionIds.length
    ? await db.from("crm_opportunity_sessions").select("session_ref, opportunity_id").in("session_ref", sessionIds)
    : { data: [] };
  const oppIds = Array.from(new Set((links ?? []).map((link: any) => link.opportunity_id).filter(Boolean)));
  const { data: opps } = oppIds.length
    ? await db.from("opp_opportunities").select("id, owner_agent_id, department_id").in("id", oppIds).eq("organization_id", organizationId)
    : { data: [] };
  const oppById = new Map((opps ?? []).map((opp: any) => [opp.id, opp]));
  const oppBySession = new Map((links ?? []).map((link: any) => [link.session_ref, oppById.get(link.opportunity_id)]));
  const rows: any[] = [];
  for (const s of data ?? []) {
    const opp: any = oppBySession.get(s.id);
    if (opp && !canAccessOpportunityRow(access, opp)) continue;
    if (!opp && getOpportunityVisibility(access) !== "all") continue;
    rows.push(await shapeSessionRow(organizationId, s, db));
  }
  return rows;
});

export const getChatWithMessages = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ chatId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const [{ getWorkspace, supabaseAdmin }, { requireAnyPermission }, { canAccessOpportunityRow, getOpportunityVisibility }] =
      await Promise.all([
        import("@/platform/workspace/workspace.server"),
        import("@/platform/rbac/rbac.server"),
        import("@/platform/rbac/data-scope.server"),
      ]);
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    // Permissions, session, link and the message page are independent reads.
    const [access, sessRes, linkRes, msgsRes] = await Promise.all([
      requireAnyPermission([
        "messaging.send",
        "crm.opportunities.view",
        "opportunities.view",
        "opportunities.view_department", "opportunities.view_own",
      ]),
      db.from("msg_sessions").select("*").eq("id", data.chatId).eq("organization_id", organizationId).maybeSingle(),
      db
        .from("crm_opportunity_sessions")
        .select("opportunity_id")
        .eq("organization_id", organizationId)
        .eq("session_ref", data.chatId)
        .maybeSingle(),
      db
        .from("msg_messages")
        .select(
          "id, session_id, content, status, direction, is_internal, created_at, message_type, media_url, media_meta",
        )
        .eq("session_id", data.chatId)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(150),
    ]);
    const sess = sessRes?.data;
    const link = linkRes?.data;
    if (!sess) return null;
    if (link?.opportunity_id) {
      const { data: opp } = await db
        .from("opp_opportunities")
        .select("owner_agent_id, department_id")
        .eq("id", link.opportunity_id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!opp || !canAccessOpportunityRow(access, opp)) return null;
    } else if (getOpportunityVisibility(access) !== "all") {
      return null;
    }
    const chat = await shapeSessionRow(
      organizationId,
      sess,
      db,
    );

    const rawMessages = [
      ...(msgsRes?.data ?? []),
    ].reverse();

    const mediaPaths = Array.from(
      new Set(
        rawMessages
          .map((m: any) =>
            typeof m.media_url === "string" &&
              m.media_url.startsWith(
                "crm-files/",
              )
              ? m.media_url.slice(
                "crm-files/".length,
              )
              : null,
          )
          .filter(Boolean),
      ),
    ) as string[];

    const signedRes =
      mediaPaths.length > 0
        ? await db.storage
          .from("crm-files")
          .createSignedUrls(
            mediaPaths,
            3600,
          )
        : { data: [] };

    const signedMap =
      new Map<string, string>();

    ((signedRes as any)?.data ?? []).forEach(
      (row: any) => {
        if (
          row?.path &&
          row?.signedUrl
        ) {
          signedMap.set(
            `crm-files/${row.path}`,
            row.signedUrl,
          );
        }
      },
    );

    const messages = rawMessages.map(
      (m: any) => {
        const rawUrl:
          | string
          | null =
          m.media_url ?? null;

        return {
          id: m.id,
          chat_id: m.session_id,
          content: m.content,
          status: m.status,

          from_me:
            m.direction === "outbound",

          is_internal:
            m.is_internal === true,

          created_at: m.created_at,

          message_type:
            m.message_type ?? "text",

          media_url:
            rawUrl &&
              signedMap.has(rawUrl)
              ? signedMap.get(rawUrl)!
              : rawUrl,

          media_meta:
            m.media_meta ?? {},
        };
      },
    );

    void db
      .from("msg_sessions")
      .update({ unread_count: 0 })
      .eq("id", data.chatId)
      .eq("organization_id", organizationId)
      .then(() => undefined, () => undefined);
    return { chat, messages };
  });


async function buildQuotedFromMessageId(db: any, organizationId: string, messageId: string, peerJid: string) {
  const { data: q } = await db
    .from("msg_messages")
    .select("id, external_id, direction, content, message_type, media_meta, sent_by_user_id")
    .eq("id", messageId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!q || !q.external_id) return {
    quoted: null as any, snapshot: q ? {
      message_id: q.id, from_me: q.direction === "outbound", content: q.content,
      message_type: q.message_type, media_meta: q.media_meta, sent_by_user_id: q.sent_by_user_id,
    } : null
  };
  const fromMe = q.direction === "outbound";
  let message: Record<string, unknown> = { conversation: q.content ?? "" };
  if (q.message_type === "image") message = { imageMessage: { caption: q.content ?? "" } };
  else if (q.message_type === "video") message = { videoMessage: { caption: q.content ?? "" } };
  else if (q.message_type === "audio") message = { audioMessage: { ptt: true } };
  else if (q.message_type === "document") message = { documentMessage: { fileName: q.media_meta?.file_name ?? "file" } };
  return {
    quoted: { key: { id: q.external_id, remoteJid: peerJid, fromMe }, message },
    snapshot: {
      message_id: q.id,
      from_me: fromMe,
      content: q.content,
      message_type: q.message_type,
      media_meta: q.media_meta,
      sent_by_user_id: q.sent_by_user_id,
    },
  };
}

export const sendMessageFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      chatId: z.string().uuid(),
      text: z.string().min(1).max(4000),
      isInternal: z.boolean().optional().default(false),
      replyToMessageId: z.string().uuid().optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const [{ getWorkspace, supabaseAdmin }, { requireAnyPermission }, { canAccessOpportunityRow, getOpportunityVisibility }] =
      await Promise.all([
        import("@/platform/workspace/workspace.server"),
        import("@/platform/rbac/rbac.server"),
        import("@/platform/rbac/data-scope.server"),
      ]);
    const db = supabaseAdmin as any;
    const { userId, organizationId } = await getWorkspace();

    // Run permission resolution, the opportunity link and the session lookup
    // concurrently — they don't depend on each other.
    const [access, chatLinkRes, sessionRes] = await Promise.all([
      requireAnyPermission(data.isInternal ? ["internal_comms.write", "messaging.send"] : ["messaging.send"]),
      db
        .from("crm_opportunity_sessions")
        .select("opportunity_id")
        .eq("organization_id", organizationId)
        .eq("session_ref", data.chatId)
        .maybeSingle(),
      db
        .from("msg_sessions")
        .select("id, channel_account_id, peer_identifier, msg_channel_accounts(external_ref, status)")
        .eq("id", data.chatId)
        .eq("organization_id", organizationId)
        .maybeSingle(),
    ]);
    const chatLink = chatLinkRes?.data;
    const sess = sessionRes?.data;

    if (chatLink?.opportunity_id) {
      const { data: opp } = await db
        .from("opp_opportunities")
        .select("owner_agent_id, department_id")
        .eq("id", chatLink.opportunity_id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!opp || !canAccessOpportunityRow(access, opp)) throw new Error("لا تملك صلاحية إرسال رسالة في هذه المحادثة");
    } else if (getOpportunityVisibility(access) !== "all") {
      throw new Error("لا تملك صلاحية إرسال رسالة في هذه المحادثة");
    }

    // Resolve reply target (if any) for both internal and outbound.
    let replySnapshot: any = null;
    let quotedRef: any = null;
    if (data.replyToMessageId) {
      const q = await buildQuotedFromMessageId(db, organizationId, data.replyToMessageId, sess?.peer_identifier ?? "");
      replySnapshot = q.snapshot;
      quotedRef = q.quoted;
    }


    // Internal (team-only) notes: never call Evolution, never touch preview.
    if (data.isInternal) {
      const { data: msg } = await db
        .from("msg_messages")
        .insert({
          organization_id: organizationId,
          session_id: data.chatId,
          direction: "outbound",
          message_type: "text",
          content: data.text,
          status: "sent",
          is_internal: true,
          sent_by_user_id: userId,
          reply_to_message_id: data.replyToMessageId ?? null,
          reply_to_snapshot: replySnapshot,
        })
        .select()
        .single();
      return {
        id: msg.id,
        chat_id: data.chatId,
        content: data.text,
        status: "sent",
        is_internal: true,
        from_me: true,
        created_at: msg.created_at,
      };
    }

    if (!sess) throw new Error("محادثة غير موجودة");
    const acc = Array.isArray(sess.msg_channel_accounts)
      ? sess.msg_channel_accounts[0]
      : sess.msg_channel_accounts;
    if (!acc) throw new Error("جلسة الواتساب غير مرتبطة");

    const ops = await import("@/modules/channels/whatsapp/channel-ops.server");
    const { resolveAccountProvider } = await import("@/modules/channels/whatsapp/registry.server");
    const providerRef = await resolveAccountProvider(sess.channel_account_id);
    if (!providerRef.provider.isConfigured())
      throw new Error(`محرّك ${providerRef.provider.label} غير مُهيأ.`);

    // Risk layer: protect the number from behaviour that gets it restricted.
    const risk = await import("@/modules/risk/risk.server");
    const guard = await risk.riskGuard({
      orgId: organizationId,
      accountId: sess.channel_account_id,
      source: "manual",
      peer: sess.peer_identifier,
    });
    if (!guard.allowed) throw new Error(guard.message ?? "تم إيقاف الإرسال من هذا الرقم مؤقتاً لحمايته.");

    const number = String(sess.peer_identifier).split("@")[0];
    let externalId: string | null = null;
    let status = "sent";
    let sendError: string | null = null;
    try {
      const res = (await ops.opSendText(
        sess.channel_account_id,
        number,
        data.text,
        quotedRef ?? undefined,
      )) as Record<string, unknown>;
      externalId = ((res?.key as { id?: string } | undefined)?.id ?? null) as string | null;
      await risk.recordOutbound({ orgId: organizationId, accountId: sess.channel_account_id });
    } catch (e) {
      status = "failed";
      sendError = e instanceof Error ? e.message : "فشل الإرسال";
      await risk.recordHealthEvent({
        orgId: organizationId,
        accountId: sess.channel_account_id,
        eventType: "send_failed",
        detail: { error: sendError },
      });
    }


    const { data: msg } = await db
      .from("msg_messages")
      .insert({
        organization_id: organizationId,
        session_id: data.chatId,
        external_id: externalId,
        direction: "outbound",
        message_type: "text",
        content: data.text,
        status,
        sent_by_user_id: userId,
        reply_to_message_id: data.replyToMessageId ?? null,
        reply_to_snapshot: replySnapshot,
      })
      .select()
      .single();

    const previewUpdate = db
      .from("msg_sessions")
      .update({ last_message_preview: data.text.slice(0, 500), last_message_at: new Date().toISOString() })
      .eq("id", data.chatId);

    // Advance the linked opportunity from the FIRST stage (usually "جديد") to
    // the next one — but ONLY when the sender is a sales agent, not a
    // supervisor/admin/owner. Supervisor-initiated chats stay in "جديد" until
    // they explicitly assign the lead to an agent.
    const stageAdvance = (async () => {
      if (!chatLink?.opportunity_id) return;
      const [agentRes, supRes, adminRes, oppRes] = await Promise.all([
        db.rpc("has_role", { _user_id: userId, _role: "sales" }),
        db.rpc("has_role", { _user_id: userId, _role: "supervisor" }),
        db.rpc("has_role", { _user_id: userId, _role: "admin" }),
        db
          .from("opp_opportunities")
          .select("id, pipeline_id, stage_id")
          .eq("id", chatLink.opportunity_id)
          .eq("organization_id", organizationId)
          .maybeSingle(),
      ]);
      const senderIsAgentOnly = Boolean(agentRes?.data) && !supRes?.data && !adminRes?.data;
      const opp = oppRes?.data;
      if (!senderIsAgentOnly || !opp?.pipeline_id || !opp.stage_id) return;
      const { data: stages } = await db
        .from("crm_pipeline_stages")
        .select("id, ord")
        .eq("pipeline_id", opp.pipeline_id)
        .order("ord", { ascending: true });
      const idx = (stages ?? []).findIndex((s: any) => s.id === opp.stage_id);
      if (idx === 0 && stages && stages.length > 1) {
        await db
          .from("opp_opportunities")
          .update({
            stage_id: stages[1].id,
            stage: "contacted",
            first_response_at: new Date().toISOString(),
          })
          .eq("id", opp.id)
          .eq("organization_id", organizationId);
      }
    })().catch((e) => console.error("[sendMessageFn] stage advance failed", e));

    await Promise.all([previewUpdate, stageAdvance]);


    if (sendError) throw new Error(sendError);
    return {
      id: msg.id,
      chat_id: data.chatId,
      content: data.text,
      status,
      from_me: true,
      is_internal: false,
      created_at: msg.created_at,
    };
  });


export const createChatFromContact = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ contactId: z.string().uuid(), instanceId: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    await requireAnyPermission(["messaging.send", "contacts.manage"]);

    const { data: cp } = await db
      .from("crm_contact_points")
      .select("identifier")
      .eq("organization_id", organizationId)
      .eq("contact_id", data.contactId)
      .eq("channel_type", "whatsapp")
      .maybeSingle();
    if (!cp?.identifier) throw new Error("لا يوجد رقم واتساب لهذه الجهة");
    const remoteJid = `${cp.identifier}@s.whatsapp.net`;

    const { data: existing } = await db
      .from("msg_sessions")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("channel_account_id", data.instanceId)
      .eq("peer_identifier", remoteJid)
      .maybeSingle();
    if (existing) return { id: existing.id };

    const { data: row, error } = await db
      .from("msg_sessions")
      .insert({
        organization_id: organizationId,
        channel_account_id: data.instanceId,
        peer_identifier: remoteJid,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const saveChatContactToCrm = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        chatId: z.string().uuid(),
        name: z.string().max(120).optional().nullable(),
        funnel_stage: z
          .enum(["lead", "qualified", "customer", "returning_customer", "churned"])
          .default("lead"),
        notes: z.string().max(2000).optional().nullable(),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    await requireAnyPermission(["contacts.manage", "crm.opportunities.update"]);
    const { data: sess } = await db
      .from("msg_sessions")
      .select("peer_identifier")
      .eq("id", data.chatId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!sess) throw new Error("محادثة غير موجودة");
    const phone = String(sess.peer_identifier).split("@")[0].replace(/\D/g, "");

    // Reuse existing contact by phone if any
    const { data: cp } = await db
      .from("crm_contact_points")
      .select("contact_id")
      .eq("organization_id", organizationId)
      .eq("channel_type", "whatsapp")
      .eq("identifier", phone)
      .maybeSingle();

    let contactId = cp?.contact_id as string | undefined;
    if (contactId) {
      await db
        .from("crm_contacts")
        .update({
          display_name: data.name ?? null,
          full_name: data.name ?? null,
          lifecycle_stage: data.funnel_stage,
          notes: data.notes ?? null,
        })
        .eq("id", contactId);
    } else {
      const { data: c, error } = await db
        .from("crm_contacts")
        .insert({
          organization_id: organizationId,
          display_name: data.name ?? null,
          full_name: data.name ?? null,
          lifecycle_stage: data.funnel_stage,
          notes: data.notes ?? null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      contactId = c.id;
      await db.from("crm_contact_points").insert({
        organization_id: organizationId,
        contact_id: contactId,
        channel_type: "whatsapp",
        identifier: phone,
        is_primary: true,
        verified: true,
      });
    }

    // Ensure an open opportunity + link to this session
    const { data: linked } = await db
      .from("crm_opportunity_sessions")
      .select("opportunity_id")
      .eq("organization_id", organizationId)
      .eq("session_ref", data.chatId)
      .maybeSingle();
    if (!linked?.opportunity_id) {
      const { data: defaultPipe } = await db
        .from("crm_pipelines")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("is_default", true)
        .maybeSingle();
      const { data: defaultStage } = defaultPipe?.id
        ? await db
          .from("crm_pipeline_stages")
          .select("id, probability")
          .eq("pipeline_id", defaultPipe.id)
          .order("ord", { ascending: true })
          .limit(1)
          .maybeSingle()
        : { data: null };
      const { data: openOpp } = await db
        .from("opp_opportunities")
        .select("id, pipeline_id, stage_id")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .is("outcome", null)
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      let oppId = openOpp?.id as string | undefined;
      if (!oppId) {
        const { data: newOpp } = await db
          .from("opp_opportunities")
          .insert({
            organization_id: organizationId,
            contact_id: contactId,
            pipeline_id: defaultPipe?.id ?? null,
            stage_id: defaultStage?.id ?? null,
            probability: defaultStage?.probability ?? 10,
            stage: "new",
            source: "manual_save",
          })
          .select("id")
          .single();
        oppId = newOpp?.id;
      } else if (!openOpp.stage_id && defaultStage?.id) {
        await db
          .from("opp_opportunities")
          .update({
            pipeline_id: openOpp.pipeline_id ?? defaultPipe?.id ?? null,
            stage_id: defaultStage.id,
            probability: defaultStage.probability ?? 10,
          })
          .eq("id", openOpp.id)
          .eq("organization_id", organizationId);
      }
      if (oppId) {
        await db
          .from("crm_opportunity_sessions")
          .insert({
            organization_id: organizationId,
            opportunity_id: oppId,
            session_ref: data.chatId,
            channel: "whatsapp",
          });
      }
    }

    return { id: contactId };
  });

export const updateChatContact = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        contactId: z.string().uuid(),
        name: z.string().max(120).optional().nullable(),
        funnel_stage: z
          .enum(["lead", "qualified", "customer", "returning_customer", "churned"])
          .optional(),
        notes: z.string().max(2000).optional().nullable(),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    await requireAnyPermission(["contacts.manage", "crm.opportunities.update"]);
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) {
      patch.display_name = data.name;
      patch.full_name = data.name;
    }
    if (data.funnel_stage !== undefined) patch.lifecycle_stage = data.funnel_stage;
    if (data.notes !== undefined) patch.notes = data.notes;
    const { error } = await db
      .from("crm_contacts")
      .update(patch)
      .eq("id", data.contactId)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { id: data.contactId };
  });

/**
 * Merged chat for an opportunity:
 *   - collects every msg_session for the contact (any of our WhatsApp numbers),
 *   - unions all messages ordered by time,
 *   - annotates each outbound message with the sending agent (name/avatar)
 *     and the account/number it came from.
 * The `primary_session_id` is the newest session and is used for sending replies.
 */
export const getMergedChatForOpportunity = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ opportunityId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission([
      "crm.opportunities.view",
      "opportunities.view",
      "opportunities.view_department", "opportunities.view_own",
      "messaging.send",
    ]);

    const { data: opp } = await db
      .from("opp_opportunities")
      .select("id, contact_id, owner_agent_id, department_id")
      .eq("id", data.opportunityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!opp) return null;
    if (!canAccessOpportunityRow(access, opp)) return null;

    // 1) contact identifiers + explicitly linked sessions (independent → parallel)
    const [{ data: cps }, { data: links }] = await Promise.all([
      db
        .from("crm_contact_points")
        .select("identifier, channel_type")
        .eq("organization_id", organizationId)
        .eq("contact_id", opp.contact_id),
      db
        .from("crm_opportunity_sessions")
        .select("session_ref")
        .eq("organization_id", organizationId)
        .eq("opportunity_id", data.opportunityId),
    ]);
    const phones: string[] = Array.from(
      new Set((cps ?? []).map((c: any) => String(c.identifier ?? "").replace(/\D/g, "")).filter(Boolean)),
    ) as string[];
    const jids: string[] = phones.flatMap((p) => [`${p}@s.whatsapp.net`, p, `${p}@c.us`]);
    const linkedIds: string[] = (links ?? []).map((l: any) => l.session_ref).filter(Boolean);

    // 2) sessions matching those JIDs org-wide + linked ones, in one round trip
    const sessionCols = "id, channel_account_id, peer_identifier, last_message_at";
    const [byJid, byId] = await Promise.all([
      jids.length
        ? db.from("msg_sessions").select(sessionCols).eq("organization_id", organizationId).in("peer_identifier", jids)
        : Promise.resolve({ data: [] }),
      linkedIds.length
        ? db.from("msg_sessions").select(sessionCols).eq("organization_id", organizationId).in("id", linkedIds)
        : Promise.resolve({ data: [] }),
    ]);
    const sessionMap = new Map<string, any>();
    [...(byJid.data ?? []), ...(byId.data ?? [])].forEach((s: any) => sessionMap.set(s.id, s));
    const sessions: any[] = Array.from(sessionMap.values());

    if (sessions.length === 0) {
      return { primary_session_id: null, sessions: [], messages: [] };
    }

    const sessionIds = sessions.map((s) => s.id);
    const accIds = Array.from(new Set(sessions.map((s) => s.channel_account_id).filter(Boolean)));

    // 3) accounts, phone labels and the message page all at once
    const [{ data: accs }, { data: plugins }, { data: msgsDesc }] = await Promise.all([
      accIds.length
        ? db.from("msg_channel_accounts").select("id, display_name").in("id", accIds)
        : Promise.resolve({ data: [] }),
      accIds.length
        ? db
          .from("plugin_whatsapp_evolution_instances")
          .select("channel_account_id, phone_number")
          .in("channel_account_id", accIds)
        : Promise.resolve({ data: [] }),
      db
        .from("msg_messages")
        .select(
          "id, session_id, direction, content, status, is_internal, sent_by_user_id, created_at, message_type, media_url, media_meta, reply_to_message_id, reply_to_snapshot, edited_at, reactions, forwarded_from_message_id",
        )
        .in("session_id", sessionIds)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    const msgs = [...(msgsDesc ?? [])].reverse();
    const accMap = new Map((accs ?? []).map((a: any) => [a.id, a]));
    const phoneMap = new Map((plugins ?? []).map((p: any) => [p.channel_account_id, p.phone_number]));
    const accountLabel = (accId: string | null | undefined, acc: any) => {
      const phone = accId ? phoneMap.get(accId) : null;
      return acc?.display_name ?? (phone ? `+${phone}` : null);
    };
    const sessAccMap = new Map(sessions.map((s) => [s.id, s.channel_account_id]));

    const senderIds = Array.from(
      new Set(msgs.map((m: any) => m.sent_by_user_id).filter(Boolean)),
    ) as string[];
    const mediaPaths = Array.from(
      new Set(
        msgs
          .map((m: any) =>
            typeof m.media_url === "string" && m.media_url.startsWith("crm-files/")
              ? m.media_url.slice("crm-files/".length)
              : null,
          )
          .filter(Boolean),
      ),
    ) as string[];

    // 4) sender profiles + signed media URLs together; unread reset is fire-and-forget
    const [{ data: profs }, signedRes] = await Promise.all([
      senderIds.length
        ? db.from("profiles").select("id, full_name, avatar_url").in("id", senderIds)
        : Promise.resolve({ data: [] }),
      mediaPaths.length
        ? db.storage.from("crm-files").createSignedUrls(mediaPaths, 3600)
        : Promise.resolve({ data: [] }),
    ]);
    const profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
    const signedMap = new Map<string, string>();
    ((signedRes as any)?.data ?? []).forEach((s: any) => {
      if (s?.path && s?.signedUrl) signedMap.set(`crm-files/${s.path}`, s.signedUrl);
    });

    const primary = [...sessions].sort(
      (a, b) => new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime(),
    )[0];

    void db
      .from("msg_sessions")
      .update({ unread_count: 0 })
      .in("id", sessionIds)
      .eq("organization_id", organizationId)
      .then(() => undefined, () => undefined);


    return {
      primary_session_id: primary?.id ?? null,
      sessions: sessions.map((s) => {
        const acc: any = accMap.get(s.channel_account_id);
        return {
          id: s.id,
          account_id: s.channel_account_id,
          account_name: accountLabel(s.channel_account_id, acc),
        };
      }),
      messages: (msgs ?? []).map((m: any) => {
        const accId = sessAccMap.get(m.session_id);
        const acc: any = accId ? accMap.get(accId) : null;
        const prof: any = m.sent_by_user_id ? profMap.get(m.sent_by_user_id) : null;
        const rawUrl: string | null = m.media_url ?? null;
        const displayUrl = rawUrl && signedMap.has(rawUrl) ? signedMap.get(rawUrl)! : rawUrl;
        return {
          id: m.id,
          session_id: m.session_id,
          content: m.content,
          from_me: m.direction === "outbound",
          is_internal: m.is_internal === true,
          status: m.status,
          created_at: m.created_at,
          message_type: m.message_type ?? "text",
          media_url: displayUrl,
          media_meta: m.media_meta ?? {},
          agent: prof ? { id: prof.id, name: prof.full_name, avatar_url: prof.avatar_url } : null,
          account_name: accountLabel(accId as string | null | undefined, acc),
          reply_to_message_id: m.reply_to_message_id ?? null,
          reply_to_snapshot: m.reply_to_snapshot ?? null,
          edited_at: m.edited_at ?? null,
          reactions: Array.isArray(m.reactions) ? m.reactions : [],
          forwarded: Boolean(m.forwarded_from_message_id),
        };
      }),
    };
  });

/**
 * Send an image / video / document / voice-note through Evolution + record it
 * in msg_messages. Client sends base64 payload; we store it in the private
 * crm-files bucket for our own playback and forward the base64 to Evolution.
 */
export const sendMediaMessageFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        chatId: z.string().uuid(),
        kind: z.enum(["image", "video", "audio", "document"]),
        fileName: z.string().min(1).max(200),
        mimeType: z.string().min(1).max(200),
        base64: z.string().min(1), // raw base64 (no data: prefix)
        caption: z.string().max(2000).optional(),
        replyToMessageId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow, getOpportunityVisibility } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { userId, organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["messaging.send"]);

    const { data: chatLink } = await db
      .from("crm_opportunity_sessions")
      .select("opportunity_id")
      .eq("organization_id", organizationId)
      .eq("session_ref", data.chatId)
      .maybeSingle();
    if (chatLink?.opportunity_id) {
      const { data: opp } = await db
        .from("opp_opportunities")
        .select("owner_agent_id, department_id")
        .eq("id", chatLink.opportunity_id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!opp || !canAccessOpportunityRow(access, opp)) throw new Error("لا تملك صلاحية إرسال في هذه المحادثة");
    } else if (getOpportunityVisibility(access) !== "all") {
      throw new Error("لا تملك صلاحية إرسال في هذه المحادثة");
    }

    const { data: sess } = await db
      .from("msg_sessions")
      .select("id, channel_account_id, peer_identifier")
      .eq("id", data.chatId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!sess) throw new Error("المحادثة غير موجودة");
    const { data: acc } = await db
      .from("msg_channel_accounts")
      .select("external_ref, status")
      .eq("id", sess.channel_account_id)
      .maybeSingle();
    if (!acc) throw new Error("جلسة الواتساب غير مرتبطة");

    // Upload to private storage for our own playback.
    const buffer = Buffer.from(data.base64, "base64");
    const safeName = data.fileName.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
    const storagePath = `chat-media/${organizationId}/${data.chatId}/${Date.now()}-${safeName}`;
    const { error: upErr } = await db.storage
      .from("crm-files")
      .upload(storagePath, buffer, { contentType: data.mimeType, upsert: false });
    if (upErr) throw new Error(`تعذّر رفع الملف: ${upErr.message}`);
    const storedUrl = `crm-files/${storagePath}`;

    // Signed URL for Evolution to fetch (avoids base64 in JSON → 413 Payload Too Large).
    const { data: signed } = await db.storage
      .from("crm-files")
      .createSignedUrl(storagePath, 60 * 60 * 24); // 24h
    const mediaUrlForEvo = signed?.signedUrl ?? null;

    const ops = await import("@/modules/channels/whatsapp/channel-ops.server");
    const { resolveAccountProvider } = await import("@/modules/channels/whatsapp/registry.server");
    const providerRef = await resolveAccountProvider(sess.channel_account_id);
    if (!providerRef.provider.isConfigured())
      throw new Error(`محرّك ${providerRef.provider.label} غير مُهيأ.`);
    const number = String(sess.peer_identifier).split("@")[0];

    // Resolve reply (quoted) for real WhatsApp reply.
    let replySnapshot: any = null;
    let quotedRef: any = null;
    if (data.replyToMessageId) {
      const q = await buildQuotedFromMessageId(db, organizationId, data.replyToMessageId, sess.peer_identifier);
      replySnapshot = q.snapshot;
      quotedRef = q.quoted;
    }

    let status = "sent";
    let externalId: string | null = null;
    let sendError: string | null = null;

    const RAW_BASE64_LIMIT = 9 * 1024 * 1024;
    const preferBase64 = buffer.length <= RAW_BASE64_LIMIT;

    async function trySend(useBase64: boolean) {
      if (data.kind === "audio") {
        const audioArg = useBase64 ? data.base64 : (mediaUrlForEvo ?? data.base64);
        const res: any = await ops.opSendAudioNote(
          sess.channel_account_id,
          number,
          audioArg,
          quotedRef ?? undefined,
        );
        return res?.key?.id ?? null;
      }
      const mediaArg = useBase64 ? data.base64 : mediaUrlForEvo;
      if (!mediaArg) throw new Error("تعذّر تحضير الملف للإرسال");
      const res: any = await ops.opSendMedia(sess.channel_account_id, number, {
        mediatype: data.kind,
        media: mediaArg,
        mimetype: data.mimeType,
        fileName: data.fileName,
        caption: data.caption,
        quoted: quotedRef ?? undefined,
      });
      return res?.key?.id ?? null;
    }

    const risk = await import("@/modules/risk/risk.server");
    const guard = await risk.riskGuard({
      orgId: organizationId,
      accountId: sess.channel_account_id,
      source: "manual",
      peer: sess.peer_identifier,
    });
    if (!guard.allowed) throw new Error(guard.message ?? "تم إيقاف الإرسال من هذا الرقم مؤقتاً لحمايته.");

    try {
      try {
        externalId = await trySend(preferBase64);
      } catch (firstErr) {
        // Fallback: swap strategy (URL ↔ base64) once.
        console.warn("[sendMedia] first attempt failed, retrying", firstErr);
        externalId = await trySend(!preferBase64);
      }
      await risk.recordOutbound({ orgId: organizationId, accountId: sess.channel_account_id });
    } catch (e) {
      status = "failed";
      sendError = e instanceof Error ? e.message : "فشل الإرسال";
      await risk.recordHealthEvent({
        orgId: organizationId,
        accountId: sess.channel_account_id,
        eventType: "send_failed",
        detail: { error: sendError },
      });
    }


    const preview =
      data.caption?.trim() ||
      (data.kind === "image"
        ? "📷 صورة"
        : data.kind === "video"
          ? "🎬 فيديو"
          : data.kind === "audio"
            ? "🎙️ رسالة صوتية"
            : `📎 ${data.fileName}`);

    const { data: msg } = await db
      .from("msg_messages")
      .insert({
        organization_id: organizationId,
        session_id: data.chatId,
        external_id: externalId,
        direction: "outbound",
        message_type: data.kind,
        content: data.caption ?? null,
        media_url: storedUrl,
        media_meta: { file_name: data.fileName, mime_type: data.mimeType, size: buffer.length },
        status,
        sent_by_user_id: userId,
        reply_to_message_id: data.replyToMessageId ?? null,
        reply_to_snapshot: replySnapshot,
      })
      .select()
      .single();

    await db
      .from("msg_sessions")
      .update({ last_message_preview: preview.slice(0, 500), last_message_at: new Date().toISOString() })
      .eq("id", data.chatId);

    if (sendError) throw new Error(sendError);
    return { id: msg?.id, status };
  });

/**
 * Delete a message for everyone (both sides) on WhatsApp, and mark it deleted
 * locally so the UI shows "الرسالة محذوفة" like WhatsApp Web.
 */
export const deleteMessageFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ messageId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow, getOpportunityVisibility } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["messaging.send"]);

    const { data: msg } = await db
      .from("msg_messages")
      .select("id, session_id, direction, external_id, status")
      .eq("id", data.messageId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!msg) throw new Error("الرسالة غير موجودة");
    if (msg.status === "deleted") return { ok: true };

    // Authorize via linked opportunity.
    const { data: link } = await db
      .from("crm_opportunity_sessions")
      .select("opportunity_id")
      .eq("organization_id", organizationId)
      .eq("session_ref", msg.session_id)
      .maybeSingle();
    if (link?.opportunity_id) {
      const { data: opp } = await db
        .from("opp_opportunities")
        .select("owner_agent_id, department_id")
        .eq("id", link.opportunity_id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!opp || !canAccessOpportunityRow(access, opp)) throw new Error("لا تملك صلاحية الحذف");
    } else if (getOpportunityVisibility(access) !== "all") {
      throw new Error("لا تملك صلاحية الحذف");
    }

    const { data: sess } = await db
      .from("msg_sessions")
      .select("channel_account_id, peer_identifier")
      .eq("id", msg.session_id)
      .maybeSingle();
    const { data: acc } = sess?.channel_account_id
      ? await db.from("msg_channel_accounts").select("external_ref").eq("id", sess.channel_account_id).maybeSingle()
      : { data: null };

    // Only outbound messages can be revoked on WhatsApp; inbound → delete locally only.
    if (msg.direction === "outbound" && msg.external_id && acc?.external_ref && sess?.peer_identifier) {
      try {
        const { opDeleteMessage } = await import("@/modules/channels/whatsapp/channel-ops.server");
        await opDeleteMessage(sess.channel_account_id, {
          id: msg.external_id,
          remoteJid: sess.peer_identifier,
          fromMe: true,
        });
      } catch (e) {
        console.warn("[deleteMessage] provider delete failed", e);
        // Continue and mark locally deleted anyway.
      }
    }

    await db
      .from("msg_messages")
      .update({ status: "deleted", content: null, media_url: null, media_meta: {}, message_type: "text" })
      .eq("id", data.messageId)
      .eq("organization_id", organizationId);

    return { ok: true };
  });

// Edit an already-sent outbound text message (mirrors WhatsApp's 15-minute edit window).
export const editMessageFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ messageId: z.string().uuid(), text: z.string().min(1).max(4096) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const { canAccessOpportunityRow, getOpportunityVisibility } = await import("@/platform/rbac/data-scope.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    const access = await requireAnyPermission(["messaging.send"]);

    const { data: msg } = await db
      .from("msg_messages")
      .select("id, session_id, direction, external_id, status, message_type, is_internal, created_at")
      .eq("id", data.messageId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!msg) throw new Error("الرسالة غير موجودة");
    if (msg.status === "deleted") throw new Error("لا يمكن تعديل رسالة محذوفة");
    if (msg.direction !== "outbound") throw new Error("يمكن تعديل الرسائل الصادرة فقط");
    if ((msg.message_type ?? "text") !== "text") throw new Error("يمكن تعديل الرسائل النصية فقط");

    // Authorize via the linked opportunity, same rule as deletion.
    const { data: link } = await db
      .from("crm_opportunity_sessions")
      .select("opportunity_id")
      .eq("organization_id", organizationId)
      .eq("session_ref", msg.session_id)
      .maybeSingle();
    if (link?.opportunity_id) {
      const { data: opp } = await db
        .from("opp_opportunities")
        .select("owner_agent_id, department_id")
        .eq("id", link.opportunity_id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!opp || !canAccessOpportunityRow(access, opp)) throw new Error("لا تملك صلاحية التعديل");
    } else if (getOpportunityVisibility(access) !== "all") {
      throw new Error("لا تملك صلاحية التعديل");
    }

    if (!msg.is_internal) {
      const ageMs = Date.now() - new Date(msg.created_at).getTime();
      if (ageMs > 15 * 60 * 1000) throw new Error("انتهت مهلة التعديل (15 دقيقة)");

      const { data: sess } = await db
        .from("msg_sessions")
        .select("channel_account_id, peer_identifier")
        .eq("id", msg.session_id)
        .maybeSingle();
      const { data: acc } = sess?.channel_account_id
        ? await db.from("msg_channel_accounts").select("external_ref").eq("id", sess.channel_account_id).maybeSingle()
        : { data: null };

      if (msg.external_id && acc?.external_ref && sess?.peer_identifier) {
        const { opEditMessage } = await import("@/modules/channels/whatsapp/channel-ops.server");
        await opEditMessage(sess.channel_account_id, {
          number: String(sess.peer_identifier).split("@")[0],
          text: data.text,
          key: { id: msg.external_id, remoteJid: sess.peer_identifier, fromMe: true },
        });
      }
    }

    const { error } = await db
      .from("msg_messages")
      .update({ content: data.text, edited_at: new Date().toISOString() })
      .eq("id", data.messageId)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

/* ============================ Reactions ============================ */

// Add / replace / remove (emoji = "") the current user's emoji reaction on a message.
export const reactToMessageFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ messageId: z.string().uuid(), emoji: z.string().max(16) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const db = supabaseAdmin as any;
    const { organizationId, userId } = await getWorkspace();
    await requireAnyPermission(["messaging.send"]);

    const { data: msg } = await db
      .from("msg_messages")
      .select("id, session_id, direction, external_id, status, reactions, is_internal")
      .eq("id", data.messageId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!msg) throw new Error("الرسالة غير موجودة");
    if (msg.status === "deleted") throw new Error("لا يمكن التفاعل مع رسالة محذوفة");

    const { data: prof } = await db.from("profiles").select("full_name").eq("id", userId).maybeSingle();

    const current: any[] = Array.isArray(msg.reactions) ? msg.reactions : [];
    const others = current.filter((r: any) => r?.user_id !== userId);
    const next = data.emoji
      ? [...others, { user_id: userId, name: prof?.full_name ?? null, emoji: data.emoji, at: new Date().toISOString() }]
      : others;

    // Mirror the reaction on WhatsApp when possible.
    if (!msg.is_internal && msg.external_id) {
      try {
        const { data: sess } = await db
          .from("msg_sessions")
          .select("channel_account_id, peer_identifier")
          .eq("id", msg.session_id)
          .maybeSingle();
        const { data: acc } = sess?.channel_account_id
          ? await db.from("msg_channel_accounts").select("external_ref").eq("id", sess.channel_account_id).maybeSingle()
          : { data: null };
        if (acc?.external_ref && sess?.peer_identifier) {
          const { opSendReaction } = await import("@/modules/channels/whatsapp/channel-ops.server");
          await opSendReaction(
            sess.channel_account_id,
            { id: msg.external_id, remoteJid: sess.peer_identifier, fromMe: msg.direction === "outbound" },
            data.emoji,
          );
        }
      } catch (e) {
        console.warn("[reactToMessage] provider reaction failed", e);
      }
    }

    const { error } = await db
      .from("msg_messages")
      .update({ reactions: next })
      .eq("id", data.messageId)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);

    return { ok: true, reactions: next };
  });

/* ============================ Forwarding ============================ */

// Suggestions for the forward dialog: latest chats + saved CRM contacts.
export const listForwardTargets = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const db = supabaseAdmin as any;
  const { organizationId } = await getWorkspace();

  const [sessRes, contactsRes] = await Promise.all([
    db
      .from("msg_sessions")
      .select("id, peer_identifier, push_name, profile_pic_url, last_message_at, last_message_preview")
      .eq("organization_id", organizationId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(30),
    db
      .from("crm_contacts")
      .select("id, display_name, full_name, avatar_url, crm_contact_points(identifier, channel_type)")
      .eq("organization_id", organizationId)
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .limit(100),
  ]);

  const chats: Array<{ kind: "session"; id: string; name: string; phone: string; avatar_url: string | null; last_message_at: string | null }> =
    (sessRes?.data ?? []).map((s: any) => ({
      kind: "session" as const,
      id: s.id,
      name: s.push_name || `+${String(s.peer_identifier ?? "").split("@")[0]}`,
      phone: String(s.peer_identifier ?? "").split("@")[0],
      avatar_url: s.profile_pic_url ?? null,
      last_message_at: s.last_message_at,
    }));
  const chatPhones = new Set(chats.map((c) => c.phone));

  const contacts = (contactsRes?.data ?? [])
    .map((c: any) => {
      const points = Array.isArray(c.crm_contact_points) ? c.crm_contact_points : [];
      const wa = points.find((p: any) => p.channel_type === "whatsapp");
      if (!wa?.identifier) return null;
      return {
        kind: "contact" as const,
        id: c.id,
        name: c.display_name || c.full_name || `+${wa.identifier}`,
        phone: String(wa.identifier),
        avatar_url: c.avatar_url ?? null,
      };
    })
    .filter(Boolean)
    .filter((c: any) => !chatPhones.has(c.phone));

  return { chats, contacts };
});

// Forward one message to one or more chats / phone numbers.
export const forwardMessageFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        messageId: z.string().uuid(),
        targets: z
          .array(z.object({ kind: z.enum(["session", "phone"]), value: z.string().min(1) }))
          .min(1)
          .max(20),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const db = supabaseAdmin as any;
    const { organizationId, userId } = await getWorkspace();
    await requireAnyPermission(["messaging.send"]);

    const { data: msg } = await db
      .from("msg_messages")
      .select("id, session_id, content, message_type, media_url, media_meta, status")
      .eq("id", data.messageId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!msg) throw new Error("الرسالة غير موجودة");
    if (msg.status === "deleted") throw new Error("لا يمكن إعادة توجيه رسالة محذوفة");

    const { data: srcSess } = await db
      .from("msg_sessions")
      .select("channel_account_id")
      .eq("id", msg.session_id)
      .maybeSingle();

    // Media is stored privately; sign it so Evolution can fetch it by URL.
    let mediaUrl: string | null = null;
    if (msg.media_url && String(msg.media_url).startsWith("crm-files/")) {
      const path = String(msg.media_url).slice("crm-files/".length);
      const { data: signed } = await db.storage.from("crm-files").createSignedUrl(path, 3600);
      mediaUrl = signed?.signedUrl ?? null;
    } else {
      mediaUrl = msg.media_url ?? null;
    }

    const ops = await import("@/modules/channels/whatsapp/channel-ops.server");
    const risk = await import("@/modules/risk/risk.server");

    const kind = msg.message_type ?? "text";
    let sent = 0;
    const failures: string[] = [];

    for (const t of data.targets) {
      try {
        let sessionId: string | null = null;
        let accountId: string | null = null;
        let peerJid: string | null = null;
        let isNewConversation = false;

        if (t.kind === "session") {
          const { data: s } = await db
            .from("msg_sessions")
            .select("id, channel_account_id, peer_identifier")
            .eq("id", t.value)
            .eq("organization_id", organizationId)
            .maybeSingle();
          if (!s) throw new Error("المحادثة غير موجودة");
          sessionId = s.id;
          accountId = s.channel_account_id;
          peerJid = s.peer_identifier;
        } else {
          const phone = t.value.replace(/[^\d]/g, "");
          if (!phone) throw new Error("رقم غير صالح");
          peerJid = `${phone}@s.whatsapp.net`;
          accountId = srcSess?.channel_account_id ?? null;
          if (!accountId) throw new Error("لا توجد جلسة إرسال");
          const { data: existing } = await db
            .from("msg_sessions")
            .select("id")
            .eq("organization_id", organizationId)
            .eq("channel_account_id", accountId)
            .eq("peer_identifier", peerJid)
            .maybeSingle();
          if (existing?.id) sessionId = existing.id;
          else {
            isNewConversation = true;
            const { data: created } = await db
              .from("msg_sessions")
              .insert({
                organization_id: organizationId,
                channel_account_id: accountId,
                external_thread_id: peerJid,
                peer_identifier: peerJid,
                unread_count: 0,
              })
              .select()
              .single();
            sessionId = created?.id ?? null;
          }
        }
        if (!sessionId || !accountId || !peerJid) throw new Error("تعذر تحديد الوجهة");

        const { data: acc } = await db
          .from("msg_channel_accounts")
          .select("external_ref")
          .eq("id", accountId)
          .maybeSingle();
        if (!acc?.external_ref) throw new Error("جلسة الواتساب غير مرتبطة");

        const number = String(peerJid).split("@")[0];
        let externalId: string | null = null;

        // إعادة التوجيه تمر بحارس المخاطر مثل بقية مسارات الإرسال،
        // وتُعتبر تواصلاً بارداً عندما تكون المحادثة جديدة.
        const guard = await risk.riskGuard({
          orgId: organizationId,
          accountId,
          source: "manual",
          isNewConversation,
        });
        if (!guard.allowed) throw new Error(guard.reason ?? "تم إيقاف الإرسال لحماية الرقم");

        if (kind === "text" || !mediaUrl) {
          const res = (await ops.opSendText(accountId, number, msg.content ?? "")) as Record<string, unknown>;
          externalId = ((res?.key as { id?: string } | undefined)?.id ?? null) as string | null;
        } else if (kind === "audio") {
          const res = (await ops.opSendAudioNote(accountId, number, mediaUrl)) as Record<string, unknown>;
          externalId = ((res?.key as { id?: string } | undefined)?.id ?? null) as string | null;
        } else {
          const res = (await ops.opSendMedia(accountId, number, {
            mediatype: kind === "image" ? "image" : kind === "video" ? "video" : "document",
            media: mediaUrl,
            mimetype: (msg.media_meta as any)?.mime_type,
            fileName: (msg.media_meta as any)?.file_name,
            caption: msg.content ?? undefined,
          })) as Record<string, unknown>;
          externalId = ((res?.key as { id?: string } | undefined)?.id ?? null) as string | null;
        }

        await risk.recordOutbound({ orgId: organizationId, accountId });



        await db.from("msg_messages").insert({
          organization_id: organizationId,
          session_id: sessionId,
          external_id: externalId,
          direction: "outbound",
          message_type: kind,
          content: msg.content,
          media_url: msg.media_url,
          media_meta: msg.media_meta ?? {},
          status: "sent",
          sent_by_user_id: userId,
          forwarded_from_message_id: msg.id,
        });

        const preview =
          (msg.content && String(msg.content).slice(0, 500)) ||
          (kind === "image" ? "📷 صورة" : kind === "video" ? "🎬 فيديو" : kind === "audio" ? "🎙️ رسالة صوتية" : "📎 ملف");
        await db
          .from("msg_sessions")
          .update({ last_message_preview: preview, last_message_at: new Date().toISOString() })
          .eq("id", sessionId);

        sent += 1;
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "فشل الإرسال");
      }
    }

    return { sent, failed: failures.length, errors: failures };
  });
