/**
 * منطق النظام لأحداث القنوات — مشترك بين كل المحرّكات.
 * يستقبل أحداثاً موحّدة (NormalizedEvent) فقط: لا يعرف Evolution ولا WAHA.
 */
import type { NormalizedEvent, NormalizedMessage } from "./provider";
import { getProvider } from "./registry.server";

type Db = any;

type AccountCtx = {
  accountId: string;
  orgId: string;
  ownerUserId: string | null;
  externalRef: string;
  providerId: string;
};

export async function handleProviderWebhook(providerId: string, payload: unknown) {
  const provider = getProvider(providerId);
  const { accountRef, events } = provider.normalizeWebhook(payload);
  if (!accountRef || !events.length) return;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as Db;
  const { data: acc } = await db
    .from("msg_channel_accounts")
    .select("id, organization_id, owner_user_id, external_ref")
    .eq("external_ref", accountRef)
    .maybeSingle();
  if (!acc) {
    console.log("[WA_WEBHOOK] no channel account for ref", accountRef);
    return;
  }
  const ctx: AccountCtx = {
    accountId: acc.id,
    orgId: acc.organization_id,
    ownerUserId: acc.owner_user_id ?? null,
    externalRef: accountRef,
    providerId,
  };
  await db
    .from("msg_channel_accounts")
    .update({ last_webhook_at: new Date().toISOString() })
    .eq("id", ctx.accountId);

  for (const event of events) {
    try {
      await handleOne(db, ctx, event);
    } catch (e) {
      console.error("[WA_WEBHOOK] handler error", event.kind, e);
    }
  }
}

async function handleOne(db: Db, ctx: AccountCtx, event: NormalizedEvent) {
  switch (event.kind) {
    case "connection.state":
      return onConnectionState(db, ctx, event);
    case "qr.updated":
      return onQr(db, ctx, event.base64);
    case "message.reaction":
      return onReaction(db, ctx, event);
    case "message.in":
    case "message.out":
      return onMessage(db, ctx, event.message);
    case "message.status":
      return onStatus(db, ctx, event);
    case "chat.read":
      return onChatRead(db, event.peer);
  }
}

async function onConnectionState(
  db: Db,
  ctx: AccountCtx,
  event: Extract<NormalizedEvent, { kind: "connection.state" }>,
) {
  const status = event.state === "unknown" ? (event.rawState ?? "unknown") : event.state;
  const { data: prevAcc } = await db
    .from("msg_channel_accounts")
    .select("status")
    .eq("id", ctx.accountId)
    .maybeSingle();
  const patch: Record<string, unknown> = { status };
  if (status === "connected") patch.last_connected_at = new Date().toISOString();
  await db.from("msg_channel_accounts").update(patch).eq("id", ctx.accountId);
  if (status === "connected") {
    await db
      .from("plugin_whatsapp_evolution_instances")
      .update({ qr_code: null })
      .eq("channel_account_id", ctx.accountId);
  }

  const risk = await import("@/modules/risk/risk.server");
  // طبقة المخاطر: تكرار الفصل/الوصل مؤشر مبكر على رقم حساس.
  if (prevAcc?.status !== status && (status === "disconnected" || status === "connected")) {
    await risk.recordHealthEvent({
      orgId: ctx.orgId,
      accountId: ctx.accountId,
      eventType: status === "disconnected" ? "disconnected" : "reconnected",
      detail: {
        state: event.rawState ?? null,
        previous: prevAcc?.status ?? null,
        provider: ctx.providerId,
      },
    });
  }
  // اكتشاف تلقائي للتقييد من أحداث المزوّد.
  const reason = risk.detectRestrictionReason({
    state: event.rawState,
    statusReason: event.statusReason,
    raw: event.raw,
  });
  if (reason) {
    await risk.openRestriction({
      orgId: ctx.orgId,
      accountId: ctx.accountId,
      source: "automatic",
      reason,
    });
  } else if (status === "connected") {
    await risk.closeRestriction(ctx.accountId);
    if (prevAcc?.status && prevAcc.status !== "connected") {
      await db
        .from("msg_channel_accounts")
        .update({ last_relinked_at: new Date().toISOString() })
        .eq("id", ctx.accountId);
    }
  }
}

