export const FUNNEL_STAGES = ["lead", "qualified", "customer", "returning_customer", "churned"] as const;

export function normalizePhone(p: string) {
  return p.replace(/\D/g, "");
}

export async function shapeContact(orgId: string, contact: any, adminDb: any) {
  const { data: points } = await adminDb
    .from("crm_contact_points")
    .select("identifier, is_primary, channel_type")
    .eq("organization_id", orgId)
    .eq("contact_id", contact.id)
    .eq("channel_type", "whatsapp");
  const primary = (points ?? []).find((p: any) => p.is_primary) ?? (points ?? [])[0];
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
