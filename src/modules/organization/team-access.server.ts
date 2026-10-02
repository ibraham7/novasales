import { requireAnyPermission } from "@/platform/rbac/rbac.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
export async function teamAccess(write = false) {
  const access = await requireAnyPermission(
    write
      ? ["department.manage", "org.manage"]
      : ["departments:read", "department.manage", "org.manage"],
  );
  return { access, organizationId: access.organizationId, db: supabaseAdmin as any };
}
export async function teamRow(query: any, label: string) {
  const { data, error } = await query;
  if (error) throw new Error(`تعذر ${label}؛ أعد المحاولة`);
  if (!data) throw new Error("السجل غير موجود أو لا يتبع مؤسستك");
  return data;
}
export async function ownDepartment(db: any, id: string, org: string) {
  return teamRow(
    db.from("org_departments").select("*").eq("id", id).eq("organization_id", org).maybeSingle(),
    "تحميل القسم",
  );
}
export async function ownAccount(db: any, id: string, org: string) {
  return teamRow(
    db
      .from("msg_channel_accounts")
      .select("id")
      .eq("id", id)
      .eq("organization_id", org)
      .maybeSingle(),
    "تحميل رقم واتساب",
  );
}
export async function supervisorRole(db: any, user: string, org: string, dept: string) {
  const { data: roles, error } = await db
    .from("rbac_roles")
    .select("id,key")
    .eq("organization_id", org)
    .in("key", ["owner", "supervisor", "department_supervisor"]);
  if (error) throw new Error("تعذر التحقق من صلاحيات المشرف");
  const ids = (roles ?? []).map((r: any) => r.id);
  if (!ids.length) throw new Error("عيّن للمستخدم دور مشرف من صفحة المستخدمين أولًا");
  const { data: links, error: linkError } = await db
    .from("rbac_user_roles")
    .select("role_id,scope_department_id")
    .eq("organization_id", org)
    .eq("user_id", user)
    .in("role_id", ids);
  if (linkError) throw new Error("تعذر التحقق من صلاحيات المشرف");
  if (!(links ?? []).some((r: any) => !r.scope_department_id || r.scope_department_id === dept))
    throw new Error("عيّن للمستخدم دور مشرف لهذا القسم من صفحة المستخدمين أولًا");
}
