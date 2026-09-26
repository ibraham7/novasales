export async function shapeSessionRow(orgId: string, sess: any, db: any) {
  const { data: acc } = await db
    .from("msg_channel_accounts")
    .select("id, display_name, status")
    .eq("id", sess.channel_account_id)
    .maybeSingle();
  const { data: plugin } = sess.channel_account_id
    ? await db
        .from("plugin_whatsapp_evolution_instances")
        .select("phone_number")
        .eq("channel_account_id", sess.channel_account_id)
        .maybeSingle()
    : { data: null };
  const phone = String(sess.peer_identifier ?? "").split("@")[0];
  const { data: cp } = await db
    .from("crm_contact_points")
    .select("contact_id")
    .eq("organization_id", orgId)
    .eq("channel_type", "whatsapp")
    .eq("identifier", phone)
    .maybeSingle();
  let contact: any = null;
  let contactId: string | null = null;
  if (cp?.contact_id) {
    contactId = cp.contact_id;
    const { data: c } = await db
      .from("crm_contacts")
      .select("display_name, full_name, lifecycle_stage, notes")
      .eq("id", cp.contact_id)
      .maybeSingle();
    if (c) {
      contact = {
        name: c.display_name ?? c.full_name ?? null,
        phone,
        avatar_url: null,
        funnel_stage: c.lifecycle_stage,
        notes: c.notes,
      };
    }
  }
  return {
    id: sess.id,
    remote_jid: sess.peer_identifier,
    instance_id: sess.channel_account_id,
    contact_id: contactId,
    last_message_text: sess.last_message_preview,
    last_message_at: sess.last_message_at,
    unread_count: sess.unread_count ?? 0,
    created_at: sess.created_at,
    contact,
    instance: acc
      ? { name: plugin?.phone_number ? `+${plugin.phone_number}` : null, display_name: acc.display_name, status: acc.status }
      : null,
  };
}
