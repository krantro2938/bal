// Service worker: makes the site installable as an app and shows a small offline page
// instead of the browser's error when there is no connection. Nothing else is cached —
// videos and data always come fresh from the server.
const CACHE = "bal-offline-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});

// Push notifications (internal/server/push.go): a reply, a mention or a new video.
self.addEventListener("push", (event) => {
  let m = {};
  try {
    m = event.data ? event.data.json() : {};
  } catch {
    m = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(m.title || "Звёздная одиссея", {
      body: m.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png", // Android's status bar: the logo's star, white
      tag: m.tag,
      lang: "ru",
      data: { url: m.url || "/" },
    }),
  );
});

// A tap opens the page in the app's window if one is open, or in a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of open) {
        if (new URL(c.url).origin !== self.location.origin) continue;
        try {
          await c.focus();
          await c.navigate(url);
          return;
        } catch {
          /* not ours to steer: open a new window */
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