async function onQr(db: Db, ctx: AccountCtx, base64: string) {
  await db
    .from("plugin_whatsapp_evolution_instances")
    .update({ qr_code: base64 })
    .eq("channel_account_id", ctx.accountId);
  await db.from("msg_channel_accounts").update({ status: "connecting" }).eq("id", ctx.accountId);
}

async function onReaction(
  db: Db,
  ctx: AccountCtx,
  event: Extract<NormalizedEvent, { kind: "message.reaction" }>,
) {
  const { data: target } = await db
    .from("msg_messages")
    .select("id, reactions")
    .eq("organization_id", ctx.orgId)
    .eq("external_id", event.targetExternalId)
    .maybeSingle();
  if (!target) return;
  const current: any[] = Array.isArray(target.reactions) ? target.reactions : [];
  const peerKey = `peer:${event.peer}`;
  const others = current.filter((r: any) => r?.user_id !== peerKey);
  const next = event.emoji
    ? [
        ...others,
        {
          user_id: peerKey,
          name: event.actorName ?? "العميل",
          emoji: event.emoji,
          at: new Date().toISOString(),
        },
      ]
    : others;
  await db.from("msg_messages").update({ reactions: next }).eq("id", target.id);
}

async function onMessage(db: Db, ctx: AccountCtx, msg: NormalizedMessage) {
  const { orgId, accountId } = ctx;
  const { fromMe, externalId, peer, identifier: phone, pushName, profilePicUrl: payloadPic } = msg;

  // 1) العميل + نقطة التواصل
  const { data: cp } = await db
    .from("crm_contact_points")
    .select("contact_id")
    .eq("organization_id", orgId)
    .eq("channel_type", "whatsapp")
    .eq("identifier", phone)
    .maybeSingle();
  if (!cp?.contact_id) {
    const safeName = !fromMe && pushName ? pushName : null;
    const safeAvatar = !fromMe ? (payloadPic ?? null) : null;
    const { data: c } = await db
      .from("crm_contacts")
      .insert({
        organization_id: orgId,
        display_name: safeName,
        full_name: safeName,
        avatar_url: safeAvatar,
        lifecycle_stage: "lead",
        last_activity_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (c) {
      await db.from("crm_contact_points").insert({
        organization_id: orgId,
        contact_id: c.id,
        channel_type: "whatsapp",
        identifier: phone,
        is_primary: true,
        verified: true,
      });
      if (!safeAvatar) {
        const { opGetProfilePicture } = await import("./channel-ops.server");
        const url = await opGetProfilePicture(accountId, phone);
        if (url) await db.from("crm_contacts").update({ avatar_url: url }).eq("id", c.id);
      }
    }
  } else if (!fromMe) {
    const patch: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
    if (payloadPic) patch.avatar_url = payloadPic;
    await db.from("crm_contacts").update(patch).eq("id", cp.contact_id);
  }

  // 2) الجلسة
  const previewText =
    msg.text.trim() ||
    (msg.mediaKind === "image"
      ? "📷 صورة"
      : msg.mediaKind === "video"
        ? "🎬 فيديو"
        : msg.mediaKind === "audio"
          ? "🎙️ رسالة صوتية"
          : msg.mediaKind === "document"
            ? `📎 ${msg.mediaFileName ?? "ملف"}`
            : "");

  const { data: existingSess } = await db
    .from("msg_sessions")
    .select("id, unread_count")
    .eq("organization_id", orgId)
    .eq("channel_account_id", accountId)
    .eq("peer_identifier", peer)
    .maybeSingle();

  let sessionId: string;
  if (existingSess?.id) {
    sessionId = existingSess.id;
    const patch: Record<string, unknown> = {
      last_message_preview: previewText.slice(0, 500),
      last_message_at: new Date().toISOString(),
    };
    if (!fromMe && pushName) patch.push_name = pushName;
    if (!fromMe && payloadPic) patch.profile_pic_url = payloadPic;
    if (!fromMe) patch.unread_count = (existingSess.unread_count ?? 0) + 1;
    await db.from("msg_sessions").update(patch).eq("id", sessionId);
  } else {
    const { data: s, error: sErr } = await db
      .from("msg_sessions")
      .insert({
        organization_id: orgId,
        channel_account_id: accountId,
        external_thread_id: peer,
        peer_identifier: peer,
        push_name: !fromMe && pushName ? pushName : null,
        profile_pic_url: !fromMe ? (payloadPic ?? null) : null,
        last_message_preview: previewText.slice(0, 500),
        last_message_at: new Date().toISOString(),
        unread_count: fromMe ? 0 : 1,
      })
      .select()
      .single();
    if (sErr) console.error("[WA_WEBHOOK] session insert err", sErr);
    if (!s) return;
    sessionId = s.id;
  }

  // 3) الوسائط → تنزيل من المزوّد ورفع للتخزين
  let mediaStoredUrl: string | null = null;
  const mediaMeta: Record<string, unknown> = {};
  if (msg.mediaKind && externalId) {
    try {
      const { opDownloadMedia } = await import("./channel-ops.server");
      // بعض المزوّدين (واتساب الرسمي) يعطون معرّف وسائط مستقلاً عن معرّف الرسالة.
      const dl = await opDownloadMedia(accountId, {
        id: msg.mediaId ?? externalId,
        remoteJid: peer,
        fromMe,
      });
      if (dl?.base64) {
        const buf = Buffer.from(dl.base64, "base64");
        const mime = dl.mimetype ?? msg.mediaMime ?? "application/octet-stream";
        const safeName =
          (msg.mediaFileName ?? `file-${externalId}`).replace(/[^\w.\-]+/g, "_").slice(0, 120) ||
          "file";
        const path = `chat-media/${orgId}/${sessionId}/${Date.now()}-${safeName}`;
        const { error: upErr } = await db.storage
          .from("crm-files")
          .upload(path, buf, { contentType: mime, upsert: false });
        if (!upErr) {
          mediaStoredUrl = `crm-files/${path}`;
          mediaMeta.file_name = safeName;
          mediaMeta.mime_type = mime;
          mediaMeta.size = buf.length;
          if (msg.ptt) mediaMeta.ptt = true;
        } else {
          console.warn("[WA_WEBHOOK] media upload failed", upErr);
        }
      }
    } catch (e) {
      console.warn("[WA_WEBHOOK] media download error", e);
    }
  }

  // 4) الرسالة (مع منع التكرار: صدى رسائلنا الصادرة)
  if (externalId) {
    const { data: dupe } = await db
      .from("msg_messages")
      .select("id")
      .eq("external_id", externalId)
      .limit(1);
    if (dupe && dupe.length > 0) return;
  }
  const { error: msgErr } = await db.from("msg_messages").insert({
    organization_id: orgId,
    session_id: sessionId,
    external_id: externalId,
    direction: fromMe ? "outbound" : "inbound",
    message_type: msg.mediaKind ?? "text",
    content: msg.text || null,
    media_url: mediaStoredUrl,
    media_meta: mediaMeta,
    status: fromMe ? "sent" : "received",
  });
  if (msgErr) console.error("[WA_WEBHOOK] message insert err", msgErr);

  // 5) طبقة المخاطر: الرسائل الصادرة من جوال المندوب تُحسب على سقوف الرقم أيضاً
  {
    const risk = await import("@/modules/risk/risk.server");
    if (fromMe)
      await risk.recordOutbound({ orgId, accountId, isNewConversation: false, origin: "phone" });
    else await risk.recordInbound(accountId);
  }

  // 6) حدث النطاق
  await db.from("domain_events").insert({
    organization_id: orgId,
    event_type: fromMe ? "messaging.message.sent" : "messaging.message.received",
    aggregate_type: "msg_session",
    aggregate_id: sessionId,
    payload: {
      session_id: sessionId,
      channel: "whatsapp",
      provider: ctx.providerId,
      peer,
      text: msg.text.slice(0, 1000),
      external_id: externalId,
    },
  });

  await ensureOpportunity(db, ctx, { phone, sessionId, fromMe });
}

/**
 * تفاعل CRM: ضمان وجود فرصة مفتوحة للعميل + ربط الجلسة بها.
 * يعمل على الرسائل الواردة والصادرة لتحديد المرحلة الصحيحة:
 *   * صاحب الرقم مندوب (sales) → المرحلة الثانية "تم التواصل"
 *   * مشرف/أدمن → المرحلة الأولى "عميل جديد"
 */
async function ensureOpportunity(
  db: Db,
  ctx: AccountCtx,
  args: { phone: string; sessionId: string; fromMe: boolean },
) {
  const { orgId, accountId, ownerUserId } = ctx;
  const { data: cp2 } = await db
    .from("crm_contact_points")
    .select("contact_id")
    .eq("organization_id", orgId)
    .eq("channel_type", "whatsapp")
    .eq("identifier", args.phone)
    .maybeSingle();
  const contactId = cp2?.contact_id as string | undefined;
  if (!contactId) return;

  let ownerIsSales = false;
  let accountDepartmentId: string | undefined;
  if (ownerUserId) {
    const [{ data: appRoleRow }, { data: rbacRoleRows }, { data: deptLinks }] = await Promise.all([
      db
        .from("user_roles")
        .select("role")
        .eq("user_id", ownerUserId)
        .eq("role", "sales")
        .maybeSingle(),
      db
        .from("rbac_user_roles")
        .select("rbac_roles(key)")
        .eq("user_id", ownerUserId)
        .eq("organization_id", orgId),
      db
        .from("msg_channel_account_departments")
        .select("department_id")
        .eq("account_id", accountId)
        .limit(1),
    ]);
    ownerIsSales =
      Boolean(appRoleRow?.role) ||
      Boolean((rbacRoleRows ?? []).some((row: any) => row.rbac_roles?.key === "sales"));
    accountDepartmentId = (deptLinks ?? [])[0]?.department_id as string | undefined;
  }

  const { data: linked } = await db
    .from("crm_opportunity_sessions")
    .select("opportunity_id")
    .eq("organization_id", orgId)
    .eq("session_ref", args.sessionId)
    .maybeSingle();

  const { data: pipe } = await db
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_default", true)
    .maybeSingle();
  const { data: stages } = pipe?.id
    ? await db
        .from("crm_pipeline_stages")
        .select("id, probability, ord")
        .eq("pipeline_id", pipe.id)
        .order("ord", { ascending: true })
    : { data: [] as any[] };
  const firstStage = stages?.[0];
  const secondStage = stages?.[1];
  const targetStage = ownerIsSales && secondStage ? secondStage : firstStage;
  const targetStageName = ownerIsSales && secondStage ? "contacted" : "new";

  let oppId: string | undefined;
  if (!linked?.opportunity_id) {
    const { data: openOpp } = await db
      .from("opp_opportunities")
      .select("id, pipeline_id, stage_id, stage, owner_agent_id, department_id")
      .eq("organization_id", orgId)
      .eq("contact_id", contactId)
      .is("outcome", null)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    oppId = openOpp?.id as string | undefined;
    if (!oppId) {
      // الرسائل الواردة فقط تنشئ فرصة جديدة؛ إرسال المندوب أولاً يعيد استخدام الفرصة القائمة.
      if (!args.fromMe) {
        const { data: newOpp, error: oppErr } = await db
          .from("opp_opportunities")
          .insert({
            organization_id: orgId,
            contact_id: contactId,
            pipeline_id: pipe?.id ?? null,
            stage_id: targetStage?.id ?? null,
            probability: targetStage?.probability ?? 10,
            stage: targetStageName,
            owner_agent_id: ownerUserId ?? null,
            department_id: accountDepartmentId ?? null,
            source: "whatsapp_inbound",
          })
          .select("id")
          .single();
        if (oppErr) console.error("[WA_WEBHOOK] opp insert err", oppErr);
        oppId = newOpp?.id;
        if (oppId) {
          await db.from("domain_events").insert({
            organization_id: orgId,
            event_type: "crm.opportunity.created",
            aggregate_type: "opportunity",
            aggregate_id: oppId,
            payload: { contact_id: contactId, source: "whatsapp_inbound" },
          });
        }
      }
    } else {
      const patch: Record<string, unknown> = {};
      if (!openOpp.stage_id && targetStage?.id) {
        patch.pipeline_id = openOpp.pipeline_id ?? pipe?.id ?? null;
        patch.stage_id = targetStage.id;
        patch.probability = targetStage.probability ?? 10;
        patch.stage = targetStageName;
      }
      if (!openOpp.owner_agent_id && ownerUserId) patch.owner_agent_id = ownerUserId;
      if (!openOpp.department_id && accountDepartmentId) patch.department_id = accountDepartmentId;
      if (Object.keys(patch).length > 0) {
        await db
          .from("opp_opportunities")
          .update(patch)
          .eq("id", openOpp.id)
          .eq("organization_id", orgId);
      }
    }
    if (oppId) {
      await db.from("crm_opportunity_sessions").insert({
        organization_id: orgId,
        opportunity_id: oppId,
        session_ref: args.sessionId,
        channel: "whatsapp",
      });
    }
  } else {
    oppId = linked.opportunity_id as string;
  }

  if (oppId && ownerIsSales && secondStage) {
    const { data: currentOpp } = await db
      .from("opp_opportunities")
      .select("stage_id, owner_agent_id, department_id")
      .eq("id", oppId)
      .eq("organization_id", orgId)
      .maybeSingle();
    const patch: Record<string, unknown> = {};
    if (currentOpp?.stage_id === firstStage?.id) {
      patch.stage_id = secondStage.id;
      patch.stage = "contacted";
      patch.probability = secondStage.probability ?? 20;
      patch.first_response_at = new Date().toISOString();
    }
    if (!currentOpp?.owner_agent_id && ownerUserId) patch.owner_agent_id = ownerUserId;
    if (!currentOpp?.department_id && accountDepartmentId)
      patch.department_id = accountDepartmentId;
    if (Object.keys(patch).length > 0) {
      await db.from("opp_opportunities").update(patch).eq("id", oppId).eq("organization_id", orgId);
    }
  }
}

async function onStatus(
  db: Db,
  ctx: AccountCtx,
  event: Extract<NormalizedEvent, { kind: "message.status" }>,
) {
  const nowIso = new Date().toISOString();
  const isRead = event.status === "read";
  const { data: chatRows } = await db
    .from("msg_messages")
    .select("id, session_id, direction, status")
    .eq("organization_id", ctx.orgId)
    .eq("external_id", event.externalId);
  for (const chatMsg of (chatRows ?? []) as any[]) {
    if (!chatMsg || chatMsg.status === "deleted") continue;
    if (chatMsg.direction === "outbound") {
      const rank: Record<string, number> = {
        queued: 0,
        sending: 1,
        sent: 2,
        delivered: 3,
        read: 4,
      };
      if ((rank[event.status] ?? 0) > (rank[chatMsg.status] ?? 0)) {
        await db.from("msg_messages").update({ status: event.status }).eq("id", chatMsg.id);
      }
    } else if (isRead) {
      // صاحب الرقم قرأ رسالة العميل من جواله → صفّر عدّاد غير المقروء
      await db.from("msg_sessions").update({ unread_count: 0 }).eq("id", chatMsg.session_id);
    }
  }

  if (event.status === "delivered") {
    await db
      .from("cmp_recipients")
      .update({ status: "delivered", delivered_at: nowIso })
      .eq("organization_id", ctx.orgId)
      .eq("external_message_id", event.externalId)
      .in("status", ["sent"]);
  } else if (isRead) {
    await db
      .from("cmp_recipients")
      .update({ status: "read", read_at: nowIso })
      .eq("organization_id", ctx.orgId)
      .eq("external_message_id", event.externalId)
      .in("status", ["sent", "delivered"]);
  }
}

async function onChatRead(db: Db, peer: string) {
  await db.from("msg_sessions").update({ unread_count: 0 }).eq("peer_identifier", peer);
}
