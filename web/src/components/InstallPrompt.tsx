import { Share, X } from "lucide-react";
import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const KEY = "bal:install-dismissed";
const AGAIN_AFTER = 30 * 86400000; // ask again a month after ✕
const DELAY = 20000; // let people look around first

function dismissedRecently() {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < AGAIN_AFTER;
  } catch {
    return false;
  }
}

const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
// Safari on iPhone/iPad has no install prompt: people add the site from the share sheet.
const iosSafari = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && /Safari\//.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

/** «Установить приложение»: the browser's install dialog where there is one, instructions on iPhone. */
export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(() => standalone() || dismissedRecently());

  useEffect(() => {
    if (hidden) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    const onInstalled = () => setHidden(true);
    addEventListener("beforeinstallprompt", onPrompt);
    addEventListener("appinstalled", onInstalled);
    setIos(iosSafari());
    const t = setTimeout(() => setReady(true), DELAY);
    return () => {
      removeEventListener("beforeinstallprompt", onPrompt);
      removeEventListener("appinstalled", onInstalled);
      clearTimeout(t);
    };
  }, [hidden]);

  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* storage blocked: hidden for this visit */
    }
  };

  if (hidden || !ready || (!event && !ios)) return null;
  return (
    <div
      role="dialog"
      aria-label="Установить приложение"
      className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 flex items-start gap-3 rounded-2xl bg-[var(--sheet)] p-3.5 shadow-[var(--shadow-pop)] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[380px]"
    >
      <img src="/icons/icon-192.png" alt="" className="size-11 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">Установить как приложение</p>
        {event ? (
          <>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-2">Своя иконка, открывается без адресной строки — удобно на репетиции.</p>
            <button
              type="button"
              onClick={async () => {
                await event.prompt();
                const { outcome } = await event.userChoice;
                if (outcome === "accepted") setHidden(true);
                else close();
              }}
              className="mt-2.5 h-9 rounded-full bg-accent px-4 text-[14px] font-medium text-accent-ink"
            >
              Установить
            </button>
          </>
        ) : (
          <p className="mt-0.5 text-[13px] leading-snug text-ink-2">
            Нажмите <Share className="inline size-4 -translate-y-px" /> «Поделиться» внизу экрана, затем «На экран „Домой“».
          </p>
        )}
      </div>
      <button type="button" onClick={close} className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-hover hover:text-ink" aria-label="Не сейчас">
        <X className="size-4" />
      </button>
    </div>
  );
}
