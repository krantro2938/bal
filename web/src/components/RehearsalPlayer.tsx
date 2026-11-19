import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import { MediaPlayer, MediaProvider, Poster, Track, useMediaRemote, useMediaState, type MediaPlayerInstance } from "@vidstack/react";
import { DefaultVideoLayout, defaultLayoutIcons, type DefaultLayoutTranslations } from "@vidstack/react/player/layouts/default";
import { FastForward, Minus, NotebookPen, Play, Plus, Repeat, Rewind, RotateCcw, RotateCw, SkipBack, SkipForward, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import { Link } from "react-router";
import { SplitPill, splitHalf } from "@/components/SplitPill";
import { Tip } from "@/components/Tip";
import { timecode } from "@/lib/format";
import { WATCH } from "@/lib/mini";
import type { DanceDetail, DanceSummary, Note } from "@/lib/types";
import { cn } from "@/lib/utils";

export type Loop = { a: number; b: number } | null;

/** Default loop length when it is switched on at the playhead. */
export const LOOP_SECONDS = 8;

/** A fresh repeat window starting at t (kept inside the video). */
function loopAt(t: number, duration: number): { a: number; b: number } {
  const r = (x: number) => Math.round(Math.max(0, Math.min(duration, x)) * 10) / 10;
  const a = r(Math.min(t, duration - LOOP_SECONDS));
  return { a, b: r(a + LOOP_SECONDS) };
}

const ru: Partial<DefaultLayoutTranslations> = {
  Accessibility: "Доступность",
  Audio: "Звук",
  Auto: "Авто",
  Captions: "Субтитры",
  Chapters: "Фрагменты",
  Default: "По умолчанию",
  "Enter Fullscreen": "На весь экран",
  "Exit Fullscreen": "Выйти из полноэкранного режима",
  "Enter PiP": "Картинка в картинке",
  "Exit PiP": "Закрыть картинку в картинке",
  Fullscreen: "Полный экран",
  "Keyboard Animations": "Анимации клавиатуры",
  Loop: "Повтор",
  Mute: "Без звука",
  Normal: "Обычная",
  Off: "Выкл.",
  Pause: "Пауза",
  Play: "Смотреть",
  Playback: "Воспроизведение",
  Quality: "Качество",
  Replay: "Смотреть снова",
  Reset: "Сбросить",
  "Seek Backward": "Назад",
  "Seek Forward": "Вперёд",
  Seek: "Перемотка",
  Settings: "Настройки",
  Speed: "Скорость",
  Unmute: "Включить звук",
  Volume: "Громкость",
};

const SPEEDS = [0.5, 0.75, 1] as const;

// Volume and mute carry over to every video on this device.
const VOLUME_KEY = "bal:volume";

function savedVolume(): { volume: number; muted: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "null");
    if (v && typeof v.volume === "number" && v.volume >= 0 && v.volume <= 1) return { volume: v.volume, muted: !!v.muted };
  } catch {
    /* storage blocked or bad value */
  }
  return { volume: 1, muted: false };
}

function saveVolume(volume: number, muted: boolean) {
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume, muted }));
  } catch {
    /* storage blocked: lasts for this page */
  }
}

