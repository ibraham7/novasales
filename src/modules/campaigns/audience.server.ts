// Audience resolution + send-time estimator.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as any;

export interface AudienceFilter {
  lifecycle_stage?: string;      // "lead" | "customer" ...
  department_id?: string;
  tag_ids?: string[];
  lead_status?: string;
  has_whatsapp?: boolean;
  contact_ids?: string[];
  limit?: number;
}

export interface AudienceRecipient {
  contact_id: string;
  phone: string;
  display_name: string | null;
}

export async function resolveAudience(orgId: string, filter: AudienceFilter): Promise<AudienceRecipient[]> {
  if (filter.contact_ids?.length) {
    const { data } = await db
      .from("crm_contacts")
      .select("id, display_name, full_name, crm_contact_points!inner(identifier, channel_type, is_primary)")
      .eq("organization_id", orgId)
      .in("id", filter.contact_ids)
      .eq("crm_contact_points.channel_type", "whatsapp");
    return (data ?? []).map((c: any) => ({
      contact_id: c.id,
      phone: c.crm_contact_points?.[0]?.identifier ?? "",
      display_name: c.display_name ?? c.full_name ?? null,
    })).filter((r: AudienceRecipient) => r.phone);
  }

  let q = db
    .from("crm_contacts")
    .select("id, display_name, full_name, primary_department_id, lifecycle_stage, crm_contact_points!inner(identifier, channel_type)")
    .eq("organization_id", orgId)
    .eq("crm_contact_points.channel_type", "whatsapp")
    .limit(filter.limit ?? 10000);
  if (filter.lifecycle_stage) q = q.eq("lifecycle_stage", filter.lifecycle_stage);
  if (filter.department_id) q = q.eq("primary_department_id", filter.department_id);
  const { data } = await q;
  let rows: AudienceRecipient[] = (data ?? []).map((c: any) => ({
    contact_id: c.id,
    phone: c.crm_contact_points?.[0]?.identifier ?? "",
    display_name: c.display_name ?? c.full_name ?? null,
  })).filter((r: AudienceRecipient) => r.phone);

  if (filter.tag_ids?.length) {
    const { data: links } = await db
      .from("crm_tag_links")
      .select("entity_id")
      .eq("organization_id", orgId)
      .eq("entity_type", "contact")
      .in("tag_id", filter.tag_ids);
    const tagged = new Set((links ?? []).map((l: any) => l.entity_id));
    rows = rows.filter((r) => tagged.has(r.contact_id));
  }
  return rows;
}

export async function previewAudience(orgId: string, filter: AudienceFilter): Promise<{ count: number; sample: AudienceRecipient[] }> {
  const rows = await resolveAudience(orgId, { ...filter, limit: 100 });
  const count = rows.length >= 100 ? await countAudience(orgId, filter) : rows.length;
  return { count, sample: rows.slice(0, 10) };
}

async function countAudience(orgId: string, filter: AudienceFilter): Promise<number> {
  const rows = await resolveAudience(orgId, { ...filter, limit: 10000 });
  return rows.length;
}

// Human "4h 10m" formatter.
export function estimateSendTime(count: number, throttlePerMinute: number): {
  minutes: number; label: string;
} {
  const perMin = Math.max(1, throttlePerMinute);
  const minutes = Math.ceil(count / perMin);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const label = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return { minutes, label };
}
