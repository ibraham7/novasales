import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isEmailAllowed } from "./gate";

const cache = new Map<string, { allowed: boolean; expires: number }>();
const CACHE_MS = 60_000;

/** Whether this user may use the marketing page. The email comes from the auth service, never from the browser. */
export async function canUseMarketing(userId: string): Promise<boolean> {
  const list = process.env.MARKETING_ALLOWED_EMAILS;
  if (!list?.trim()) return false;
  const key = `${userId}|${list}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.allowed;
  const { data, error } = await (supabaseAdmin as any).auth.admin.getUserById(userId);
  if (error) throw new Error(error.message);
  const allowed = isEmailAllowed(data?.user?.email, list);
  cache.set(key, { allowed, expires: Date.now() + CACHE_MS });
  return allowed;
}

export async function assertMarketingUser(userId: string): Promise<void> {
  if (!(await canUseMarketing(userId))) throw new Error("Forbidden: صفحة التسويق غير متاحة لحسابك حالياً");
}
