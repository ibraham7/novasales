import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { allRows, checked } from "./access.server";
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
  const query = (ids?: string[]) => () => {
    let q = db
      .from("crm_contacts")
      .select("id,display_name,full_name,primary_department_id,lifecycle_stage")
      .eq("organization_id", org)
      .order("id");
    if (filter.lifecycle_stage) q = q.eq("lifecycle_stage", filter.lifecycle_stage);
    if (filter.department_id) q = q.eq("primary_department_id", filter.department_id);
    if (ids) q = q.in("id", ids);
    return q;
  };
  // Chosen or imported contacts are read in small groups so the request stays short.
  const contacts: any[] = [];
  if (filter.contact_ids?.length)
    for (let i = 0; i < filter.contact_ids.length; i += 150)
      contacts.push(...(await allRows(query(filter.contact_ids.slice(i, i + 150)))));
  else contacts.push(...(await allRows(query())));
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

/**
 * Contacts for imported numbers: an existing contact with the same WhatsApp number is reused, other
 * numbers become new contacts (stage lead). Returns the contact ids in the file's order.
 */
export async function importAudienceContacts(org: string, rows: { phone: string; name: string | null }[]) {
  const byPhone = new Map<string, string>();
  for (let i = 0; i < rows.length; i += 150) {
    const points = await allRows(() =>
      db
        .from("crm_contact_points")
        .select("contact_id,identifier")
        .eq("organization_id", org)
        .eq("channel_type", "whatsapp")
        .in("identifier", rows.slice(i, i + 150).map((r) => r.phone))
        .order("id"),
    );
    for (const p of points) if (!byPhone.has(p.identifier)) byPhone.set(p.identifier, p.contact_id);
  }
  const missing = rows.filter((r) => !byPhone.has(r.phone));
  for (let i = 0; i < missing.length; i += 200) {
    const chunk = missing.slice(i, i + 200);
    const created = await checked<any[]>(
      db
        .from("crm_contacts")
        .insert(chunk.map((r) => ({ organization_id: org, display_name: r.name, full_name: r.name, lifecycle_stage: "lead" })))
        .select("id"),
    );
    if (created.length !== chunk.length) throw new Error("تعذر إضافة بعض جهات الاتصال؛ أعد المحاولة");
    await checked(
      db.from("crm_contact_points").insert(
        chunk.map((r, index) => ({
          organization_id: org,
          contact_id: created[index].id,
          channel_type: "whatsapp",
          identifier: r.phone,
          is_primary: true,
          verified: false,
        })),
      ),
    );
    chunk.forEach((r, index) => byPhone.set(r.phone, created[index].id));
  }
  return { contactIds: rows.map((r) => byPhone.get(r.phone)!), created: missing.length, existing: rows.length - missing.length };
}

/** Contacts with a WhatsApp number matching a name or number, for choosing campaign recipients. */
export async function searchAudienceContacts(org: string, search: string) {
  const term = search.trim().replace(/[%_,()]/g, "");
  const digits = term.replace(/[^0-9٠-٩]/g, "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
  let contacts: any[];
  if (digits.length >= 3) {
    const points = await checked<any[]>(
      db
        .from("crm_contact_points")
        .select("contact_id")
        .eq("organization_id", org)
        .eq("channel_type", "whatsapp")
        .ilike("identifier", `%${digits}%`)
        .limit(50),
    );
    const ids = [...new Set(points.map((p) => p.contact_id))];
    contacts = ids.length
      ? await checked<any[]>(db.from("crm_contacts").select("id,display_name,full_name").eq("organization_id", org).in("id", ids))
      : [];
  } else {
    let q = db.from("crm_contacts").select("id,display_name,full_name").eq("organization_id", org).order("last_activity_at", { ascending: false, nullsFirst: false }).limit(50);
    if (term) q = q.or(`display_name.ilike.%${term}%,full_name.ilike.%${term}%`);
    contacts = await checked<any[]>(q);
  }
  if (!contacts.length) return [];
  const points = await checked<any[]>(
    db
      .from("crm_contact_points")
      .select("contact_id,identifier,is_primary")
      .eq("organization_id", org)
      .eq("channel_type", "whatsapp")
      .in("contact_id", contacts.map((c) => c.id))
      .order("is_primary", { ascending: false }),
  );
  return contacts
    .map((c) => ({ id: c.id, name: c.display_name ?? c.full_name ?? null, phone: points.find((p) => p.contact_id === c.id)?.identifier?.split("@")[0] ?? null }))
    .filter((c) => c.phone);
}
