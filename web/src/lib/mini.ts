import { useSyncExternalStore } from "react";
import { track } from "./analytics";

/**
 * Phones: the dance keeps playing in a small bar at the bottom after the video is dragged down,
 * like YouTube's app. The bar owns one <video> that is always mounted, so playback can start
 * inside the drag's touchend (iPhones only allow sound from within a gesture).
 */
export type MiniDance = { slug: string; title: string; order: number; kind: "dance" | "glossary"; url: string; poster?: string };

let current: MiniDance | null = null;
let video: HTMLVideoElement | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useMini() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function registerMiniVideo(el: HTMLVideoElement | null) {
  video = el;
}

export function miniVideo() {
  return video;
}

/** Call from the gesture's own event handler. */
export function openMini(dance: MiniDance, at: number, sound: { volume: number; muted: boolean; play: boolean }) {
  if (!video) return;
  current = dance;
  video.src = `${dance.url}#t=${at.toFixed(1)}`;
  video.volume = sound.volume;
  video.muted = sound.muted;
  if (sound.play) video.play().catch(() => {});
  track("mini-player");
  emit();
}

export function closeMini() {
  if (!current) return;
  current = null;
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  emit();
}
