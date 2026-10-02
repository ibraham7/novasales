import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

export const listMarketplaceApps = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { organizationId } = await getWorkspace();
  const [{ data: apps }, { data: installs }] = await Promise.all([
    (supabaseAdmin as any).from("integ_marketplace_apps").select("*").eq("status", "published").order("sort_order"),
    (supabaseAdmin as any).from("integ_marketplace_installs").select("app_id, is_active").eq("organization_id", organizationId),
  ]);
  const installMap = new Map((installs ?? []).map((i: any) => [i.app_id, i.is_active]));
  return (apps ?? []).map((a: any) => ({ ...a, installed: installMap.has(a.id), install_active: installMap.get(a.id) ?? false }));
});

export const installApp = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ appId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { organizationId, userId } = await getWorkspace();
    const { error } = await (supabaseAdmin as any)
      .from("integ_marketplace_installs")
      .upsert(
        { organization_id: organizationId, app_id: data.appId, installed_by: userId, is_active: true },
        { onConflict: "organization_id,app_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const uninstallApp = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ appId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { organizationId } = await getWorkspace();
    const { error } = await (supabaseAdmin as any)
      .from("integ_marketplace_installs")
      .delete()
      .eq("organization_id", organizationId)
      .eq("app_id", data.appId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
