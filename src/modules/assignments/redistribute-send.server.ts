// Server-only: sends the queued «new agent» messages from each agent's own WhatsApp number.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runDueSends, type AgentInfo } from "./redistribute-send-core";

const db = supabaseAdmin as any;

async function connectedAccount(organizationId: string, userId: string): Promise<string | null> {
  const { data: own } = await db.from("msg_channel_accounts").select("id").eq("organization_id", organizationId).eq("owner_user_id", userId).eq("status", "connected").limit(1).maybeSingle();
  if (own?.id) return own.id;
  const { data: member } = await db.from("org_department_members").select("default_channel_account_id").eq("organization_id", organizationId).eq("user_id", userId).eq("is_active", true).not("default_channel_account_id", "is", null).limit(1).maybeSingle();
  if (!member?.default_channel_account_id) return null;
  const { data: acc } = await db.from("msg_channel_accounts").select("id").eq("id", member.default_channel_account_id).eq("organization_id", organizationId).eq("status", "connected").maybeSingle();
  return acc?.id ?? null;
}

async function agentInfo(organizationId: string, userId: string): Promise<AgentInfo> {
  const [{ data: profile }, { data: org }, { data: member }, accountId] = await Promise.all([
    db.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    db.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    db.from("org_department_members").select("display_name,org_departments(name)").eq("organization_id", organizationId).eq("user_id", userId).eq("is_active", true).limit(1).maybeSingle(),
    connectedAccount(organizationId, userId),
  ]);
  const dept = Array.isArray(member?.org_departments) ? member.org_departments[0] : member?.org_departments;
  return { name: member?.display_name || profile?.full_name || "المندوب", departmentName: dept?.name || "فريق المبيعات", orgName: org?.name ?? "", accountId };
}

export async function tickRedistributionSends(): Promise<{ processed: number }> {
  const { sendWelcomeMessage } = await import("@/modules/messaging/welcome-send.server");
  return runDueSends(db, {
    agent: agentInfo,
    contactName: async (organizationId, contactId) => {
      const { data } = await db.from("crm_contacts").select("display_name,full_name").eq("id", contactId).eq("organization_id", organizationId).maybeSingle();
      return data?.display_name || data?.full_name || "";
    },
    send: async ({ organizationId, opportunityId, contactId, accountId, text, userId }) => {
      const r = await sendWelcomeMessage({ organizationId, opportunityId, contactId, sendingAccountId: accountId, renderedText: text, sentByUserId: userId });
      return { sent: r.sent, reason: r.reason };
    },
  });
}
