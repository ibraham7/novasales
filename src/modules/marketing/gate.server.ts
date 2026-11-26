import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emailRestrictionAllows, parseAllowedEmails } from "./gate";

const cache = new Map<string, { allowed: boolean; expires: number }>();
const CACHE_MS = 60_000;

/** The optional restriction by email (MARKETING_ALLOWED_EMAILS). Empty list: nobody is held back. The email comes from the auth service. */
export async function emailAllowsMarketing(userId: string): Promise<boolean> {
  const list = process.env.MARKETING_ALLOWED_EMAILS;
  if (parseAllowedEmails(list).size === 0) return true;
  const key = `${userId}|${list}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.allowed;
  const { data, error } = await (supabaseAdmin as any).auth.admin.getUserById(userId);
  if (error) throw new Error(error.message);
  const allowed = emailRestrictionAllows(data?.user?.email, list);
  cache.set(key, { allowed, expires: Date.now() + CACHE_MS });
  return allowed;
}

export async function assertMarketingUser(userId: string): Promise<void> {
  if (!(await emailAllowsMarketing(userId))) throw new Error("Forbidden: صفحة التسويق غير متاحة لحسابك حالياً");
}