export function RehearsalPlayer({
  dance,
  player,
  startAt,
  loop,
  setLoop,
  onNote,
  onReady,
  theatre,
  onTheatre,
  next = [],
  prev,
  pull,
  autoPlay,
}: {
  dance: DanceDetail;
  player: RefObject<MediaPlayerInstance | null>;
  startAt: number | null;
  loop: Loop;
  setLoop: (l: Loop) => void;
  onNote: () => void;
  onReady: () => void;
  /** Large screens: the player spans the page, letterboxed, like YouTube's theatre mode. */
  theatre: boolean;
  onTheatre: () => void;
  /** Dances offered on the end screen, next in the programme first. */
  next?: DanceSummary[];
  prev?: DanceSummary;
  pull?: Pull;
  /** Continue playing at startAt (coming back from the mini player). */
  autoPlay?: boolean;
}) {
  const video = dance.video!;
  const [sound] = useState(savedVolume);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const started = useRef(false);

  // When playback crosses the end of the fragment, jump back to its start.
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    return p.subscribe(({ currentTime }) => {
      const l = loopRef.current;
      if (l && currentTime >= l.b && currentTime < l.b + 1.5) p.currentTime = l.a;
    });
  }, [player]);

  // Once a video has ended, Vidstack ignores timeline seeks in its state and restarts from 0 on
  // play. Remember where the viewer asked to go, hide the end screen, and continue from there.
  const afterEnd = useRef<number | null>(null);
  const [leftEnd, setLeftEnd] = useState(false);
  const replay = () => {
    const p = player.current;
    if (!p) return;
    p.currentTime = 0;
    p.play().catch(() => {});
  };

  const chapters = useMemo(
    () => ({ cues: dance.chapterList.map((c) => ({ startTime: c.start, endTime: c.end, text: c.title })) }),
    [dance.chapterList],
  );

  return (
    <div>
      {/* In theatre mode the player runs edge to edge; the video keeps its ratio inside, with black sides. */}
      <div className={cn(theatre && "lg:-mx-6")}>
      <MediaPlayer
        ref={player}
        className={cn("bal-player aspect-video w-full overflow-hidden sm:rounded-[var(--radius-frame)]", theatre && "bal-theatre")}
        title={dance.title}
        src={{ src: video.url, type: "video/mp4" }}
        playsInline
        preload="metadata"
        volume={sound.volume}
        muted={sound.muted}
        onVolumeChange={(d) => saveVolume(d.volume, d.muted)}
        keyShortcuts={{ togglePaused: "k Space", seekBackward: "j J ArrowLeft", seekForward: "l L ArrowRight", toggleFullscreen: "f" }}
        onLoadedMetadata={onReady}
        onMediaSeekRequest={(t, e) => {
          const p = player.current;
          // Playing then sends Vidstack's own "seek to 0", which must not replace the choice.
          if (t === 0 && afterEnd.current !== null) {
            e.stopImmediatePropagation();
            return;
          }
          // Like YouTube, a seek after the end plays from there. Vidstack stays "ended" otherwise:
          // the time reads the end and phones show no play button.
          if (p?.state.ended && t < video.duration - 0.5) {
            const first = afterEnd.current === null;
            afterEnd.current = t;
            setLeftEnd(true);
            if (first)
              queueMicrotask(() =>
                p.play().catch(() => {
                  afterEnd.current = null;
                }),
              );
          }
        }}
        onPlay={() => {
          const t = afterEnd.current;
          const p = player.current;
          afterEnd.current = null;
          setLeftEnd(false);
          if (t === null || !p) return;
          // Vidstack's own replay jumps back to 0 right after play starts; go to the chosen moment once it has.
          const go = () => {
            if (p.currentTime < t - 1) p.currentTime = t;
          };
          go();
          window.setTimeout(go, 150);
          window.setTimeout(go, 450);
        }}
        onCanPlay={() => {
          if (!started.current && (startAt !== null || autoPlay) && player.current) {
            started.current = true;
            if (startAt !== null) player.current.currentTime = Math.min(startAt, video.duration - 0.5);
            // Opened from a card (or back from the mini player): play at once. A browser that wants
            // a tap first (iPhones, often) refuses quietly and the play button stays.
            if (autoPlay) player.current.play().catch(() => {});
          }
        }}
      >
        <MediaProvider>
          <Poster className="vds-poster" src={dance.poster} alt="" />
          {dance.chapterList.length ? <Track kind="chapters" lang="ru" label="Фрагменты" type="json" content={chapters} default /> : null}
        </MediaProvider>
        <DefaultVideoLayout
          icons={defaultLayoutIcons}
          thumbnails={dance.thumbnails}
          translations={ru}
          playbackRates={[0.5, 0.75, 1, 1.25]}
          seekStep={5}
          colorScheme="dark"
          noGestures
          slots={{
            smallLayout: {
              // Phones have no rehearsal bar: repeat and note sit in the player, left of the speed.
              beforeSettingsMenu: (
                <>
                  <PlayerIconButton label={loop ? "Выключить повтор" : "Повтор фрагмента"} on={!!loop} onClick={() => setLoop(loop ? null : loopAt(player.current?.currentTime ?? 0, video.duration))}>
                    <Repeat />
                  </PlayerIconButton>
                  <PlayerIconButton label="Заметка" onClick={onNote}>
                    <NotebookPen />
                  </PlayerIconButton>
                </>
              ),
            },
            googleCastButton: null,
            pipButton: null,
            airPlayButton: null,
            chaptersMenu: null,
            settingsMenu: <SpeedButton />,
            beforeFullscreenButton: <TheatreButton on={theatre} onToggle={onTheatre} />,
          }}
        />
        <Gestures player={player} pull={pull} />
        <EndScreen next={next} prev={prev} onReplay={replay} hidden={!!loop || leftEnd} />
      </MediaPlayer>
      </div>
    </div>
  );
}

