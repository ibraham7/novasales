import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWorkspace } from "@/platform/workspace/workspace.server";

const db = supabaseAdmin as any;

export async function incrementCounter(counterKey: string, amount = 1, organizationId?: string): Promise<void> {
  const orgId = organizationId ?? (await getWorkspace()).organizationId;
  const period = new Date().toISOString().slice(0, 7);
  const { data: existing } = await db
    .from("billing_usage_counters")
    .select("value")
    .eq("organization_id", orgId)
    .eq("period", period)
    .eq("counter_key", counterKey)
    .maybeSingle();
  if (existing) {
    await db
      .from("billing_usage_counters")
      .update({ value: Number(existing.value) + amount, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("period", period)
      .eq("counter_key", counterKey);
  } else {
    await db.from("billing_usage_counters").insert({
      organization_id: orgId,
      period,
      counter_key: counterKey,
      value: amount,
    });
  }
}
