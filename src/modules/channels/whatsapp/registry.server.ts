// Provider Registry — يختار المحرّك المناسب.
// `msg_channels.provider` من نوع TEXT مفتوح (لا Enum ولا CHECK) لتسهيل إضافة
// محرّكات مستقبلاً (waha, coexistence, telegram…) بدون Migration.
import type { IWhatsAppProvider, ProviderCapabilities, ProviderId, ProviderLinkMode } from "./provider";
import { evolutionProvider } from "./evolution.provider";
import { coexistenceProvider } from "./coexistence.provider";
import { wahaProvider } from "./waha.provider";

const providers = new Map<ProviderId, IWhatsAppProvider>([
  [coexistenceProvider.id, coexistenceProvider],
  [evolutionProvider.id, evolutionProvider],
  [wahaProvider.id, wahaProvider],
]);

export function getProvider(id: ProviderId): IWhatsAppProvider {
  const p = providers.get(id);
  if (!p) throw new Error(`مزوّد غير مدعوم: ${id}`);
  return p;
}

export function listProviders(): IWhatsAppProvider[] {
  return [...providers.values()];
}

/** قائمة المحرّكات للـUI مع قدراتها المعلنة (Auto Detection). */
export function listAvailableProviders(): Array<{
  id: ProviderId;
  label: string;
  description: string | null;
  enabled: boolean;
  linkMode: ProviderLinkMode;
  isOfficial: boolean;
  capabilities: ProviderCapabilities;
}> {
  return listProviders().map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description ?? null,
    enabled: p.isConfigured(),
    linkMode: p.linkMode ?? "qr",
    isOfficial: Boolean(p.isOfficial),
    capabilities: p.capabilities,
  }));
}

export type AccountProviderRef = {
  accountId: string;
  organizationId: string;
  providerId: ProviderId;
  externalRef: string;
  provider: IWhatsAppProvider;
};

/** يرجع المزوّد + مرجع الجلسة لحساب قناة معيّن. */
export async function resolveAccountProvider(accountId: string): Promise<AccountProviderRef> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: acc } = await db
    .from("msg_channel_accounts")
    .select("id, organization_id, channel_id, external_ref")
    .eq("id", accountId)
    .maybeSingle();
  if (!acc) throw new Error("حساب القناة غير موجود");
  const { data: ch } = await db
    .from("msg_channels")
    .select("provider")
    .eq("id", acc.channel_id)
    .maybeSingle();
  const providerId = (ch?.provider as string | undefined) ?? "evolution";
  return {
    accountId: acc.id,
    organizationId: acc.organization_id,
    providerId,
    externalRef: acc.external_ref ?? "",
    provider: getProvider(providerId),
  };
}

/** توافق خلفي مع الاستدعاءات القديمة. */
export async function getProviderForAccount(accountId: string): Promise<IWhatsAppProvider> {
  return (await resolveAccountProvider(accountId)).provider;
}

/** قدرات المحرّك الذي يشغّل هذا الرقم — تقرأها الواجهة لإظهار/تعطيل الأزرار. */
export async function getAccountCapabilities(
  accountId: string,
): Promise<{ providerId: ProviderId; label: string; capabilities: ProviderCapabilities }> {
  const ref = await resolveAccountProvider(accountId);
  return { providerId: ref.providerId, label: ref.provider.label, capabilities: ref.provider.capabilities };
}

/** يجد المزوّد المسؤول عن جلسة بحسب external_ref (يُستخدم في الويبهوك). */
export async function resolveAccountByExternalRef(externalRef: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: acc } = await db
    .from("msg_channel_accounts")
    .select("id, organization_id, owner_user_id, channel_id, external_ref, status")
    .eq("external_ref", externalRef)
    .maybeSingle();
  return acc ?? null;
}
