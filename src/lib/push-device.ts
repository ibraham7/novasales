import { registerPushSubscription, unregisterPushSubscription } from "@/modules/notifications/notifications.functions";
import { currentSubscription, deviceLabel, pushSupport, permissionState, subscriptionKeys, unsubscribeThisDevice } from "./push-client";

/** After sign-in: a device that already allowed notifications follows the account that is signed in now. */
export async function syncPushSubscription(): Promise<void> {
  if (!pushSupport().ok || permissionState() !== "granted") return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  const keys = subscriptionKeys(subscription);
  if (!keys.p256dh || !keys.auth) return;
  await registerPushSubscription({ data: { ...keys, userAgent: navigator.userAgent.slice(0, 300), deviceLabel: deviceLabel() } });
}

/**
 * Before sign-out: this device stops receiving this account's notifications, so the next person
 * on a shared device does not see them. It never blocks signing out for more than a few seconds.
 */
export async function forgetThisDevice(): Promise<void> {
  try {
    await Promise.race([
      (async () => {
        const endpoint = await unsubscribeThisDevice();
        if (endpoint) await unregisterPushSubscription({ data: { endpoint } });
      })(),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {
    /* signing out matters more than cleaning up */
  }
}