export function RehearsalBar({
  player,
  duration,
  loop,
  setLoop,
  notes,
  onNote,
}: {
  player: RefObject<MediaPlayerInstance | null>;
  duration: number;
  loop: Loop;
  setLoop: (l: Loop) => void;
  notes: Note[];
  onNote: () => void;
}) {
  const rate = useMediaState("playbackRate", player);
  const time = useMediaState("currentTime", player);
  const now = () => player.current?.currentTime ?? 0;
  const clamp = (t: number) => Math.round(Math.max(0, Math.min(duration, t)) * 10) / 10;

  const seekBy = (d: number) => {
    const p = player.current;
    if (p) p.currentTime = clamp(p.currentTime + d);
  };
  const toggleLoop = () => {
    if (loop) return setLoop(null);
    setLoop(loopAt(now(), duration));
    player.current?.play().catch(() => {});
  };

  return (
    <div className="bg-bg sm:pt-3 sm:pb-1">
      {/* Phones: these controls live in the player (repeat, note, speed) and in gestures (±5 s). */}
      <div className="flex flex-wrap items-center gap-1.5 max-sm:hidden sm:gap-2">
        <SplitPill label="Перемотка" className="h-10">
          <button type="button" onClick={() => seekBy(-5)} aria-label="Назад на 5 секунд" title="Назад на 5 секунд" className={cn(splitHalf("l"), "gap-1 max-sm:px-2.5")}>
            <RotateCcw className="size-[18px]" />
            <span className="tnum text-[13px]">5</span>
          </button>
          <button type="button" onClick={() => seekBy(5)} aria-label="Вперёд на 5 секунд" title="Вперёд на 5 секунд" className={cn(splitHalf("r"), "gap-1 max-sm:px-2.5")}>
            <RotateCw className="size-[18px]" />
            <span className="tnum text-[13px]">5</span>
          </button>
        </SplitPill>

        <div className="flex h-10 items-center rounded-full bg-surface-2 p-1" role="group" aria-label="Скорость">
          {SPEEDS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                if (player.current) player.current.playbackRate = r;
              }}
              aria-pressed={rate === r}
              className={cn("tnum h-full min-w-8 rounded-full px-2 text-[13px] font-medium sm:px-2.5", rate === r ? "bg-accent text-accent-ink" : "text-ink-2 hover:text-ink")}
            >
              {String(r).replace(".", ",")}×
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={toggleLoop}
          aria-pressed={!!loop}
          aria-label={loop ? "Выключить повтор" : "Повтор фрагмента"}
          className={cn(
            "group/tip relative grid size-10 place-items-center rounded-full",
            loop ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink hover:bg-line",
          )}
        >
          <Repeat className="size-[18px]" />
          <Tip label={loop ? "Выключить повтор" : "Повтор фрагмента"} />
        </button>

        <button
          type="button"
          onClick={onNote}
          aria-label={`Заметка на ${timecode(time)}`}
          className="group/tip relative grid size-10 place-items-center rounded-full bg-surface-2 hover:bg-line sm:ml-auto"
        >
          <NotebookPen className="size-[18px]" />
          <Tip label={`Заметка на ${timecode(time)}`} align="end" />
        </button>
      </div>

      {loop ? (
        <LoopPanel loop={loop} setLoop={setLoop} now={now} clamp={clamp}>
          <Strip player={player} duration={duration} time={time} loop={loop} setLoop={setLoop} notes={notes} />
        </LoopPanel>
      ) : null}
    </div>
  );
}

/** Explains and edits the repeating fragment: two ends, each nudgeable or set to the playhead. */
function LoopPanel({
  loop,
  setLoop,
  now,
  clamp,
  children,
}: {
  loop: { a: number; b: number };
  setLoop: (l: Loop) => void;
  now: () => number;
  clamp: (t: number) => number;
  children: ReactNode;
}) {
  const set = (a: number, b: number) => {
    a = clamp(a);
    b = clamp(b);
    if (b - a >= 0.5) setLoop({ a, b });
  };
  return (
    <div className="mt-3 rounded-[var(--radius-sheet)] border border-line px-4 pt-3 pb-4 sm:mt-4">
      <div className="flex items-center gap-2">
        <Repeat className="size-4 shrink-0 text-accent" />
        <p className="tnum flex-1 text-[15px]">
          Повтор <b className="font-semibold">{timecode(loop.a)} – {timecode(loop.b)}</b>
          <span className="ml-2 text-ink-3">{Math.round(loop.b - loop.a)} с</span>
        </p>
        <button
          type="button"
          onClick={() => setLoop(null)}
          className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
          aria-label="Выключить повтор"
          title="Выключить повтор"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-2">{children}</div>
      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
        <EndEditor label="Начало" t={loop.a} onStep={(d) => set(loop.a + d, loop.b)} onHere={() => set(now(), loop.b)} />
        <EndEditor label="Конец" t={loop.b} onStep={(d) => set(loop.a, loop.b + d)} onHere={() => set(loop.a, now())} />
      </div>
      <p className="mt-2 text-[13px] text-ink-3">Края полосы и кружок позиции можно тянуть. «Сюда» ставит край на текущий момент видео.</p>
    </div>
  );
}

