import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import { MediaPlayer, MediaProvider, Poster, Track, useMediaRemote, useMediaState, type MediaPlayerInstance } from "@vidstack/react";
import { DefaultVideoLayout, defaultLayoutIcons, type DefaultLayoutTranslations } from "@vidstack/react/player/layouts/default";
import { ArrowRightFromLine, ArrowRightToLine, Hand, LocateFixed, Minus, Plus, Repeat, RotateCcw, RotateCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import { SplitPill, splitHalf } from "@/components/SplitPill";
import { Star } from "@/components/Star";
import { timecode } from "@/lib/format";
import type { DanceDetail, Note } from "@/lib/types";
import { cn } from "@/lib/utils";

export type Loop = { a: number; b: number } | null;

/** Default loop length when it is switched on at the playhead. */
export const LOOP_SECONDS = 8;

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

export function RehearsalPlayer({
  dance,
  player,
  startAt,
  loop,
  setLoop,
  notes,
  onNote,
  onReady,
}: {
  dance: DanceDetail;
  player: RefObject<MediaPlayerInstance | null>;
  startAt: number | null;
  loop: Loop;
  setLoop: (l: Loop) => void;
  notes: Note[];
  onNote: () => void;
  onReady: () => void;
}) {
  const video = dance.video!;
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

  const chapters = useMemo(
    () => ({ cues: dance.chapterList.map((c) => ({ startTime: c.start, endTime: c.end, text: c.title })) }),
    [dance.chapterList],
  );

  return (
    <div>
      <MediaPlayer
        ref={player}
        className="bal-player aspect-video w-full overflow-hidden rounded-[var(--radius-frame)]"
        title={dance.title}
        src={{ src: video.url, type: "video/mp4" }}
        playsInline
        preload="metadata"
        keyShortcuts={{ togglePaused: "k Space", seekBackward: "j J ArrowLeft", seekForward: "l L ArrowRight", toggleFullscreen: "f" }}
        onLoadedMetadata={onReady}
        onCanPlay={() => {
          if (!started.current && startAt !== null && player.current) {
            started.current = true;
            player.current.currentTime = Math.min(startAt, video.duration - 0.5);
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
          slots={{ googleCastButton: null, pipButton: null, airPlayButton: null, settingsMenu: <SpeedButton /> }}
        />
      </MediaPlayer>
      <RehearsalBar player={player} duration={video.duration} loop={loop} setLoop={setLoop} notes={notes} onNote={onNote} />
    </div>
  );
}

function RehearsalBar({
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
    const a = clamp(Math.min(now(), duration - LOOP_SECONDS));
    setLoop({ a, b: clamp(a + LOOP_SECONDS) });
    player.current?.play().catch(() => {});
  };

  return (
    <div className="bg-bg pt-3 pb-1">
      <div className="flex flex-wrap items-center gap-2">
        <SplitPill label="Перемотка" className="h-10">
          <button type="button" onClick={() => seekBy(-5)} aria-label="Назад на 5 секунд" title="Назад на 5 секунд" className={cn(splitHalf("l"), "gap-1")}>
            <RotateCcw className="size-[18px]" />
            <span className="tnum text-[13px]">5</span>
          </button>
          <button type="button" onClick={() => seekBy(5)} aria-label="Вперёд на 5 секунд" title="Вперёд на 5 секунд" className={cn(splitHalf("r"), "gap-1")}>
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
              className={cn("tnum h-full rounded-full px-2.5 text-[13px] font-medium", rate === r ? "bg-accent text-accent-ink" : "text-ink-2 hover:text-ink")}
            >
              {String(r).replace(".", ",")}×
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={toggleLoop}
          aria-pressed={!!loop}
          className={cn(
            "flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium",
            loop ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink hover:bg-line",
          )}
        >
          <Repeat className="size-[18px]" />
          {loop ? "Повтор включён" : "Повтор фрагмента"}
        </button>

        <button
          type="button"
          onClick={onNote}
          className="flex h-10 items-center gap-1.5 rounded-full bg-surface-2 px-4 text-sm font-medium hover:bg-line sm:ml-auto"
        >
          <Star className="size-3.5 text-accent" />
          <span className="tnum">Заметка на {timecode(time)}</span>
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
    <div className="mt-4 rounded-[var(--radius-sheet)] border border-line px-4 pt-3 pb-4">
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
        <EndEditor icon={<ArrowRightFromLine />} label="Начало" t={loop.a} onStep={(d) => set(loop.a + d, loop.b)} onHere={() => set(now(), loop.b)} />
        <EndEditor icon={<ArrowRightToLine />} label="Конец" t={loop.b} onStep={(d) => set(loop.a, loop.b + d)} onHere={() => set(loop.a, now())} />
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-3 [&_svg]:inline [&_svg]:size-3.5 [&_svg]:align-[-2px]">
        <Hand /> Тяните края полосы или нажмите <LocateFixed /> «Сюда» — край встанет на текущий момент видео
      </p>
    </div>
  );
}

function EndEditor({ icon, label, t, onStep, onHere }: { icon: ReactNode; label: string; t: number; onStep: (d: number) => void; onHere: () => void }) {
  const step = "grid size-8 place-items-center rounded-full text-ink-2 hover:bg-hover hover:text-ink";
  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 flex w-[5.25rem] items-center gap-1.5 text-[13px] text-ink-2 [&_svg]:size-4 [&_svg]:text-accent">
        {icon}
        {label}
      </span>
      <button type="button" onClick={() => onStep(-0.5)} className={step} aria-label={`${label}: на полсекунды раньше`} title="На 0,5 с раньше">
        <Minus className="size-4" />
      </button>
      <span className="tnum w-11 text-center text-[15px] font-semibold">{timecode(t)}</span>
      <button type="button" onClick={() => onStep(0.5)} className={step} aria-label={`${label}: на полсекунды позже`} title="На 0,5 с позже">
        <Plus className="size-4" />
      </button>
      <button
        type="button"
        onClick={onHere}
        className="ml-1 flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-accent hover:bg-hover"
        title={`Поставить ${label.toLowerCase()} в текущий момент видео`}
      >
        <LocateFixed className="size-4" />
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
  const [drag, setDrag] = useState<{ end: "a" | "b"; view: [number, number] } | null>(null);
  // The strip zooms to the fragment and some context around it, so even a few seconds read clearly.
  // While an end is dragged the window holds still.
  const live = useMemo(() => loopWindow(loop, duration), [loop, duration]);
  const [w0, w1] = drag?.view ?? live;
  const inView = (t: number) => t >= w0 && t <= w1;
  const pct = (t: number) => `${((Math.min(Math.max(t, w0), w1) - w0) / (w1 - w0)) * 100}%`;
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round((w0 + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (w1 - w0)) * 10) / 10;
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || !loop) return;
    const t = timeAt(e.clientX);
    if (drag.end === "a" && t <= loop.b - 0.5) setLoop({ a: t, b: loop.b });
    if (drag.end === "b" && t >= loop.a + 0.5) setLoop({ a: loop.a, b: t });
  };
  return (
    <div>
      <div
        ref={track}
        className="relative h-8 cursor-pointer touch-none select-none"
        onPointerDown={(e) => {
          if (drag) return;
          if (player.current) player.current.currentTime = Math.min(duration - 0.1, timeAt(e.clientX));
        }}
        onPointerMove={onMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        role="presentation"
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line" />
        <div className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-ink-3/60" style={{ width: pct(time) }} />
        {loop ? (
          <>
            {/* The repeating fragment: a light band with diagonal hatching. */}
            <div
              className="absolute top-1/2 h-6 -translate-y-1/2 rounded-md bg-accent-soft"
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
                className="absolute top-1/2 z-10 grid h-8 w-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center"
                style={{ left: pct(loop[end]) }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  track.current?.setPointerCapture(e.pointerId);
                  setDrag({ end, view: live });
                }}
              >
                <span className="h-7 w-1.5 rounded-full bg-accent" />
              </button>
            ))}
          </>
        ) : null}
        {notes.filter((n) => inView(n.t)).map((n) => (
          <span key={n.id} className="pointer-events-none absolute -top-1 -translate-x-1/2 text-accent" style={{ left: pct(n.t) }}>
            <Star className="size-2.5" />
          </span>
        ))}
        {inView(time) ? (
          <div className="pointer-events-none absolute top-1/2 z-20 h-5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" style={{ left: pct(time) }} />
        ) : null}
      </div>
      <div className="tnum mt-0.5 flex justify-between text-[11px] text-ink-3">
        <span>{timecode(w0)}</span>
        <span>{timecode(w1)}</span>
      </div>
    </div>
  );
}

