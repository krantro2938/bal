import { markVideoOpen, type VideoEntry } from "./analytics";

export const loadRehearsalPlayer = () => import("@/components/RehearsalPlayer");

export function openVideo(event: Pick<MouseEvent, "button" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "defaultPrevented">, slug: string, entry: VideoEntry) {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  markVideoOpen(slug, entry);
  // Start the bundle before navigation. React's lazy render uses the same import.
  void loadRehearsalPlayer().catch(() => {});
}
