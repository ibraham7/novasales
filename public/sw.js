/*
 * NovaSales service worker: Web Push only. It does not cache pages and does not intercept
 * requests (no fetch handler), so it cannot change how the site loads. To switch push off for
 * everyone, deploy a version of this file that unregisters itself.
 */
const RECEIPT_URL = "/api/public/push-receipt";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function report(id, event) {
  if (!id) return Promise.resolve();
  return fetch(RECEIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, event }),
    keepalive: true,
  }).catch(() => undefined);
}

// Only paths inside this site are opened from a notification.
function targetUrl(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "/", self.location.origin);
    return url.origin === self.location.origin ? url.href : new URL("/", self.location.origin).href;
  } catch {
    return new URL("/", self.location.origin).href;
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "NovaSales";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    dir: "rtl",
    lang: "ar",
    // The same tag replaces the earlier notification instead of stacking a duplicate.
    ...(data.tag ? { tag: data.tag, renotify: true } : {}),
    data: { url: data.url || "/", id: data.id || null },
  };
  // A push must always show something (browsers require it), then tell the server it did.
  event.waitUntil(self.registration.showNotification(title, options).then(() => report(data.id, "shown")));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const info = event.notification.data || {};
  const url = targetUrl(info.url);
  event.waitUntil(
    (async () => {
      void report(info.id, "clicked");
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse a window already open on the site instead of opening another copy.
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          if ("navigate" in client && client.url !== url) await client.navigate(url);
        } catch {
          /* a window that cannot navigate still gets focus */
        }
        return client.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
