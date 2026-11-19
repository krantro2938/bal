import { BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";
import { useInstall } from "@/lib/install";
import { usePush } from "@/lib/push";
import { cn } from "@/lib/utils";

/** «Уведомления на этом устройстве» with a switch, in the account menu and the bell's list.
 *  On an iPhone outside the installed app it explains that installing comes first. */
export function PushSwitch({ className }: { className?: string }) {
  const push = usePush();
  const install = useInstall();
  // className comes last, so a page can override the padding or the hover.
  const row = (...extra: string[]) => cn("flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px]", ...extra, className);
  if (push.state === "unsupported") return null;
  if (push.state === "install") {
    return (
      <button type="button" onClick={install.showHint} className={row("hover:bg-hover")}>
        <BellRing className="size-5 shrink-0 text-ink-2" />
        <span className="min-w-0">
          Уведомления
          <span className="block text-[13px] text-ink-3">Сначала установите приложение на экран «Домой»</span>
        </span>
      </button>
    );
  }
  if (push.state === "denied") {
    return (
      <div className={row()}>
        <BellOff className="size-5 shrink-0 text-ink-3" />
        <span className="min-w-0">
          Уведомления
          <span className="block text-[13px] text-ink-3">Запрещены в настройках браузера для этого сайта</span>
        </span>
      </div>
    );
  }
  const on = push.state === "on";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={push.busy}
      onClick={async () => {
        const wasOn = on;
        if (!(await push.toggle())) toast("Не удалось включить уведомления");
        else toast(wasOn ? "Уведомления выключены" : "Уведомления включены: ответы, упоминания и новые видео");
      }}
      className={row("hover:bg-hover disabled:opacity-60")}
    >
      <BellRing className="size-5 shrink-0 text-ink-2" />
      <span className="min-w-0 flex-1">
        Уведомления
        <span className="block text-[13px] text-ink-3">Ответы, упоминания и новые видео</span>
      </span>
      <span className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-line-strong")} aria-hidden>
        <span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full shadow transition", on ? "translate-x-4 bg-accent-ink" : "bg-white")} />
      </span>
    </button>
  );
}
