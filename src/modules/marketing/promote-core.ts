/**
 * Moving a discovered business to the CRM as a lead («عميل محتمل»). The lead is created by the
 * CRM's own function (passed in), so its permissions, timeline and rules all apply.
 */
import { blockedPhones } from "./outbound-core.ts";

export const PROMOTABLE_STATUSES = ["approved", "contacted", "replied", "interested"];
export const LEAD_SOURCE = "التسويق";

export type PromoteResult = { promoted: number; linked: number; already: number; blocked: number; noPhone: number; notReady: number; failed: { name: string; error: string }[] };

type SaveLead = (input: Record<string, unknown>) => Promise<{ id?: string; contact_id?: string } | null | undefined>;

const isMissing = (error: any) => ["PGRST205", "42P01", "42703"].includes(error?.code);

function leadNotes(p: any): string {
  const lines = [`من التسويق${p.category ? ` · ${p.category}` : ""}`];
  if (p.address) lines.push(`العنوان: ${p.address}`);
  if (p.website) lines.push(`الموقع: ${p.website}`);
  if (p.emails?.length) lines.push(`البريد: ${p.emails.join("، ")}`);
  for (const s of Object.entries(p.socials ?? {})) lines.push(`${s[0]}: ${s[1]}`);
  if (p.site_whatsapp) lines.push(`واتساب الموقع: ${p.site_whatsapp}`);
  return lines.join("\n").slice(0, 1900);
}

export async function promoteProspects(db: any, organizationId: string, ids: string[], saveLead: SaveLead): Promise<PromoteResult> {
  const result: PromoteResult = { promoted: 0, linked: 0, already: 0, blocked: 0, noPhone: 0, notReady: 0, failed: [] };
  const { data, error } = await db
    .from("ob_prospects")
    .select("id,name,category,address,website,phone_e164,emails,socials,site_whatsapp,status,promoted_contact_id")
    .eq("organization_id", organizationId)
    .in("id", [...new Set(ids)]);
  if (error) throw new Error(error.message);
  const rows: any[] = data ?? [];
  const blocked = await blockedPhones(db, organizationId, rows.map((r) => r.phone_e164 ?? ""));

  for (const p of rows) {
    if (p.status === "opted_out" || (p.phone_e164 && blocked.has(p.phone_e164))) { result.blocked++; continue; }
    if (p.promoted_contact_id || p.status === "converted") { result.already++; continue; }
    if (!PROMOTABLE_STATUSES.includes(p.status)) { result.notReady++; continue; }
    if (!p.phone_e164) { result.noPhone++; continue; }
    try {
      // The same number may already be a CRM contact: link to it instead of making a copy.
      const { data: points, error: pointError } = await db
        .from("crm_contact_points")
        .select("contact_id")
        .eq("organization_id", organizationId)
        .in("identifier", [p.phone_e164, `+${p.phone_e164}`])
        .limit(1);
      if (pointError && !isMissing(pointError)) throw new Error(pointError.message);
      const existing: string | undefined = points?.[0]?.contact_id;
      let contactId = existing;
      if (existing) {
        const { data: leads } = await db.from("crm_leads").select("id").eq("organization_id", organizationId).eq("contact_id", existing).limit(1);
        if (!leads?.length) await saveLead({ contactId: existing, source: LEAD_SOURCE, status: "new", notes: leadNotes(p) });
        result.linked++;
      } else {
        const lead = await saveLead({ contactName: p.name, phone: p.phone_e164, email: p.emails?.[0] ?? "", source: LEAD_SOURCE, status: "new", notes: leadNotes(p) });
        contactId = lead?.contact_id;
        result.promoted++;
      }
      await db
        .from("ob_prospects")
        .update({ status: "converted", promoted_contact_id: contactId ?? null, updated_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .eq("id", p.id);
    } catch (e) {
      result.failed.push({ name: p.name, error: e instanceof Error ? e.message : "تعذر النقل" });
    }
  }
  return result;
}
