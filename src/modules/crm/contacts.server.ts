import type { WorkspaceAccess } from "@/platform/rbac/rbac.server";

export const FUNNEL_STAGES = ["lead", "qualified", "customer", "returning_customer", "churned"] as const;

export function normalizePhone(p: string) {
  return p.replace(/\D/g, "");
}

// PostgREST puts `.in()` lists in the URL, so long id lists are read in chunks.
const ID_CHUNK = 150;
function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += ID_CHUNK) out.push(items.slice(i, i + ID_CHUNK));
  return out;
}

/**
 * Contacts follow chat visibility: owners, admins and supervisors see every contact (null);
 * everyone else sees the contacts of the opportunities in their scope, plus contacts they added.
 */
export async function visibleContactIds(db: any, access: WorkspaceAccess): Promise<string[] | null> {
  const { getOpportunityVisibility, applyOpportunityScope } = await import("@/platform/rbac/data-scope.server");
  if (getOpportunityVisibility(access) === "all") return null;
  const oppQuery = applyOpportunityScope(
    db
      .from("opp_opportunities")
      .select("contact_id")
      .eq("organization_id", access.organizationId)
      .is("deleted_at", null)
      .not("contact_id", "is", null)
      .limit(10000),
    access,
  );
  const [opps, added] = await Promise.all([
    oppQuery ?? Promise.resolve({ data: [], error: null }),
    db
      .from("crm_contacts")
      .select("id")
      .eq("organization_id", access.organizationId)
      .eq("custom_fields->>created_by", access.userId)
      .limit(10000),
  ]);
  if (opps.error) throw new Error(opps.error.message);
  if (added.error) throw new Error(added.error.message);
  return Array.from(
    new Set<string>([
      ...(opps.data ?? []).map((r: any) => r.contact_id),
      ...(added.data ?? []).map((r: any) => r.id),
    ]),
  );
}

export async function assertContactVisible(db: any, access: WorkspaceAccess, contactId: string) {
  const visible = await visibleContactIds(db, access);
  if (visible && !visible.includes(contactId)) throw new Error("جهة الاتصال غير موجودة أو غير مسموح بتعديلها");
}

/** Reads contacts by id in chunks, newest first. */
export async function contactsByIds(db: any, orgId: string, ids: string[], limit: number) {
  const results = await Promise.all(
    chunks(ids).map((part) => db.from("crm_contacts").select("*").eq("organization_id", orgId).in("id", part)),
  );
  const rows: any[] = [];
  for (const r of results) {
    if (r.error) throw new Error(r.error.message);
    rows.push(...(r.data ?? []));
  }
  return rows
    .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))
    .slice(0, limit);
}

function shapeRow(contact: any, points: any[]) {
  const primary = points.find((p: any) => p.is_primary) ?? points[0];
  return {
    id: contact.id,
    name: contact.display_name ?? contact.full_name ?? null,
    phone: primary?.identifier ?? "",
    funnel_stage: contact.lifecycle_stage ?? "lead",
    notes: contact.notes ?? null,
    is_group: false,
    avatar_url: null,
    created_at: contact.created_at,
    updated_at: contact.updated_at,
    instance_id: null,
  };
}

export async function shapeContact(orgId: string, contact: any, adminDb: any) {
  const { data: points } = await adminDb
    .from("crm_contact_points")
    .select("identifier, is_primary, channel_type")
    .eq("organization_id", orgId)
    .eq("contact_id", contact.id)
    .eq("channel_type", "whatsapp");
  return shapeRow(contact, points ?? []);
}

/** Shapes a list of contacts with one phone lookup per chunk instead of one per contact. */
export async function shapeContacts(orgId: string, contacts: any[], adminDb: any) {
  const results = await Promise.all(
    chunks(contacts.map((c) => c.id)).map((part) =>
      adminDb
        .from("crm_contact_points")
        .select("contact_id, identifier, is_primary, channel_type")
        .eq("organization_id", orgId)
        .eq("channel_type", "whatsapp")
        .in("contact_id", part),
    ),
  );
  const byContact = new Map<string, any[]>();
  for (const r of results) {
    for (const p of r.data ?? []) {
      const list = byContact.get(p.contact_id) ?? [];
      list.push(p);
      byContact.set(p.contact_id, list);
    }
  }
  return contacts.map((c) => shapeRow(c, byContact.get(c.id) ?? []));
}
