// Cookieless counting of visits and a short list of actions, through a self-hosted Umami.
// The page sends a small report to /api/pulse on our own server, which checks it and passes it
// on (internal/server/analytics.go); no Umami script is loaded and nothing is stored here.
// Off unless /api/auth/config says it is on, and off for Do Not Track / Global Privacy Control.

/** Every event that exists; keep in step with analyticsEvents in internal/server/analytics.go. */
export const EVENTS = [
  "play", // a dance video started playing (once per page view)
  "finished", // it was watched to the end (once per page view)
  "loop", // a fragment repeat was turned on
  "slowed", // playback speed set below 1×
  "scheme-opened", // a scheme page was opened
  "mini-player", // the dance went on in the mini player
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

let enabled = false;
// The page being shown as we report it ("/dance/vals-gavot"), or null for one we don't report.
let page: string | null = null;
let fired = new Set<string>();
let first = true;
// Reports made before the config arrived; sent (or dropped) once it does.
let queue: { name?: AnalyticsEvent; page: string }[] | null = [];

const PAGES = new Set(["/", "/login", "/register", "/me"]);
const DANCE = /^\/dance\/[a-z0-9-]{1,64}$/;

function optedOut() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

function post(name: AnalyticsEvent | undefined, at: string) {
  const body: Record<string, string> = {
    url: at,
    language: navigator.language,
    screen: `${screen.width}x${screen.height}`,
  };
  if (name) body.name = name;
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

function send(name?: AnalyticsEvent) {
  if (!page) return;
  if (queue) {
    if (queue.length < 20) queue.push({ name, page });
    return;
  }
  if (enabled) post(name, page);
}

/** Turn counting on or off; called once with what the server says. */
export function configureAnalytics(on: boolean) {
  enabled = on && !optedOut();
  const waiting = queue ?? [];
  queue = null;
  if (enabled) for (const q of waiting) post(q.name, q.page);
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

/** Like track, but at most once per page view. */
export function trackOnce(name: AnalyticsEvent) {
  if (fired.has(name)) return;
  fired.add(name);
  send(name);
}
