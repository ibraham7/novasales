import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

// Who may disconnect an account: the person who linked it, or the managers who see every number.
const MANAGER_ROLES = ["owner", "org_owner", "admin", "supervisor"];

/** The Instagram tab: whether linking is available and the accounts this person may see. */
export const getInstagramSetupFn = createServerFn({ method: "GET" }).handler(async () => {
  const [{ getWorkspace, supabaseAdmin }, { loadAccounts }, core] = await Promise.all([
    import("@/platform/workspace/workspace.server"),
    import("../whatsapp/instances.server"),
    import("./instagram-core"),
  ]);
  const { userId, organizationId } = await getWorkspace();
  const accounts = await loadAccounts(userId, organizationId, { channel: "instagram" });
  const ids = accounts.map((a: any) => a.id);
  const db = supabaseAdmin as any;
  const { data: links } = ids.length
    ? await db
        .from("plugin_instagram_accounts")
        .select("channel_account_id, username, status, token_expires_at, last_error")
        .eq("organization_id", organizationId)
        .in("channel_account_id", ids)
    : { data: [] as any[] };
  const byAccount = new Map<string, any>((links ?? []).map((l: any) => [l.channel_account_id, l]));
  return {
    configured: core.isInstagramConfigured(),
    accounts: accounts.map((a: any) => {
      const link = byAccount.get(a.id);
      return {
        id: a.id as string,
        displayName: a.display_name as string,
        username: (link?.username ?? null) as string | null,
        status: (link?.status ?? "disconnected") as string,
        tokenExpiresAt: (link?.token_expires_at ?? null) as string | null,
        needsAttention: link?.status === "needs_reconnect" || core.tokenState(link?.token_expires_at) === "refresh_due" || Boolean(link?.last_error),
        isMine: a.owner_user_id === userId,
        ownerUserId: (a.owner_user_id ?? null) as string | null,
        createdAt: a.created_at as string,
      };
    }),
  };
});

/** Starts the link: returns Instagram's own login page for this person to sign in on. */
export const startInstagramLinkFn = createServerFn({ method: "POST" }).handler(async () => {
  const [{ getWorkspace, supabaseAdmin }, core, store] = await Promise.all([
    import("@/platform/workspace/workspace.server"),
    import("./instagram-core"),
    import("./instagram-store"),
  ]);
  const redirectUri = core.linkRedirectUri();
  if (!core.isInstagramConfigured() || !redirectUri) throw new Error("ربط إنستغرام غير مفعّل بعد على الخادم. تواصل مع إدارة المنصة.");
  const { userId, organizationId } = await getWorkspace();
  return store.startInstagramLink(supabaseAdmin as any, { now: () => new Date() }, {
    organizationId,
    userId,
    appId: process.env.INSTAGRAM_APP_ID!,
    redirectUri,
  });
});

/** Called when Instagram sends the person back to the app with a code. */
export const finishInstagramLinkFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ code: z.string().trim().min(5).max(2000), state: z.string().trim().min(10).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const [{ getWorkspace, supabaseAdmin }, core, store, server] = await Promise.all([
      import("@/platform/workspace/workspace.server"),
      import("./instagram-core"),
      import("./instagram-store"),
      import("./instagram.server"),
    ]);
    const redirectUri = core.linkRedirectUri();
    if (!core.isInstagramConfigured() || !redirectUri) throw new Error("ربط إنستغرام غير مفعّل بعد على الخادم.");
    const { userId, organizationId } = await getWorkspace();
    const result = await store.finishInstagramLink(supabaseAdmin as any, server.instagramDeps(), {
      organizationId,
      userId,
      code: data.code,
      state: data.state,
      redirectUri,
    });
    return { accountId: result.accountId, username: result.username, relinked: result.relinked, warning: result.warning };
  });

export const disconnectInstagramFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const [{ getWorkspace, supabaseAdmin }, { getWorkspaceAccess }, { loadAccounts }, store] = await Promise.all([
      import("@/platform/workspace/workspace.server"),
      import("@/platform/rbac/rbac.server"),
      import("../whatsapp/instances.server"),
      import("./instagram-store"),
    ]);
    const { userId, organizationId } = await getWorkspace();
    // Only an account this person is allowed to see, and only their own unless they are a manager.
    const visible = (await loadAccounts(userId, organizationId, { channel: "instagram" })).find((a: any) => a.id === data.accountId);
    if (!visible) throw new Error("الحساب غير موجود");
    const access = await getWorkspaceAccess();
    const manager = access.isSuperAdmin || access.roleKeys.some((role: string) => MANAGER_ROLES.includes(role));
    if (visible.owner_user_id !== userId && !manager) throw new Error("لا تملك صلاحية فصل هذا الحساب");
    return store.disconnectInstagram(supabaseAdmin as any, { organizationId, accountId: data.accountId });
  });

/** For the chat composer: is this an Instagram chat, and how long can it still be answered? */
export const getInstagramWindowFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ chatId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const [{ getWorkspace, supabaseAdmin }, store] = await Promise.all([import("@/platform/workspace/workspace.server"), import("./instagram-store")]);
    const { organizationId } = await getWorkspace();
    const db = supabaseAdmin as any;
    const { data: session } = await db.from("msg_sessions").select("id, channel_account_id").eq("id", data.chatId).eq("organization_id", organizationId).maybeSingle();
    if (!session) return { isInstagram: false, connected: true, open: true, expiresAt: null as string | null };
    const { data: link } = await db
      .from("plugin_instagram_accounts")
      .select("status")
      .eq("organization_id", organizationId)
      .eq("channel_account_id", session.channel_account_id)
      .maybeSingle();
    if (!link) return { isInstagram: false, connected: true, open: true, expiresAt: null as string | null };
    const state = await store.instagramWindowForSession(db, { now: () => new Date() }, { organizationId, sessionId: session.id });
    return { isInstagram: true, connected: link.status === "connected", ...state };
  });
