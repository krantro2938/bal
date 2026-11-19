import { useEffect, useReducer } from "react";
import { track } from "./analytics";
import { api } from "./api";
import { isStandalone } from "./install";

/**
 * Push notifications on this device: replies, mentions and new videos reach the phone while
 * the site is closed. The browser asks for permission only after the switch is tapped.
 * iPhones can only do this in the installed app (added to the home screen).
 *
 * unsupported: this browser can't; install: an iPhone/iPad outside the installed app;
 * denied: blocked in the browser's settings; off / on.
 */
export type PushState = "unsupported" | "install" | "denied" | "off" | "on";

const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// The service worker that shows them is registered in production builds only (main.tsx).
const supported = import.meta.env.PROD && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

let state: PushState = !supported ? (ios && !isStandalone() ? "install" : "unsupported") : Notification.permission === "denied" ? "denied" : "off";
let busy = false;
const subscribers = new Set<() => void>();
const set = (s: PushState) => {
  state = s;
  subscribers.forEach((f) => f());
};

const subscription = async () => (await navigator.serviceWorker.ready).pushManager.getSubscription();

if (supported && state === "off") {
  subscription().then((s) => s && Notification.permission === "granted" && set("on"), () => {});
}

function keyBytes(b64: string) {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function start() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return set(permission === "denied" ? "denied" : "off");
  const key = (await api.authConfig()).push;
  if (!key) throw new Error("no push key");
  const reg = await navigator.serviceWorker.ready;
  const options = { userVisibleOnly: true, applicationServerKey: keyBytes(key) };
  let sub: PushSubscription;
  try {
    sub = await reg.pushManager.subscribe(options);
  } catch (e) {
    // Subscribed earlier with another key: start over.
    const old = await reg.pushManager.getSubscription();
    if (!old) throw e;
    await old.unsubscribe();
    sub = await reg.pushManager.subscribe(options);
  }
  await api.pushSubscribe(sub.toJSON());
  track("push-on");
  set("on");
}

/** Turns this device's notifications off (also on signing out). */
export async function stopPush() {
  if (!supported) return;
  const sub = await subscription().catch(() => null);
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => false);
  if (state === "on") set("off");
}

/** Signed in: tells the server again which account this device's notifications are for. */
export async function syncPush() {
  if (!supported || Notification.permission !== "granted") return;
  const sub = await subscription().catch(() => null);
  if (sub) api.pushSubscribe(sub.toJSON()).catch(() => {});
}

export function usePush() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    subscribers.add(rerender);
    return () => void subscribers.delete(rerender);
  }, []);
  return {
    state,
    busy,
    /** Call from the tap itself: browsers only ask for permission inside a gesture. */
    toggle: async () => {
      if (busy || (state !== "on" && state !== "off")) return false;
      busy = true;
      set(state);
      try {
        if (state === "on") await stopPush();
        else await start();
        return true;
      } catch {
        return false;
      } finally {
        busy = false;
        set(state);
      }
    },
  };
}
