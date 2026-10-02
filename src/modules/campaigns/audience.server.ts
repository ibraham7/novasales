import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { allRows } from "./access.server";
const db = supabaseAdmin as any;
export interface AudienceFilter {
  lifecycle_stage?: string;
  department_id?: string;
  tag_ids?: string[];
  lead_status?: string;
  contact_ids?: string[];
}
export interface AudienceRecipient {
  contact_id: string;
  phone: string;
  display_name: string | null;
}
export async function resolveAudience(
  org: string,
  filter: AudienceFilter,
): Promise<AudienceRecipient[]> {
  const contacts = await allRows(() => {
    let q = db
      .from("crm_contacts")
      .select("id,display_name,full_name,primary_department_id,lifecycle_stage")
      .eq("organization_id", org)
      .order("id");
    if (filter.lifecycle_stage) q = q.eq("lifecycle_stage", filter.lifecycle_stage);
    if (filter.department_id) q = q.eq("primary_department_id", filter.department_id);
    if (filter.contact_ids?.length) q = q.in("id", filter.contact_ids);
    return q;
  });
  let allowed = new Set(contacts.map((c) => c.id));
  if (filter.tag_ids?.length)
    throw new Error(
      "فلترة الحملات بالوسوم غير متاحة حاليًا؛ استخدم المرحلة أو القسم أو العملاء المحددين",
    );
  if (filter.lead_status) {
    const leads = await allRows(() =>
      db
        .from("crm_leads")
        .select("id,contact_id")
        .eq("organization_id", org)
        .eq("status", filter.lead_status)
        .order("id"),
    );
    const ids = new Set(leads.map((l) => l.contact_id));
    allowed = new Set([...allowed].filter((id) => ids.has(id)));
  }
  const points = await allRows(() =>
    db
      .from("crm_contact_points")
      .select("id,contact_id,identifier,is_primary")
      .eq("organization_id", org)
      .eq("channel_type", "whatsapp")
      .order("is_primary", { ascending: false })
      .order("id"),
  );
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const phones = new Set<string>(),
    seen = new Set<string>();
  const out: AudienceRecipient[] = [];
  for (const p of points) {
    const phone = String(p.identifier ?? "")
      .split("@")[0]
      .replace(/\D/g, "");
    if (
      !allowed.has(p.contact_id) ||
      seen.has(p.contact_id) ||
      phones.has(phone) ||
      !/^\d{7,15}$/.test(phone)
    )
      continue;
    const c = byId.get(p.contact_id);
    seen.add(p.contact_id);
    phones.add(phone);
    out.push({
      contact_id: p.contact_id,
      phone,
      display_name: c?.display_name ?? c?.full_name ?? null,
    });
  }
  return out;
}
export async function previewAudience(org: string, filter: AudienceFilter) {
  const rows = await resolveAudience(org, filter);
  return { count: rows.length, sample: rows.slice(0, 10) };
}
export function estimateSendTime(count: number, perMinute: number) {
  const minutes = Math.ceil(count / Math.max(1, perMinute));
  return {
    minutes,
    label:
      minutes >= 60
        ? `${Math.floor(minutes / 60)} ساعة و${minutes % 60} دقيقة`
        : `${minutes} دقيقة`,
  };
}
