import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const AudienceSchema = z.object({
  lifecycle_stage: z.string().optional(),
  department_id: z.string().uuid().optional(),
  tag_ids: z.array(z.string().uuid()).optional(),
  lead_status: z.string().optional(),
  contact_ids: z.array(z.string().uuid()).optional(),
}).partial();

export const listCampaigns = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { organizationId } = await getWorkspace();
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("cmp_campaigns")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return { campaigns: (data ?? []) as any[] };
});

export const getCampaign = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { organizationId } = await getWorkspace();
    const db = supabaseAdmin as any;
    const [{ data: c }, { data: recipients }] = await Promise.all([
      db.from("cmp_campaigns").select("*").eq("id", data.id).eq("organization_id", organizationId).maybeSingle(),
      db.from("cmp_recipients").select("*").eq("campaign_id", data.id).order("created_at", { ascending: false }).limit(500),
    ]);
    return { campaign: c as any, recipients: (recipients ?? []) as any[] };
  });

export const previewCampaignAudience = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ audience_filter: AudienceSchema, throttle_per_minute: z.number().int().min(1).max(1000).default(20) }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace } = await import("@/platform/workspace/workspace.server");
    const { organizationId } = await getWorkspace();
    const { previewAudience, estimateSendTime } = await import("./audience.server");
    const preview = await previewAudience(organizationId, data.audience_filter as any);
    const eta = estimateSendTime(preview.count, data.throttle_per_minute);
    return { count: preview.count, sample: preview.sample, eta };
  });

export const saveCampaign = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1).max(200),
      channel_account_id: z.string().uuid(),
      template_id: z.string().uuid(),
      audience_filter: AudienceSchema,
      throttle_per_minute: z.number().int().min(1).max(1000).default(20),
      scheduled_at: z.string().optional().nullable(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { organizationId, userId } = await getWorkspace();
    const db = supabaseAdmin as any;
    const { data: tpl } = await db.from("cmp_templates").select("version").eq("id", data.template_id).maybeSingle();
    const row: Record<string, any> = {
      organization_id: organizationId,
      name: data.name,
      channel_account_id: data.channel_account_id,
      template_id: data.template_id,
      template_version: tpl?.version ?? 1,
      audience_filter: data.audience_filter,
      throttle_per_minute: data.throttle_per_minute,
      scheduled_at: data.scheduled_at ?? null,
    };
    if (data.id) {
      const { error } = await db.from("cmp_campaigns").update(row).eq("id", data.id).eq("organization_id", organizationId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    row.created_by = userId;
    row.status = "draft";
    const { data: created, error } = await db.from("cmp_campaigns").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return { id: created.id };
  });

export const launchCampaign = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), sendNow: z.boolean().default(true) }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { organizationId } = await getWorkspace();
    const db = supabaseAdmin as any;
    // Refresh template version snapshot on launch
    const { data: c } = await db.from("cmp_campaigns").select("template_id").eq("id", data.id).maybeSingle();
    if (c) {
      const { data: tpl } = await db.from("cmp_templates").select("version").eq("id", c.template_id).maybeSingle();
      if (tpl) await db.from("cmp_campaigns").update({ template_version: tpl.version }).eq("id", data.id);
    }
    const patch: any = {
      status: "scheduled",
      scheduled_at: data.sendNow ? new Date().toISOString() : undefined,
    };
    const { error } = await db.from("cmp_campaigns").update(patch).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const controlCampaign = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), action: z.enum(["pause", "resume", "cancel"]) }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { organizationId } = await getWorkspace();
    const db = supabaseAdmin as any;
    const nextStatus = data.action === "pause" ? "paused" : data.action === "resume" ? "running" : "cancelled";
    const { error } = await db.from("cmp_campaigns").update({ status: nextStatus }).eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    if (data.action === "pause") {
      await db.from("domain_events").insert({
        organization_id: organizationId, event_type: "cmp.campaign.paused",
        aggregate_type: "cmp_campaign", aggregate_id: data.id, payload: {},
      });
    }
    return { ok: true };
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { organizationId } = await getWorkspace();
    const db = supabaseAdmin as any;
    const { error } = await db.from("cmp_campaigns").delete().eq("id", data.id).eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
