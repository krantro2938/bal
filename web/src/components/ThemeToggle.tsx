import { Moon, Sun } from "lucide-react";
import { useInstall } from "@/lib/install";
import { useMini } from "@/lib/mini";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      className="grid size-10 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-hover hover:text-ink"
      aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"}
      title={dark ? "Светлая тема" : "Тёмная тема"}
    >
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}

/** Phones, guests: the theme switch at the bottom of every page, when the header's place for it
 *  went to the install button. */
export function FooterThemeToggle() {
  const { user, ready } = useSession();
  const install = useInstall();
  const mini = useMini();
  const [theme, toggle] = useTheme();
  if (!ready || user || !install.canShowHint) return null;
  const dark = theme === "dark";
  return (
    <div className={cn("flex justify-center pt-2 pb-[max(24px,env(safe-area-inset-bottom))] sm:hidden", mini && "pb-[calc(88px+env(safe-area-inset-bottom))]")}>
      <button type="button" onClick={toggle} className="flex h-9 items-center gap-2 rounded-full border border-line px-4 text-[14px] text-ink-2 hover:bg-hover hover:text-ink">
        {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
        {dark ? "Светлая тема" : "Тёмная тема"}
      </button>
    </div>
  );
}
