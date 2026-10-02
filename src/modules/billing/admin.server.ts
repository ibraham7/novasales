import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
export async function requireBillingAdmin() {
  const token = getRequest().headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("يرجى تسجيل الدخول أولًا");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) throw new Error("انتهت جلسة الدخول؛ سجل الدخول مجددًا");
  const { data: role, error: roleError } = await (supabaseAdmin as any).from("user_roles").select("role").eq("user_id", data.user.id).eq("role", "admin").maybeSingle();
  if (roleError || !role) throw new Error("هذه العملية تتطلب صلاحية السوبر أدمن");
}
