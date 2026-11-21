// Service worker: makes the site installable as an app and shows a small offline page
// instead of the browser's error when there is no connection.
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

// One short-lived, in-memory prefix, available only to the tab that warmed it.
const PREFIX = 512 * 1024;
let warm;
self.addEventListener("message", (event) => {
  const { type, url, bytes, total } = event.data ?? {};
  if (type !== "bal-video-prefix" || !event.source?.id ||
      typeof url !== "string" || !/^\/media\/vals-gavot\/video-[a-z0-9-]+\.mp4$/.test(url) ||
      !(bytes instanceof ArrayBuffer) || bytes.byteLength !== PREFIX ||
      !Number.isSafeInteger(total) || total <= PREFIX) return;
  warm = { url: self.location.origin + url, client: event.source.id, bytes: new Uint8Array(bytes), total, expires: Date.now() + 30_000 };
});

async function warmedRange(request, entry, start, end) {
  const cut = Math.min(end + 1, PREFIX);
  const prefix = entry.bytes.subarray(start, cut);
  let tail;
  if (cut <= end) {
    const headers = new Headers(request.headers);
    headers.set("Range", `bytes=${cut}-${end}`);
    try {
      const response = await fetch(new Request(request, { headers }));
      if (response.status !== 206 || !response.body ||
          response.headers.get("Content-Range") !== `bytes ${cut}-${end}/${entry.total}`) {
        await response.body?.cancel();
        return fetch(request);
      }
      tail = response.body.getReader();
    } catch {
      return fetch(request);
    }
  }
  let sent = false;
  const body = new ReadableStream({
    async pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(prefix);
        if (!tail) controller.close();
        return;
      }
      const next = await tail.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel(reason) { return tail?.cancel(reason); },
  });
  return new Response(body, { status: 206, headers: {
    "Accept-Ranges": "bytes",
    "Content-Type": "video/mp4",
    "Content-Range": `bytes ${start}-${end}/${entry.total}`,
    "Content-Length": String(end - start + 1),
    "Cache-Control": "no-store",
    "X-Bal-Warmed-Bytes": String(prefix.length),
  } });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
    return;
  }
  if (warm && Date.now() >= warm.expires) warm = undefined;
  if (!warm || event.clientId !== warm.client || request.url !== warm.url ||
      request.method !== "GET" || request.destination !== "video" ||
      request.headers.has("If-Range")) return;
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("Range") ?? "");
  if (!range) return;
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), warm.total - 1) : warm.total - 1;
  if (start < PREFIX && end >= start) event.respondWith(warmedRange(request, warm, start, end));
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
