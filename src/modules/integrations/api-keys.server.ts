// Server-only helpers for API key generation, hashing, and verification.
import { createHash, randomBytes } from "node:crypto";

const KEY_PREFIX = "wsk_"; // NovaSales Key

export function generateApiKey(): { fullKey: string; prefix: string; hash: string } {
  const raw = randomBytes(24).toString("hex"); // 48 chars
  const fullKey = KEY_PREFIX + raw;
  const prefix = fullKey.slice(0, 12); // wsk_ + 8 chars — safe to show
  const hash = createHash("sha256").update(fullKey).digest("hex");
  return { fullKey, prefix, hash };
}

export function hashApiKey(fullKey: string): string {
  return createHash("sha256").update(fullKey).digest("hex");
}

export interface ApiCaller {
  organizationId: string;
  apiKeyId: string;
  scopes: string[];
}

/** Verify an incoming Bearer token against integ_api_keys. Returns null when invalid. */
export async function verifyApiKey(bearer: string | null | undefined): Promise<ApiCaller | null> {
  if (!bearer) return null;
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : bearer.trim();
  if (!token.startsWith(KEY_PREFIX)) return null;
  const hash = hashApiKey(token);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any)
    .from("integ_api_keys")
    .select("id, organization_id, scopes, revoked_at, expires_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (!data) return null;
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  // best-effort touch last_used_at (fire and forget)
  void (supabaseAdmin as any).from("integ_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return {
    organizationId: data.organization_id,
    apiKeyId: data.id,
    scopes: data.scopes ?? [],
  };
}

export function hasScope(caller: ApiCaller, required: string): boolean {
  if (caller.scopes.includes("*")) return true;
  if (caller.scopes.includes(required)) return true;
  // wildcard on resource: "leads:*" grants "leads:read"
  const [resource] = required.split(":");
  return caller.scopes.includes(`${resource}:*`);
}
