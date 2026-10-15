import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./platform/errors/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Log-only: records server functions slower than 400 ms (name and duration, never data) so
// speed work targets what is actually slow in production. Does not change any result.
const slowServerFnLog = createMiddleware({ type: "function" }).server(async ({ next, serverFnMeta }) => {
  const started = performance.now();
  try {
    return await next();
  } finally {
    const ms = Math.round(performance.now() - started);
    if (ms >= 400) console.log(`[SLOW_FN] ${ms}ms ${serverFnMeta?.name ?? "unknown"}`);
  }
});

// Server functions that change roles, permissions, memberships or departments. After any of them
// succeeds, cached permissions are dropped so the change applies on the next request.
const ACCESS_CHANGING_FNS = new Set([
  "assignUserRole",
  "unassignUserRole",
  "createRole",
  "updateRole",
  "deleteRole",
  "setRolePermissions",
  "activateMember",
  "deactivateMember",
  "removeMember",
  "setMemberRoles",
  "addMember",
  "updateMember",
  "createDepartment",
  "updateDepartment",
  "deleteDepartment",
  "acceptInvitation",
  "revokeInvitation",
  "addUserToOrganization",
  "removeUserFromOrganization",
  "createUser",
  "setUserRole",
  "deleteOrganization",
  "startImpersonation",
  "stopImpersonation",
  "switchActiveOrganization",
]);

const clearAccessAfterChanges = createMiddleware({ type: "function" }).server(async ({ next, serverFnMeta }) => {
  const result = await next();
  if (ACCESS_CHANGING_FNS.has(serverFnMeta?.name ?? "")) {
    const { forgetWorkspaceAccess } = await import("@/platform/rbac/rbac.server");
    forgetWorkspaceAccess();
  }
  return result;
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, slowServerFnLog, clearAccessAfterChanges],
  requestMiddleware: [errorMiddleware],
}));
