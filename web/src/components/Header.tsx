import { CircleUserRound, Search, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { useSession } from "@/lib/session";
import { cn, hueStyle, userHue } from "@/lib/utils";
import { useInstall } from "@/lib/install";
import type { User } from "@/lib/types";
import { NotificationsBell } from "./Notifications";
import { SearchBox } from "./SearchBox";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  const { user, ready } = useSession();
  const install = useInstall();
  // Phones, guests: an install button takes the theme switch's place, which moves to the
  // bottom of the page. On computers and when signed in, installing is on the account page.
  const installHere = ready && !user && install.available;
  const loc = useLocation();
  const [mobileSearch, setMobileSearch] = useState(false);
  const loginHref = `/login?return=${encodeURIComponent(loc.pathname + loc.search)}`;

  useEffect(() => setMobileSearch(false), [loc.pathname]);
  // The account page has a glow at its top (dark theme): the header lets it through until scrolled.
  const glow = loc.pathname === "/me";
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    if (!glow) return;
    const on = () => setAtTop(window.scrollY < 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [glow]);

  return (
    <header className={cn("sticky top-0 z-40 transition-colors", glow && atTop ? "bg-transparent" : "bg-bg")}>
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
        {installHere ? (
          <button
            type="button"
            onClick={() => (install.native ? install.install() : install.showHint())}
            className="grid size-10 shrink-0 place-items-center rounded-full text-ink hover:bg-hover sm:hidden"
            aria-label="Установить приложение"
            title="Установить приложение"
          >
            <Smartphone className="size-5" />
          </button>
        ) : null}
        {/* Shown with the rest of the right side once the session is known, so nothing shifts.
            Signed in on phones, the theme switch moves to the account page to make room for the bell. */}
        {ready ? (
          <div className={user || installHere ? "max-sm:hidden" : undefined}>
            <ThemeToggle />
          </div>
        ) : null}
        {user ? <NotificationsBell /> : null}
        {!ready ? (
          <span className="size-10" />
        ) : user ? (
          // Like YouTube's «Вы»: the account opens as its own page (rehearsals, profile, settings).
          <Link to="/me" className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-hover" aria-label="Мои репетиции, профиль и настройки">
            <Avatar user={user} />
          </Link>
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
export function Avatar({ user, size = 32 }: { user: Pick<User, "name" | "picture"> & { id?: number; verified?: boolean }; size?: number }) {
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
    // The letter on the person's own colour, deep in the light theme and pale in the dark one.
    <span
      className="grid shrink-0 place-items-center rounded-full bg-[hsl(var(--hue)_48%_44%)] font-medium text-white dark:bg-[hsl(var(--hue)_62%_76%)] dark:text-[#0a1028]"
      style={{ ...hueStyle(userHue(user)), width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden
    >
      {user.name.trim().charAt(0).toUpperCase() || <CircleUserRound className="size-[60%]" />}
    </span>
  );
}
