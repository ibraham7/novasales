import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

const ScopeSchema = z.array(z.string().max(60)).max(30);

export const listApiKeys = createServerFn({ method: "GET" }).handler(async () => {
  const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
  const { organizationId } = await getWorkspace();
  const { data, error } = await (supabaseAdmin as any)
    .from("integ_api_keys")
    .select("id, name, key_prefix, scopes, created_at, last_used_at, expires_at, revoked_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const createApiKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().trim().min(1).max(120),
      scopes: ScopeSchema.default(["leads:read", "opportunities:read", "contacts:read"]),
      expiresInDays: z.number().int().positive().max(3650).nullable().default(null),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { generateApiKey } = await import("./api-keys.server");
    const { organizationId, userId } = await getWorkspace();
    const { fullKey, prefix, hash } = generateApiKey();
    const expiresAt = data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 86400_000).toISOString()
      : null;
    const { data: row, error } = await (supabaseAdmin as any)
      .from("integ_api_keys")
      .insert({
        organization_id: organizationId,
        name: data.name,
        key_prefix: prefix,
        key_hash: hash,
        scopes: data.scopes,
        expires_at: expiresAt,
        created_by: userId,
      })
      .select("id, name, key_prefix, scopes, expires_at")
      .single();
    if (error) throw new Error(error.message);
    // fullKey is returned ONCE — the caller must copy it now.
    return { ...row, key: fullKey };
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { organizationId } = await getWorkspace();
    const { error } = await (supabaseAdmin as any)
      .from("integ_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteApiKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { getWorkspace, supabaseAdmin } = await import("@/platform/workspace/workspace.server");
    const { organizationId } = await getWorkspace();
    const { error } = await (supabaseAdmin as any)
      .from("integ_api_keys")
      .delete()
      .eq("id", data.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
