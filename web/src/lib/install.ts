import { useEffect, useReducer } from "react";
import { track } from "./analytics";

// The browser offers installation once (beforeinstallprompt) and only if someone is listening
// early, so the offer is caught here at startup and shared by the card and the account menu.

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let offer: InstallEvent | null = null;
let installed = false;
let hintOpen = false; // the card opened from the menu
const subscribers = new Set<() => void>();
const emit = () => subscribers.forEach((f) => f());

addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  offer = e as InstallEvent;
  emit();
});
addEventListener("appinstalled", () => {
  offer = null;
  installed = true;
  emit();
});

export const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

// Safari on iPhone/iPad has no install dialog: people add the site from the share sheet.
export const isIosSafari = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) && /Safari\//.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

export function useInstall() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    subscribers.add(rerender);
    return () => void subscribers.delete(rerender);
  }, []);
  const native = !!offer;
  return {
    /** Installing is possible here: a browser offer, or instructions on iPhone. */
    available: !installed && !isStandalone() && (native || isIosSafari()),
    native,
    hintOpen,
    /** Opens the browser's dialog; true if the person installed. */
    install: async () => {
      const e = offer;
      if (!e) return false;
      await e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === "accepted") {
        offer = null;
        track("install");
      }
      emit();
      return outcome === "accepted";
    },
    showHint: () => {
      hintOpen = true;
      emit();
    },
    hideHint: () => {
      hintOpen = false;
      emit();
    },
  };
}
