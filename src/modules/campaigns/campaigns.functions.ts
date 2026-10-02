import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";
import { campaignAccess, ownCampaign, checked, allRows } from "./access.server";

const AudienceSchema = z
  .object({
    lifecycle_stage: z.string().optional(),
    department_id: z.string().uuid().optional(),
    tag_ids: z.array(z.string().uuid()).optional(),
    lead_status: z.string().optional(),
    contact_ids: z.array(z.string().uuid()).optional(),
  })
  .partial();

export const listCampaigns = createServerFn({ method: "GET" }).handler(async () => {
  const { organizationId, db, canManage, canSend } = await campaignAccess();
  const { data, error } = await db
    .from("cmp_campaigns")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("تعذر حفظ أو تحميل الحملة؛ أعد المحاولة");
  return { campaigns: (data ?? []) as any[], canManage, canSend };
});

export const getCampaign = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { organizationId, db } = await campaignAccess();
    const c = await ownCampaign(db, data.id, organizationId);
    const recipients = await allRows(() =>
      db
        .from("cmp_recipients")
        .select("*")
        .eq("campaign_id", data.id)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .order("id"),
    );
    return { campaign: c, recipients };
  });

export const previewCampaignAudience = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        audience_filter: AudienceSchema,
        throttle_per_minute: z.number().int().min(1).max(1000).default(20),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { organizationId } = await campaignAccess("manage");
    const { previewAudience, estimateSendTime } = await import("./audience.server");
    const preview = await previewAudience(organizationId, data.audience_filter as any);
    const eta = estimateSendTime(preview.count, data.throttle_per_minute);
    return { count: preview.count, sample: preview.sample, eta };
  });

export const saveCampaign = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(200),
        channel_account_id: z.string().uuid(),
        template_id: z.string().uuid(),
        audience_filter: AudienceSchema,
        throttle_per_minute: z.number().int().min(1).max(1000).default(20),
        scheduled_at: z.string().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { organizationId, db, access } = await campaignAccess("manage");
    const userId = access.userId;
    if (data.id && (await ownCampaign(db, data.id, organizationId)).status !== "draft")
      throw new Error("يمكن تعديل المسودات فقط");
    if (
      data.scheduled_at &&
      (!Number.isFinite(Date.parse(data.scheduled_at)) ||
        Date.parse(data.scheduled_at) <= Date.now())
    )
      throw new Error("اختر موعدًا صحيحًا في المستقبل");
    const account = await checked<any>(
      db
        .from("msg_channel_accounts")
        .select("id,status")
        .eq("id", data.channel_account_id)
        .eq("organization_id", organizationId)
        .maybeSingle(),
    );
    if (!account || account.status !== "connected")
      throw new Error("اختر حساب واتساب متصلًا تابعًا لمؤسستك");
    const { data: tpl } = await db
      .from("cmp_templates")
      .select("version,body")
      .eq("id", data.template_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!tpl) throw new Error("القالب غير موجود في مؤسستك");
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
      const { error } = await db
        .from("cmp_campaigns")
        .update(row)
        .eq("id", data.id)
        .eq("organization_id", organizationId)
        .eq("status", "draft")
        .select("id")
        .single();
      if (error) throw new Error("تعذر حفظ أو تحميل الحملة؛ أعد المحاولة");
      return { id: data.id };
    }
    row.created_by = userId;
    row.status = "draft";
    const { data: created, error } = await db
      .from("cmp_campaigns")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error("تعذر حفظ أو تحميل الحملة؛ أعد المحاولة");
    return { id: created.id };
  });

export const launchCampaign = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), sendNow: z.boolean().default(true) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { organizationId, db } = await campaignAccess("send");
    const c = await ownCampaign(db, data.id, organizationId);
    if (c.status !== "draft") throw new Error("يمكن إطلاق المسودات فقط");
    const scheduled = data.sendNow ? new Date().toISOString() : c.scheduled_at;
    if (!scheduled || (!data.sendNow && Date.parse(scheduled) <= Date.now()))
      throw new Error("حدد موعدًا مستقبليًا أو اختر الإطلاق الآن");
    const tpl = await checked<any>(
      db
        .from("cmp_templates")
        .select("version,body")
        .eq("id", c.template_id)
        .eq("organization_id", organizationId)
        .single(),
    );
    const vars = [...String(tpl.body).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
    if (vars.some((v) => v !== "name"))
      throw new Error("قوالب الحملات تدعم متغير {{name}} فقط حاليًا");
    const account = await checked<any>(
      db
        .from("msg_channel_accounts")
        .select("status")
        .eq("id", c.channel_account_id)
        .eq("organization_id", organizationId)
        .single(),
    );
    if (account.status !== "connected") throw new Error("جلسة واتساب غير متصلة");
    await checked(
      db
        .from("cmp_campaigns")
        .update({ status: "scheduled", scheduled_at: scheduled, template_version: tpl.version })
        .eq("id", data.id)
        .eq("organization_id", organizationId)
        .eq("status", "draft")
        .select("id")
        .single(),
    );
    return { ok: true };
  });

export const controlCampaign = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), action: z.enum(["pause", "resume", "cancel"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { organizationId, db } = await campaignAccess("send");
    const c = await ownCampaign(db, data.id, organizationId);
    const allowed =
      data.action === "pause"
        ? ["running", "scheduled"]
        : data.action === "resume"
          ? ["paused"]
          : ["draft", "scheduled", "running", "paused"];
    if (!allowed.includes(c.status))
      throw new Error("لا يمكن تنفيذ الإجراء في حالة الحملة الحالية");
    await checked(
      db
        .from("cmp_campaigns")
        .update({
          status:
            data.action === "pause"
              ? "paused"
              : data.action === "resume"
                ? c.scheduled_at && Date.parse(c.scheduled_at) > Date.now()
                  ? "scheduled"
                  : "running"
                : "cancelled",
        })
        .eq("id", data.id)
        .eq("organization_id", organizationId)
        .eq("status", c.status)
        .select("id")
        .single(),
    );
    return { ok: true };
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { organizationId, db } = await campaignAccess("manage");
    const c = await ownCampaign(db, data.id, organizationId);
    if (["running", "scheduled", "paused"].includes(c.status))
      throw new Error("ألغِ الحملة قبل حذفها");
    const { error } = await db
      .from("cmp_campaigns")
      .delete()
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error("تعذر حفظ أو تحميل الحملة؛ أعد المحاولة");
    return { ok: true };
  });

export const processCampaignJobs = createServerFn({ method: "POST" }).handler(async () => {
  const { organizationId } = await campaignAccess("send");
  const { tickCampaigns } = await import("./dispatcher.server");
  return tickCampaigns(organizationId);
});
