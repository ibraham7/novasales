/**
 * Outbound campaigns: who may be messaged, the final approval, the «do not send» list and what
 * happens when a business replies. The database and the account lookup are passed in, so all of
 * it is tested without Supabase.
 */
import { DEFAULT_OPTOUT_FOOTER, isOptOutMessage } from "./optout.ts";
import { prospectPhone } from "./phone.ts";

const CHUNK = 100;
const chunks = <T>(items: T[], size = CHUNK) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

export const DEFAULT_MAX_RECIPIENTS = 200;
export const DEFAULT_MAX_THROTTLE = 10;
/** A reply counts for a message sent in the last days. */
export const REPLY_WINDOW_DAYS = 14;
/** A hidden id is only guessed for a business messaged this recently (a long id carries no number to check). */
export const HIDDEN_ID_WINDOW_DAYS = 3;

export type OutboundSettings = { allow_unofficial: boolean; optout_footer: string };

export async function loadSettings(db: any, organizationId: string): Promise<OutboundSettings> {
  const { data, error } = await db.from("ob_org_settings").select("allow_unofficial,optout_footer").eq("organization_id", organizationId).maybeSingle();
  if (error && !MISSING_TABLE.has(error.code)) throw new Error(error.message);
  return { allow_unofficial: data?.allow_unofficial === true, optout_footer: data?.optout_footer || DEFAULT_OPTOUT_FOOTER };
}

export async function logEvent(db: any, organizationId: string, actorUserId: string | null, eventType: string, entityType: string | null, entityId: string | null, detail: Record<string, unknown> = {}) {
  await db.from("ob_events").insert({ organization_id: organizationId, actor_user_id: actorUserId, event_type: eventType, entity_type: entityType, entity_id: entityId, detail });
}

/* ------------------------- the «do not send» list ------------------------- */

/** The numbers among `phones` that the organization asked never to message. A missing table (before the migration) blocks nobody. */
export async function blockedPhones(db: any, organizationId: string, phones: string[]): Promise<Set<string>> {
  const blocked = new Set<string>();
  for (const part of chunks([...new Set(phones.filter(Boolean))])) {
    const { data, error } = await db.from("ob_suppressions").select("identifier").eq("organization_id", organizationId).eq("channel", "whatsapp").in("identifier", part);
    if (error) {
      if (MISSING_TABLE.has(error.code)) return blocked;
      throw new Error(error.message);
    }
    for (const row of data ?? []) blocked.add(row.identifier);
  }
  return blocked;
}

