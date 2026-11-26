/**
 * Why a WhatsApp number cannot send campaign messages right now, in words for the screen (null when it can). The campaign
 * runner applies the same conditions (connected, not paused, observation over) and otherwise leaves the messages waiting
 * without saying anything; the screens use this to say it.
 */
export type SendBlockInput = {
  status?: string | null;
  send_paused_at?: string | null;
  observation_started_at?: string | null;
  observation_hours?: number | null;
};

export function observationLeftHours(account: SendBlockInput, now = Date.now()): number {
  if (!account.observation_started_at) return 0;
  const end = new Date(account.observation_started_at).getTime() + (account.observation_hours ?? 48) * 3_600_000;
  return Math.max(0, Math.ceil((end - now) / 3_600_000));
}

export function sendBlockReason(account: SendBlockInput | null | undefined, now = Date.now()): string | null {
  if (!account) return "الرقم المرسِل غير موجود";
  if (account.status !== "connected") return "الرقم غير متصل";
  if (account.send_paused_at) return "الإرسال موقوف لهذا الرقم";
  const left = observationLeftHours(account, now);
  if (left > 0) return `الرقم تحت المراقبة (يتبقى نحو ${left} ساعة)، وهي حماية من الحظر بعد ربط رقم جديد`;
  return null;
}
