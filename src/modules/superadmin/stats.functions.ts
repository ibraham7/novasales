import { createServerFn } from "@tanstack/react-start";

export const getPlatformStats = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  const [orgs, users, subs, invoicesPaid, messages, contacts, wa, activeWfs] = await Promise.all([
    db.from("organizations").select("id", { count: "exact", head: true }),
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("billing_subscriptions").select("status, plan_id, billing_period, plan:billing_plans(price_monthly)"),
    db.from("billing_invoices").select("amount, currency").eq("status", "paid"),
    db.from("msg_messages").select("id", { count: "exact", head: true }),
    db.from("crm_contacts").select("id", { count: "exact", head: true }),
    db.from("msg_channel_accounts").select("id", { count: "exact", head: true }),
    db.from("wf_workflows").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);

  const subList = (subs.data ?? []) as any[];
  const activeSubs = subList.filter((s) => s.status === "active" || s.status === "trialing").length;
  const trialing = subList.filter((s) => s.status === "trialing").length;
  const canceled = subList.filter((s) => s.status === "canceled").length;

  const mrr = subList
    .filter((s) => s.status === "active")
    .reduce((acc, s) => acc + Number(s.plan?.price_monthly ?? 0), 0);

  const revenueTotal = (invoicesPaid.data ?? []).reduce((a: number, r: any) => a + Number(r.amount ?? 0), 0);

  return {
    organizations: orgs.count ?? 0,
    users: users.count ?? 0,
    activeSubscriptions: activeSubs,
    trialingSubscriptions: trialing,
    canceledSubscriptions: canceled,
    mrr,
    revenueTotal,
    messages: messages.count ?? 0,
    contacts: contacts.count ?? 0,
    whatsappAccounts: wa.count ?? 0,
    activeWorkflows: activeWfs.count ?? 0,
  };
});

export const getRevenueChart = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const since = new Date();
  since.setMonth(since.getMonth() - 11);
  const { data } = await db
    .from("billing_invoices")
    .select("amount, paid_at")
    .eq("status", "paid")
    .gte("paid_at", since.toISOString());
  const buckets = new Map<string, number>();
  (data ?? []).forEach((r: any) => {
    const key = String(r.paid_at ?? "").slice(0, 7);
    if (!key) return;
    buckets.set(key, (buckets.get(key) ?? 0) + Number(r.amount ?? 0));
  });
  return Array.from(buckets.entries()).sort().map(([month, revenue]) => ({ month, revenue }));
});
