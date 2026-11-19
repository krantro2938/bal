import { CircleCheck, MessageSquare, ThumbsUp } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Cover } from "@/components/DanceCard";
import { Avatar } from "@/components/Header";
import { PixelSky } from "@/components/PixelSky";
import { Star } from "@/components/Star";
import { StateBlock } from "@/components/StateBlock";
import { TelegramIcon } from "@/components/TelegramIcon";
import { api } from "@/lib/api";
import { useCatalog } from "@/lib/catalog";
import { plural, since } from "@/lib/format";
import type { Profile as ProfileData, ProfileComment } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Arrives after `ms`: fades and rises into place. */
const rise = (ms: number): CSSProperties => ({
  animation: `rise 500ms ${ms}ms cubic-bezier(.2,.7,.2,1) both`,
});

/** /@username: anyone's public page. The site's own account (@bal) gets the ball's page instead. */
export function Profile() {
  const { handle = "" } = useParams();
  const username = handle.startsWith("@") ? handle.slice(1) : "";
  const [data, setData] = useState<{
    profile: ProfileData;
    comments: ProfileComment[];
  } | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!username) return;
    setData(null);
    setMissing(false);
    api.profile(username).then(setData, () => setMissing(true));
  }, [username]);

  useEffect(() => {
    if (data)
      document.title = `${data.profile.name} (@${data.profile.username}) · Звёздная одиссея`;
  }, [data]);

  if (!username || missing) {
    return (
      <main className="mx-auto max-w-[1200px] px-3 sm:px-4 lg:px-6">
        <StateBlock
          className="mt-6"
          title={
            username ? `Пользователя @${username} нет` : "Страница не найдена"
          }
          action={
            <Link to="/" className="text-accent underline underline-offset-4">
              К списку танцев
            </Link>
          }
        />
      </main>
    );
  }
  if (!data)
    return (
      <main
        className="mx-auto max-w-[960px] px-3 pt-8 sm:px-5"
        aria-busy="true"
      >
        <div className="h-24 rounded-[var(--radius-sheet)] bg-surface-2" />
      </main>
    );
  return data.profile.verified ? (
    <SiteProfile profile={data.profile} comments={data.comments} />
  ) : (
    <UserProfile profile={data.profile} comments={data.comments} />
  );
}

function Handle({ profile }: { profile: ProfileData }) {
  return profile.verified ? (
    <span className="inline-flex h-7 items-center gap-1 rounded-full bg-ink-2 pr-2 pl-2.5 text-[14px] font-medium text-bg">
      @{profile.username}
      <CircleCheck
        className="size-4 fill-current [&_path]:stroke-ink-2"
        strokeWidth={3}
        aria-label="Подтверждённый аккаунт"
      />
    </span>
  ) : (
    <span className="text-[15px] text-ink-3">@{profile.username}</span>
  );
}

// --- everyone ---

