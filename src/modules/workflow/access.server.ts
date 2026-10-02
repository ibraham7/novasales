import { requireAnyPermission } from "@/platform/rbac/rbac.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
export async function workflowAccess(write = false) {
  const access = await requireAnyPermission(
    write ? ["wf.workflows.manage"] : ["automation.view", "wf.workflows.manage"],
  );
  return {
    access,
    organizationId: access.organizationId,
    db: supabaseAdmin as any,
    canManage: access.isSuperAdmin || access.permissions.includes("wf.workflows.manage"),
  };
}
export async function ownWorkflow(db: any, id: string, org: string) {
  const { data, error } = await db
    .from("wf_workflows")
    .select("*")
    .eq("id", id)
    .eq("organization_id", org)
    .maybeSingle();
  if (error) throw new Error("تعذر تحميل الأتمتة؛ أعد المحاولة");
  if (!data) throw new Error("الأتمتة غير موجودة أو لا تتبع مؤسستك");
  return data;
}
