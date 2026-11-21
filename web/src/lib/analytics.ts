// Cookieless counting of visits and a short list of actions, through a self-hosted Umami.
// The page sends a small report to /api/pulse on our own server, which checks it and passes it
// on (internal/server/analytics.go); no Umami script is loaded and nothing is stored here.
// Off unless /api/auth/config says it is on, and off for Do Not Track / Global Privacy Control.

/** Every event that exists; keep in step with analyticsEvents in internal/server/analytics.go. */
export const EVENTS = [
  "play", // a dance video started playing (once per page view)
  "video-startup",
  "video-seek",
  "video-failure",
  "video-session",
  "finished", // it was watched to the end (once per page view)
  "loop", // a fragment repeat was turned on
  "slowed", // playback speed set below 1×
  "scheme-opened", // a scheme page was opened
  "mini-player", // the dance went on in the mini player
  "timestamp-opened", // a timestamp link was opened
  "comment-timestamp", // a timestamp in a comment was clicked
  "note-saved", // a new private note
  "comment", // a comment or reply was posted
  "reaction", // like or dislike
  "favorite", // saved to favorites
  "learned", // marked as learned
  "share", // a link was shared or copied
  "signup", // an account was created
  "login", // signed in with email and password
  "install", // installed as an app
  "push-on", // turned on notifications on a device
] as const;
export type AnalyticsEvent = (typeof EVENTS)[number];
type PlaybackMetrics = {
  "video-startup": { ms: number; frame: "presented" | "ready" };
  "video-seek": { ms: number; frame: "presented" | "ready" };
  "video-failure": { phase: "startup" | "seek" | "playback"; reason: "error" | "timeout" };
  "video-session": { stalls: number; stall_ms: number };
};
type EventData = PlaybackMetrics[keyof PlaybackMetrics];

let enabled = false;
// The page being shown as we report it ("/dance/vals-gavot"), or null for one we don't report.
let page: string | null = null;
let fired = new Set<string>();
let first = true;
// Reports made before the config arrived; sent (or dropped) once it does.
let queue: { name?: AnalyticsEvent; page: string; data?: EventData }[] | null = [];

const PAGES = new Set(["/", "/login", "/register", "/me"]);
const DANCE = /^\/dance\/[a-z0-9-]{1,64}$/;

function optedOut() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

function post(name: AnalyticsEvent | undefined, at: string, data?: EventData) {
  const body: Record<string, unknown> = {
    url: at,
    language: navigator.language,
    screen: `${screen.width}x${screen.height}`,
  };
  if (name) body.name = name;
  if (data) body.data = data;
  // The first page view of a visit carries the site that sent the visitor (the server keeps origin and path only).
  if (first && document.referrer) body.referrer = document.referrer;
  first = false;
  void fetch("/api/pulse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
    keepalive: true,
  }).catch(() => {});
}

function send(name?: AnalyticsEvent, data?: EventData, at = page) {
  if (!at) return;
  if (queue) {
    if (queue.length < 20) queue.push({ name, page: at, data });
    return;
  }
  if (enabled) post(name, at, data);
}

/** Turn counting on or off; called once with what the server says. */
export function configureAnalytics(on: boolean) {
  enabled = on && !optedOut();
  const waiting = queue ?? [];
  queue = null;
  if (enabled) for (const q of waiting) post(q.name, q.page, q.data);
}

/** Say which page is showing (its path) and count the view. Paths we don't report are ignored. */
export function setPage(pathname: string) {
  const next = PAGES.has(pathname) || DANCE.test(pathname) ? pathname : null;
  if (next === page) return;
  page = next;
  fired = new Set();
  send();
}

/** Count something that happened on the current page. */
export function track(name: AnalyticsEvent) {
  send(name);
}

export function trackPlayback<K extends keyof PlaybackMetrics>(slug: string, name: K, data: PlaybackMetrics[K]) {
  const at = `/dance/${slug}`;
  if (DANCE.test(at)) send(name, data, at);
}

/** Like track, but at most once per page view. */
export function trackOnce(name: AnalyticsEvent) {
  if (fired.has(name)) return;
  fired.add(name);
  send(name);
}