/** Visible range of the loop strip: the fragment plus as much again on each side, at least 20 s in total. */
function loopWindow(loop: Loop, duration: number): [number, number] {
  if (!loop) return [0, duration];
  const span = Math.min(duration, Math.max(20, (loop.b - loop.a) * 3));
  let w0 = (loop.a + loop.b) / 2 - span / 2;
  w0 = Math.max(0, Math.min(duration - span, w0));
  return [Math.floor(w0), Math.min(duration, Math.ceil(w0 + span))];
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
    <div ref={ref} className="relative">
      <button
        type="button"
        className="tnum mx-1 flex h-8 items-center rounded-full bg-white/10 px-3 text-[13px] font-semibold text-white transition-colors hover:bg-white/20"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Скорость ${fmt(rate)}`}
        aria-expanded={open}
      >
        {fmt(rate)}
      </button>
      {open ? (
        <div className="absolute right-0 bottom-[72px] z-50 w-64 [[data-sm]_&]:top-11 [[data-sm]_&]:bottom-auto rounded-2xl bg-[#0b1230]/95 p-4 text-[#ece6d6] shadow-2xl ring-1 ring-white/10 backdrop-blur">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-white/60">Скорость</span>
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
                  Math.abs(rate - r) < 0.01 ? "bg-[#e8ddc2] text-[#0a1028]" : "bg-white/10 hover:bg-white/20",
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
            style={{ background: `linear-gradient(to right, #e8ddc2 ${((rate - 0.25) / 1.75) * 100}%, rgb(255 255 255 / 0.2) ${((rate - 0.25) / 1.75) * 100}%)`, ["--accent" as string]: "#e8ddc2" }}
          />
          <div className="tnum mt-1.5 flex justify-between text-[11px] text-white/40">
            <span>0,25×</span>
            <span>2×</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