/** On phones −/+ move to the far end so the thumb doesn't cover the time being changed. */
function EndEditor({ label, t, onStep, onHere }: { label: string; t: number; onStep: (d: number) => void; onHere: () => void }) {
  const step = "grid size-10 place-items-center rounded-full text-ink-2 hover:bg-hover hover:text-ink max-sm:bg-surface-2 sm:size-8";
  return (
    <div className="flex items-center gap-1 max-sm:w-full">
      <span className="w-14 text-[13px] text-ink-3 max-sm:-order-2">{label}</span>
      <button type="button" onClick={() => onStep(-0.5)} className={cn(step, "max-sm:order-1 max-sm:ml-auto")} aria-label={`${label}: на полсекунды раньше`} title="На 0,5 с раньше">
        <Minus className="size-4" />
      </button>
      <span className="tnum w-11 text-center text-[15px] font-semibold max-sm:-order-1 max-sm:text-left">{timecode(t)}</span>
      <button type="button" onClick={() => onStep(0.5)} className={cn(step, "max-sm:order-1")} aria-label={`${label}: на полсекунды позже`} title="На 0,5 с позже">
        <Plus className="size-4" />
      </button>
      <button
        type="button"
        onClick={onHere}
        className="ml-1 h-8 rounded-full px-2.5 text-[13px] font-medium text-accent hover:bg-hover"
        title={`Поставить ${label.toLowerCase()} в текущий момент видео`}
      >
        Сюда
      </button>
    </div>
  );
}

/** Whole-video strip inside the loop panel: the fragment with draggable ends, note stars, playhead. Tap to seek. */
function Strip({
  player,
  duration,
  time,
  loop,
  setLoop,
  notes,
}: {
  player: RefObject<MediaPlayerInstance | null>;
  duration: number;
  time: number;
  loop: Loop;
  setLoop: (l: Loop) => void;
  notes: Note[];
}) {
  const track = useRef<HTMLDivElement>(null);
  // "a"/"b": an end of the fragment; "t": the playhead (scrubbing).
  const [drag, setDrag] = useState<"a" | "b" | "t" | null>(null);
  const pct = (t: number) => `${(Math.min(Math.max(t, 0), duration) / duration) * 100}%`;
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration * 10) / 10;
  };
  // Pointer capture keeps a drag going outside the strip; some browsers refuse it, and the drag must still work.
  const capture = (e: PointerEvent) => {
    try {
      track.current?.setPointerCapture(e.pointerId);
    } catch {
      /* drag continues while the finger stays on the strip */
    }
  };
  const seek = (clientX: number) => {
    if (player.current) player.current.currentTime = Math.min(duration - 0.1, timeAt(clientX));
  };
  const onMove = (e: PointerEvent) => {
    if (drag === "t") return seek(e.clientX);
    if (!drag || !loop) return;
    const t = timeAt(e.clientX);
    if (drag === "a" && t <= loop.b - 0.5) setLoop({ a: t, b: loop.b });
    if (drag === "b" && t >= loop.a + 0.5) setLoop({ a: loop.a, b: t });
  };
  return (
    <div>
      <div
        ref={track}
        className="relative isolate h-11 cursor-pointer touch-none select-none"
        onPointerDown={(e) => {
          if (drag) return;
          capture(e);
          setDrag("t");
          seek(e.clientX);
        }}
        onPointerMove={onMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        role="presentation"
      >
        {/* The band sits low; the playhead's knob sits above it so the two never fight for a touch. */}
        <div className="absolute inset-x-0 top-7 h-1 -translate-y-1/2 rounded-full bg-line" />
        <div className="absolute top-7 left-0 h-1 -translate-y-1/2 rounded-full bg-ink-3/60" style={{ width: pct(time) }} />
        {loop ? (
          <>
            {/* The repeating fragment: a light band with diagonal hatching. */}
            <div
              className="absolute top-7 h-6 -translate-y-1/2 rounded-md bg-accent-soft"
              style={{
                left: pct(loop.a),
                width: `calc(${pct(loop.b)} - ${pct(loop.a)})`,
                backgroundImage: "repeating-linear-gradient(-55deg, color-mix(in srgb, var(--accent) 28%, transparent) 0 2px, transparent 2px 9px)",
              }}
            />
            {(["a", "b"] as const).map((end) => (
              <button
                key={end}
                type="button"
                aria-label={end === "a" ? "Начало фрагмента" : "Конец фрагмента"}
                className="absolute top-7 z-10 grid h-8 w-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center"
                style={{ left: pct(loop[end]) }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  capture(e);
                  setDrag(end);
                }}
              >
                <span className="h-7 w-1.5 rounded-full bg-accent" />
              </button>
            ))}
          </>
        ) : null}
        {notes.map((n) => (
          <span key={n.id} className="pointer-events-none absolute top-1 -translate-x-1/2 text-accent" style={{ left: pct(n.t) }}>
            <span className="block size-1.5 rounded-full bg-accent" />
          </span>
        ))}
        <div className="pointer-events-none absolute top-1.5 bottom-1.5 z-20 w-[3px] -translate-x-1/2 rounded-full bg-ink" style={{ left: pct(time) }} />
        <button
          type="button"
          aria-label="Позиция видео"
          className="absolute top-0 z-30 grid h-5 w-9 -translate-x-1/2 cursor-grab place-items-center active:cursor-grabbing"
          style={{ left: pct(time) }}
          onPointerDown={(e) => {
            e.stopPropagation();
            capture(e);
            setDrag("t");
          }}
        >
          <span className="size-3.5 rounded-full bg-ink ring-2 ring-bg" />
        </button>
      </div>
    </div>
  );
}

