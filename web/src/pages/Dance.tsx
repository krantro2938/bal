import type { MediaPlayerInstance } from "@vidstack/react";
import { Bookmark, ChevronDown, ExternalLink, Film, GraduationCap, Maximize2, Music, NotebookPen, Pencil, ScrollText, Share2, Trash2, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { AudioTrack } from "@/components/AudioTrack";
import { ChaptersCarousel, ChaptersPanel } from "@/components/ChaptersPanel";
import { Comments } from "@/components/Comments";
import { Badge, CompactCard, Cover, isNew, NewBadge, Views } from "@/components/DanceCard";
import { Avatar } from "@/components/Header";
import { ReactionPill } from "@/components/ReactionPill";
import { SchemeViewer } from "@/components/SchemeViewer";
import type { Loop, Pull } from "@/components/RehearsalPlayer";
import { Catalog } from "@/pages/Catalog";
import { openMini } from "@/lib/mini";
import { Tip } from "@/components/Tip";
import { TelegramIcon } from "@/components/TelegramIcon";
import { StateBlock } from "@/components/StateBlock";
import { Button } from "@/components/ui/button";
import { AuthPrompt } from "@/components/AuthPrompt";
import { NoteInput } from "@/components/NoteInput";
import { track, trackOnce } from "@/lib/analytics";
import { api, ApiError } from "@/lib/api";
import { useCatalog } from "@/lib/catalog";
import { ago, fullDate, parseTime, timecode } from "@/lib/format";
import { useSession } from "@/lib/session";
import { shareLink } from "@/lib/share";
import { useThumbs } from "@/lib/thumbs";
import type { Chapter, DanceDetail, Note } from "@/lib/types";
import { backToTop, feedPlace } from "@/lib/scroll";
import { cn } from "@/lib/utils";

// The player bundle (Vidstack) is only fetched when a dance page opens.
const RehearsalPlayer = lazy(() => import("@/components/RehearsalPlayer").then((m) => ({ default: m.RehearsalPlayer })));
const RehearsalBar = lazy(() => import("@/components/RehearsalPlayer").then((m) => ({ default: m.RehearsalBar })));

const guestPosKey = (slug: string) => `bal-pos:${slug}`;

/** The sticky header's height (the player pins under it at top-16). */
const HEADER = 64;

export function Dance() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, state, setMark, refresh } = useSession();
  const catalog = useCatalog();
  const [dance, setDance] = useState<DanceDetail | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loop, setLoop] = useState<Loop>(null);
  const [noteDraft, setNoteDraft] = useState<{ t: number; id?: number; text: string } | null>(null);
  const [loginAsk, setLoginAsk] = useState<string | null>(null);
  const [scheme, setScheme] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const descRef = useRef<HTMLDivElement>(null);
  const player = useRef<MediaPlayerInstance>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const startAt = useMemo(() => parseTime(params.get("t")), [params]);
  // Opened from a card or the end screen (or back from the mini player): start playing at once.
  const autoPlay = !!(useLocation().state as { play?: boolean } | null)?.play;

  // Phones: dragging the video down slides this page away over the feed and hands the dance
  // to the mini player, like YouTube's app. Only the part below the header moves.
  const mainRef = useRef<HTMLElement>(null);
  const [pull, setPull] = useState<{ dy: number; settle?: boolean } | null>(null);
  const pullClip = useRef(0);
  const danceRef = useRef(dance);
  danceRef.current = dance;
  const pullHandlers = useMemo<Pull>(
    () => ({
      move(dy) {
        setPull((p) => {
          if (!p) pullClip.current = Math.max(0, HEADER - (mainRef.current?.getBoundingClientRect().top ?? HEADER));
          return { dy };
        });
      },
      end(dy, v) {
        const p = player.current;
        const d = danceRef.current;
        const h = window.innerHeight;
        if (p && d?.video && (dy > h * 0.2 || (v > 0.5 && dy > 40))) {
          const at = p.currentTime;
          const playing = !p.paused;
          p.pause();
          openMini({ slug: d.slug, title: d.title, order: d.order, kind: d.kind, url: d.video.url, poster: d.posterSmall ?? d.poster }, at, {
            volume: p.volume,
            muted: p.muted,
            play: playing,
          });
          setPull({ dy: h, settle: true });
          window.setTimeout(() => navigate(feedPlace().href), 200);
        } else {
          setPull({ dy: 0, settle: true });
          window.setTimeout(() => setPull(null), 220);
        }
      },
    }),
    [navigate],
  );
  const focusComment = Number(params.get("c")) || undefined;
  // A card's comments button: phones open the drawer, computers scroll down to the list.
  const toComments = params.has("comments");
  const [tab, setTab] = useState<"comments" | "notes">(() => {
    try {
      return localStorage.getItem(TAB_KEY) === "notes" ? "notes" : "comments";
    } catch {
      return "comments";
    }
  });
  const pickTab = (t: "comments" | "notes") => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* storage blocked: the choice lasts for this page */
    }
  };
  // A notification link opens the comments.
  useEffect(() => {
    if (focusComment || toComments) setTab("comments");
  }, [focusComment, toComments]);
  const loaded = !!dance;
  useEffect(() => {
    if (!toComments || !loaded || !matchMedia("(min-width: 1024px)").matches) return;
    const t = setTimeout(() => document.getElementById("comments")?.scrollIntoView({ behavior: "smooth" }), 150);
    return () => clearTimeout(t);
  }, [toComments, loaded]);
  const [commentCount, setCommentCount] = useState(0);
  const [theatreOn, setTheatre] = useState(() => readFlag(THEATRE_KEY));
  // Theatre mode only exists on large screens; phones keep the stored choice for later.
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const m = matchMedia(WIDE);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  const theatre = theatreOn && wide;
  const toggleTheatre = useCallback(() => {
    setTheatre((t) => {
      writeFlag(THEATRE_KEY, !t);
      return !t;
    });
  }, []);
  // T toggles theatre mode, as on YouTube (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key.toLowerCase() !== "t" || e.metaKey || e.ctrlKey || e.altKey || el.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(el.tagName)) return;
      if (matchMedia(WIDE).matches) toggleTheatre();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTheatre]);
  // Once someone closes the "you stopped at" banner, it stays closed everywhere.
  const [resumeOff, setResumeOff] = useState(() => readFlag(RESUME_OFF_KEY));
  const cues = useThumbs(dance?.thumbnails);

  useEffect(() => {
    let alive = true;
    setDance(null);
    setError(null);
    setPlayerReady(false);
    setLoop(null);
    setMore(false);
    api
      .dance(slug)
      .then((d) => {
        if (!alive) return;
        setDance(d);
        document.title = `${d.title} · Звёздная одиссея`;
      })
      .catch((e) => alive && setError({ status: e instanceof ApiError ? e.status : 0, message: e.message }));
    return () => {
      alive = false;
    };
  }, [slug, user?.id]);

  useEffect(() => {
    if (!user) {
      setNotes([]);
      return;
    }
    api.notes(slug).then(setNotes).catch(() => {});
  }, [slug, user]);

  // A ?t= link inside the same page (from search suggestions) seeks without reloading.
  useEffect(() => {
    if (startAt !== null && player.current && playerReady) player.current.currentTime = startAt;
  }, [startAt, playerReady]);

  const seek = useCallback((t: number, play = true) => {
    const p = player.current;
    if (!p) return;
    p.currentTime = t;
    if (play) p.play().catch(() => {});
    if (window.matchMedia("(max-width: 1023px)").matches) window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Resume position: server for signed-in users, this browser for guests.
  const resumeAt = useMemo(() => {
    if (!dance?.video || startAt !== null) return null;
    let pos: number | null = null;
    const p = state?.progress.find((x) => x.dance === dance.slug && x.version === dance.version);
    if (p) pos = p.position;
    else if (!user) {
      try {
        const raw = localStorage.getItem(guestPosKey(dance.slug));
        if (raw) {
          const v = JSON.parse(raw) as { version: string; position: number };
          if (v.version === dance.version) pos = v.position;
        }
      } catch {
        /* storage blocked */
      }
    }
    return pos !== null && pos > 5 && pos < dance.video.duration - 5 ? pos : null;
  }, [dance, state, user, startAt]);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  // Playing at once picks up where you stopped, like YouTube; the banner then offers the start.
  const resumeStart = autoPlay && startAt === null ? resumeAt : null;

  // Save position every 15 s of playback, on pause and when leaving.
  useEffect(() => {
    if (!dance?.video || !dance.version) return;
    const version = dance.version;
    let last = 0;
    const save = () => {
      const p = player.current;
      if (!p || p.currentTime < 1) return;
      const pos = p.currentTime;
      if (user) api.progress(dance.slug, version, pos).catch(() => {});
      else {
        try {
          localStorage.setItem(guestPosKey(dance.slug), JSON.stringify({ version, position: pos }));
        } catch {
          /* storage blocked */
        }
      }
    };
    const id = window.setInterval(() => {
      const p = player.current;
      if (p && !p.paused && Math.abs(p.currentTime - last) > 1) {
        last = p.currentTime;
        save();
      }
    }, 15000);
    const unsub = player.current?.subscribe(({ paused }) => paused && save());
    window.addEventListener("pagehide", save);
    return () => {
      window.clearInterval(id);
      unsub?.();
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [dance, user, playerReady]);

  // One view per page visit, counted when playback first starts (the server dedupes per day).
  useEffect(() => {
    const p = player.current;
    if (!p || !dance?.video) return;
    let counted = false;
    return p.subscribe(({ playing, ended, playbackRate }) => {
      if (playing && !counted) {
        counted = true;
        api.view(dance.slug).catch(() => {});
      }
      if (playing) trackOnce("play");
      if (ended) trackOnce("finished");
      if (playbackRate < 1) trackOnce("slowed");
    });
  }, [dance, playerReady]);

  useEffect(() => {
    if (loop) trackOnce("loop");
  }, [loop]);
  useEffect(() => {
    if (scheme !== null) trackOnce("scheme-opened");
  }, [scheme]);

  const currentTime = () => player.current?.currentTime ?? startAt ?? 0;

  const share = async (at?: number) => {
    const t = Math.floor(at ?? currentTime());
    const url = `${catalog.data?.shareUrl || location.origin}/dance/${slug}${t > 0 ? `?t=${t}` : ""}`;
    await shareLink(url, dance?.title, t > 0 ? `Ссылка на ${timecode(t)} скопирована` : "Ссылка скопирована");
  };

  const askLogin = (why: string) => {
    player.current?.pause();
    setLoginAsk(why);
  };

  const composer = useRef<HTMLTextAreaElement>(null);
  const startNote = () => {
    const t = currentTime();
    player.current?.pause();
    if (!user) return askLogin(`Чтобы сохранить заметку на ${timecode(t)}. Заметки видны только вам.`);
    pickTab("notes");
    setNoteDraft((d) => (d && !d.id ? { ...d, t } : { t, text: "" }));
    window.setTimeout(() => {
      composer.current?.focus();
      composer.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  };

  const saveNote = async () => {
    if (!noteDraft || !dance?.version) return;
    try {
      if (noteDraft.id) {
        const n = await api.updateNote(noteDraft.id, { text: noteDraft.text });
        setNotes((ns) => ns.map((x) => (x.id === n.id ? n : x)));
      } else {
        const n = await api.createNote({ dance: slug, version: dance.version, t: noteDraft.t, text: noteDraft.text });
        track("note-saved");
        setNotes((ns) => [...ns, n].sort((a, b) => a.t - b.t));
      }
      setNoteDraft(null);
      toast("Заметка сохранена");
      refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const deleteNote = async (id: number) => {
    const prev = notes;
    setNotes((ns) => ns.filter((n) => n.id !== id));
    try {
      await api.deleteNote(id);
      toast("Заметка удалена");
    } catch {
      setNotes(prev);
      toast("Не удалось удалить заметку");
    }
  };

  const toggleMark = (kind: "favorite" | "learned") => {
    if (!user) return askLogin(kind === "favorite" ? "Чтобы сохранять танцы и видеть их на всех устройствах." : "Чтобы отмечать выученные танцы.");
    const list = kind === "favorite" ? state?.favorites : state?.learned;
    const on = !list?.includes(slug);
    const done = kind === "favorite" ? (on ? "Сохранено — танец есть в «Избранном»" : "Убрано из сохранённых") : on ? "Отмечено как выученное" : "Отметка «Выучено» снята";
    setMark(kind, slug, on).then(
      () => {
        if (on) track(kind);
        toast(done);
      },
      () => toast("Не удалось сохранить, попробуйте ещё раз"),
    );
  };

  const react = async (v: -1 | 0 | 1) => {
    if (!user || !dance) return askLogin("Чтобы оценить видео.");
    const prev = dance;
    const likes = dance.likes + (v === 1 ? 1 : 0) - (dance.myReaction === 1 ? 1 : 0);
    const dislikes = dance.dislikes + (v === -1 ? 1 : 0) - (dance.myReaction === -1 ? 1 : 0);
    setDance({ ...dance, likes, dislikes, myReaction: v });
    try {
      const r = await api.react(slug, v);
      if (v !== 0) track("reaction");
      setDance((d) => (d ? { ...d, likes: r.likes, dislikes: r.dislikes, myReaction: r.mine } : d));
      catalog.patch(slug, { likes: r.likes, dislikes: r.dislikes, myReaction: r.mine });
    } catch {
      setDance(prev);
      toast("Не удалось сохранить оценку");
    }
  };

  const loopChapter = (c: Chapter) => {
    setLoop({ a: c.start, b: c.end });
    seek(c.start);
  };

  if (error) {
    return (
      <main className="mx-auto max-w-[1200px] px-3 sm:px-4 lg:px-6">
        <StateBlock
          className="mt-6"
          title={error.status === 404 ? "Такого танца нет в каталоге" : "Страница не загрузилась"}
          action={<Button onClick={() => navigate("/")}>К списку танцев</Button>}
        >
          {error.status === 404 ? "Проверьте ссылку или выберите танец из списка." : error.message}
        </StateBlock>
      </main>
    );
  }

  if (!dance) return <DanceSkeleton />;

  const fav = !!state?.favorites.includes(slug);
  const learned = !!state?.learned.includes(slug);
  const isGlossary = dance.kind === "glossary";
  const videoPost = dance.assets.find((a) => a.kind === "video");
  const others = (catalog.data?.dances ?? []).filter((d) => d.slug !== slug);
  // End screen: the dances after this one in programme order, wrapping round to the start.
  const programme = others.filter((d) => d.available && d.kind === "dance").sort((a, b) => a.order - b.order);
  const upNext = [...programme.filter((d) => d.order > dance.order), ...programme.filter((d) => d.order < dance.order)];
  // Sidebar: the next dance in the programme first (where a rehearsal goes on), then the rest by
  // popularity; dances you marked learned sink to the bottom.
  const done = new Set(state?.learned ?? []);
  const popularity = (d: (typeof others)[number]) => d.views + 3 * d.likes - d.dislikes;
  const recommended = [
    ...upNext.slice(0, 1),
    ...others
      .filter((d) => d.slug !== upNext[0]?.slug)
      .sort((a, b) => Number(done.has(a.slug)) - Number(done.has(b.slug)) || popularity(b) - popularity(a) || a.order - b.order),
  ];
  const caption = dance.caption.replace(/\s*#\S+/g, "").trim();
  const facts = [
    dance.hasScheme && "схема",
    dance.hasAudio && "музыка",
    dance.chapterList.length > 0 && `${dance.chapterList.length} фрагментов`,
  ].filter((f): f is string => !!f);

  return (
    // Large screens: the player is its own grid cell so theatre mode can span both columns;
    // the 1fr row keeps the side column's height from stretching the player's row.
    <>
      {pull ? (
        <div inert className="fixed inset-x-0 top-16 bottom-0 overflow-hidden">
          {/* The feed as it was left (the unfiltered one; a search or filter shows from the top). */}
          <div style={{ transform: `translateY(${feedPlace().href === "/" ? -feedPlace().y : 0}px)` }}>
            <Catalog peek />
          </div>
        </div>
      ) : null}
    <main
      ref={mainRef}
      className={cn("grid gap-x-8 px-3 pb-24 sm:px-6 sm:pt-2 lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[auto_1fr] lg:pt-6 2xl:gap-x-10", pull && "relative z-10 bg-bg")}
      style={
        pull
          ? {
              transform: `translateY(${pull.dy}px)`,
              // The page moves as an opaque sheet with rounded top corners; the feed shows above it.
              clipPath: `inset(${pullClip.current}px 0 0 0 round ${Math.min(16, pull.dy / 4)}px ${Math.min(16, pull.dy / 4)}px 0 0)`,
              transition: pull.settle ? "transform .2s ease-out" : "none",
            }
          : undefined
      }
    >
        <div data-sticky-player className={cn("sticky top-16 z-20 -mx-3 min-w-0 bg-bg sm:static sm:mx-0 lg:col-start-1 lg:row-start-1", theatre && "lg:col-span-2 lg:-mt-6")}>
          {dance.video ? (
            <Suspense fallback={<div className="aspect-video w-full bg-player sm:rounded-[var(--radius-frame)]" />}>
              <RehearsalPlayer
                dance={dance}
                player={player}
                startAt={startAt ?? resumeStart}
                loop={loop}
                setLoop={setLoop}
                onNote={startNote}
                onReady={() => setPlayerReady(true)}
                theatre={theatre}
                onTheatre={toggleTheatre}
                next={upNext}
                prev={upNext[upNext.length - 1]}
                pull={pullHandlers}
                autoPlay={autoPlay}
              />
            </Suspense>
          ) : (
            <div className="px-3 sm:px-0">
              <Cover dance={dance} quiet />
              <div className="py-4">
                <p className="font-medium">Видео ещё не загружено на сайт</p>
                <p className="mt-1 text-[15px] text-ink-2">Инструкция доступна в исходном посте канала.</p>
                <Button asChild variant="primary" className="mt-3">
                  <a href={videoPost?.post ?? dance.sourcePost} target="_blank" rel="noopener">
                    Открыть пост в Telegram <ExternalLink />
                  </a>
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          {/* The rehearsal bar sits here rather than in the player's cell: on phones it scrolls away
              while the player stays pinned, and in theatre mode the side column starts level with it. */}
          {dance.video ? (
            <Suspense fallback={<div className="h-[52px]" />}>
              <RehearsalBar player={player} duration={dance.video.duration} loop={loop} setLoop={setLoop} notes={notes} onNote={startNote} />
            </Suspense>
          ) : null}
          <h1 className="font-title mt-3 text-[24px] leading-tight sm:mt-6 lg:text-[30px]">{dance.title}</h1>
          {/* Phones: views and date under the title, like YouTube's app; the description card drops them. */}
          <p className="tnum mt-1 flex flex-wrap gap-x-2 text-[13px] text-ink-3 sm:hidden">
            <Views n={dance.views} />
            {dance.published ? <span>{ago(dance.published)}</span> : null}
            {facts.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </p>

          {/* On phones only the badge stays and the actions lose their labels, like YouTube's app. */}
          <div className="mt-4 flex items-center gap-3 sm:flex-wrap sm:gap-x-6 sm:gap-y-4">
            {/* Like a channel on YouTube: the badge and name lead to the ball's own page, @bal. */}
            <Link to="/@bal" className="group/channel flex min-w-0 shrink-0 items-center gap-3 rounded-full" aria-label="Традиционный бал РТУ МИРЭА — страница @bal">
              <Badge dance={dance} size={40} />
              <div className="min-w-0 leading-tight max-sm:hidden">
                <p className="truncate text-[15px] font-medium group-hover/channel:underline group-hover/channel:underline-offset-4">Традиционный бал РТУ МИРЭА</p>
                <p className="tnum flex gap-x-2 text-[13px] text-ink-3">
                  <span>{isGlossary ? "Словарь движений" : `Танец ${String(dance.order).padStart(2, "0")}`}</span>
                  {dance.duration ? <span>{timecode(dance.duration)}</span> : null}
                </p>
              </div>
            </Link>
            {/* On phones the actions sit at the right edge, icons only, and always fit (no scrolling). */}
            <div className="flex flex-1 justify-end gap-2 max-sm:min-w-0 max-[370px]:gap-1.5 sm:flex-auto">
              <ReactionPill likes={dance.likes} dislikes={dance.dislikes} mine={dance.myReaction} onReact={react} />
              <Pill onClick={() => share()} icon={<Share2 />} label="Поделиться" iconOnly />
              <Pill
                onClick={() => toggleMark("favorite")}
                icon={<Bookmark className={cn(fav && "fill-current")} />}
                pressed={fav}
                label={fav ? "Убрать из сохранённых" : "Сохранить"}
                iconOnly
              />
              {!isGlossary ? (
                <Pill
                  onClick={() => toggleMark("learned")}
                  icon={<GraduationCap />}
                  pressed={learned}
                  strong={learned}
                  label={learned ? "Выучено" : "Отметить «Выучено»"}
                />
              ) : null}
            </div>
          </div>

          {resumeAt !== null && !resumeDismissed && !resumeOff ? (
            <div className="mt-5 flex items-center gap-2 rounded-[var(--radius-frame)] bg-accent-soft px-4 py-2.5 text-[15px]">
              <span className="tnum flex-1">{resumeStart !== null ? `Продолжаем с ${timecode(resumeAt)}` : `Вы остановились на ${timecode(resumeAt)}`}</span>
              {resumeStart === null ? (
                <button
                  type="button"
                  onClick={() => {
                    seek(resumeAt);
                    setResumeDismissed(true);
                  }}
                  className="rounded-full bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-ink"
                >
                  Продолжить
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (resumeStart !== null) seek(0);
                  setResumeDismissed(true);
                }}
                className={cn(
                  "rounded-full py-1.5 text-sm",
                  resumeStart !== null ? "bg-accent px-3.5 font-medium text-accent-ink" : "px-2 text-ink-2 hover:text-ink",
                )}
              >
                Сначала
              </button>
              <button
                type="button"
                onClick={() => {
                  setResumeOff(true);
                  writeFlag(RESUME_OFF_KEY, true);
                }}
                className="-mr-2 grid size-8 place-items-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
                aria-label="Больше не показывать"
                title="Больше не показывать"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : null}

          {/* Description card, like YouTube's: short text, expands to the organizers' caption and sources. */}
          <div
            ref={descRef}
            className={cn(
              "mt-5 rounded-[var(--radius-sheet)] bg-surface-2 p-4 text-[15px] leading-normal lg:p-5",
              !more && "cursor-pointer transition-colors hover:bg-line/60",
            )}
            onClick={() => !more && setMore(true)}
          >
            <p className={cn("tnum flex flex-wrap gap-x-2.5 text-[14px] font-semibold", !more && "max-sm:hidden")}>
              <Views n={dance.views} />
              {dance.published ? <span title={fullDate(dance.published)}>{more ? fullDate(dance.published) : ago(dance.published)}</span> : null}
              {isNew(dance) ? (
                <span className="self-center">
                  <NewBadge />
                </span>
              ) : null}
              {facts.map((f) => (
                <span key={f} className="font-medium text-ink-2">
                  {f}
                </span>
              ))}
            </p>
            <p className={cn("mt-1.5 max-w-[75ch] text-ink-soft", !more && "line-clamp-2 max-sm:mt-0")}>{dance.description}</p>
            {more ? (
              <>
                {caption ? (
                  <div className="mt-5 max-w-[75ch] border-t border-line-strong/60 pt-5">
                    <p className="text-[14px] font-medium text-ink-2">Из поста организаторов</p>
                    <p className="mt-2 whitespace-pre-line text-ink-soft">{caption}</p>
                  </div>
                ) : null}
                <div className="mt-5 border-t border-line-strong/60 pt-5">
                  <p className="text-[14px] font-medium text-ink-2">Источники в Telegram</p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {dance.assets.map((a) => {
                      const Icon = { video: Film, scheme: ScrollText, audio: Music }[a.kind];
                      return (
                        <li key={a.post + a.originalFilename}>
                          <a
                            href={a.post}
                            target="_blank"
                            rel="noopener"
                            className="flex h-9 items-center gap-2 rounded-full bg-bg pr-3.5 pl-2.5 text-[14px] transition-colors hover:bg-hover"
                            title={a.originalFilename}
                          >
                            <TelegramIcon className="size-[18px]" />
                            <Icon className="size-4 text-ink-3" />
                            <span className="font-medium">{{ video: "Видео", scheme: "Схема", audio: "Музыка" }[a.kind]}</span>
                            <span className="tnum text-ink-3">#{a.post.split("/").pop()}</span>
                            {a.status !== "obtained" ? <span className="text-ink-3">только в Telegram</span> : null}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMore(false);
                    requestAnimationFrame(() => backToTop(descRef.current));
                  }}
                  className="mt-5 text-[15px] font-medium underline-offset-4 hover:underline">
                  Свернуть
                </button>
              </>
            ) : (
              <span className="mt-2 flex items-center gap-1 text-[15px] font-medium">
                ещё <ChevronDown className="size-4" />
              </span>
            )}
          </div>

          {dance.chapterList.length > 0 ? (
            <div className="mt-8 lg:hidden">
              <ChaptersCarousel chapters={dance.chapterList} cues={cues} player={player} onSeek={seek} />
            </div>
          ) : null}

          {/* Comments and private notes share one place; the last choice is remembered. */}
          <section id="comments" className="mt-10 scroll-mt-24">
            <div role="tablist" className="mb-5 flex gap-6 border-b border-line">
              {(
                [
                  ["comments", "Комментарии", commentCount],
                  ["notes", "Мои заметки", notes.length],
                ] as const
              ).map(([id, label, n]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => pickTab(id)}
                  className={cn(
                    "-mb-px border-b-2 pb-2.5 text-[18px] font-semibold transition-colors",
                    tab === id ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink-2",
                  )}
                >
                  {label}
                  {n ? <span className="tnum ml-1.5 font-normal text-ink-3">{n}</span> : null}
                </button>
              ))}
            </div>
            <div className={cn(tab !== "comments" && "hidden")}>
              <Comments
                slug={slug}
                user={user}
                duration={dance.video?.duration ?? dance.duration ?? 0}
                now={currentTime}
                onSeek={(t) => seek(t)}
                askLogin={askLogin}
                onCount={setCommentCount}
                focusId={focusComment}
                startOpen={toComments}
              />
            </div>
            <div className={cn(tab !== "notes" && "hidden")}>
              <div className="flex gap-3">
                {user ? (
                  <Avatar user={user} size={36} />
                ) : (
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2">
                    <NotebookPen className="size-4 text-accent" />
                  </span>
                )}
                {noteDraft && !noteDraft.id ? (
                  <form
                    className="min-w-0 flex-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveNote();
                    }}
                  >
                    <span className="tnum mb-1.5 inline-block rounded-md bg-accent-soft px-1.5 py-0.5 text-[13px] font-medium text-accent">{timecode(noteDraft.t)}</span>
                    <NoteInput
                      ref={composer}
                      value={noteDraft.text}
                      onChange={(text) => setNoteDraft((d) => (d ? { ...d, text } : d))}
                      onCancel={() => setNoteDraft(null)}
                      placeholder="Например: на «три» — поворот под рукой, не забегать"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setNoteDraft(null)}>
                        Отмена
                      </Button>
                      <Button type="submit" variant="primary" size="sm" disabled={!noteDraft.text.trim()}>
                        Сохранить
                      </Button>
                    </div>
                  </form>
                ) : (
                  <button type="button" onClick={startNote} className="group min-w-0 flex-1 text-left">
                    <span className="block border-b border-line pt-2 pb-2 text-[15px] text-ink-3 group-hover:border-ink-2">
                      {user ? "Добавить заметку к текущему моменту…" : "Войдите, чтобы оставлять заметки — их видите только вы"}
                    </span>
                  </button>
                )}
              </div>
              {notes.length > 0 ? (
                <ul className="mt-6 space-y-5">
                  {notes.map((n) => (
                    <li key={n.id} className="group flex gap-3">
                      {user ? <Avatar user={user} size={36} /> : null}
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => seek(n.t, false)}
                          className="tnum rounded-md bg-accent-soft px-1.5 py-0.5 text-[13px] font-medium text-accent hover:underline"
                        >
                          {timecode(n.t)}
                        </button>
                        {n.version !== dance.version ? <span className="ml-2 text-[12px] text-ink-3">к прошлой версии видео</span> : null}
                        {noteDraft?.id === n.id ? (
                          <form
                            className="mt-1.5"
                            onSubmit={(e) => {
                              e.preventDefault();
                              saveNote();
                            }}
                          >
                            <NoteInput autoFocus value={noteDraft.text} onChange={(text) => setNoteDraft((d) => (d ? { ...d, text } : d))} onCancel={() => setNoteDraft(null)} />
                            <div className="mt-2 flex justify-end gap-2">
                              <Button type="button" variant="ghost" size="sm" onClick={() => setNoteDraft(null)}>
                                Отмена
                              </Button>
                              <Button type="submit" variant="primary" size="sm" disabled={!noteDraft.text.trim()}>
                                Сохранить
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <p className="mt-1 text-[15px] break-words whitespace-pre-wrap">{n.text}</p>
                        )}
                      </div>
                      <div className={cn("flex shrink-0 gap-0.5 lg:opacity-0 lg:group-hover:opacity-100", noteDraft?.id === n.id && "hidden")}>
                        <button
                          type="button"
                          onClick={() => setNoteDraft({ t: n.t, id: n.id, text: n.text })}
                          className="grid size-9 place-items-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
                          aria-label="Изменить заметку"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteNote(n.id)}
                          className="grid size-9 place-items-center rounded-full text-ink-3 hover:bg-hover hover:text-danger"
                          aria-label="Удалить заметку"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : user ? (
                <p className="mt-3 text-[14px] text-ink-3">Поставьте видео на паузу в трудном месте и нажмите «Заметка» — она откроется ровно на этой секунде.</p>
              ) : null}
            </div>
          </section>
        </div>

      <aside className={cn("mt-12 min-w-0 space-y-8 lg:col-start-2 lg:mt-0", theatre ? "lg:row-start-2 lg:pt-3" : "lg:row-span-2 lg:row-start-1")}>
        {dance.chapterList.length > 0 ? (
          <div className="hidden lg:block">
            <ChaptersPanel
              chapters={dance.chapterList}
              cues={cues}
              player={player}
              onSeek={seek}
              onLoop={loopChapter}
              onShare={(t) => share(t)}
            />
          </div>
        ) : null}

        {dance.schemes.length > 0 ? (
          <section>
            <header className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[18px] font-semibold">{isGlossary ? "Бортовой словарь" : "Схема танца"}</h2>
              <button
                type="button"
                onClick={() => setScheme(0)}
                className="flex h-9 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-[13px] font-medium hover:bg-line"
              >
                <Maximize2 className="size-4" /> Открыть
              </button>
            </header>
            <div className={cn("grid gap-3", dance.schemes.length === 1 ? "grid-cols-2" : "grid-cols-3")}>
              {dance.schemes.map((s, i) => (
                <button
                  key={s.path}
                  type="button"
                  onClick={() => setScheme(i)}
                  className="group overflow-hidden rounded-xl ring-1 ring-black/10 transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <img src={s.thumb} alt={`Страница ${i + 1}`} loading="lazy" className="aspect-[2/3] w-full object-cover object-top transition group-hover:scale-[1.03]" />
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-[13px] text-ink-3">К — кавалер, Д — дама, ЛТ — линия танца.</p>
          </section>
        ) : null}

        {dance.audio.length > 0 ? (
          <section>
            <h2 className="mb-2 text-[18px] font-semibold">Музыка для повторения</h2>
            <ul className="-mx-2 flex flex-col gap-3">
              {dance.audio.map((a) => (
                <li key={a.path}>
                  <AudioTrack src={a.path} title={a.title} duration={a.duration} filename={a.original} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Recommendations are set apart from this dance's own materials. */}
        {others.length > 0 ? (
          <section className="!mt-12 border-t border-line pt-8">
            <h2 className="mb-3 px-1 text-[18px] font-semibold">Другие танцы</h2>
            <div className="space-y-2">
              {recommended.map((d, i) => (
                <CompactCard
                  key={d.slug}
                  dance={d}
                  note={i === 0 && d.slug === upNext[0]?.slug ? "Далее по программе" : done.has(d.slug) ? "Выучено" : undefined}
                />
              ))}
            </div>
          </section>
        ) : null}
      </aside>

      <AuthPrompt
        reason={loginAsk}
        returnTo={() => {
          // Keep a tenth of a second so a note lands on the same frame after sign-in.
          const t = Math.round(currentTime() * 10) / 10;
          return `/dance/${slug}${t ? `?t=${t}` : ""}`;
        }}
        onClose={() => setLoginAsk(null)}
      />

      {scheme !== null ? (
        <SchemeViewer pages={dance.schemes} title={dance.title} index={scheme} onIndex={setScheme} onClose={() => setScheme(null)} />
      ) : null}

    </main>
    </>
  );
}

/** Pill button; `iconOnly` drops the text and shows it as a tooltip after a short hover. */
const TAB_KEY = "bal:discussion-tab";
const THEATRE_KEY = "bal:theatre";
const WIDE = "(min-width: 1024px)";
const RESUME_OFF_KEY = "bal:resume-banner-off";

function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* storage blocked: lasts for this page */
  }
}

function Pill({
  onClick,
  icon,
  label,
  pressed,
  strong,
  iconOnly,
}: {
  onClick: () => void;
  icon: ReactNode;
  label: string;
  pressed?: boolean;
  strong?: boolean;
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      className={cn(
        "group/tip relative flex h-9 shrink-0 items-center gap-2 rounded-full text-sm font-medium sm:h-10 sm:text-[15px] [&_svg]:size-[18px] sm:[&_svg]:size-5",
        iconOnly ? "w-9 justify-center sm:w-10" : "px-2.5 sm:px-4",
        strong ? "bg-accent text-accent-ink" : "bg-surface-2 hover:bg-line",
      )}
    >
      {icon}
      {iconOnly ? (
        <Tip label={label} />
      ) : (
        <span className="max-sm:hidden">{label}</span>
      )}
    </button>
  );
}

/** While the dance loads: the page's own shapes in place (player, controls, title, channel row
 *  and actions, description, fragments, comments; on computers the scheme, music and the list
 *  beside), so nothing jumps when it arrives. */
function DanceSkeleton() {
  const block = "rounded-lg bg-surface-2";
  return (
    <main
      className="grid gap-x-8 px-3 pb-24 sm:px-6 sm:pt-2 lg:grid-cols-[minmax(0,1fr)_420px] lg:pt-6 2xl:gap-x-10"
      aria-busy="true"
      aria-label="Загрузка"
    >
      <div className="min-w-0">
        <div className="-mx-3 aspect-video bg-player sm:mx-0 sm:rounded-[var(--radius-frame)]" />
        <div className="mt-3 flex gap-2">
          <div className="h-9 w-24 rounded-full bg-surface-2" />
          <div className="h-9 w-32 rounded-full bg-surface-2" />
          <div className="ml-auto size-9 rounded-full bg-surface-2" />
        </div>
        <div className={cn(block, "mt-5 h-7 w-3/5 sm:h-8")} />
        <div className="mt-4 flex items-center gap-3">
          <div className="size-10 shrink-0 rounded-full bg-surface-2" />
          <div className="space-y-1.5 max-sm:hidden">
            <div className={cn(block, "h-4 w-48")} />
            <div className={cn(block, "h-3 w-24")} />
          </div>
          <div className="ml-auto flex gap-2">
            <div className="h-9 w-28 rounded-full bg-surface-2" />
            <div className="size-9 rounded-full bg-surface-2" />
            <div className="size-9 rounded-full bg-surface-2" />
            <div className="h-9 w-9 rounded-full bg-surface-2 sm:w-44" />
          </div>
        </div>
        <div className="mt-5 h-28 rounded-[var(--radius-sheet)] bg-surface-2" />
        <div className="mt-8 lg:hidden">
          <div className={cn(block, "mb-2 h-5 w-28")} />
          <div className="-mx-3 flex gap-3 overflow-hidden px-3">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="w-[148px] shrink-0">
                <div className="aspect-video rounded-lg bg-surface-2" />
                <div className={cn(block, "mt-2 h-3.5 w-24")} />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-10 h-24 rounded-[var(--radius-sheet)] bg-surface-2 lg:hidden" />
        <div className="mt-10 space-y-6 max-lg:hidden">
          <div className={cn(block, "h-6 w-40")} />
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex gap-3">
              <div className="size-9 shrink-0 rounded-full bg-surface-2" />
              <div className="flex-1 space-y-2">
                <div className={cn(block, "h-3.5 w-32")} />
                <div className={cn(block, "h-4 w-4/5")} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <aside className="space-y-8 max-lg:hidden">
        <div>
          <div className={cn(block, "mb-3 h-5 w-32")} />
          <div className="flex gap-2">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="aspect-[3/4] flex-1 rounded-lg bg-surface-2" />
            ))}
          </div>
        </div>
        <div className="h-14 rounded-[var(--radius-frame)] bg-surface-2" />
        <div className="space-y-3">
          <div className={cn(block, "h-5 w-36")} />
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex gap-2.5 p-1">
              <div className="aspect-video w-[168px] shrink-0 rounded-lg bg-surface-2" />
              <div className="flex-1 space-y-2 py-0.5">
                <div className={cn(block, "h-4 w-4/5")} />
                <div className={cn(block, "h-3 w-1/2")} />
              </div>
            </div>
          ))}
        </div>
      </aside>
    </main>
  );
}
