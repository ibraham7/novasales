import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWorkspace } from "@/platform/workspace/workspace.server";

const db = supabaseAdmin as any;

export type Subscription = {
  id: string;
  organization_id: string;
  plan_id: string;
  status: string;
  billing_period: string;
  trial_ends_at: string | null;
  current_period_start: string;
  current_period_end: string | null;
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  canceled_at: string | null;
  cancel_at_period_end: boolean;
  plan?: any;
};

export async function getSubscription(organizationId?: string): Promise<Subscription | null> {
  const orgId = organizationId ?? (await getWorkspace()).organizationId;
  const { data, error } = await db
    .from("billing_subscriptions")
    .select("*, plan:billing_plans(*)")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function getEffectiveFeatures(organizationId?: string): Promise<Record<string, boolean>> {
  const orgId = organizationId ?? (await getWorkspace()).organizationId;
  const { data, error } = await db.rpc("billing_get_effective_features", { _org_id: orgId });
  if (error) throw new Error(error.message);
  const map: Record<string, boolean> = {};
  (data ?? []).forEach((r: any) => {
    map[r.feature_key] = !!r.is_enabled;
  });
  return map;
}

export async function getEffectiveLimits(organizationId?: string): Promise<Record<string, number>> {
  const orgId = organizationId ?? (await getWorkspace()).organizationId;
  const { data, error } = await db.rpc("billing_get_effective_limits", { _org_id: orgId });
  if (error) throw new Error(error.message);
  const map: Record<string, number> = {};
  (data ?? []).forEach((r: any) => {
    map[r.limit_key] = Number(r.limit_value);
  });
  return map;
}

export async function hasFeature(featureKey: string, organizationId?: string): Promise<boolean> {
  const features = await getEffectiveFeatures(organizationId);
  return features[featureKey] === true;
}

export async function getCurrentUsage(organizationId?: string): Promise<Record<string, number>> {
  const orgId = organizationId ?? (await getWorkspace()).organizationId;
  const period = new Date().toISOString().slice(0, 7);

  const [seats, wa, messages, leads, opps, contacts, wfs, cmps] = await Promise.all([
    db.from("org_memberships").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_active", true),
    db.from("msg_channel_accounts").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    db.from("billing_usage_counters").select("value").eq("organization_id", orgId).eq("period", period),
    db.from("crm_leads").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    db.from("opp_opportunities").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    db.from("crm_contacts").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    db.from("wf_workflows").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_active", true),
    db.from("cmp_campaigns").select("id", { count: "exact", head: true }).eq("organization_id", orgId).in("status", ["scheduled", "running"]),
  ]);

  const messagesTotal = (messages.data ?? []).reduce((a: number, r: any) => a + Number(r.value ?? 0), 0);

  return {
    seats: seats.count ?? 0,
    whatsapp_accounts: wa.count ?? 0,
    monthly_messages: messagesTotal,
    leads: leads.count ?? 0,
    opportunities: opps.count ?? 0,
    contacts: contacts.count ?? 0,
    active_workflows: wfs.count ?? 0,
    active_campaigns: cmps.count ?? 0,
    storage_mb: 0,
  };
}
