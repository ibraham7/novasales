/**
 * Everything an automatic message needs to know about who it goes to: the customer, their number and address, the
 * ticket's stage and owner, and which WhatsApp number the conversation is on. Read-only; the database is a
 * parameter. Every query is limited to the organization.
 */
import { first, type Vars } from "./template.ts";

export type MessageContext = {
  contactId: string | null;
  opportunityId: string | null;
  ownerId: string | null;
  phone: string | null;
  email: string | null;
  vars: Vars;
  /** The WhatsApp account of the ticket's own chat (the newest one that is connected). */
  ticketAccountId: string | null;
  /** A connected WhatsApp account of the ticket's owner. */
  ownerAccountId: string | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const digitsOf = (v: string) => v.replace(/\D/g, "");

/** A dialable WhatsApp number: plain digits, no jid suffix or internal id. */
export function dialable(identifier: string | null | undefined): string | null {
  const raw = String(identifier ?? "").trim();
  if (!raw || /[@a-zA-Z]/.test(raw)) return null;
  const d = digitsOf(raw);
  return d.length >= 7 && d.length <= 15 ? d : null;
}

const money = (value: unknown, currency: unknown): string | null => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n)} ${str(currency) ?? "USD"}`;
};

export async function loadMessageContext(db: any, organizationId: string, trigger: Record<string, unknown>, config: Record<string, unknown>): Promise<MessageContext> {
  const one = async (table: string, id: string | null, columns: string) => {
    if (!id) return null;
    const { data } = await db.from(table).select(columns).eq("id", id).eq("organization_id", organizationId).maybeSingle();
    return data ?? null;
  };
  // A ticket id from another organization (or a made-up one) is not found, so nothing about it is used.
  const opp = await one("opp_opportunities", str(config.opportunity_id) ?? str(trigger.opportunity_id), "id,contact_id,owner_agent_id,stage_id,source,value,currency");
  const opportunityId: string | null = opp?.id ?? null;
  // Stages belong to an organization through their pipeline (the stage table has no organization column).
  const stageOf = async (id: string | null) => {
    if (!id) return null;
    const { data } = await db.from("crm_pipeline_stages").select("id,name,crm_pipelines!inner(organization_id)").eq("id", id).eq("crm_pipelines.organization_id", organizationId).maybeSingle();
    return data ?? null;
  };
  const lead = await one("crm_leads", str(trigger.lead_id), "id,contact_id,owner_user_id");
  const contactId = str(config.contact_id) ?? str(trigger.contact_id) ?? str(opp?.contact_id) ?? str(lead?.contact_id);
  const ownerId = str(trigger.to_user_id) ?? str(trigger.owner_user_id) ?? str(opp?.owner_agent_id) ?? str(lead?.owner_user_id);

  const [contact, stage, owner, org, points] = await Promise.all([
    one("crm_contacts", contactId, "id,display_name,full_name"),
    str(trigger.to_stage_name) ? Promise.resolve({ name: str(trigger.to_stage_name) }) : stageOf(str(opp?.stage_id)),
    (async () => (ownerId ? (await db.from("profiles").select("full_name").eq("id", ownerId).maybeSingle()).data ?? null : null))(),
    (async () => (await db.from("organizations").select("name").eq("id", organizationId).maybeSingle()).data ?? null)(),
    (async () => (contactId ? (await db.from("crm_contact_points").select("channel_type,identifier,is_primary").eq("organization_id", organizationId).eq("contact_id", contactId)).data ?? [] : []))(),
  ]);

  const byPrimary = (a: any, b: any) => Number(b.is_primary === true) - Number(a.is_primary === true);
  const phone = (points as any[]).filter((p) => p.channel_type === "whatsapp").sort(byPrimary).map((p) => dialable(p.identifier)).find(Boolean) ?? null;
  const email = (points as any[]).filter((p) => p.channel_type === "email").sort(byPrimary).map((p) => str(p.identifier)).find(Boolean) ?? null;
  const name = str(contact?.display_name) ?? str(contact?.full_name);

  // WhatsApp numbers: the one the customer is chatting on, and one belonging to the ticket's owner.
  let ticketAccountId: string | null = null;
  if (opportunityId) {
    const { data: links } = await db.from("crm_opportunity_sessions").select("session_ref").eq("organization_id", organizationId).eq("opportunity_id", opportunityId).limit(20);
    const sessionIds = (links ?? []).map((l: any) => l.session_ref);
    if (sessionIds.length) {
      const { data: sessions } = await db.from("msg_sessions").select("id,channel_account_id,last_message_at").eq("organization_id", organizationId).in("id", sessionIds);
      const newest = [...(sessions ?? [])].sort((a: any, b: any) => String(b.last_message_at ?? "").localeCompare(String(a.last_message_at ?? "")));
      for (const s of newest) {
        if (!s.channel_account_id) continue;
        const { data: acc } = await db.from("msg_channel_accounts").select("id,status").eq("id", s.channel_account_id).eq("organization_id", organizationId).maybeSingle();
        if (acc?.status === "connected") { ticketAccountId = acc.id; break; }
      }
    }
  }
  let ownerAccountId: string | null = null;
  if (ownerId) {
    const { data: acc } = await db.from("msg_channel_accounts").select("id").eq("organization_id", organizationId).eq("owner_user_id", ownerId).eq("status", "connected").limit(1);
    ownerAccountId = acc?.[0]?.id ?? null;
  }

  return {
    contactId, opportunityId, ownerId, phone, email, ticketAccountId, ownerAccountId,
    vars: {
      name: name ?? "", first_name: first(name), phone: phone ?? "", stage: str(stage?.name) ?? "", assignee: str(owner?.full_name) ?? "",
      source: str(trigger.source) ?? str(opp?.source) ?? "", org: str(org?.name) ?? "", value: money(opp?.value, opp?.currency) ?? "",
      due_today: trigger.tasks_due_today != null ? String(trigger.tasks_due_today) : "", overdue: trigger.tasks_overdue != null ? String(trigger.tasks_overdue) : "", account: str(trigger.account_name) ?? "",
    },
  };
}

/** Which WhatsApp account sends: the ticket's own chat (default), the owner's number, or one named in the step. */
export function pickWhatsappAccount(mode: unknown, ctx: Pick<MessageContext, "ticketAccountId" | "ownerAccountId">, explicitId?: string | null): string | null {
  if (explicitId) return explicitId;
  if (mode === "owner") return ctx.ownerAccountId ?? ctx.ticketAccountId;
  return ctx.ticketAccountId ?? ctx.ownerAccountId;
}
