import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

export const getMyOrganization = createServerFn({ method: "GET" }).handler(async () => {
  const { requirePermission } = await import("@/platform/rbac/rbac.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { organizationId } = await requirePermission("org:read");
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("organizations")
    .select("id, name, slug, created_at, updated_at")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
});

export const updateOrganization = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().trim().min(1).max(120).optional(),
      slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9-]+$/).optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { requirePermission } = await import("@/platform/rbac/rbac.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { organizationId } = await requirePermission("org:update");
    const db = supabaseAdmin as any;
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.slug !== undefined) patch.slug = data.slug;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await db.from("organizations").update(patch).eq("id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
