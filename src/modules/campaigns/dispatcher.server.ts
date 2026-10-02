import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveAudience } from "./audience.server";
import { checked } from "./access.server";
import { ensureActionsRegistered, getAction } from "@/modules/workflow/actions/registry.server";
const db = supabaseAdmin as any;
export async function tickCampaigns(organizationId?: string): Promise<{ processed: number }> {
  const now = new Date().toISOString();
  let due = db
    .from("cmp_campaigns")
    .update({ status: "running", started_at: now })
    .eq("status", "scheduled")
    .lte("scheduled_at", now);
  if (organizationId) due = due.eq("organization_id", organizationId);
  await checked(due);
  let query = db
    .from("cmp_campaigns")
    .select("*")
    .eq("status", "running")
    .order("created_at")
    .limit(100);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const campaigns = await checked<any[]>(query);
  await ensureActionsRegistered();
  const handler = getAction("messaging.send");
  if (!handler) throw new Error("محرك إرسال الحملات غير جاهز");
  let processed = 0;
  for (const c of campaigns) {
    const token = crypto.randomUUID(),
      org = c.organization_id;
    const claimed = await checked(
      db.rpc("cmp_claim_campaign", { p_id: c.id, p_org: org, p_token: token }),
    );
    if (!claimed) continue;
    try {
      // Unknown sends after a crashed worker are never automatically retried.
      await checked(
        db
          .from("cmp_recipients")
          .update({
            status: "failed",
            failed_at: now,
            error: "انقطع التنفيذ؛ تحقق من واتساب قبل إعادة الإرسال",
          })
          .eq("campaign_id", c.id)
          .eq("organization_id", org)
          .eq("status", "sending")
          .lt("claimed_at", new Date(Date.now() - 600000).toISOString()),
      );
      if (!c.audience_ready) {
        const audience = await resolveAudience(org, c.audience_filter ?? {});
        for (let i = 0; i < audience.length; i += 200)
          await checked(
            db.from("cmp_recipients").upsert(
              audience.slice(i, i + 200).map((r) => ({
                organization_id: org,
                campaign_id: c.id,
                contact_id: r.contact_id,
                phone: r.phone,
                variables: { name: r.display_name },
                status: "queued",
              })),
              { onConflict: "campaign_id,phone", ignoreDuplicates: true },
            ),
          );
        await checked(
          db
            .from("cmp_campaigns")
            .update({ audience_ready: true })
            .eq("id", c.id)
            .eq("organization_id", org),
        );
      }
      const { pickBestAccountForOutreach } = await import("@/modules/risk/risk.server");
      const account = await pickBestAccountForOutreach(org, [c.channel_account_id]);
      if (!account) continue;
      const batch = await checked<any[]>(
        db.rpc("cmp_claim_recipients", {
          p_id: c.id,
          p_org: org,
          p_token: token,
          p_limit: c.throttle_per_minute,
        }),
      );
      for (const r of batch) {
        const current = await checked<any>(
          db
            .from("cmp_campaigns")
            .select("status,lease_token,lease_until")
            .eq("id", c.id)
            .eq("organization_id", org)
            .single(),
        );
        if (
          current.status !== "running" ||
          current.lease_token !== token ||
          Date.parse(current.lease_until) <= Date.now()
        ) {
          await checked(
            db
              .from("cmp_recipients")
              .update({ status: "queued", claimed_at: null })
              .eq("id", r.id)
              .eq("organization_id", org)
              .eq("status", "sending"),
          );
          continue;
        }
        let result;
        try {
          result = await handler(
            {
              channel: "whatsapp",
              channel_account_id: account,
              risk_source: "campaign",
              phone: r.phone,
              contact_id: r.contact_id,
              template_id: c.template_id,
              template_version: c.template_version,
              variables: r.variables,
            },
            {
              organizationId: org,
              runId: c.id,
              workflowId: c.id,
              triggerPayload: {},
              runContext: {},
            },
          );
        } catch {
          result = { ok: false, error: "تعذر الإرسال؛ تحقق من اتصال واتساب" };
        }
        await checked(
          db
            .from("cmp_recipients")
            .update(
              result.ok
                ? {
                    status: "sent",
                    sent_at: new Date().toISOString(),
                    external_message_id: result.output?.external_id ?? null,
                  }
                : {
                    status: "failed",
                    failed_at: new Date().toISOString(),
                    error: result.error ?? "تعذر الإرسال",
                  },
            )
            .eq("id", r.id)
            .eq("organization_id", org)
            .eq("status", "sending"),
        );
        if (result.ok) processed++;
      }
      const pending = await checked<any[]>(
        db
          .from("cmp_recipients")
          .select("id")
          .eq("campaign_id", c.id)
          .eq("organization_id", org)
          .in("status", ["queued", "sending"])
          .limit(1),
      );
      if (!pending.length)
        await checked(
          db
            .from("cmp_campaigns")
            .update({ status: "completed", finished_at: new Date().toISOString() })
            .eq("id", c.id)
            .eq("organization_id", org)
            .eq("status", "running"),
        );
    } catch (e) {
      await checked(
        db
          .from("cmp_campaigns")
          .update({ status: "failed", error: e instanceof Error ? e.message : "تعذر تشغيل الحملة" })
          .eq("id", c.id)
          .eq("organization_id", org)
          .eq("status", "running"),
      );
    } finally {
      await checked(
        db
          .from("cmp_campaigns")
          .update({ lease_token: null, lease_until: null })
          .eq("id", c.id)
          .eq("organization_id", org)
          .eq("lease_token", token),
      );
    }
  }
  return { processed };
}
