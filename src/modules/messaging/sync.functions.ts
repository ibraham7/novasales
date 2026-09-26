import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Fetch chat history from the session's provider (any engine) for an
 * opportunity and upsert missing messages into msg_messages. Also refreshes
 * opportunity and upsert missing messages. Also refreshes the contact avatar.
 */
export const syncOpportunityHistory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ opportunityId: z.string().uuid(), limit: z.number().int().min(20).max(500).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { requireAnyPermission } = await import("@/platform/rbac/rbac.server");
    const ops = await import("@/modules/channels/whatsapp/channel-ops.server");
    const db = supabaseAdmin as any;
    const { organizationId } = await getWorkspace();
    await requireAnyPermission(["crm.opportunities.view", "opportunities.view", "opportunities.view_department", "opportunities.view_own"]);
    const limit = data.limit ?? 100;

    const { data: opp } = await db
      .from("opp_opportunities")
      .select("id, contact_id")
      .eq("id", data.opportunityId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!opp) throw new Error("الفرصة غير موجودة");

    // All sessions linked to this opportunity
    const { data: links } = await db
      .from("crm_opportunity_sessions")
      .select("session_ref")
      .eq("organization_id", organizationId)
      .eq("opportunity_id", opp.id);
    const sessIds = (links ?? []).map((l: any) => l.session_ref).filter(Boolean);
    if (!sessIds.length) return { ok: false, synced: 0, reason: "no_sessions" };

    const { data: sessions } = await db
      .from("msg_sessions")
      .select("id, channel_account_id, peer_identifier")
      .in("id", sessIds);
    let inserted = 0;
    for (const s of (sessions ?? []) as any[]) {
      if (!s.channel_account_id || !s.peer_identifier) continue;
      // جلب السجل عبر طبقة العمليات: المحرّك الذي يعلن supportsHistory فقط.
      const records = (await ops
        .opFetchHistory(s.channel_account_id, s.peer_identifier, limit)
        .catch(() => [])) as any[];
      if (!records.length) continue;

      // Find existing external_ids to skip
      const externalIds: string[] = records
        .map((r: any) => r?.key?.id)
        .filter((x: any): x is string => typeof x === "string");
      const { data: existing } = externalIds.length
        ? await db
            .from("msg_messages")
            .select("external_id")
            .eq("session_id", s.id)
            .in("external_id", externalIds)
        : { data: [] };
      const existingSet = new Set((existing ?? []).map((r: any) => r.external_id));

      const rows: any[] = [];
      for (const r of records) {
        const extId = r?.key?.id;
        if (!extId || existingSet.has(extId)) continue;
        const fromMe = Boolean(r?.key?.fromMe);
        const msg = r?.message ?? {};
        const text =
          msg?.conversation ??
          msg?.extendedTextMessage?.text ??
          msg?.imageMessage?.caption ??
          msg?.videoMessage?.caption ??
          "";
        const ts = r?.messageTimestamp
          ? new Date(Number(r.messageTimestamp) * 1000).toISOString()
          : new Date().toISOString();
        rows.push({
          organization_id: organizationId,
          session_id: s.id,
          external_id: extId,
          direction: fromMe ? "outbound" : "inbound",
          message_type: "text",
          content: String(text ?? ""),
          status: "received",
          created_at: ts,
        });
      }
      if (rows.length) {
        const { error } = await db.from("msg_messages").insert(rows);
        if (!error) inserted += rows.length;
      }

      // Refresh contact avatar (best-effort)
      const phone = String(s.peer_identifier).split("@")[0];
      try {
        const url = await ops.opGetProfilePicture(s.channel_account_id, phone);
        if (url && opp.contact_id) {
          await db.from("crm_contacts").update({ avatar_url: url }).eq("id", opp.contact_id);
          await db.from("msg_sessions").update({ profile_pic_url: url }).eq("id", s.id);
        }
      } catch {}
    }

    return { ok: true, synced: inserted };
  });
