// Campaign dispatcher: on tick, expands audience and creates recipients,
// then dispatches sends (throttled) via the Workflow Engine's `messaging.send` action.
// Recipients table is source of truth; cmp_campaigns.stats is refreshed by trigger.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveAudience } from "./audience.server";
import { ensureActionsRegistered, getAction } from "@/modules/workflow/actions/registry.server";

const db = supabaseAdmin as any;

async function ensureRecipients(orgId: string, campaign: any): Promise<number> {
  const { data: existing } = await db.from("cmp_recipients").select("id").eq("campaign_id", campaign.id).limit(1);
  if (existing && existing.length > 0) return 0;
  const rows = await resolveAudience(orgId, campaign.audience_filter ?? {});
  if (!rows.length) return 0;
  const toInsert = rows.map((r) => ({
    organization_id: orgId,
    campaign_id: campaign.id,
    contact_id: r.contact_id,
    phone: r.phone,
    variables: { name: r.display_name },
    status: "queued",
  }));
  // Chunk insert
  const chunkSize = 500;
  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize);
    await db.from("cmp_recipients").insert(chunk);
  }
  return toInsert.length;
}

async function dispatchBatch(campaign: any, batchSize: number): Promise<number> {
  await ensureActionsRegistered();
  const handler = getAction("messaging.send");
  if (!handler) return 0;

  // Claim a batch atomically-ish: pick queued, mark sending
  const { data: batch } = await db
    .from("cmp_recipients")
    .select("*")
    .eq("campaign_id", campaign.id)
    .eq("status", "queued")
    .limit(batchSize);
  if (!batch || batch.length === 0) return 0;

  const ids = batch.map((r: any) => r.id);
  await db.from("cmp_recipients").update({ status: "sending" }).in("id", ids);

  // Risk layer: never blast from a number that is under observation or paused —
  // fall back to the healthiest connected number in the org.
  const { pickBestAccountForOutreach } = await import("@/modules/risk/risk.server");
  const preferred = campaign.channel_account_id
    ? await pickBestAccountForOutreach(campaign.organization_id, [campaign.channel_account_id])
    : null;
  const sendingAccountId = preferred ?? (await pickBestAccountForOutreach(campaign.organization_id));
  if (!sendingAccountId) {
    // Put the batch back; the campaign resumes once a number becomes healthy.
    await db.from("cmp_recipients").update({ status: "queued" }).in("id", ids);
    return 0;
  }

  let sentCount = 0;
  for (const r of batch as any[]) {
    const result = await handler({
      channel: "whatsapp",
      channel_account_id: sendingAccountId,
      risk_source: "campaign",
      phone: r.phone,
      contact_id: r.contact_id,
      template_id: campaign.template_id,
      template_version: campaign.template_version,
      variables: r.variables ?? {},
    }, {
      organizationId: campaign.organization_id,
      runId: campaign.id,
      workflowId: campaign.id,
      triggerPayload: {},
      runContext: {},
    });


    if (result.ok) {
      const output = result.output ?? {};
      await db.from("cmp_recipients").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        external_message_id: (output as any).external_id ?? null,
      }).eq("id", r.id);
      await db.from("domain_events").insert({
        organization_id: campaign.organization_id,
        event_type: "cmp.message.sent",
        aggregate_type: "cmp_recipient", aggregate_id: r.id,
        payload: { campaign_id: campaign.id, contact_id: r.contact_id },
      });
      sentCount++;
    } else {
      await db.from("cmp_recipients").update({
        status: "failed",
        failed_at: new Date().toISOString(),
        error: result.error ?? "send_failed",
      }).eq("id", r.id);
      await db.from("domain_events").insert({
        organization_id: campaign.organization_id,
        event_type: "cmp.message.failed",
        aggregate_type: "cmp_recipient", aggregate_id: r.id,
        payload: { campaign_id: campaign.id, error: result.error },
      });
    }
  }
  return sentCount;
}

// Called every minute by cron
export async function tickCampaigns(): Promise<{ processed: number }> {
  const nowIso = new Date().toISOString();

  // 1) scheduled -> running (if scheduled_at passed)
  const { data: due } = await db
    .from("cmp_campaigns")
    .select("*")
    .in("status", ["scheduled"])
    .lte("scheduled_at", nowIso);
  for (const c of (due ?? []) as any[]) {
    await db.from("cmp_campaigns").update({ status: "running", started_at: nowIso }).eq("id", c.id);
    await db.from("domain_events").insert({
      organization_id: c.organization_id,
      event_type: "cmp.campaign.started",
      aggregate_type: "cmp_campaign", aggregate_id: c.id, payload: {},
    });
  }

  // 2) Process running campaigns
  const { data: running } = await db
    .from("cmp_campaigns")
    .select("*")
    .eq("status", "running");
  let processed = 0;
  for (const c of (running ?? []) as any[]) {
    await ensureRecipients(c.organization_id, c);
    processed += await dispatchBatch(c, Math.max(1, c.throttle_per_minute ?? 20));

    // Completion check
    const { data: pending } = await db
      .from("cmp_recipients")
      .select("id")
      .eq("campaign_id", c.id)
      .in("status", ["queued", "sending"])
      .limit(1);
    if (!pending || pending.length === 0) {
      await db.from("cmp_campaigns").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", c.id);
      await db.from("domain_events").insert({
        organization_id: c.organization_id,
        event_type: "cmp.campaign.finished",
        aggregate_type: "cmp_campaign", aggregate_id: c.id, payload: {},
      });
    }
  }
  return { processed };
}
