import { createServerFn } from "@tanstack/react-start";

export const isAdmin = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { getWorkspace } = await import("@/platform/workspace/workspace.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const userId = (await getWorkspace()).userId;
    const { data } = await db.rpc("has_role", { _user_id: userId, _role: "admin" });
    return { isAdmin: data === true };
  } catch {
    return { isAdmin: false };
  }
});

export const adminStats = createServerFn({ method: "GET" }).handler(async () => {
  const { getPlatformStats } = await import("@/modules/superadmin/stats.functions");
  return getPlatformStats();
});

export const adminListUsers = createServerFn({ method: "GET" }).handler(async () => {
  const { listAllUsers } = await import("@/modules/superadmin/users.functions");
  return listAllUsers();
});
