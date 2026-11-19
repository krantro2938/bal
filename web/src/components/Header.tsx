import { CircleUserRound, LogOut, MonitorDown, Moon, NotebookPen, Search, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useSession } from "@/lib/session";
import { useInstall } from "@/lib/install";
import { useTheme } from "@/lib/theme";
import type { User } from "@/lib/types";
import { NotificationsBell } from "./Notifications";
import { SearchBox } from "./SearchBox";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  const { user, ready } = useSession();
  const loc = useLocation();
  const [mobileSearch, setMobileSearch] = useState(false);
  const loginHref = `/login?return=${encodeURIComponent(loc.pathname + loc.search)}`;

  useEffect(() => setMobileSearch(false), [loc.pathname]);

  return (
    <header className="sticky top-0 z-40 bg-bg">
      {mobileSearch ? (
        <div className="flex h-16 items-center gap-2 px-2 sm:hidden">
          <SearchBox autoFocus onClose={() => setMobileSearch(false)} />
        </div>
      ) : null}
      <div className={`flex h-16 items-center gap-1 px-3 sm:h-[72px] sm:gap-3 sm:px-6 ${mobileSearch ? "hidden sm:flex" : ""}`}>
        <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-full py-1 pr-2" aria-label="Звёздная одиссея — все танцы">
          <img src="/icons/logo.webp" alt="" className="size-8 shrink-0 rounded-full" />
          <span className="min-w-0 leading-none">
            <span className="block truncate font-display text-[18px] font-semibold italic">Звёздная одиссея</span>
            <span className="mt-0.5 block truncate text-[11px] tracking-[0.08em] whitespace-nowrap text-ink-3 uppercase">Репетиции бала</span>
          </span>
        </Link>

        <div className="hidden flex-1 justify-center sm:flex">
          <SearchBox className="max-w-[680px]" />
        </div>
        <span className="flex-1 sm:hidden" />

        <button
          type="button"
          onClick={() => setMobileSearch(true)}
          className="grid size-10 shrink-0 place-items-center rounded-full text-ink hover:bg-hover sm:hidden"
          aria-label="Поиск"
        >
          <Search className="size-5" />
        </button>
        {/* Signed in on phones, the theme switch moves into the account menu to make room for the bell. */}
        <div className={user ? "max-sm:hidden" : undefined}>
          <ThemeToggle />
        </div>
        {user ? <NotificationsBell /> : null}
        {!ready ? (
          <span className="size-10" />
        ) : user ? (
          <AccountMenu user={user} />
        ) : (
          <Link
            to={loginHref}
            aria-label="Войти"
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line-strong px-3 text-sm font-medium text-accent hover:bg-hover max-[400px]:w-9 max-[400px]:justify-center max-[400px]:px-0"
          >
            <CircleUserRound className="size-5" />
            <span className="max-[400px]:hidden">Войти</span>
          </Link>
        )}
      </div>
    </header>
  );
}

/** Profile picture, or the first letter of the name when there is none or it fails to load
 *  (Google's image host is not always reachable from Russia). */
export function Avatar({ user, size = 32 }: { user: Pick<User, "name" | "picture"> & { verified?: boolean }; size?: number }) {
  const [broken, setBroken] = useState(false);
  // The site's own account wears the ball's emblem (the organizers' Telegram picture).
  if (user.verified) {
    return <img src="/icons/logo.webp" alt="" className="shrink-0 rounded-full" style={{ width: size, height: size }} />;
  }
  return user.picture && !broken ? (
    <img
      src={user.picture}
      alt=""
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  ) : (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-accent font-medium text-accent-ink"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden
    >
      {user.name.trim().charAt(0).toUpperCase() || <CircleUserRound className="size-[60%]" />}
    </span>
  );
}

function AccountMenu({ user }: { user: User }) {
  const { logout } = useSession();
  const [theme, toggleTheme] = useTheme();
  const install = useInstall();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-hover" aria-label="Аккаунт" aria-expanded={open}>
        <Avatar user={user} />
      </button>
      {open ? (
        <div className="absolute top-12 right-0 z-50 w-72 overflow-hidden rounded-[var(--radius-sheet)] border border-line bg-bg py-2 shadow-[var(--shadow-pop)]">
          <Link to={`/@${user.username}`} className="flex items-center gap-3 px-4 pt-2 pb-3 hover:bg-hover">
            <Avatar user={user} size={40} />
            <div className="min-w-0">
              <p className="truncate font-medium">{user.name}</p>
              <p className="truncate text-[13px] text-ink-3">@{user.username}</p>
              <p className="mt-0.5 text-[13px] text-link">Открыть профиль</p>
            </div>
          </Link>
          <div className="pt-1">
            <Link to="/me" className="flex items-center gap-3 px-4 py-2.5 text-[15px] hover:bg-hover">
              <NotebookPen className="size-5 text-ink-2" /> Мои репетиции
            </Link>
            {install.available ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (install.native) install.install();
                  else install.showHint();
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-hover"
              >
                <MonitorDown className="size-5 text-ink-2" /> Установить приложение
              </button>
            ) : null}
            <button type="button" onClick={toggleTheme} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-hover sm:hidden">
              {theme === "dark" ? <Sun className="size-5 text-ink-2" /> : <Moon className="size-5 text-ink-2" />}
              {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
            </button>
            <button type="button" onClick={logout} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-hover">
              <LogOut className="size-5 text-ink-2" /> Выйти
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