/**
 * When the video ends (not while a fragment repeats), like YouTube's end screen: big cards for
 * the next dances in the corners and a round replay button, over the last frame (no dimming).
 * On phones, one compact card with ✕; closed, replay between previous and next. Clicks pass
 * through everywhere else, so the timeline keeps working; seeking back hides the screen.
 */
function EndScreen({ next, prev, onReplay, hidden }: { next: DanceSummary[]; prev?: DanceSummary; onReplay: () => void; hidden: boolean }) {
  const time = useMediaState("currentTime");
  const duration = useMediaState("duration");
  // Fades in over the last two seconds; seeking anywhere earlier hides it again.
  const show = !hidden && duration > 0 && time >= duration - 2;
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!show) setClosed(false);
  }, [show]);
  if (!next.length) return null;
  const [up, second, third] = next;
  const round = "pointer-events-auto grid place-items-center rounded-full text-white transition-colors hover:bg-white/15";
  return (
    <div
      inert={!show}
      className={cn("pointer-events-none absolute inset-0 z-20 transition-opacity duration-700 @container", show ? "opacity-100" : "opacity-0")}
    >
      {/* Tablets and computers: the YouTube layout, sized by the player's width. */}
      <div className="absolute inset-x-[7%] top-[7%] bottom-[18%] max-sm:hidden">
        <EndCard d={up} label="Следующий" className="top-0 left-0" />
        {second ? <EndCard d={second} className="bottom-0 left-0" /> : null}
        {third ? <EndCard d={third} className="top-0 right-0" /> : null}
        <button
          type="button"
          onClick={onReplay}
          className="pointer-events-auto absolute right-[8.5cqw] bottom-0 grid aspect-square w-[13cqw] place-items-center rounded-full bg-[#ece6d6] text-[#0a1028] shadow-xl transition-transform hover:scale-105"
          aria-label="Смотреть снова"
          title="Смотреть снова"
        >
          <RotateCcw className="size-[45%]" />
        </button>
      </div>

      {/* Phones: one card. */}
      <div className="absolute inset-x-0 top-0 bottom-14 flex items-center justify-center p-2.5 sm:hidden">
        {!closed ? (
          <div className="pointer-events-auto relative w-full max-w-[420px] rounded-xl bg-[#05091a]/90 p-2.5 text-[#ece6d6] shadow-2xl">
            <button
              type="button"
              onClick={() => setClosed(true)}
              className="absolute top-1.5 right-1.5 grid size-8 place-items-center rounded-full text-[#ece6d6]/70 hover:bg-white/10 hover:text-white"
              aria-label="Закрыть"
            >
              <X className="size-4" />
            </button>
            <Link to={`/dance/${up.slug}`} state={WATCH} className="group flex gap-3 pr-7">
              <span className="relative block aspect-video w-36 shrink-0 overflow-hidden rounded-md bg-black/40">
                {up.posterSmall ? <img src={up.posterSmall} alt="" className="size-full object-cover" /> : null}
                {up.duration ? <span className="tnum absolute right-1 bottom-1 rounded bg-black/75 px-1 text-[11px]">{timecode(up.duration)}</span> : null}
              </span>
              <span className="self-center">
                <span className="block text-[11px] text-[#ece6d6]/60">Следующий</span>
                <span className="line-clamp-2 text-[14px] leading-snug font-medium group-hover:underline">{up.title}</span>
              </span>
            </Link>
            <div className="mt-2.5 flex gap-2">
              <button type="button" onClick={onReplay} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full bg-white/10 text-[13px] font-medium hover:bg-white/20">
                <RotateCcw className="size-4" /> Ещё раз
              </button>
              <Link
                to={`/dance/${up.slug}`} state={WATCH}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full bg-[#e8ddc2] text-[13px] font-semibold text-[#0a1028] hover:bg-white"
              >
                <Play className="size-4 fill-current" /> Смотреть
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-6">
            {prev ? (
              <Link to={`/dance/${prev.slug}`} state={WATCH} className={cn(round, "size-11 bg-black/40")} aria-label={`Предыдущий: ${prev.title}`} title={prev.title}>
                <SkipBack className="size-6 fill-current" />
              </Link>
            ) : null}
            <button type="button" onClick={onReplay} className={cn(round, "size-16 bg-black/50")} aria-label="Смотреть снова" title="Смотреть снова">
              <RotateCcw className="size-8" />
            </button>
            <Link to={`/dance/${up.slug}`} state={WATCH} className={cn(round, "size-11 bg-black/40")} aria-label={`Следующий: ${up.title}`} title={up.title}>
              <SkipForward className="size-6 fill-current" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Our own gestures in place of Vidstack's: click toggles play (mouse) or shows/hides the controls (touch);
 * double-click is fullscreen with a mouse, double-tap on the left or right third seeks ∓5 s on
 * touch (more taps keep adding, like YouTube); press and hold plays at 2× until released.
 */
/** How long the controls stay up after a tap while the video plays. */
const IDLE_HIDE = 3000;

/** Phones: dragging the video down hands it to the mini player and shows the feed (see Dance). */
export type Pull = { move: (dy: number) => void; end: (dy: number, velocity: number) => void };

function Gestures({ player, pull }: { player: RefObject<MediaPlayerInstance | null>; pull?: Pull }) {
  const remote = useMediaRemote();
  const layer = useRef<HTMLDivElement>(null);
  const pullRef = useRef(pull);
  pullRef.current = pull;
  const [hold, setHold] = useState(false);
  const [jump, setJump] = useState<{ side: -1 | 1; total: number; key: number } | null>(null);
  const g = useRef({ x: 0, y: 0, timer: 0, holding: false, rate: 1, lastTap: 0, lastSide: 0 as -1 | 0 | 1, single: 0, seekUntil: 0, wereShowing: false, pulled: false });
  const jumpTimer = useRef(0);

  // Phones: a tap anywhere outside the playing video puts its controls away, like YouTube's app.
  useEffect(() => {
    const away = (e: globalThis.PointerEvent) => {
      const p = player.current;
      if (e.pointerType === "mouse" || !p?.el || p.el.contains(e.target as Node)) return;
      if (!p.state.paused && p.controls.showing) p.controls.hide(0);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [player]);

  // Touch events rather than pointer events: only a cancelled touchmove keeps the page from
  // scrolling (or bouncing on iPhones) while the finger drags the video down.
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    let mode: "pull" | "other" | null = null;
    let dy = 0;
    let last = { y: 0, t: 0, v: 0 };
    const onStart = (e: TouchEvent) => {
      g.current.pulled = false;
      start = null;
      if (e.touches.length !== 1 || !pullRef.current || player.current?.state.fullscreen || matchMedia("(min-width: 640px)").matches) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      mode = null;
      dy = 0;
      last = { y: t.clientY, t: e.timeStamp, v: 0 };
    };
    const onMove = (e: TouchEvent) => {
      if (!start || mode === "other") return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      dy = t.clientY - start.y;
      if (mode === null) {
        // Undecided small moves stay ours too, or the browser would start scrolling first.
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
          if (dy >= 0) e.preventDefault();
          return;
        }
        mode = dy > 0 && dy > Math.abs(dx) ? "pull" : "other";
        if (mode === "other") return;
        g.current.pulled = true;
        window.clearTimeout(g.current.timer);
      }
      e.preventDefault();
      const dt = e.timeStamp - last.t;
      if (dt > 0) last = { y: t.clientY, t: e.timeStamp, v: (t.clientY - last.y) / dt };
      pullRef.current?.move(Math.max(0, dy));
    };
    const onEnd = () => {
      if (start && mode === "pull") pullRef.current?.end(Math.max(0, dy), last.v);
      start = null;
      mode = null;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [player]);

  const side = (e: PointerEvent): -1 | 0 | 1 => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    return x < 1 / 3 ? -1 : x > 2 / 3 ? 1 : 0;
  };
  const seekBy = (dir: -1 | 1) => {
    const p = player.current;
    if (!p) return;
    p.currentTime = Math.max(0, Math.min(p.state.duration - 0.1, p.currentTime + dir * 5));
    setJump((j) => ({ side: dir, total: j && j.side === dir ? j.total + 5 : 5, key: Date.now() }));
    window.clearTimeout(jumpTimer.current);
    jumpTimer.current = window.setTimeout(() => setJump(null), 700);
  };

  return (
    <div
      ref={layer}
      className="absolute inset-0 z-0 touch-manipulation select-none [-webkit-touch-callout:none]"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const s = g.current;
        s.x = e.clientX;
        s.y = e.clientY;
        // Vidstack shows the controls on any touch itself, so remember how they were before it.
        s.wereShowing = player.current?.controls.showing ?? false;
        window.clearTimeout(s.timer);
        s.timer = window.setTimeout(() => {
          const p = player.current;
          if (!p) return;
          s.holding = true;
          s.rate = p.playbackRate;
          p.playbackRate = 2;
          if (p.paused) p.play().catch(() => {});
          setHold(true);
        }, 450);
      }}
      onPointerMove={(e) => {
        const s = g.current;
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12) window.clearTimeout(s.timer);
      }}
      onPointerCancel={() => window.clearTimeout(g.current.timer)}
      onPointerUp={(e) => {
        const s = g.current;
        const p = player.current;
        window.clearTimeout(s.timer);
        if (!p || s.pulled) return;
        if (s.holding) {
          s.holding = false;
          p.playbackRate = s.rate;
          setHold(false);
          return;
        }
        const now = e.timeStamp;
        const touch = e.pointerType !== "mouse";
        const where = side(e);
        if (touch) {
          // Already seeking: every tap on the same side adds 5 s.
          if (where && now < s.seekUntil && where === s.lastSide) {
            s.seekUntil = now + 700;
            return seekBy(where);
          }
          if (now - s.lastTap < 300 && where && where === s.lastSide) {
            window.clearTimeout(s.single);
            s.lastTap = 0;
            s.seekUntil = now + 700;
            return seekBy(where);
          }
          s.lastTap = now;
          s.lastSide = where;
          window.clearTimeout(s.single);
          // One tap shows the controls or hides them if they were up. Shown during playback, they
          // fade again after a few idle seconds (show(0) alone would cancel the player's own timer).
          const wereShowing = s.wereShowing;
          s.single = window.setTimeout(() => {
            if (wereShowing) return p.controls.hide(0);
            p.controls.show(0);
            if (!p.state.paused) p.controls.hide(IDLE_HIDE);
          }, 260);
          return;
        }
        if (now - s.lastTap < 300) {
          s.lastTap = 0;
          remote.toggleFullscreen("prefer-media");
          return;
        }
        s.lastTap = now;
        remote.togglePaused();
      }}
    >
      {hold ? (
        <span className="pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-[13px] font-semibold text-white">
          2× <FastForward className="size-4 fill-current" />
        </span>
      ) : null}
      {jump ? (
        <span
          key={jump.key}
          className={cn(
            "pointer-events-none absolute inset-y-0 grid w-1/3 place-items-center bg-white/10 text-white",
            jump.side < 0 ? "left-0 rounded-r-[50%]" : "right-0 rounded-l-[50%]",
          )}
        >
          <span className="flex flex-col items-center gap-1 text-[13px] font-semibold">
            {jump.side < 0 ? <Rewind className="size-6 fill-current" /> : <FastForward className="size-6 fill-current" />}
            {jump.side < 0 ? "−" : "+"}
            {jump.total} с
          </span>
        </span>
      ) : null}
    </div>
  );
}

/** A round icon button in the player's own style (phones: repeat and note next to the speed). */
function PlayerIconButton({ label, on, onClick, children }: { label: string; on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className={cn("vds-button [&_svg]:size-[22px]", on && "!bg-[#e8ddc2] !text-[#0a1028]")}
    >
      {children}
    </button>
  );
}

/** A big end-screen card: the poster with the title over its top edge and the length in the corner. */
function EndCard({ d, label, className }: { d: DanceSummary; label?: string; className: string }) {
  return (
    <Link
      to={`/dance/${d.slug}`} state={WATCH}
      className={cn(
        "group pointer-events-auto absolute block aspect-video w-[30cqw] overflow-hidden rounded-[1cqw] bg-black text-white shadow-xl ring-1 ring-white/30 transition hover:ring-2 hover:ring-white",
        className,
      )}
    >
      {d.posterSmall ? <img src={d.poster || d.posterSmall} alt="" className="size-full object-cover" /> : null}
      <span className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent px-[1.2cqw] pt-[0.9cqw] pb-[2.5cqw]">
        {label ? <span className="block text-[max(10px,1.1cqw)] font-medium text-white/75">{label}</span> : null}
        <span className="line-clamp-2 text-[max(12px,1.75cqw)] leading-tight font-medium">{d.title}</span>
      </span>
      {d.duration ? (
        <span className="tnum absolute right-[0.9cqw] bottom-[0.9cqw] rounded bg-black/80 px-[0.5cqw] text-[max(10px,1.2cqw)] font-medium">{timecode(d.duration)}</span>
      ) : null}
    </Link>
  );
}

/** Theatre mode toggle, only on large screens (T on the keyboard, as on YouTube). */
function TheatreButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const label = on ? "Обычный режим (t)" : "Режим кинотеатра (t)";
  return (
    <button type="button" onClick={onToggle} className="vds-button max-lg:!hidden" aria-label={label} title={label}>
      {/* a wide frame to enter, a narrower one to leave, like YouTube's */}
      <svg className="vds-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
        {on ? <rect x="8" y="10" width="16" height="12" rx="2" /> : <rect x="4" y="9" width="24" height="14" rx="2" />}
      </svg>
    </button>
  );
}

