import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || `org-${Date.now()}`;
}

export const createOrganization = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().min(1).max(120),
      slug: z.string().min(1).max(60).optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    let slug = data.slug ? slugify(data.slug) : slugify(data.name);
    // ensure unique
    for (let i = 0; i < 5; i++) {
      const { data: existing } = await db.from("organizations").select("id").eq("slug", slug).maybeSingle();
      if (!existing) break;
      slug = `${slug}-${Math.floor(Math.random() * 1000)}`;
    }
    const { data: org, error } = await db.from("organizations").insert({ name: data.name, slug }).select().single();
    if (error) throw new Error(error.message);
    await db.from("platform_audit_log").insert({
      action: "organization.created",
      target_type: "organization",
      target_id: org.id,
      metadata: { name: data.name },
    });
    return org;
  });

export const listOrganizations = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: orgs, error } = await db
    .from("organizations")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const ids = (orgs ?? []).map((o: any) => o.id);
  const [subs, members] = await Promise.all([
    ids.length ? db.from("billing_subscriptions").select("organization_id, status, plan:billing_plans(name, code)").in("organization_id", ids) : { data: [] },
    ids.length ? db.from("org_memberships").select("organization_id").in("organization_id", ids).eq("is_active", true) : { data: [] },
  ]);

  const memberByOrg = new Map<string, number>();
  (members.data ?? []).forEach((m: any) => memberByOrg.set(m.organization_id, (memberByOrg.get(m.organization_id) ?? 0) + 1));
  const subByOrg = new Map<string, any>();
  (subs.data ?? []).forEach((s: any) => subByOrg.set(s.organization_id, s));

  return (orgs ?? []).map((o: any) => ({
    ...o,
    subscription: subByOrg.get(o.id) ?? null,
    member_count: memberByOrg.get(o.id) ?? 0,
  }));
});

export const getOrganizationDetails = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [org, sub, members, overrides, usage] = await Promise.all([
      db.from("organizations").select("*").eq("id", data.id).maybeSingle(),
      db.from("billing_subscriptions").select("*, plan:billing_plans(*)").eq("organization_id", data.id).maybeSingle(),
      db.from("org_memberships").select("*, profile:profiles(full_name)").eq("organization_id", data.id),
      db.from("billing_subscription_overrides").select("*").eq("organization_id", data.id),
      db.from("billing_usage_counters").select("*").eq("organization_id", data.id).order("period", { ascending: false }).limit(50),
    ]);
    return {
      organization: org.data,
      subscription: sub.data,
      members: members.data ?? [],
      overrides: overrides.data ?? [],
      usage: usage.data ?? [],
    };
  });

export const deleteOrganization = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("organizations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await db.from("platform_audit_log").insert({
      action: "organization.deleted",
      target_type: "organization",
      target_id: data.id,
    });
    return { ok: true };
  });
