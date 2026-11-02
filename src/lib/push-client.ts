/** Browser side of Web Push: support checks, the service worker, and subscribing this device. */

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "ios-needs-install" | "insecure" };

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Opened from the home screen icon rather than a browser tab. */
export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return { ok: false, reason: "unsupported" };
  if (!window.isSecureContext) return { ok: false, reason: "insecure" };
  const hasApi = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // iPhone and iPad only expose push to a site added to the home screen.
  if (!hasApi) return { ok: false, reason: isIos() && !isInstalledApp() ? "ios-needs-install" : "unsupported" };
  return { ok: true };
}

export type PermissionState = "granted" | "denied" | "default" | "unsupported";
export function permissionState(): PermissionState {
  return typeof Notification === "undefined" ? "unsupported" : (Notification.permission as PermissionState);
}

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  // The worker file itself is always re-checked, so a new version reaches everyone.
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  await navigator.serviceWorker.ready;
  return registration;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupport().ok) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? registration.pushManager.getSubscription() : null;
}

export function subscriptionKeys(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return { endpoint: subscription.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" };
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad|iPod/.test(ua) ? "آيفون/آيباد" : /Android/.test(ua) ? "أندرويد" : /Windows/.test(ua) ? "ويندوز" : /Mac OS/.test(ua) ? "ماك" : /Linux/.test(ua) ? "لينكس" : "جهاز";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "متصفح";
  return `${browser} على ${os}${isInstalledApp() ? " (تطبيق مثبّت)" : ""}`;
}

/** Asks for permission (call it from a click), subscribes this device and returns what the server must store. */
export async function subscribeThisDevice(publicKey: string): Promise<{ endpoint: string; p256dh: string; auth: string }> {
  const support = pushSupport();
  if (!support.ok) throw new Error("هذا المتصفح لا يدعم الإشعارات");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "denied" : "dismissed");
  const registration = await registerServiceWorker();
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    // A subscription made with another key cannot be used with ours.
    const key = subscription.options?.applicationServerKey;
    const same = key && bytesEqual(new Uint8Array(key), urlBase64ToUint8Array(publicKey));
    if (!same) {
      await subscription.unsubscribe();
      subscription = null;
    }
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  const keys = subscriptionKeys(subscription);
  if (!keys.p256dh || !keys.auth) throw new Error("تعذّر الحصول على مفاتيح الاشتراك");
  return keys;
}

export async function unsubscribeThisDevice(): Promise<string | null> {
  const subscription = await currentSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}

function bytesEqual(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
