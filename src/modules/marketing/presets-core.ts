/**
 * The ready-made filter templates are part of the app, but each organization may remove the ones it does
 * not want. Removing one only hides it for that organization; it can be restored. The database is passed
 * in, so this is tested without Supabase. Every query is tied to one organization.
 */
import { PRESETS } from "./filters.ts";

const known = (id: string) => PRESETS.some((preset) => preset.id === id);

/** The ids of the templates this organization has removed (ids that no longer exist are not listed). */
export async function listHiddenPresets(db: any, organizationId: string): Promise<string[]> {
  const { data, error } = await db.from("ob_hidden_presets").select("preset_id").eq("organization_id", organizationId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { preset_id: string }) => row.preset_id).filter(known);
}

export async function hidePreset(db: any, organizationId: string, userId: string, presetId: string): Promise<void> {
  if (!known(presetId)) throw new Error("القالب غير موجود");
  const { error } = await db
    .from("ob_hidden_presets")
    .upsert({ organization_id: organizationId, preset_id: presetId, hidden_by: userId }, { onConflict: "organization_id,preset_id", ignoreDuplicates: true });
  if (error) throw new Error("تعذر حذف القالب");
}

/** Brings back every template this organization removed. */
export async function restorePresets(db: any, organizationId: string): Promise<number> {
  const { data, error } = await db.from("ob_hidden_presets").delete().eq("organization_id", organizationId).select("preset_id");
  if (error) throw new Error("تعذر إرجاع القوالب");
  return (data ?? []).length;
}
