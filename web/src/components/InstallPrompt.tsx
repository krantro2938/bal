import { Share, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useInstall } from "@/lib/install";
import { useMini } from "@/lib/mini";
import { cn } from "@/lib/utils";

const KEY = "bal:install-dismissed";
const AGAIN_AFTER = 30 * 86400000; // ask again a month after ✕
const DELAY = 10000; // let people look around first

function dismissedRecently() {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < AGAIN_AFTER;
  } catch {
    return false;
  }
}

/** «Установить приложение»: the browser's install dialog where there is one, instructions on iPhone. */
export function InstallPrompt() {
  const { available, native, install, hintOpen, hideHint } = useInstall();
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(dismissedRecently);
  const mini = useMini();

  useEffect(() => {
    const t = setTimeout(() => setReady(true), DELAY);
    return () => clearTimeout(t);
  }, []);

  const close = () => {
    hideHint();
    setDismissed(true);
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* storage blocked: hidden for this visit */
    }
  };

  // Opened from the account menu it shows right away, even after an earlier ✕.
  if (!available || !(hintOpen || (ready && !dismissed))) return null;
  return (
    <div
      role="dialog"
      aria-label="Установить приложение"
      className={cn(
        "fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 flex items-start gap-3 rounded-2xl bg-[var(--sheet)] p-3.5 shadow-[var(--shadow-pop)] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[380px]",
        // Phones: above the mini player.
        mini && "max-sm:bottom-[calc(76px+env(safe-area-inset-bottom))]",
      )}
    >
      <img src="/icons/icon-192.png" alt="" className="size-11 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">Установить как приложение</p>
        {native ? (
          <>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-2">Своя иконка, открывается без адресной строки — удобно на репетиции.</p>
            <button
              type="button"
              onClick={async () => {
                if (!(await install())) close();
                else hideHint();
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
