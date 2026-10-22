/**
 * NovaSales Meta Pixel (4618096201805650) for site analytics in Meta Events Manager.
 * Only page views are sent: automatic collection of buttons and form data is turned off, since the
 * site shows customers' conversations and details. Loaded only on the live domain.
 */
export const META_PIXEL_ID = "4618096201805650";
const LIVE_HOSTS = ["sales.novanoai.online"];

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue: unknown[]; loaded?: boolean; version?: string; push?: unknown };

export function startMetaPixel() {
  if (typeof window === "undefined" || !LIVE_HOSTS.includes(window.location.hostname)) return false;
  const w = window as unknown as { fbq?: Fbq; _fbq?: Fbq };
  if (w.fbq) return true;
  // Meta's standard loader, written out instead of an inline snippet.
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  } as Fbq;
  fbq.queue = [];
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  w.fbq = fbq;
  w._fbq = fbq;
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
  fbq("set", "autoConfig", false, META_PIXEL_ID);
  fbq("init", META_PIXEL_ID);
  return true;
}

/** One page view per page the user opens (the app changes pages without reloading). */
export function trackMetaPageView() {
  const w = window as unknown as { fbq?: Fbq };
  w.fbq?.("track", "PageView");
}
