import { DEFAULT_ORG_ID } from "@/platform/workspace/workspace.server";

/**
 * Gives an organization the standard roles (owner, supervisor, department supervisor, sales) with
 * the same permissions as the default organization, which serves as the template. Organizations
 * created from the admin panel used to start with no roles at all, so anyone added to them got no
 * permissions and saw "no access". Roles the organization already has are left as they are.
 */
export async function ensureOrgRoles(db: any, organizationId: string) {
  if (organizationId === DEFAULT_ORG_ID) return;
  const [{ data: template, error: templateError }, { data: existing, error: existingError }] = await Promise.all([
    db.from("rbac_roles").select("id, key, name, description, is_system").eq("organization_id", DEFAULT_ORG_ID),
    db.from("rbac_roles").select("key").eq("organization_id", organizationId),
  ]);
  if (templateError) throw new Error(templateError.message);
  if (existingError) throw new Error(existingError.message);
  const have = new Set((existing ?? []).map((r: any) => r.key));
  const missing = (template ?? []).filter((r: any) => !have.has(r.key));
  if (!missing.length) return;

  const { data: created, error: insertError } = await db
    .from("rbac_roles")
    .insert(
      missing.map((r: any) => ({
        organization_id: organizationId,
        key: r.key,
        name: r.name,
        description: r.description,
        is_system: r.is_system,
      })),
    )
    .select("id, key");
  if (insertError) throw new Error(insertError.message);

  const { data: perms, error: permsError } = await db
    .from("rbac_role_permissions")
    .select("role_id, permission_key")
    .in("role_id", missing.map((r: any) => r.id));
  if (permsError) throw new Error(permsError.message);
  const templateKeyById = new Map(missing.map((r: any) => [r.id, r.key]));
  const newIdByKey = new Map((created ?? []).map((r: any) => [r.key, r.id]));
  const rows = (perms ?? []).map((p: any) => ({
    role_id: newIdByKey.get(templateKeyById.get(p.role_id)),
    permission_key: p.permission_key,
  }));
  if (rows.length) {
    const { error } = await db.from("rbac_role_permissions").insert(rows);
    if (error) throw new Error(error.message);
  }
}