/** Replaces the settings menu: speed presets and a slider in a small popover inside the player (works in fullscreen). */
function SpeedButton() {
  const rate = useMediaState("playbackRate");
  const remote = useMediaRemote();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  const fmt = (r: number) => `${String(Math.round(r * 100) / 100).replace(".", ",")}×`;
  return (
    <div ref={ref} className="relative flex items-center">
      <button
        type="button"
        className="vds-button tnum text-[14px] leading-none font-semibold"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Скорость ${fmt(rate)}`}
        title="Скорость"
        aria-expanded={open}
      >
        {fmt(rate)}
      </button>
      {open ? (
        <div className="absolute right-0 bottom-[72px] z-50 w-64 [[data-sm]_&]:top-11 [[data-sm]_&]:bottom-auto rounded-2xl bg-[var(--sheet)] p-4 text-ink shadow-[var(--shadow-pop)]">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-ink-3">Скорость</span>
            <span className="tnum text-[15px] font-semibold">{fmt(rate)}</span>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-1">
            {[0.5, 0.75, 1, 1.25, 1.5].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => remote.changePlaybackRate(r)}
                className={cn(
                  "tnum h-8 rounded-full text-[12px] font-medium transition-colors",
                  Math.abs(rate - r) < 0.01 ? "bg-accent text-accent-ink" : "bg-surface-2 hover:bg-line",
                )}
              >
                {String(r).replace(".", ",")}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={0.25}
            max={2}
            step={0.05}
            value={rate}
            onChange={(e) => remote.changePlaybackRate(Number(e.target.value))}
            aria-label="Скорость"
            className="bal-range mt-4 h-1 w-full cursor-pointer appearance-none rounded-full"
            style={{ background: `linear-gradient(to right, var(--accent) ${((rate - 0.25) / 1.75) * 100}%, var(--line) ${((rate - 0.25) / 1.75) * 100}%)` }}
          />
          <div className="tnum mt-1.5 flex justify-between text-[11px] text-ink-3">
            <span>0,25×</span>
            <span>2×</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
