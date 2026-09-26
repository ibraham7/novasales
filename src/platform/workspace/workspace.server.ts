import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getRequest } from "@tanstack/react-start/server";

export const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
export const WHATSAPP_CHANNEL_ID = "a103f9f7-e070-4e8d-8463-55c34c1659d1";

const tokenCache = new Map<string, { userId: string; orgId: string; exp: number }>();

async function resolveFromToken(token: string): Promise<{ userId: string; organizationId: string }> {
  const cached = tokenCache.get(token);
  if (cached && cached.exp > Date.now()) {
    return { userId: cached.userId, organizationId: cached.orgId };
  }
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) throw new Error("Unauthorized: invalid session");
  const userId = data.user.id;

  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("active_organization_id")
    .eq("id", userId)
    .maybeSingle();
  let orgId = (prof as any)?.active_organization_id as string | null;

  let activeMembership = null as { organization_id: string } | null;
  if (orgId) {
    const { data: mem } = await supabaseAdmin
      .from("org_memberships")
      .select("organization_id")
      .eq("user_id", userId)
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .maybeSingle();
    activeMembership = mem as { organization_id: string } | null;
  }

  if (!activeMembership) {
    const { data: mem } = await supabaseAdmin
      .from("org_memberships")
      .select("organization_id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    orgId = (mem as any)?.organization_id ?? null;
    if (!orgId) {
      // Auto-provision membership in the default org (direct-workspace mode).
      orgId = DEFAULT_ORG_ID;
      await supabaseAdmin
        .from("org_memberships")
        .upsert(
          { user_id: userId, organization_id: orgId, is_active: true },
          { onConflict: "user_id,organization_id" },
        );
    }
    await supabaseAdmin.from("profiles").upsert({ id: userId, active_organization_id: orgId }, { onConflict: "id" });
  }

  tokenCache.set(token, { userId, orgId: orgId!, exp: Date.now() + 600_000 });
  return { userId, organizationId: orgId! };
}

export async function getWorkspace() {
  const request = getRequest();
  const authHeader = request?.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) throw new Error("Unauthorized: sign in required");
  const { userId, organizationId } = await resolveFromToken(token);
  return { userId, organizationId, whatsappChannelId: WHATSAPP_CHANNEL_ID };
}

// System-level (webhooks, jobs) — no user context.
export function getSystemWorkspace(organizationId: string = DEFAULT_ORG_ID) {
  return { userId: null as string | null, organizationId, whatsappChannelId: WHATSAPP_CHANNEL_ID };
}

export { supabaseAdmin };
