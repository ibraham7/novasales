import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWorkspace } from "@/platform/workspace/workspace.server";
export async function incrementCounter(counterKey: string, amount = 1, organizationId?: string) {
  const org = organizationId ?? (await getWorkspace()).organizationId;
  const { error } = await (supabaseAdmin as any).rpc("billing_increment_counter", {
    _org_id: org,
    _period: new Date().toISOString().slice(0, 7),
    _key: counterKey,
    _amount: amount,
  });
  if (error) throw new Error("تعذر تحديث عداد الاستخدام");
}
