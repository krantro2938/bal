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

export const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// In Safari on iPhone/iPad, the Share menu offers installation.
export const isIosSafari = () =>
  isIos() && /Safari\//.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

function showHint() {
  hintOpen = true;
  emit();
}

async function openInstall() {
  const e = offer;
  if (e) {
    offer = null;
    try {
      await e.prompt();
      const { outcome } = await e.userChoice;
      hintOpen = false;
      if (outcome === "accepted") {
        installed = true;
        track("install");
      }
      emit();
      return outcome;
    } catch {
      // A browser can revoke its offer before the user taps.
    }
  }
  showHint();
}

export function useInstall() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    subscribers.add(rerender);
    return () => void subscribers.delete(rerender);
  }, []);
  const native = !!offer;
  const canShowHint = !installed && !isStandalone();
  return {
    canShowHint,
    /** The automatic card only appears when we have a browser offer or Safari instructions. */
    available: canShowHint && (native || isIosSafari()),
    native,
    hintOpen,
    openInstall,
    showHint,
    hideHint: () => {
      hintOpen = false;
      emit();
    },
  };
}
