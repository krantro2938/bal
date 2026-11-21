import { trackPlayback } from "./analytics";
import { takePreviewOpen } from "./previewWarm";

const LIMIT_MS = 15_000;
const MAX_SEEKS = 3;
const visible = () => document.visibilityState === "visible";
type Phase = "startup" | "seek" | "playback";
type Timing = { ms: number; frame: "presented" | "ready" };

/** Bounded observations per video page. No playback ticks or polling. */
export function playbackMetrics(slug: string, getVideo: () => HTMLVideoElement | null | undefined) {
  let startup: number | undefined;
  let seek: { started: number; target: number } | undefined;
  let ignoredSeek: { target: number; until: number } | undefined;
  let started = false;
  let summarized = false;
  let failed = false;
  let resumingSeek = false;
  let seeks = 0;
  let stall: number | undefined;
  let stalls = 0;
  let stallMs = 0;
  let startupTimer = 0;
  let seekTimer = 0;
  let sendSeekTimer = 0;
  let cancelStartupFrame: (() => void) | undefined;
  let cancelSeekFrame: (() => void) | undefined;

  const failure = (phase: Phase, reason: "error" | "timeout") => {
    if (failed || !visible()) return;
    failed = true;
    trackPlayback(slug, "video-failure", { phase, reason });
  };

  const stopStall = () => {
    if (stall === undefined) return;
    const ms = performance.now() - stall;
    stall = undefined;
    if (ms >= 250) {
      stalls = Math.min(stalls + 1, 100);
      stallMs = Math.min(stallMs + ms, 600_000);
    }
  };
  const clearStartup = () => {
    startup = undefined;
    window.clearTimeout(startupTimer);
    cancelStartupFrame?.();
    cancelStartupFrame = undefined;
  };
  const clearSeek = () => {
    seek = undefined;
    window.clearTimeout(seekTimer);
    window.clearTimeout(sendSeekTimer);
    cancelSeekFrame?.();
    cancelSeekFrame = undefined;
  };

  // Use the compositor callback where available. The playing/seeked event is a
  // labeled fallback for older browsers and browsers that skip callbacks while paused.
  const firstFrame = (since: number, accept: (timing: Timing) => void, target?: number) => {
    const video = getVideo();
    const elapsed = () => Math.min(LIMIT_MS, Math.max(0, Math.round(performance.now() - since)));
    const ready = elapsed();
    if (!video?.requestVideoFrameCallback) {
      accept({ ms: ready, frame: "ready" });
      return;
    }
    let id = 0;
    const cancel = () => {
      window.clearTimeout(fallback);
      video.cancelVideoFrameCallback(id);
    };
    const fallback = window.setTimeout(() => {
      cancel();
      accept({ ms: ready, frame: "ready" });
    }, 350);
    const frame: VideoFrameRequestCallback = (_, info) => {
      if (target !== undefined && Math.abs(info.mediaTime - target) > 0.5) {
        id = video.requestVideoFrameCallback(frame);
        return;
      }
      cancel();
      accept({ ms: elapsed(), frame: "presented" });
    };
    id = video.requestVideoFrameCallback(frame);
    return cancel;
  };

  const play = () => {
    if (started || startup !== undefined || !visible()) return;
    startup = performance.now();
    startupTimer = window.setTimeout(() => {
      failure("startup", "timeout");
      clearStartup();
    }, LIMIT_MS);
  };
  const flush = () => {
    stopStall();
    if (started && !summarized) {
      summarized = true;
      trackPlayback(slug, "video-session", { stalls, stall_ms: Math.round(stallMs) });
    }
  };

  return {
    play,
    playRejected: clearStartup,
    playing() {
      stopStall();
      resumingSeek = false;
      if (started || !visible()) return;
      started = true;
      const since = startup;
      clearStartup();
      const opening = takePreviewOpen(slug);
      const from = since ?? opening?.at;
      if (from !== undefined) {
        cancelStartupFrame = firstFrame(from, (timing) => {
          if (!visible()) return;
          if (since !== undefined) trackPlayback(slug, "video-startup", timing);
          if (opening) {
            const ms = Math.min(LIMIT_MS, Math.max(0, Math.round(timing.ms + from - opening.at)));
            trackPlayback(slug, "video-open", { ...timing, ms, group: opening.group });
          }
        });
      }
    },
    ignoreSeek(target: number) {
      ignoredSeek = { target, until: performance.now() + 500 };
    },
    seeking(target: number) {
      stopStall();
      resumingSeek = true;
      if (ignoredSeek && performance.now() < ignoredSeek.until && Math.abs(target - ignoredSeek.target) < 0.2) {
        ignoredSeek = undefined;
        return;
      }
      clearSeek();
      if (!visible() || seeks >= MAX_SEEKS) return;
      seek = { started: performance.now(), target };
      seekTimer = window.setTimeout(() => {
        failure("seek", "timeout");
        clearSeek();
      }, LIMIT_MS);
    },
    seeked() {
      if (!seek) return;
      const { started: since, target } = seek;
      seek = undefined;
      window.clearTimeout(seekTimer);
      cancelSeekFrame = firstFrame(since, (timing) => {
        // Defer emission until the user has stopped dragging. A newer seek
        // cancels this timer, but the recorded time excludes this delay.
        sendSeekTimer = window.setTimeout(() => {
          if (!visible()) return;
          seeks++;
          trackPlayback(slug, "video-seek", timing);
        }, 250);
      }, target);
    },
    waiting() {
      if (started && visible() && !resumingSeek && !getVideo()?.paused) stall ??= performance.now();
    },
    pause() {
      stopStall();
      if (!started) clearStartup();
    },
    error() {
      failure(seek ? "seek" : started ? "playback" : "startup", "error");
      clearStartup();
      clearSeek();
      stopStall();
    },
    visibilityChanged() {
      if (visible()) return;
      clearStartup();
      clearSeek();
      stopStall();
    },
    flush,
    dispose() {
      flush();
      clearStartup();
      clearSeek();
    },
  };
}
