import { requireAnyPermission } from "@/platform/rbac/rbac.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
export async function campaignAccess(mode: "read" | "manage" | "send" = "read") {
  const access = await requireAnyPermission(
    mode === "read"
      ? ["cmp.campaigns.manage", "cmp.campaigns.send"]
      : [mode === "manage" ? "cmp.campaigns.manage" : "cmp.campaigns.send"],
  );
  return {
    access,
    organizationId: access.organizationId,
    db: supabaseAdmin as any,
    canManage: access.isSuperAdmin || access.permissions.includes("cmp.campaigns.manage"),
    canSend: access.isSuperAdmin || access.permissions.includes("cmp.campaigns.send"),
  };
}
export async function ownCampaign(db: any, id: string, org: string) {
  const { data, error } = await db
    .from("cmp_campaigns")
    .select("*")
    .eq("id", id)
    .eq("organization_id", org)
    .maybeSingle();
  if (error) throw new Error("تعذر تحميل الحملات؛ أعد المحاولة");
  if (!data) throw new Error("الحملة غير موجودة أو لا تتبع مؤسستك");
  return data;
}
export async function checked<T = any>(query: any): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error("تعذر حفظ أو تحميل بيانات الحملات؛ أعد المحاولة");
  return data as T;
}
export async function allRows(makeQuery: () => any) {
  const rows: any[] = [];
  for (let offset = 0; ;) {
    const page: any[] = await checked(makeQuery().range(offset, offset + 499));
    if (!page?.length) break;
    rows.push(...page);
    offset += page.length;
  }
  return rows;
}