export async function addSuppression(db: any, organizationId: string, rawPhone: string, info: { source: "manual" | "keyword" | "import"; reason?: string; userId?: string | null; dial?: string }) {
  const { e164 } = prospectPhone(rawPhone, info.dial ?? "");
  if (!e164) throw new Error("الرقم غير صالح؛ اكتبه بصيغة دولية مثل +905321234567");
  const { error } = await db.from("ob_suppressions").upsert(
    { organization_id: organizationId, channel: "whatsapp", identifier: e164, reason: info.reason?.slice(0, 200) ?? null, source: info.source, created_by: info.userId ?? null },
    { onConflict: "organization_id,channel,identifier", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
  // The same number as a discovered business: never contacted again.
  await db.from("ob_prospects").update({ status: "opted_out", updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("phone_e164", e164).in("status", ["new", "review", "qualified", "approved", "contacted", "replied", "interested"]);
  return e164;
}

/* ------------------------------ manual entry ------------------------------ */

/** Adds a business by hand (the team's own test numbers, a list from elsewhere). It has no Google data, so it never expires. */
export async function addManualProspect(db: any, organizationId: string, input: { name: string; phone: string; dial: string; countryCode: string; category?: string; website?: string; city?: string }) {
  const { e164, kind } = prospectPhone(input.phone, input.dial);
  if (!e164) throw new Error("الرقم غير صالح؛ اكتبه بصيغة دولية مثل +905321234567");
  const now = new Date();
  const { data, error } = await db
    .from("ob_prospects")
    .upsert(
      {
        organization_id: organizationId,
        provider: "manual",
        external_id: `manual:${e164}`,
        name: input.name.trim().slice(0, 200),
        category: input.category?.trim().slice(0, 120) || null,
        city: input.city?.trim().slice(0, 80) || null,
        country: input.countryCode,
        phone_raw: input.phone.trim().slice(0, 40),
        phone_e164: e164,
        phone_kind: kind,
        website: input.website?.trim().slice(0, 300) || null,
        fetched_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 100 * 365 * 86_400_000).toISOString(),
      },
      { onConflict: "organization_id,provider,external_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(error.message);
  return { created: (data ?? []).length > 0, phone: e164 };
}

/* --------------------------- who can be messaged --------------------------- */

export type AudiencePreview = {
  eligible: { id: string; name: string; phone: string }[];
  excluded: { noPhone: number; landline: number; suppressed: number; inOtherCampaign: number; duplicatePhone: number };
  approved: number;
};

/**
 * Approved businesses that can be messaged now. A business without a number, with a landline,
 * on the «do not send» list, already waiting in another campaign, or sharing a number with an
 * earlier one is left out and counted by reason.
 */
export async function previewAudience(db: any, organizationId: string, prospectIds?: string[]): Promise<AudiencePreview> {
  let query = db.from("ob_prospects").select("id,name,phone_e164,phone_kind").eq("organization_id", organizationId).eq("status", "approved").limit(5000);
  if (prospectIds?.length) query = query.in("id", prospectIds);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows: { id: string; name: string; phone_e164: string | null; phone_kind: string }[] = data ?? [];

  const waiting = new Set<string>();
  for (const part of chunks(rows.map((r) => r.id))) {
    const { data: pending, error: pendingError } = await db.from("cmp_recipients").select("ob_prospect_id").eq("organization_id", organizationId).in("ob_prospect_id", part).in("status", ["queued", "sending"]);
    if (pendingError) throw new Error(pendingError.message);
    for (const row of pending ?? []) waiting.add(row.ob_prospect_id);
  }
  const blocked = await blockedPhones(db, organizationId, rows.map((r) => r.phone_e164 ?? ""));

  const excluded = { noPhone: 0, landline: 0, suppressed: 0, inOtherCampaign: 0, duplicatePhone: 0 };
  const seen = new Set<string>();
  const eligible: AudiencePreview["eligible"] = [];
  for (const r of rows) {
    if (!r.phone_e164) excluded.noPhone++;
    else if (r.phone_kind === "landline") excluded.landline++;
    else if (blocked.has(r.phone_e164)) excluded.suppressed++;
    else if (waiting.has(r.id)) excluded.inOtherCampaign++;
    else if (seen.has(r.phone_e164)) excluded.duplicatePhone++;
    else {
      seen.add(r.phone_e164);
      eligible.push({ id: r.id, name: r.name, phone: r.phone_e164 });
    }
  }
  return { eligible, excluded, approved: rows.length };
}

/* ------------------------------ final approval ------------------------------ */

export type AccountInfo = { organizationId: string; connected: boolean; isOfficial: boolean; label: string } | null;

export type CampaignInput = {
  organizationId: string;
  userId: string;
  name: string;
  body: string;
  accountId: string;
  prospectIds?: string[];
  /** ISO time in the future, or empty to start now. */
  scheduledAt?: string | null;
  throttlePerMinute: number;
  acknowledgments: { b2b: boolean; optOut: boolean; review: boolean };
};

export type CampaignDeps = {
  account: (accountId: string) => Promise<AccountInfo>;
  now?: () => Date;
  maxRecipients?: number;
  maxThrottle?: number;
};

/**
 * The final approval: checks everything, writes the message as its own template with the opt-out
 * line, the campaign (scheduled, with a record of what was approved and by whom) and its
 * recipients. Nothing is sent here; the campaign engine sends it, slowly, from the chosen number.
 */
export async function createOutboundCampaign(db: any, deps: CampaignDeps, input: CampaignInput) {
  const now = (deps.now ?? (() => new Date()))();
  const maxRecipients = deps.maxRecipients ?? DEFAULT_MAX_RECIPIENTS;
  const maxThrottle = deps.maxThrottle ?? DEFAULT_MAX_THROTTLE;

  if (!input.acknowledgments.b2b || !input.acknowledgments.optOut || !input.acknowledgments.review) throw new Error("أكّد كل بنود الاعتماد قبل المتابعة");
  const body = input.body.trim();
  if (!body) throw new Error("اكتب نص الرسالة");
  if (body.length > 900) throw new Error("نص الرسالة طويل؛ الحد الأقصى 900 حرف");
  const vars = [...body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
  if (vars.some((v) => v !== "name")) throw new Error("الرسالة تدعم متغير {{name}} فقط حالياً");
  let scheduledAt = now.toISOString();
  if (input.scheduledAt) {
    const time = Date.parse(input.scheduledAt);
    if (!Number.isFinite(time) || time <= now.getTime()) throw new Error("اختر موعداً صحيحاً في المستقبل أو اتركه فارغاً للبدء الآن");
    scheduledAt = new Date(time).toISOString();
  }

  const settings = await loadSettings(db, input.organizationId);
  const account = await deps.account(input.accountId);
  if (!account || account.organizationId !== input.organizationId) throw new Error("اختر رقم واتساب تابعاً لمؤسستك");
  if (!account.connected) throw new Error("رقم واتساب المختار غير متصل");
  if (account.isOfficial)
    throw new Error("الإرسال عبر واتساب الرسمي يحتاج قوالب معتمدة من Meta ولم يُبنَ بعد. اختر رقماً غير رسمي بعد قبول المخاطرة من إعدادات التسويق، أو انتظر دعم القوالب");
  if (!settings.allow_unofficial)
    throw new Error("الإرسال عبر أرقام غير رسمية معطّل. فعّله من إعدادات التسويق بعد الاطلاع على مخاطر حظر الرقم");

  const audience = await previewAudience(db, input.organizationId, input.prospectIds);
  if (audience.eligible.length === 0) throw new Error("لا توجد جهات معتمدة صالحة للإرسال");
  if (audience.eligible.length > maxRecipients) throw new Error(`الحد الأقصى ${maxRecipients} مستلماً للحملة الواحدة؛ اختر عدداً أقل`);

  const throttle = Math.max(1, Math.min(Math.floor(input.throttlePerMinute) || 1, maxThrottle));
  const { data: template, error: templateError } = await db
    .from("cmp_templates")
    .insert({ organization_id: input.organizationId, name: `Outbound: ${input.name}`.slice(0, 120), body: `${body}\n\n${settings.optout_footer}`, variables: vars.length ? ["name"] : [], created_by: input.userId })
    .select("id,version")
    .single();
  if (templateError || !template) throw new Error("تعذر حفظ نص الرسالة");

  const snapshot = {
    approvedAt: now.toISOString(),
    approvedBy: input.userId,
    account: { id: input.accountId, label: account.label, official: account.isOfficial },
    unofficialAllowed: settings.allow_unofficial,
    recipients: audience.eligible.length,
    approved: audience.approved,
    excluded: audience.excluded,
    acknowledgments: input.acknowledgments,
    throttlePerMinute: throttle,
    optOutFooter: settings.optout_footer,
  };
  const { data: campaign, error: campaignError } = await db
    .from("cmp_campaigns")
    .insert({
      organization_id: input.organizationId,
      name: input.name.trim().slice(0, 200),
      channel_account_id: input.accountId,
      template_id: template.id,
      template_version: template.version ?? 1,
      audience_filter: { kind: "outbound", prospects: audience.eligible.length },
      throttle_per_minute: throttle,
      scheduled_at: scheduledAt,
      status: "scheduled",
      audience_ready: true,
      kind: "outbound",
      created_by: input.userId,
      approved_by: input.userId,
      approved_at: now.toISOString(),
      compliance_snapshot: snapshot,
    })
    .select("id")
    .single();
  if (campaignError || !campaign) {
    await db.from("cmp_templates").delete().eq("id", template.id).eq("organization_id", input.organizationId);
    throw new Error("تعذر إنشاء الحملة؛ أعد المحاولة");
  }

  for (const part of chunks(audience.eligible)) {
    const { error } = await db.from("cmp_recipients").insert(
      part.map((p) => ({ organization_id: input.organizationId, campaign_id: campaign.id, contact_id: null, ob_prospect_id: p.id, phone: p.phone, variables: { name: p.name }, status: "queued" })),
    );
    if (error) {
      // A half-built campaign must never run.
      await db.from("cmp_recipients").delete().eq("campaign_id", campaign.id).eq("organization_id", input.organizationId);
      await db.from("cmp_campaigns").delete().eq("id", campaign.id).eq("organization_id", input.organizationId);
      await db.from("cmp_templates").delete().eq("id", template.id).eq("organization_id", input.organizationId);
      throw new Error("تعذر تجهيز المستلمين؛ لم تُنشأ الحملة");
    }
  }
  await logEvent(db, input.organizationId, input.userId, "campaign_approved", "campaign", campaign.id, snapshot);
  return { campaignId: campaign.id as string, recipients: audience.eligible.length, excluded: audience.excluded };
}

/* ----------------------------------- replies ----------------------------------- */

/**
 * A message arrived from `phone`. If a business of an outbound campaign was messaged in the last
 * days, the reply is recorded; if the text is a request to stop, the number goes on the «do not
 * send» list. Anything else (a customer, an old chat) returns quickly.
 */
export async function handleInboundReply(db: any, input: { organizationId: string; phone: string; text: string; jid?: string; now?: Date }) {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - REPLY_WINDOW_DAYS * 86_400_000).toISOString();
  const find = (apply: (q: any) => any) =>
    apply(
      db
        .from("cmp_recipients")
        .select("id,ob_prospect_id,campaign_id,replied_at,sent_at,phone")
        .eq("organization_id", input.organizationId)
        .not("ob_prospect_id", "is", null)
        .in("status", ["sent", "delivered", "read"])
        .gte("sent_at", since)
        .order("sent_at", { ascending: false }),
    );
  const fail = (error: any) => {
    if (MISSING_TABLE.has(error.code) || error.code === "42703") return { matched: false as const };
    throw new Error(error.message);
  };

  // WhatsApp may hide a sender's number behind a long id (@lid). Such an id is matched to a business
  // it was learned for, or else to the one business that is still waiting for an answer.
  let recipient: any = null;
  if (input.jid) {
    const known = await find((q) => q.eq("reply_jid", input.jid).limit(1));
    if (known.error) return fail(known.error);
    recipient = known.data?.[0] ?? null;
  }
  if (!recipient) {
    const byPhone = await find((q) => q.eq("phone", input.phone).limit(1));
    if (byPhone.error) return fail(byPhone.error);
    recipient = byPhone.data?.[0] ?? null;
  }
  if (!recipient && input.jid) {
    const recent = new Date(now.getTime() - HIDDEN_ID_WINDOW_DAYS * 86_400_000).toISOString();
    const waiting = await find((q) => q.gte("sent_at", recent).is("replied_at", null).is("reply_jid", null).limit(2));
    if (waiting.error) return fail(waiting.error);
    if (waiting.data?.length === 1) {
      recipient = waiting.data[0];
      await db.from("cmp_recipients").update({ reply_jid: input.jid }).eq("id", recipient.id).eq("organization_id", input.organizationId);
    } else if (waiting.data?.length > 1) {
      await logEvent(db, input.organizationId, null, "reply_unmatched", "jid", input.jid, { candidates: "many", optOut: isOptOutMessage(input.text) });
    }
  }
  if (!recipient) return { matched: false as const };
  const phone: string = recipient.phone ?? input.phone;

  const stamp = now.toISOString();
  if (!recipient.replied_at) await db.from("cmp_recipients").update({ replied_at: stamp }).eq("id", recipient.id).eq("organization_id", input.organizationId);

  if (isOptOutMessage(input.text)) {
    await addSuppression(db, input.organizationId, phone, { source: "keyword", reason: `طلب الإيقاف: ${input.text.slice(0, 40)}` });
    await logEvent(db, input.organizationId, null, "opt_out", "prospect", recipient.ob_prospect_id, { phone, campaignId: recipient.campaign_id });
    return { matched: true as const, optOut: true as const };
  }

  const patch: Record<string, unknown> = { status: "replied", updated_at: stamp };
  const { data: point } = await db.from("crm_contact_points").select("contact_id").eq("organization_id", input.organizationId).eq("identifier", phone).limit(1);
  if (point?.[0]?.contact_id) patch.promoted_contact_id = point[0].contact_id;
  // Only a business still waiting for an answer becomes «replied»; later stages are set by people.
  await db.from("ob_prospects").update(patch).eq("organization_id", input.organizationId).eq("id", recipient.ob_prospect_id).in("status", ["approved", "contacted"]);
  await logEvent(db, input.organizationId, null, "reply", "prospect", recipient.ob_prospect_id, { campaignId: recipient.campaign_id });
  return { matched: true as const, optOut: false as const };
}
