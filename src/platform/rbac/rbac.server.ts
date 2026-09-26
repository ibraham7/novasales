import { getWorkspace } from "@/platform/workspace/workspace.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type WorkspaceAccess = {
  userId: string;
  organizationId: string;
  permissions: string[];
  roleKeys: string[];
  departmentIds: string[];
  isSuperAdmin: boolean;
};

/**
 * Check if the current workspace user has a permission in their active org.
 * Throws if not permitted.
 */
export async function requirePermission(permission: string): Promise<{ userId: string; organizationId: string }> {
  const { userId, organizationId } = await getWorkspace();
  const db = supabaseAdmin as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null; error: { message: string } | null }>;
  };
  const { data, error } = await db.rpc("has_permission", {
    _user_id: userId,
    _org_id: organizationId,
    _permission: permission,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Forbidden: missing permission "${permission}"`);
  return { userId, organizationId };
}

export async function requireAnyPermission(permissions: string[]): Promise<WorkspaceAccess> {
  const access = await getWorkspaceAccess();
  if (access.isSuperAdmin || permissions.some((permission) => access.permissions.includes(permission))) return access;
  throw new Error(`Forbidden: missing permission "${permissions.join(" or ")}"`);
}

/**
 * Get all permission keys granted to the current workspace user in their active org.
 */
export async function getMyPermissions(): Promise<string[]> {
  const access = await getWorkspaceAccess();
  return access.permissions;
}

export async function getWorkspaceAccess(): Promise<WorkspaceAccess> {
  const { userId, organizationId } = await getWorkspace();
  const db = supabaseAdmin as any;
  const { data, error } = await db.rpc("get_workspace_access_fast", {
    _user_id: userId,
    _organization_id: organizationId,
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as {
    permissions?: string[];
    roleKeys?: string[];
    departmentIds?: string[];
    isSuperAdmin?: boolean;
  };

  return {
    userId,
    organizationId,
    permissions: result.permissions ?? [],
    roleKeys: result.roleKeys ?? [],
    departmentIds: result.departmentIds ?? [],
    isSuperAdmin: result.isSuperAdmin === true,
  };
}
