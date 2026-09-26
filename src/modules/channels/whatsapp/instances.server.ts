import { supabaseAdmin } from "@/platform/workspace/workspace.server";
import { getWorkspaceAccess } from "@/platform/rbac/rbac.server";
import { getOpportunityVisibility } from "@/platform/rbac/data-scope.server";
import { resolveAccountProvider } from "./registry.server";

type AccountView = {
  id: string;
  name: string;
  display_name: string | null;
  status: string;
  phone_number: string | null;
  profile_pic_url: string | null;
  qr_code: string | null;
  webhook_configured: boolean;
  department_id: string | null;
  department_ids: string[];
  identifier: string | null;
  owner_user_id: string | null;
  created_at: string;
  provider: string;
};

function phoneFromRawState(rawState: unknown): string | null {
  if (!rawState || typeof rawState !== "object") return null;
  const raw = rawState as Record<string, unknown>;
  const phone = raw.phone ?? raw.number;
  if (typeof phone === "string" && phone.trim()) return phone.trim();
  const jid = raw.ownerJid;
  if (typeof jid === "string" && jid.includes("@")) return jid.split("@")[0] ?? null;
  return null;
}

function profilePicFromRawState(rawState: unknown): string | null {
  if (!rawState || typeof rawState !== "object") return null;
  const raw = rawState as Record<string, unknown>;
  const pic = raw.profilePicUrl ?? raw.profilePictureUrl ?? raw.pictureUrl;
  return typeof pic === "string" && pic.trim() ? pic : null;
}

function cleanPhone(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

// تحديث بيانات الرقم من محرّكه (أي مزوّد) عند غياب الرقم/الصورة.
async function syncAccountInfoFromEvolution(accounts: AccountView[]) {
  const needsSync = accounts.filter((account) => account.name && (!account.phone_number || !account.profile_pic_url));
  if (!needsSync.length) return accounts;

  const db = supabaseAdmin as any;
  const updates = await Promise.all(
    needsSync.slice(0, 10).map(async (account) => {
      const ref = await resolveAccountProvider(account.id).catch(() => null);
      if (!ref || !ref.provider.isConfigured() || !ref.provider.getDebugInfo) return null;
      const info = await ref.provider.getDebugInfo(ref.externalRef).catch(() => null);
      if (!info) return null;
      const phone = cleanPhone(info.phoneNumber ?? null) ?? account.phone_number;
      const statusMap: Record<string, string> = { open: "connected", close: "disconnected", connecting: "connecting" };
      const nextStatus = info.state ? statusMap[info.state] ?? info.state : account.status;
      const rawState = {
        phone,
        profileName: info.profileName,
        profilePicUrl: info.profilePicUrl,
        state: info.state,
        syncedAt: new Date().toISOString(),
      };

      await Promise.all([
        db.from("msg_channel_accounts").update({ status: nextStatus }).eq("id", account.id),
        db
          .from("plugin_whatsapp_evolution_instances")
          .update({ phone_number: phone, raw_state: rawState })
          .eq("channel_account_id", account.id),
      ]);

      return {
        id: account.id,
        phone_number: phone ?? account.phone_number,
        profile_pic_url: info.profilePicUrl ?? account.profile_pic_url,
        status: nextStatus,
      };
    }),
  );

  const byId = new Map(updates.filter((item): item is NonNullable<typeof item> => Boolean(item)).map((item) => [item.id, item]));
  return accounts.map((account) => ({ ...account, ...(byId.get(account.id) ?? {}) }));
}

/**
 * Visibility rules for WhatsApp sessions:
 * - owner / general supervisor / super admin: all org sessions
 * - department supervisor: sessions they own + sessions linked to their departments
 * - sales agent: only the sessions they created (their own number)
 */
export async function loadAccounts(_userId: string, orgId: string) {
  const db = supabaseAdmin as any;
  const access = await getWorkspaceAccess().catch(() => null);
  const scope = access ? getOpportunityVisibility(access) : "all";
  const seesAllSessions =
    !access ||
    access.isSuperAdmin ||
    access.roleKeys.some((role) => ["owner", "org_owner", "admin", "supervisor"].includes(role));

  let allowedByDept: string[] | null = null;
  if (access && scope === "department" && access.departmentIds.length) {
    const { data: links } = await db
      .from("msg_channel_account_departments")
      .select("account_id")
      .in("department_id", access.departmentIds);
    allowedByDept = (links ?? []).map((l: any) => l.account_id);
  }

  let query = db
    .from("msg_channel_accounts")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (!seesAllSessions && access && scope === "own") {
    query = query.eq("owner_user_id", access.userId);
  } else if (!seesAllSessions && access && scope === "department") {
    const ids = allowedByDept ?? [];
    query = ids.length
      ? query.or(`owner_user_id.eq.${access.userId},id.in.(${ids.join(",")})`)
      : query.eq("owner_user_id", access.userId);
  }

  const { data: accounts, error } = await query;
  if (error) throw new Error(error.message);
  const ids = (accounts ?? []).map((a: any) => a.id);
  let plugins: any[] = [];
  let deptLinks: any[] = [];
  if (ids.length) {
    const [{ data: plugData }, { data: linkData }] = await Promise.all([
      db.from("plugin_whatsapp_evolution_instances").select("*").in("channel_account_id", ids),
      db.from("msg_channel_account_departments").select("account_id, department_id").in("account_id", ids),
    ]);
    plugins = plugData ?? [];
    deptLinks = linkData ?? [];
  }
  // provider لكل جلسة يأتي من قناتها (msg_channels.provider)
  const channelIds = [...new Set((accounts ?? []).map((a: any) => a.channel_id).filter(Boolean))];
  const providerByChannel = new Map<string, string>();
  if (channelIds.length) {
    const { data: chans } = await db.from("msg_channels").select("id, provider").in("id", channelIds);
    (chans ?? []).forEach((c: any) => providerByChannel.set(c.id, c.provider ?? "evolution"));
  }
  const byAcc = new Map<string, any>();
  plugins.forEach((p) => byAcc.set(p.channel_account_id, p));
  const deptsByAcc = new Map<string, string[]>();
  deptLinks.forEach((l: any) => {
    const arr = deptsByAcc.get(l.account_id) ?? [];
    arr.push(l.department_id);
    deptsByAcc.set(l.account_id, arr);
  });
  const mapped: AccountView[] = (accounts ?? []).map((a: any) => {
    const p = byAcc.get(a.id);
    const department_ids = deptsByAcc.get(a.id) ?? [];
    return {
      id: a.id,
      name: a.external_ref ?? p?.instance_name ?? "",
      display_name: a.display_name,
      status: a.status,
      phone_number: p?.phone_number ?? phoneFromRawState(p?.raw_state) ?? null,
      profile_pic_url: profilePicFromRawState(p?.raw_state),
      qr_code: p?.qr_code ?? null,
      webhook_configured: a.webhook_configured,
      department_id: department_ids[0] ?? a.department_id ?? null,
      department_ids,
      identifier: a.identifier ?? null,
      owner_user_id: a.owner_user_id ?? null,
      created_at: a.created_at,
      provider:
        (a.provider_meta && typeof a.provider_meta === "object" && (a.provider_meta as any).provider) ||
        providerByChannel.get(a.channel_id) ||
        "evolution",
    };
  });

  return syncAccountInfoFromEvolution(mapped);
}
