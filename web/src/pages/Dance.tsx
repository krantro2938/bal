import type { MediaPlayerInstance } from "@vidstack/react";
import { Bookmark, ChevronDown, ExternalLink, Film, GraduationCap, Maximize2, Music, NotebookPen, Pencil, ScrollText, Share2, Trash2, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { AudioTrack } from "@/components/AudioTrack";
import { ChaptersCarousel, ChaptersPanel } from "@/components/ChaptersPanel";
import { Comments } from "@/components/Comments";
import { Badge, CompactCard, Cover, isNew, NewBadge } from "@/components/DanceCard";
import { Avatar } from "@/components/Header";
import { ReactionPill } from "@/components/ReactionPill";
import { SchemeViewer } from "@/components/SchemeViewer";
import type { Loop } from "@/components/RehearsalPlayer";
import { Tip } from "@/components/Tip";
import { TelegramIcon } from "@/components/TelegramIcon";
import { StateBlock } from "@/components/StateBlock";
import { Button } from "@/components/ui/button";
import { AuthPrompt } from "@/components/AuthPrompt";
import { NoteInput } from "@/components/NoteInput";
import { api, ApiError } from "@/lib/api";
import { useCatalog } from "@/lib/catalog";
import { ago, fullDate, parseTime, timecode, viewsLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { shareLink } from "@/lib/share";
import { useThumbs } from "@/lib/thumbs";
import type { Chapter, DanceDetail, Note } from "@/lib/types";
import { cn } from "@/lib/utils";

// The player bundle (Vidstack) is only fetched when a dance page opens.
const RehearsalPlayer = lazy(() => import("@/components/RehearsalPlayer").then((m) => ({ default: m.RehearsalPlayer })));

const guestPosKey = (slug: string) => `bal-pos:${slug}`;

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
  const player = useRef<MediaPlayerInstance>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const startAt = useMemo(() => parseTime(params.get("t")), [params]);
  const focusComment = Number(params.get("c")) || undefined;
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
    if (focusComment) setTab("comments");
  }, [focusComment]);
  const [commentCount, setCommentCount] = useState(0);
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
    return p.subscribe(({ playing }) => {
      if (playing && !counted) {
        counted = true;
        api.view(dance.slug).catch(() => {});
      }
    });
  }, [dance, playerReady]);

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
      () => toast(done),
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
      <main className="mx-auto max-w-[1200px] px-3 sm:px-4 lg:px-8">
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

  if (!dance) {
    return (
      <main className="grid gap-8 px-3 pt-2 sm:px-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:px-8 lg:pt-6" aria-busy="true">
        <div>
          <div className="aspect-video w-full rounded-[var(--radius-frame)] bg-player" />
          <div className="mt-5 h-8 w-2/3 rounded-lg bg-surface-2" />
        </div>
      </main>
    );
  }

  const fav = !!state?.favorites.includes(slug);
  const learned = !!state?.learned.includes(slug);
  const isGlossary = dance.kind === "glossary";
  const videoPost = dance.assets.find((a) => a.kind === "video");
  const others = (catalog.data?.dances ?? []).filter((d) => d.slug !== slug);
  const caption = dance.caption.replace(/\s*#\S+/g, "").trim();
  const facts = [
    dance.hasScheme && "схема",
    dance.hasAudio && "музыка",
    dance.chapterList.length > 0 && `${dance.chapterList.length} фрагментов`,
  ].filter((f): f is string => !!f);

  return (
    <main className="grid gap-x-8 px-3 pb-24 sm:px-6 sm:pt-2 lg:grid-cols-[minmax(0,1fr)_420px] lg:px-8 lg:pt-6 2xl:gap-x-10">
      <div className="min-w-0">
        <div className="sticky top-16 z-20 -mx-3 bg-bg sm:static sm:mx-0">
          {dance.video ? (
            <Suspense fallback={<div className="aspect-video w-full bg-player sm:rounded-[var(--radius-frame)]" />}>
              <RehearsalPlayer
                dance={dance}
                player={player}
                startAt={startAt}
                loop={loop}
                setLoop={setLoop}
                notes={notes}
                onNote={startNote}
                onReady={() => setPlayerReady(true)}
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

        <div>
          <h1 className="font-title mt-4 text-[24px] leading-tight lg:text-[30px]">{dance.title}</h1>

          {/* On phones only the badge stays and the actions lose their labels, like YouTube's app. */}
          <div className="mt-4 flex items-center gap-3 sm:flex-wrap sm:gap-x-6 sm:gap-y-4">
            <div className="flex min-w-0 shrink-0 items-center gap-3">
              <Badge dance={dance} size={40} />
              <div className="min-w-0 leading-tight max-sm:hidden">
                <p className="truncate text-[15px] font-medium">Традиционный бал РТУ МИРЭА</p>
                <p className="tnum flex gap-x-2 text-[13px] text-ink-3">
                  <span>{isGlossary ? "Словарь движений" : `Танец ${String(dance.order).padStart(2, "0")}`}</span>
                  {dance.duration ? <span>{timecode(dance.duration)}</span> : null}
                </p>
              </div>
            </div>
            <div className="-mr-3 flex flex-1 gap-2 overflow-x-auto pr-3 max-sm:min-w-0 [scrollbar-width:none] sm:mr-0 sm:flex-auto sm:justify-end sm:overflow-visible sm:pr-0">
              {/* On phones the actions sit at the right edge; the spacer collapses if they need to scroll. */}
              <span className="flex-1 sm:hidden" />
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

          {resumeAt !== null && !resumeDismissed ? (
            <div className="mt-5 flex items-center gap-2 rounded-[var(--radius-frame)] bg-accent-soft px-4 py-2.5 text-[15px]">
              <span className="tnum flex-1">Вы остановились на {timecode(resumeAt)}</span>
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
              <button
                type="button"
                onClick={() => setResumeDismissed(true)}
                className="rounded-full px-2 py-1.5 text-sm text-ink-2 hover:text-ink"
              >
                Сначала
              </button>
              <button
                type="button"
                onClick={() => setResumeDismissed(true)}
                className="-mr-2 grid size-8 place-items-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
                aria-label="Скрыть"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : null}

          {/* Description card, like YouTube's: short text, expands to the organizers' caption and sources. */}
          <div
            className={cn(
              "mt-5 rounded-[var(--radius-sheet)] bg-surface-2 p-4 text-[16px] leading-normal lg:p-5 lg:text-[17px]",
              !more && "cursor-pointer transition-colors hover:bg-line/60",
            )}
            onClick={() => !more && setMore(true)}
          >
            <p className="tnum flex flex-wrap gap-x-2.5 text-[14px] font-semibold">
              <span>{viewsLabel(dance.views)}</span>
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
            <p className={cn("mt-1.5 max-w-[75ch]", !more && "line-clamp-2")}>{dance.description}</p>
            {more ? (
              <>
                {caption ? (
                  <div className="mt-5 max-w-[75ch] border-t border-line-strong/60 pt-5">
                    <p className="text-[14px] font-medium text-ink-2">Из поста организаторов</p>
                    <p className="mt-2 whitespace-pre-line text-ink">{caption}</p>
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
                <button type="button" onClick={() => setMore(false)} className="mt-5 text-[15px] font-medium underline-offset-4 hover:underline">
                  Свернуть
                </button>
              </>
            ) : (
              <span className="mt-2 flex w-fit items-center gap-1 text-[15px] font-medium underline-offset-4 hover:underline">
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
          <section className="mt-10">
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
      </div>

      <aside className="mt-12 min-w-0 space-y-8 lg:mt-0">
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
                className="flex h-9 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[13px] font-medium text-accent-ink"
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

        {others.length > 0 ? (
          <section>
            <h2 className="mb-3 px-1 text-[18px] font-semibold">Другие танцы</h2>
            <div className="space-y-2">
              {others.map((d) => (
                <CompactCard key={d.slug} dance={d} />
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
  );
}

/** Pill button; `iconOnly` drops the text and shows it as a tooltip after a short hover. */
const TAB_KEY = "bal:discussion-tab";

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
        "group/tip relative flex h-9 shrink-0 items-center gap-2 rounded-full text-sm font-medium [&_svg]:size-[18px]",
        iconOnly ? "w-9 justify-center" : "px-2.5 sm:px-3.5",
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