function UserProfile({
  profile,
  comments,
}: {
  profile: ProfileData;
  comments: ProfileComment[];
}) {
  const joined = new Date(profile.createdAt);
  const days = Math.max(
    1,
    Math.ceil((Date.now() - profile.createdAt) / 86_400_000),
  );
  return (
    <main className="mx-auto max-w-[760px] px-3 pt-8 pb-16 sm:px-5 lg:pt-12">
      <div className="flex flex-col items-center text-center">
        <div style={{ animation: "pop 600ms cubic-bezier(.2,.7,.2,1) both" }}>
          <Avatar user={profile} size={96} />
        </div>
        <h1
          className="mt-4 font-title text-[30px] leading-tight lg:text-[36px]"
          style={rise(120)}
        >
          {profile.name}
        </h1>
        <div className="mt-1" style={rise(200)}>
          <Handle profile={profile} />
        </div>
      </div>

      {/* The account's life so far: joined → latest comment, drawn left to right. */}
      <div
        className="relative mx-auto mt-10 max-w-[520px] px-2"
        style={rise(300)}
      >
        <div
          className="absolute top-[9px] right-1/4 left-1/4 h-0.5 bg-line"
          aria-hidden
        >
          <div
            className="h-full origin-left bg-accent"
            style={{
              animation: "draw 900ms 500ms cubic-bezier(.6,0,.2,1) both",
            }}
          />
        </div>
        <ol className="relative grid grid-cols-2">
          <Milestone
            delay={400}
            title="На сайте с"
            value={joined.toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            sub={`${days} ${plural(days, "день", "дня", "дней")}`}
          />
          <Milestone
            delay={1300}
            title="Последний комментарий"
            value={
              profile.lastComment ? since(profile.lastComment) : "пока нет"
            }
            sub={
              profile.lastComment
                ? new Date(profile.lastComment).toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "long",
                  })
                : "всё впереди"
            }
            dim={!profile.lastComment}
          />
        </ol>
      </div>

      <div className="mt-10 grid grid-cols-2 gap-3" style={rise(500)}>
        <Stat
          icon={<MessageSquare className="size-4" />}
          n={profile.comments}
          label={plural(
            profile.comments,
            "комментарий",
            "комментария",
            "комментариев",
          )}
        />
        <Stat
          icon={<ThumbsUp className="size-4" />}
          n={profile.likes}
          label={plural(
            profile.likes,
            "отметка «нравится»",
            "отметки «нравится»",
            "отметок «нравится»",
          )}
        />
      </div>

      <section className="mt-12" style={rise(650)}>
        <h2 className="mb-4 text-[13px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
          Комментарии
        </h2>
        {comments.length ? (
          <ul className="divide-y divide-line border-y border-line">
            {comments.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/dance/${c.dance}?c=${c.id}`}
                  className="block py-3.5 hover:bg-surface"
                >
                  <p className="flex items-baseline gap-2 text-[13px]">
                    <span className="font-medium">
                      {c.danceTitle || c.dance}
                    </span>
                    <span className="text-ink-3">{since(c.createdAt)}</span>
                  </p>
                  <p className="mt-0.5 line-clamp-3 text-[15px] break-words whitespace-pre-line">
                    {c.body}
                  </p>
                  {c.likes ? (
                    <p className="mt-1 flex items-center gap-1 text-[13px] text-ink-3">
                      <ThumbsUp className="size-3.5" /> {c.likes}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-ink-3">Пока ни одного комментария.</p>
        )}
      </section>
    </main>
  );
}

function Milestone({
  delay,
  title,
  value,
  sub,
  dim,
}: {
  delay: number;
  title: string;
  value: string;
  sub: string;
  dim?: boolean;
}) {
  return (
    <li className="flex flex-col items-center text-center">
      <span
        className={cn(
          "grid size-5 place-items-center rounded-full ring-4 ring-bg",
          dim ? "bg-line-strong" : "bg-accent text-accent-ink",
        )}
        style={{
          animation: `pop 450ms ${delay}ms cubic-bezier(.2,.7,.2,1) both`,
        }}
        aria-hidden
      >
        <Star className="size-2.5" />
      </span>
      <span
        className="mt-3 text-[12px] tracking-[0.04em] text-ink-3 uppercase"
        style={rise(delay + 100)}
      >
        {title}
      </span>
      <span
        className={cn("mt-0.5 text-[16px] font-medium", dim && "text-ink-3")}
        style={rise(delay + 150)}
      >
        {value}
      </span>
      <span className="text-[13px] text-ink-3" style={rise(delay + 200)}>
        {sub}
      </span>
    </li>
  );
}

/** Counts up from 0 once, quickly (stays put for people who prefer less motion). */
function useCountUp(n: number, ms = 900) {
  const [v, setV] = useState(() =>
    matchMedia("(prefers-reduced-motion: reduce)").matches ? n : 0,
  );
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setV(n);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      setV(Math.round(n * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [n, ms]);
  return v;
}

function Stat({
  icon,
  n,
  label,
}: {
  icon?: ReactNode;
  n: number;
  label: string;
}) {
  const v = useCountUp(n);
  return (
    <div className="rounded-[var(--radius-sheet)] bg-surface-2 px-4 py-3.5">
      <p className="tnum flex items-center gap-2 text-[26px] leading-none font-semibold">
        {icon ? <span className="text-ink-3">{icon}</span> : null}
        {v}
      </p>
      <p className="mt-1.5 text-[13px] text-ink-2">{label}</p>
    </div>
  );
}

// --- the site's own account ---

function SiteProfile({
  profile,
  comments,
}: {
  profile: ProfileData;
  comments: ProfileComment[];
}) {
  const { data } = useCatalog();
  const dances = data?.dances.filter((d) => d.kind === "dance") ?? [];
  const glossary = data?.dances.find((d) => d.kind === "glossary");
  const minutes = Math.round(
    dances.reduce((s, d) => s + (d.duration ?? 0), 0) / 60,
  );
  const notes = comments
    .filter((c) => /^[^\n]+:\n• /.test(c.body))
    .sort((a, b) => order(a.dance) - order(b.dance));
  function order(slug: string) {
    return data?.dances.find((d) => d.slug === slug)?.order ?? 99;
  }
  const bySlug = new Map(data?.dances.map((d) => [d.slug, d]));

  return (
    <main className="mx-auto max-w-[1200px] px-3 pt-4 pb-16 sm:px-5 lg:px-6 lg:pt-6">
      {/* Banner: the posters' night sky, alive, with the ball's name on it. */}
      <div
        className="relative h-44 overflow-hidden rounded-[var(--radius-sheet)] bg-[#05091a] sm:h-56 lg:h-64"
        style={{ animation: "rise 600ms both" }}
      >
        <PixelSky className="absolute inset-0 size-full" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#05091a]/75 via-[#05091a]/10 to-transparent sm:bg-gradient-to-t sm:from-[#05091a]/85 sm:via-[#05091a]/15" />
        <div className="absolute inset-x-0 top-0 p-5 text-[#ece6d6] sm:top-auto sm:bottom-0 sm:p-7">
          <p
            className="font-display text-[28px] leading-none font-semibold italic sm:text-[40px]"
            style={rise(250)}
          >
            Звёздная одиссея
          </p>
          <p
            className="mt-2 max-w-[60ch] text-[13px] text-[#ece6d6]/75 sm:text-[15px]"
            style={rise(350)}
          >
            {data?.edition ?? "Традиционный бал РТУ МИРЭА"}
          </p>
        </div>
      </div>

      {/* The account, its avatar overlapping the banner like a channel's. */}
      <div className="flex flex-col gap-4 px-1 sm:flex-row sm:items-end sm:gap-5 sm:px-4">
        <div
          className="-mt-10 w-fit rounded-full ring-4 ring-bg sm:-mt-12"
          style={{ animation: "pop 600ms 300ms cubic-bezier(.2,.7,.2,1) both" }}
        >
          <Avatar user={profile} size={96} />
        </div>
        <div className="min-w-0 flex-1 pb-1" style={rise(450)}>
          <h1 className="font-title text-[28px] leading-tight lg:text-[34px]">
            {profile.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-ink-3">
            <Handle profile={profile} />
            <span>аккаунт этого сайта</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pb-1" style={rise(550)}>
          <Link
            to="/"
            className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-[14px] font-medium text-bg hover:opacity-90"
          >
            Все танцы
          </Link>
          {data?.channel ? (
            <a
              href={data.channel}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-full bg-surface-2 px-4 text-[14px] font-medium hover:bg-line"
            >
              <TelegramIcon className="size-4" /> Канал бала
            </a>
          ) : null}
        </div>
      </div>

      <p
        className="mt-6 max-w-[68ch] px-1 text-[15px] leading-relaxed text-ink-2 sm:px-4"
        style={rise(600)}
      >
        Здесь можно репетировать дома: видео каждого танца, схемы, музыка и
        заметки, которые сохраняются на всех устройствах. Под каждым танцем
        закреплена шпаргалка к экзамену — по разбору организаторов, сверенная со
        схемой. Бал проводят организаторы РТУ МИРЭА: новости, расписание
        репетиций и сами схемы — в их канале.
      </p>

      <div
        className="mt-8 grid grid-cols-2 gap-3 sm:px-4 lg:grid-cols-4"
        style={rise(700)}
      >
        <Stat
          n={dances.length}
          label={plural(dances.length, "танец", "танца", "танцев")}
        />
        <Stat
          n={minutes}
          label={`${plural(minutes, "минута", "минуты", "минут")} видео`}
        />
        <Stat
          n={glossary?.chapters?.length ?? 0}
          label={`${plural(glossary?.chapters?.length ?? 0, "движение", "движения", "движений")} в словаре`}
        />
        <Stat
          n={notes.length}
          label={plural(
            notes.length,
            "шпаргалка к экзамену",
            "шпаргалки к экзамену",
            "шпаргалок к экзамену",
          )}
        />
      </div>

      {notes.length ? (
        <section className="mt-12 sm:px-4" style={rise(800)}>
          <h2 className="mb-4 flex items-center gap-2 text-[13px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
            <Star className="size-2.5 text-accent" /> Шпаргалки к экзамену
          </h2>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
            {notes.map((c, i) => {
              const d = bySlug.get(c.dance);
              const points = c.body
                .split("\n")
                .filter((l) => l.startsWith("• "));
              return (
                <li key={c.id} style={rise(850 + i * 50)}>
                  <Link
                    to={`/dance/${c.dance}?c=${c.id}`}
                    className="group block"
                  >
                    {d ? (
                      <div className="overflow-hidden rounded-[var(--radius-frame)]">
                        <Cover dance={d} />
                      </div>
                    ) : null}
                    <p className="mt-2.5 font-title text-lg group-hover:underline">
                      {c.danceTitle}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[14px] text-ink-2">
                      {points[0]?.slice(2)}
                    </p>
                    <p className="mt-1 flex items-center gap-3 text-[13px] text-ink-3">
                      <span>
                        {points.length}{" "}
                        {plural(points.length, "пункт", "пункта", "пунктов")}
                      </span>
                      {c.likes ? (
                        <span className="flex items-center gap-1">
                          <ThumbsUp className="size-3.5" /> {c.likes}
                        </span>
                      ) : null}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
