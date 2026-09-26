/**
 * Assignment eligibility — رقم واتساب لا يستقبل عملاء جدداً إلا إذا كان مستقراً.
 * القواعد: لا فترة مراقبة جارية، لا إيقاف إرسال، لا تقييد قائم، والحالة الصحية "stable".
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { observationRemainingMs, resolveHealthState, type HealthState } from "./risk.server";

const db = supabaseAdmin as any;

export const NOT_ELIGIBLE_MESSAGE =
  "لا يمكن إسناد عملاء جدد لهذا الرقم حتى تنتهي فترة المراقبة ويصبح مستقراً.";

export type AccountEligibility = {
  account_id: string;
  display_name: string | null;
  phone_number: string | null;
  health_state: HealthState;
  eligible: boolean;
  reason: string | null;
  observation_remaining_hours: number;
  send_paused: boolean;
  is_restricted_now: boolean;
};

function evaluate(acc: any, restricted: boolean): AccountEligibility {
  const remainingMs = observationRemainingMs(acc);
  const state = resolveHealthState(acc);
  const paused = Boolean(acc.send_paused_at);
  let reason: string | null = null;
  if (restricted) reason = "restricted";
  else if (paused) reason = "send_paused";
  else if (remainingMs > 0) reason = "observation_window";
  else if (state !== "stable") reason = state;
  return {
    account_id: acc.id,
    display_name: acc.display_name ?? null,
    phone_number: acc.phone_number ?? null,
    health_state: state,
    eligible: reason === null,
    reason,
    observation_remaining_hours: Math.ceil(remainingMs / 3600_000),
    send_paused: paused,
    is_restricted_now: restricted,
  };
}

/** يحسب أهلية كل أرقام المؤسسة + يصلّح الحالة المخزّنة تلقائياً بعد انتهاء المراقبة. */
export async function loadOrgEligibility(orgId: string): Promise<AccountEligibility[]> {
  const { data: accounts } = await db
    .from("msg_channel_accounts")
    .select("id, display_name, status, risk_score, send_paused_at, observation_started_at, observation_hours, health_state")
    .eq("organization_id", orgId);
  const rows = (accounts ?? []) as any[];
  if (!rows.length) return [];
  const ids = rows.map((a) => a.id);
  const [{ data: plugins }, { data: restrictions }] = await Promise.all([
    db.from("plugin_whatsapp_evolution_instances").select("channel_account_id, phone_number").in("channel_account_id", ids),
    db.from("wa_number_restrictions").select("account_id").in("account_id", ids).is("ended_at", null),
  ]);
  const phoneMap = new Map((plugins ?? []).map((p: any) => [p.channel_account_id, p.phone_number]));
  const restrictedSet = new Set((restrictions ?? []).map((r: any) => r.account_id));

  const out = rows.map((a) =>
    evaluate({ ...a, phone_number: phoneMap.get(a.id) ?? null }, restrictedSet.has(a.id)),
  );

  // تحرير تلقائي: الحالة المخزّنة "observation" لكن المدة انتهت → تُحدَّث لتعود للتوزيع.
  const toRelease = out.filter(
    (e) => e.observation_remaining_hours === 0 && rows.find((r) => r.id === e.account_id)?.health_state !== e.health_state,
  );
  await Promise.all(
    toRelease.map((e) =>
      db.from("msg_channel_accounts").update({ health_state: e.health_state }).eq("id", e.account_id),
    ),
  );
  return out;
}

/** يمنع إسناد عميل جديد لرقم غير مستقر. */
export async function assertAccountEligibleForNewLead(orgId: string, accountId: string | null | undefined) {
  if (!accountId) return;
  const list = await loadOrgEligibility(orgId);
  const found = list.find((e) => e.account_id === accountId);
  if (found && !found.eligible) throw new Error(NOT_ELIGIBLE_MESSAGE);
}
