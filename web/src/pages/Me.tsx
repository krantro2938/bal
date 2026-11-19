import { Check, ChevronLeft, ChevronRight, LogOut, MonitorDown, Moon, Pencil, Play, Smartphone, Sun, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { toast } from "sonner";
import { CardMenu, Cover, Views } from "@/components/DanceCard";
import { Avatar } from "@/components/Header";
import { PushSwitch } from "@/components/PushSwitch";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { api, ApiError } from "@/lib/api";
import { timecode } from "@/lib/format";
import { useInstall } from "@/lib/install";
import { WATCH } from "@/lib/mini";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import type { DanceSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useCatalog } from "@/lib/catalog";

export function Me() {
  const { user, ready, state, setMark } = useSession();
  const { data } = useCatalog();

  useEffect(() => {
    document.title = "Мои репетиции · Звёздная одиссея";
  }, []);

  if (ready && !user) return <Navigate to="/login?return=%2Fme" replace />;
  if (!ready || !state || !data) return <MeSkeleton />;

  const bySlug = new Map(data.dances.map((d) => [d.slug, d]));
  // Everything watched, newest first; the bar and «с 1:23» only where it's still the same video.
  const history = state.progress.filter((p) => bySlug.has(p.dance));
  const favorites = state.favorites.map((s) => bySlug.get(s)).filter((d): d is DanceSummary => !!d);
  const notesByDance = new Map<string, typeof state.notes>();
  for (const n of state.notes) notesByDance.set(n.dance, [...(notesByDance.get(n.dance) ?? []), n]);
  const dances = data.dances.filter((d) => d.kind === "dance");
  const learnedCount = dances.filter((d) => state.learned.includes(d.slug)).length;
  const empty = history.length === 0 && state.notes.length === 0 && state.favorites.length === 0 && state.learned.length === 0;

  return (
    <main className="mx-auto max-w-[1600px] px-3 pt-4 pb-16 sm:px-5 lg:px-6 lg:pt-8">
      <Glow />

      {/* You: picture, name, @handle; your public profile is one tap away (below on phones, at the
          far right on bigger screens, with the name and @handle centred on the picture). */}
      {/* The @handle line is always as tall as its edit field, and the field's hint hangs below it
          without taking room, so editing in place moves nothing. */}
      <section className="flex flex-col gap-7 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-6">
          <span className="shrink-0 sm:hidden">
            <Avatar user={user!} size={72} />
          </span>
          <span className="shrink-0 max-sm:hidden">
            <Avatar user={user!} size={112} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[24px] leading-tight font-semibold sm:text-[32px]">{user!.name}</h1>
            <div className="relative mt-0.5 h-9 text-[14px] text-ink-3">
              <UsernameEditor username={user!.username} />
            </div>
          </div>
        </div>
        <Link
          to={`/@${user!.username}`}
          className={cn(profileButton, "flex h-10 shrink-0 justify-center text-[15px] sm:h-9 sm:px-4 sm:text-[14px]")}
        >
          Открыть профиль
        </Link>
      </section>

      {empty ? (
        <div className="mt-8">
          <p className="font-medium">Здесь появятся танцы, которые вы начали смотреть</p>
          <p className="mt-1 text-[15px] text-ink-2">Откройте танец, поставьте на паузу в нужном месте и сохраните заметку — она будет и на телефоне, и на компьютере.</p>
          <Button asChild variant="primary" className="mt-4">
            <Link to="/">Выбрать танец</Link>
          </Button>
        </div>
      ) : null}

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="space-y-12 lg:col-span-7">
          {favorites.length ? (
            <section>
              <Title count={favorites.length}>Избранное</Title>
              <Shelf>
                {favorites.map((d) => (
                  <ShelfItem key={d.slug}>
                    <Link to={`/dance/${d.slug}`} state={WATCH} className="group block">
                      <Cover dance={d} />
                      <p className="mt-2 line-clamp-2 font-title text-[16px] leading-snug group-hover:underline">{d.title}</p>
                      <p className="tnum text-[13px] text-ink-3">{d.kind === "glossary" ? "Словарь движений" : `Танец ${String(d.order).padStart(2, "0")}`}</p>
                    </Link>
                  </ShelfItem>
                ))}
              </Shelf>
            </section>
          ) : null}

          {history.length ? (
            <section>
              <Title>История</Title>
              {/* Like YouTube's history: the cover on the left, the title and where you stopped beside it, ⋮ at the end. */}
              <ul className="space-y-3 sm:space-y-4">
                {history.map((p) => {
                  const d = bySlug.get(p.dance)!;
                  const same = d.version === p.version;
                  return (
                    <li key={p.dance} className="flex gap-1">
                      <Link
                        to={same ? `/dance/${d.slug}?t=${Math.floor(p.position)}` : `/dance/${d.slug}`}
                        state={WATCH}
                        className="group flex min-w-0 flex-1 gap-3 sm:gap-4"
                      >
                        {/* clipped with the cover so the bar follows its rounded corners */}
                        <div className="relative w-[160px] shrink-0 overflow-hidden rounded-lg sm:w-[246px] sm:rounded-[var(--radius-frame)]">
                          <Cover dance={d} className="rounded-none" />
                          {same ? (
                            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
                              <div className="h-full bg-[#e8ddc2]" style={{ width: `${Math.min(100, (p.position / (d.duration || 1)) * 100)}%` }} />
                            </div>
                          ) : null}
                        </div>
                        <div className="min-w-0 py-0.5">
                          <p className="line-clamp-2 font-title text-[16px] leading-snug group-hover:underline sm:text-[18px]">{d.title}</p>
                          <p className="tnum mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3 sm:text-[13px]">
                            <span>{d.kind === "glossary" ? "Словарь движений" : `Танец ${String(d.order).padStart(2, "0")}`}</span>
                            <Views n={d.views} />
                          </p>
                          <p className="tnum text-[12px] text-ink-3 sm:text-[13px]">{same ? `с ${timecode(p.position)}` : "видео обновлено"}</p>
                        </div>
                      </Link>
                      <CardMenu dance={d} />
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {state.notes.length ? (
            <section>
              <Title count={state.notes.length}>Заметки</Title>
              <div className="space-y-6">
                {[...notesByDance.entries()].map(([slug, notes]) => {
                  const d = bySlug.get(slug);
                  return (
                    <div key={slug}>
                      <Link to={`/dance/${slug}`} className="font-title text-lg hover:underline">
                        {d?.title ?? slug}
                      </Link>
                      <ul className="mt-2 divide-y divide-line border-y border-line">
                        {notes.map((n) => (
                          <li key={n.id}>
                            <Link to={`/dance/${slug}?t=${Math.floor(n.t)}`} className="flex gap-3 py-2.5 hover:bg-surface">
                              <span className="tnum w-12 shrink-0 text-sm font-medium text-accent">{timecode(n.t)}</span>
                              <span className="min-w-0 flex-1 text-[15px] break-words whitespace-pre-wrap">
                                {n.text}
                                {d?.version && n.version !== d.version ? <span className="block text-[13px] text-ink-3">к прошлой версии видео</span> : null}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>

        <div className="flex flex-col gap-12 lg:col-span-5">
          {/* Last on phones, first beside the rehearsals on computers. */}
          <Settings className="order-last lg:order-first" />

          <section>
            <Title count={`${learnedCount} из ${dances.length}`}>Выучено</Title>
            <ul className="divide-y divide-line border-y border-line">
              {dances.map((d) => {
                const done = state.learned.includes(d.slug);
                const toggle = () =>
                  setMark("learned", d.slug, !done).then(
                    () => {
                      if (!done) track("learned");
                      toast(done ? "Отметка «Выучено» снята" : "Отмечено как выученное");
                    },
                    () => toast("Не удалось сохранить, попробуйте ещё раз"),
                  );
                // The row is the checkbox; the video opens from its own button on the right. The
                // whole row, that button too, lights up under the pointer.
                return (
                  <li key={d.slug}>
                    <div className="group -mx-2 flex items-center gap-1 rounded-lg px-2 transition-colors hover:bg-surface">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={done}
                        onClick={toggle}
                        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
                      >
                        <span
                          className={cn(
                            "grid size-5 shrink-0 place-items-center rounded-full border transition-colors",
                            done ? "border-accent bg-accent text-accent-ink" : "border-line-strong group-hover:border-accent",
                          )}
                        >
                          {done ? <Check className="size-3.5" /> : null}
                        </span>
                        <span className={cn("min-w-0 text-[15px]", !done && "text-ink-2")}>{d.title}</span>
                      </button>
                      <Link
                        to={`/dance/${d.slug}`}
                        aria-label={`Открыть видео «${d.title}»`}
                        title="Открыть видео"
                        className="grid size-9 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                      >
                        <Play className="size-4" />
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}

/** Dark theme: a soft violet glow from the top, behind the see-through header (like YouTube's «Вы»). */
function Glow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 hidden h-[480px] dark:block"
      style={{
        background:
          "radial-gradient(80% 75% at 18% 0%, #4b3aa866, transparent 70%), radial-gradient(65% 60% at 88% 0%, #2546a35c, transparent 72%)",
        maskImage: "linear-gradient(to bottom, #000 45%, transparent)",
      }}
    />
  );
}

/** The page's own shapes while it loads (you, the «Избранное» row, «История» rows; settings and
 *  «Выучено» beside them on computers, below on phones), so nothing jumps when it arrives. Once
 *  the session is known, your picture and name are already the real ones. */
function MeSkeleton() {
  const { user } = useSession();
  const block = "rounded-lg bg-surface-2";
  return (
    <main className="mx-auto max-w-[1600px] px-3 pt-4 pb-16 sm:px-5 lg:px-6 lg:pt-8" aria-busy="true" aria-label="Загрузка">
      <Glow />
      <section className="flex flex-col gap-7 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-6">
          {user ? (
            <>
              <span className="shrink-0 sm:hidden">
                <Avatar user={user} size={72} />
              </span>
              <span className="shrink-0 max-sm:hidden">
                <Avatar user={user} size={112} />
              </span>
            </>
          ) : (
            <div className="size-[72px] shrink-0 rounded-full bg-surface-2 sm:size-28" />
          )}
          <div className="min-w-0 flex-1">
            {user ? (
              <h1 className="truncate text-[24px] leading-tight font-semibold sm:text-[32px]">{user.name}</h1>
            ) : (
              <div className={cn(block, "h-[30px] w-44 sm:h-10 sm:w-56")} />
            )}
            <div className="mt-0.5 flex h-9 items-center">
              {user ? <span className="text-[14px] text-ink-3">@{user.username}</span> : <div className={cn(block, "h-3.5 w-28")} />}
            </div>
          </div>
        </div>
        <div className="h-10 shrink-0 rounded-full bg-surface-2 sm:h-9 sm:w-40" />
      </section>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="space-y-12 lg:col-span-7">
          <div>
            <div className={cn(block, "mb-3 h-6 w-36")} />
            <div className="-mx-3 flex gap-3 overflow-hidden px-3 pb-2 sm:-mx-5 sm:gap-4 sm:px-5 lg:mx-0 lg:px-0">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="w-[56vw] max-w-[260px] shrink-0 sm:w-[240px]">
                  <div className="aspect-video rounded-[var(--radius-frame)] bg-surface-2" />
                  <div className={cn(block, "mt-2 h-4 w-3/5")} />
                  <div className={cn(block, "mt-1.5 h-3 w-16")} />
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className={cn(block, "mb-3 h-6 w-28")} />
            <div className="space-y-3 sm:space-y-4">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex gap-3 sm:gap-4">
                  <div className="aspect-video w-[160px] shrink-0 rounded-lg bg-surface-2 sm:w-[246px] sm:rounded-[var(--radius-frame)]" />
                  <div className="min-w-0 flex-1 space-y-2 py-1">
                    <div className={cn(block, "h-4 w-3/4 max-w-56 sm:h-5")} />
                    <div className={cn(block, "h-3 w-24")} />
                    <div className={cn(block, "h-3 w-12")} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-12 lg:col-span-5">
          <div className="order-last lg:order-first">
            <div className={cn(block, "mb-3 h-6 w-32")} />
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex h-12 items-center gap-3">
                <div className="size-5 shrink-0 rounded-full bg-surface-2" />
                <div className={cn(block, "h-3.5")} style={{ width: `${[34, 30, 46, 18][i]}%` }} />
              </div>
            ))}
          </div>
          <div>
            <div className={cn(block, "mb-3 h-6 w-36")} />
            <div className="divide-y divide-line border-y border-line">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="flex h-[45px] items-center gap-3">
                  <div className="size-5 shrink-0 rounded-full bg-surface-2" />
                  <div className={cn(block, "h-3.5")} style={{ width: `${[52, 38, 44, 30, 56, 46, 36, 48][i]}%` }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/** Theme, notifications, installing and signing out: what the account menu used to hold. Plain
 *  rows under the heading; only the two that open or do something light up under the pointer. */
function Settings({ className }: { className?: string }) {
  const { logout } = useSession();
  const navigate = useNavigate();
  const install = useInstall();
  const [theme, toggleTheme] = useTheme();
  const dark = theme === "dark";
  const row = "flex w-full items-center gap-3 py-3 text-left text-[15px]";
  const action = cn(row, "-mx-2 w-[calc(100%+16px)] rounded-lg px-2 transition-colors hover:bg-surface");
  return (
    <section className={className}>
      <Title>Настройки</Title>
      <div>
        <button type="button" role="switch" aria-checked={dark} onClick={toggleTheme} className={row}>
          {dark ? <Moon className="size-5 shrink-0 text-ink-2" /> : <Sun className="size-5 shrink-0 text-ink-2" />}
          <span className="flex-1">Тёмная тема</span>
          <span className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", dark ? "bg-accent" : "bg-line-strong")} aria-hidden>
            <span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full shadow transition", dark ? "translate-x-4 bg-accent-ink" : "bg-white")} />
          </span>
        </button>
        <PushSwitch className="px-0 py-3 hover:bg-transparent" />
        {install.available ? (
          <button type="button" onClick={() => (install.native ? install.install() : install.showHint())} className={action}>
            <Smartphone className="size-5 shrink-0 text-ink-2 sm:hidden" />
            <MonitorDown className="size-5 shrink-0 text-ink-2 max-sm:hidden" />
            Установить приложение
          </button>
        ) : null}
        {/* Off the page first: signed out here, it would send you to the sign-in page. */}
        <button
          type="button"
          onClick={() => {
            navigate("/");
            logout();
          }}
          className={action}
        >
          <LogOut className="size-5 shrink-0 text-ink-2" />
          Выйти
        </button>
      </div>
    </section>
  );
}

/** A section's heading, plain and clear, like YouTube's «История». */
function Title({ children, count }: { children: ReactNode; count?: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-baseline gap-2 text-[20px] font-semibold">
      {children}
      {count !== undefined ? <span className="tnum text-[15px] font-normal text-ink-3">{count}</span> : null}
    </h2>
  );
}

/** A row of video covers scrolled sideways: swiped on phones; with a mouse, arrows show at
 *  the ends that have more (like YouTube's shelves). */
function Shelf({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  const go = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });
  // Centred on the covers (240px wide, 16:9), not on the whole card with its title.
  const arrow =
    "absolute top-[67px] z-10 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-[var(--sheet)] text-ink shadow-[var(--shadow-pop)] hover:bg-surface-2 [@media(hover:hover)]:grid";
  return (
    <div className="relative">
      <ul ref={ref} className="-mx-3 flex snap-x gap-3 overflow-x-auto scroll-px-3 px-3 pb-2 [scrollbar-width:none] sm:-mx-5 sm:gap-4 sm:scroll-px-5 sm:px-5 lg:mx-0 lg:scroll-px-0 lg:px-0">
        {children}
      </ul>
      {more.left ? (
        <button type="button" onClick={() => go(-1)} className={cn(arrow, "-left-3")} aria-label="Назад">
          <ChevronLeft className="size-5" />
        </button>
      ) : null}
      {more.right ? (
        <button type="button" onClick={() => go(1)} className={cn(arrow, "-right-3")} aria-label="Дальше">
          <ChevronRight className="size-5" />
        </button>
      ) : null}
    </div>
  );
}

function ShelfItem({ children }: { children: ReactNode }) {
  return <li className="w-[56vw] max-w-[260px] shrink-0 snap-start sm:w-[240px]">{children}</li>;
}

// «Открыть профиль»: a gradient from the site's accent into the violet of the page's glow.
// Light theme: navy to indigo with white text; dark: moon-ivory to lavender with dark text.
const profileButton =
  "items-center rounded-full bg-gradient-to-r from-[#1c2b6e] to-[#4b3aa8] font-medium text-white shadow-sm transition hover:brightness-110 dark:from-[#e8ddc2] dark:to-[#c4b8f2] dark:text-[#0a1028] dark:hover:brightness-105";

/** The public @handle used in comments and mentions; unique, checked while typing. Edited in
 *  place: the field takes the handle's own row (h-9) and its hint hangs below it. */
function UsernameEditor({ username }: { username: string }) {
  const { refresh } = useSession();
  const [edit, setEdit] = useState(false);
  const [value, setValue] = useState(username);
  const [check, setCheck] = useState<{ valid: boolean; free: boolean } | null>(null);
  const [error, setError] = useState("");
  const clean = value.trim().replace(/^@/, "").toLowerCase();
  useEffect(() => {
    if (!edit || clean === username) return setCheck(null);
    const t = setTimeout(() => api.usernameFree(clean).then(setCheck, () => setCheck(null)), 300);
    return () => clearTimeout(t);
  }, [clean, edit, username]);
  if (!edit) {
    return (
      <button type="button" onClick={() => setEdit(true)} className="group flex h-9 items-center gap-1.5 hover:text-ink" title="Изменить имя пользователя">
        @{username} <Pencil className="size-3.5 text-ink-2 group-hover:text-ink" />
      </button>
    );
  }
  const hint = error || (check ? (!check.valid ? "3–30 символов: a–z, цифры, «_» и «.», первая — буква" : check.free ? "Свободно" : "Уже занято") : "");
  const ok = clean === username || (check?.valid && check.free);
  const cancel = () => {
    setValue(username);
    setError("");
    setEdit(false);
  };
  return (
    <form
      className="flex h-9 max-w-[360px] items-center gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (clean === username) return setEdit(false);
        try {
          await api.setUsername(clean);
          await refresh();
          setEdit(false);
          toast(`Теперь вы @${clean}`);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Не удалось сохранить");
        }
      }}
    >
      <label className="flex h-9 min-w-0 flex-1 items-center rounded-full bg-surface-2 pr-1 pl-3 text-ink focus-within:ring-1 focus-within:ring-line-strong">
        <span className="text-ink-3">@</span>
        <input
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => e.key === "Escape" && cancel()}
          maxLength={31}
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          className="w-full min-w-0 bg-transparent px-0.5 text-[14px] outline-none"
          aria-label="Имя пользователя"
        />
        <button type="submit" disabled={!ok} className="h-7 shrink-0 rounded-full bg-accent px-3 text-[13px] font-medium text-accent-ink disabled:opacity-40">
          Сохранить
        </button>
      </label>
      <button
        type="button"
        onClick={cancel}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-3 hover:bg-line hover:text-ink"
        aria-label="Отмена"
        title="Отмена"
      >
        <X className="size-4" />
      </button>
      {hint ? (
        <span className={cn("absolute inset-x-0 top-full mt-1 truncate text-[13px]", check?.free && !error ? "text-accent" : "text-danger")}>{hint}</span>
      ) : null}
    </form>
  );
}
