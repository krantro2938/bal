import { trackPlayback } from "./analytics";

const PILOT = "vals-gavot";
const PREFIX = 512 * 1024;
type Group = "control" | "warm";
type Opening = { at: number; group: Group };
let group: Group | undefined;
let preview: { at: number; group: Group } | undefined;
let opening: Opening | undefined;
let attempted = false;

function eligible() {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } };
  return matchMedia("(hover: none)").matches && document.visibilityState === "visible" &&
    !!navigator.serviceWorker?.controller && !nav.connection?.saveData &&
    !["2g", "slow-2g", "3g"].includes(nav.connection?.effectiveType ?? "");
}

export function warmPreview(slug: string, url: string) {
  if (slug !== PILOT) return;
  void import("@/components/RehearsalPlayer").catch(() => {});
  const controller = new AbortController();
  const abort = () => controller.abort();
  document.addEventListener("visibilitychange", abort, { once: true });
  const timer = window.setTimeout(async () => {
    if (!eligible() || controller.signal.aborted) return;
    group ??= Math.random() < 0.5 ? "control" : "warm";
    preview = { at: performance.now(), group };
    if (group === "control" || attempted) return;
    attempted = true;
    try {
      const response = await fetch(url, {
        headers: { Range: `bytes=0-${PREFIX - 1}` },
        signal: controller.signal,
        cache: "no-store",
      });
      const match = /^bytes 0-524287\/(\d+)$/.exec(response.headers.get("Content-Range") ?? "");
      if (response.status !== 206 || !match || Number(match[1]) <= PREFIX) {
        await response.body?.cancel();
        return;
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== PREFIX || controller.signal.aborted) return;
      navigator.serviceWorker.controller?.postMessage({ type: "bal-video-prefix", url, bytes, total: Number(match[1]) }, [bytes]);
      trackPlayback(PILOT, "video-warm", { bytes: PREFIX });
    } catch {
      // Playback uses the normal media request if the preview goes away or warming fails.
    }
  }, 1_000);
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", abort);
    abort();
  };
}

export function markPreviewOpen(e: Pick<MouseEvent, "button" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "defaultPrevented">, slug: string) {
  if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  opening = undefined;
  if (slug !== PILOT) return;
  void import("@/components/RehearsalPlayer").catch(() => {});
  const now = performance.now();
  if (preview && now - preview.at < 30_000) opening = { at: now, group: preview.group };
}

export function takePreviewOpen(slug: string) {
  if (slug !== PILOT) return;
  const result = opening;
  opening = undefined;
  if (result && performance.now() - result.at < 15_000) return result;
}
