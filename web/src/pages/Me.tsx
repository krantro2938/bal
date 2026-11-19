import { Check, LogOut, MonitorDown, Moon, NotebookPen, Pencil, Play, Smartphone, Sun, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { toast } from "sonner";
import { Cover, VideoCard } from "@/components/DanceCard";
import { Avatar } from "@/components/Header";
import { PushSwitch } from "@/components/PushSwitch";
import { Star } from "@/components/Star";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { api, ApiError } from "@/lib/api";
import { timecode } from "@/lib/format";
import { useInstall } from "@/lib/install";
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
  if (!ready || !state || !data) {
    return <main className="mx-auto max-w-[1200px] px-3 pt-8 sm:px-4 lg:px-6" aria-busy="true"><div className="h-8 w-56 rounded bg-surface-2" /></main>;
  }

  const bySlug = new Map(data.dances.map((d) => [d.slug, d]));
  const progress = state.progress.filter((p) => bySlug.get(p.dance)?.version === p.version);
  const notesByDance = new Map<string, typeof state.notes>();
  for (const n of state.notes) notesByDance.set(n.dance, [...(notesByDance.get(n.dance) ?? []), n]);
  const dances = data.dances.filter((d) => d.kind === "dance");
  const learnedCount = dances.filter((d) => state.learned.includes(d.slug)).length;
  const empty = progress.length === 0 && state.notes.length === 0 && state.favorites.length === 0 && state.learned.length === 0;

  return (
    <main className="mx-auto max-w-[1600px] px-3 pt-4 pb-16 sm:px-5 lg:px-6 lg:pt-8">
      {/* Dark theme: a soft violet glow from the top, behind the see-through header (like YouTube's «Вы»). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 hidden h-[480px] dark:block"
        style={{
          background:
            "radial-gradient(80% 75% at 18% 0%, #4b3aa866, transparent 70%), radial-gradient(65% 60% at 88% 0%, #2546a35c, transparent 72%)",
          maskImage: "linear-gradient(to bottom, #000 45%, transparent)",
        }}
      />

      {/* You: picture, name, @handle; your public profile is one tap away. */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
          <span className="sm:hidden">
            <Avatar user={user!} size={72} />
          </span>
          <span className="max-sm:hidden">
            <Avatar user={user!} size={112} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[24px] leading-tight font-semibold sm:text-[32px]">{user!.name}</h1>
            <div className="mt-1 text-[14px] text-ink-3">
              <UsernameEditor username={user!.username} />
            </div>
            <Link
              to={`/@${user!.username}`}
              className="mt-3 inline-flex h-9 items-center rounded-full bg-accent-soft px-4 text-[14px] font-medium hover:brightness-110 max-sm:hidden"
            >
              Открыть профиль
            </Link>
          </div>
        </div>
        <Link
          to={`/@${user!.username}`}
          className="flex h-10 items-center justify-center rounded-full bg-accent-soft text-[15px] font-medium active:brightness-110 sm:hidden"
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
          {progress.length ? (
            <section>
              <Title>Продолжить</Title>
              <ul className="-mx-3 flex gap-4 overflow-x-auto px-3 pb-2 [scrollbar-width:none] sm:-mx-5 sm:px-5 lg:mx-0 lg:grid lg:grid-cols-2 lg:px-0">
                {progress.map((p) => {
                  const d = bySlug.get(p.dance)!;
                  return (
                    <li key={p.dance} className="w-[72vw] shrink-0 sm:w-[300px] lg:w-auto">
                      <Link to={`/dance/${d.slug}?t=${Math.floor(p.position)}`} className="group block">
                        {/* clipped with the cover so the bar follows its rounded corners */}
                        <div className="relative overflow-hidden rounded-[var(--radius-frame)]">
                          <Cover dance={d} />
                          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
                            <div className="h-full bg-[#e8ddc2]" style={{ width: `${Math.min(100, (p.position / (d.duration || 1)) * 100)}%` }} />
                          </div>
                        </div>
                        <p className="mt-2 font-title text-lg group-hover:underline">{d.title}</p>
                        <p className="tnum text-[13px] text-ink-3">с {timecode(p.position)}</p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {state.notes.length ? (
            <section>
              <Title icon={<NotebookPen className="size-3.5 text-accent" />}>Заметки</Title>
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

          {state.favorites.length ? (
            <section>
              <Title>Избранное</Title>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-2 lg:grid-cols-1">
                {state.favorites.map((s) => bySlug.get(s)).filter((d): d is DanceSummary => !!d).map((d) => <VideoCard key={d.slug} dance={d} />)}
              </div>
            </section>
          ) : null}

          <section>
            <Title>
              Выучено <span className="tnum ml-1 font-normal normal-case tracking-normal">{learnedCount} из {dances.length}</span>
            </Title>
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
                // The row is the checkbox; the video opens from its own button on the right.
                return (
                  <li key={d.slug} className="flex items-center gap-1">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={done}
                      onClick={toggle}
                      className="group -ml-2 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface"
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
                      className="grid size-9 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface hover:text-ink"
                    >
                      <Play className="size-4" />
                    </Link>
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

/** Notifications, installing, theme and signing out: what the account menu used to hold. */
function Settings({ className }: { className?: string }) {
  const { logout } = useSession();
  const navigate = useNavigate();
  const install = useInstall();
  const [theme, toggleTheme] = useTheme();
  const dark = theme === "dark";
  const row = "flex w-full items-center gap-3 px-4 py-3 text-left text-[15px] hover:bg-hover";
  return (
    <section className={className}>
      <Title>Настройки</Title>
      <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-sheet)] border border-line">
        <PushSwitch className="py-3" />
        {install.available ? (
          <button type="button" onClick={() => (install.native ? install.install() : install.showHint())} className={row}>
            <Smartphone className="size-5 shrink-0 text-ink-2 sm:hidden" />
            <MonitorDown className="size-5 shrink-0 text-ink-2 max-sm:hidden" />
            Установить приложение
          </button>
        ) : null}
        <button type="button" role="switch" aria-checked={dark} onClick={toggleTheme} className={row}>
          {dark ? <Moon className="size-5 shrink-0 text-ink-2" /> : <Sun className="size-5 shrink-0 text-ink-2" />}
          <span className="flex-1">Тёмная тема</span>
          <span className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", dark ? "bg-accent" : "bg-line-strong")} aria-hidden>
            <span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform", dark && "translate-x-4")} />
          </span>
        </button>
        {/* Off the page first: signed out here, it would send you to the sign-in page. */}
        <button
          type="button"
          onClick={() => {
            navigate("/");
            logout();
          }}
          className={row}
        >
          <LogOut className="size-5 shrink-0 text-ink-2" />
          Выйти
        </button>
      </div>
    </section>
  );
}

function Title({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <h2 className="mb-4 flex items-center gap-2 text-[13px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
      {icon ?? <Star className="size-2.5 text-accent" />}
      {children}
    </h2>
  );
}

/** The public @handle used in comments and mentions; unique, checked while typing. */
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
      <button type="button" onClick={() => setEdit(true)} className="group flex items-center gap-1 hover:text-ink" title="Изменить имя пользователя">
        @{username} <Pencil className="size-3.5 opacity-60 group-hover:opacity-100" />
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
      className="flex flex-wrap items-center gap-2"
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
      <label className="flex h-9 items-center rounded-full bg-surface-2 pr-1 pl-3 text-ink focus-within:ring-1 focus-within:ring-line-strong">
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
          className="w-40 bg-transparent px-0.5 text-[14px] outline-none"
          aria-label="Имя пользователя"
        />
        <button type="submit" disabled={!ok} className="h-7 rounded-full bg-accent px-3 text-[13px] font-medium text-accent-ink disabled:opacity-40">
          Сохранить
        </button>
      </label>
      <button
        type="button"
        onClick={cancel}
        className="grid size-9 place-items-center rounded-full bg-surface-2 text-ink-3 hover:bg-line hover:text-ink"
        aria-label="Отмена"
        title="Отмена"
      >
        <X className="size-4" />
      </button>
      {hint ? <span className={check?.free && !error ? "text-accent" : "text-danger"}>{hint}</span> : null}
    </form>
  );
}
