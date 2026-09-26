// Welcome message handler — server-only.
// يستمع لأحداث تعيين Lead ويرسل رسالة ترحيب استناداً للقالب:
//   member override → department template → default fallback.
// Idempotent عبر welcome_sent_at في crm_lead_assignments.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as any;

const DEFAULT_TEMPLATE =
  "مرحباً {{contact_name}} 👋\nمعك {{agent_name}} من {{department_name}}. سأتابع طلبك معك.";

function render(tpl: string, ctx: Record<string, string>) {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => ctx[k] ?? "");
}

export interface DispatchWelcomeInput {
  organizationId: string;
  assignmentId: string;
  leadId: string;
  toUserId: string;
  sendingAccountId?: string | null;
  actorUserId?: string | null;
}

export interface DispatchWelcomeResult {
  ok: boolean;
  skipped?: string;
  sent?: boolean;
}

export async function dispatchWelcomeForAssignment(
  input: DispatchWelcomeInput,
): Promise<DispatchWelcomeResult> {
  // Idempotency check
  const { data: existing } = await db
    .from("crm_lead_assignments")
    .select("id, welcome_sent_at, department_id, opportunity_id")
    .eq("id", input.assignmentId)
    .maybeSingle();
  if (!existing) return { ok: false, skipped: "assignment_not_found" };
  if (existing.welcome_sent_at) return { ok: true, skipped: "already_sent" };

  // Fetch lead + contact
  const { data: lead } = await db
    .from("crm_leads")
    .select("id, contact_id, department_id")
    .eq("id", input.leadId)
    .maybeSingle();
  if (!lead) return { ok: false, skipped: "lead_not_found" };

  const departmentId = existing.department_id ?? lead.department_id;
  const [{ data: contact }, { data: dept }, { data: org }] = await Promise.all([
    db.from("crm_contacts").select("display_name, full_name").eq("id", lead.contact_id).maybeSingle(),
    departmentId
      ? db.from("org_departments").select("name, welcome_template").eq("id", departmentId).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("organizations").select("name").eq("id", input.organizationId).maybeSingle(),
  ]);

  // Resolve member (per-department membership) — may not exist
  let memberOverride: string | null = null;
  let agentDisplay: string | null = null;
  if (departmentId) {
    const { data: mem } = await db
      .from("org_department_members")
      .select("display_name, welcome_template_override, default_channel_account_id")
      .eq("organization_id", input.organizationId)
      .eq("department_id", departmentId)
      .eq("user_id", input.toUserId)
      .maybeSingle();
    memberOverride = mem?.welcome_template_override ?? null;
    agentDisplay = mem?.display_name ?? null;
  }
  if (!agentDisplay) {
    const { data: prof } = await db
      .from("profiles")
      .select("full_name")
      .eq("id", input.toUserId)
      .maybeSingle();
    agentDisplay = prof?.full_name ?? "المندوب";
  }

  const tpl = memberOverride || dept?.welcome_template || DEFAULT_TEMPLATE;
  const rendered = render(tpl, {
    contact_name: contact?.display_name ?? contact?.full_name ?? "عزيزي",
    agent_name: agentDisplay ?? "المندوب",
    department_name: dept?.name ?? "فريق المبيعات",
    org_name: org?.name ?? "",
  });

  // Resolve sending account (explicit → member default → agent account → department account)
  let sendingAccountId = input.sendingAccountId ?? null;
  if (!sendingAccountId && departmentId) {
    const { data: mem } = await db
      .from("org_department_members")
      .select("default_channel_account_id")
      .eq("organization_id", input.organizationId)
      .eq("department_id", departmentId)
      .eq("user_id", input.toUserId)
      .maybeSingle();
    sendingAccountId = mem?.default_channel_account_id ?? null;
  }
  if (!sendingAccountId) {
    const { data: acc } = await db
      .from("msg_channel_accounts")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("owner_user_id", input.toUserId)
      .eq("status", "connected")
      .limit(1)
      .maybeSingle();
    sendingAccountId = acc?.id ?? null;
  }
  if (!sendingAccountId && departmentId) {
    const { data: link } = await db
      .from("msg_channel_account_departments")
      .select("account_id, msg_channel_accounts!inner(id, status)")
      .eq("department_id", departmentId)
      .eq("msg_channel_accounts.status", "connected")
      .limit(1)
      .maybeSingle();
    sendingAccountId = (link as any)?.account_id ?? null;
  }
  if (!sendingAccountId) {
    const { data: mem } = await db
      .from("org_department_members")
      .select("default_channel_account_id")
      .eq("organization_id", input.organizationId)
      .eq("user_id", input.toUserId)
      .eq("is_active", true)
      .not("default_channel_account_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (mem?.default_channel_account_id) {
      const { data: acc } = await db
        .from("msg_channel_accounts")
        .select("id")
        .eq("id", mem.default_channel_account_id)
        .eq("organization_id", input.organizationId)
        .eq("status", "connected")
        .maybeSingle();
      sendingAccountId = acc?.id ?? null;
    }
  }
  if (!sendingAccountId) {
    const { data: acc } = await db
      .from("msg_channel_accounts")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("status", "connected")
      .limit(1)
      .maybeSingle();
    sendingAccountId = acc?.id ?? null;
  }
  if (!sendingAccountId) {
    console.warn("[welcome] no_sending_account", { assignmentId: input.assignmentId, departmentId, toUserId: input.toUserId });
    return { ok: false, skipped: "no_sending_account" };
  }

  // Risk layer: a fresh number sending an automatic cold greeting is the single
  // riskiest pattern for WhatsApp restrictions — skip it during observation and
  // ask the agent to greet manually instead.
  const risk = await import("@/modules/risk/risk.server");
  const guard = await risk.riskGuard({
    orgId: input.organizationId,
    accountId: sendingAccountId,
    source: "welcome",
    isNewConversation: true,
  });
  if (!guard.allowed) {
    await db.from("notif_events").insert({
      organization_id: input.organizationId,
      recipient_user_id: input.toUserId,
      event_type: "risk.welcome_skipped",
      title: "لم تُرسل رسالة الترحيب تلقائياً",
      body: guard.message ?? "الرقم تحت الحماية — رجاءً ابدأ المحادثة يدوياً.",
      link: existing.opportunity_id ? `/chat?opportunity=${existing.opportunity_id}` : "/pipeline",
      payload: { reason: guard.reason ?? "risk_blocked", account_id: sendingAccountId },
    });
    return { ok: true, sent: false, skipped: guard.reason ?? "risk_blocked" };
  }

  // Delegate to messaging (provider-agnostic wrapper still uses Evolution today).
  const { sendWelcomeMessage } = await import("@/modules/messaging/welcome-send.server");
  const result = await sendWelcomeMessage({
    organizationId: input.organizationId,
    opportunityId: existing.opportunity_id ?? lead.id, // fallback for session link
    contactId: lead.contact_id,
    sendingAccountId,
    renderedText: rendered,
    sentByUserId: input.toUserId,
  });
  if (result.sent) {
    await risk.recordOutbound({
      orgId: input.organizationId,
      accountId: sendingAccountId,
      isNewConversation: true,
    });
  }

  // Mark sent (best-effort — we mark even if actual send failed to avoid retries).
  await db
    .from("crm_lead_assignments")
    .update({ welcome_sent_at: new Date().toISOString() })
    .eq("id", input.assignmentId);

  return { ok: true, sent: result.sent };

}
