import { Download, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { timecode } from "@/lib/format";
import { cn } from "@/lib/utils";

const PLAY_EVENT = "bal:audio-play";

/** Practice track in the site's style: play/pause, seek, time and a download button. */
export function AudioTrack({ src, title, duration, filename }: { src: string; title: string; duration: number; filename: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [len, setLen] = useState(duration);

  // Only one track plays at a time.
  useEffect(() => {
    const onOther = (e: Event) => (e as CustomEvent<string>).detail !== src && audio.current?.pause();
    window.addEventListener(PLAY_EVENT, onOther);
    return () => window.removeEventListener(PLAY_EVENT, onOther);
  }, [src]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) {
      window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: src }));
      a.play().catch(() => {});
    } else a.pause();
  };

  const pct = len ? (time / len) * 100 : 0;
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-frame)] p-2 transition-colors hover:bg-hover">
      <audio
        ref={audio}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setLen(e.currentTarget.duration || duration)}
      />
      <button
        type="button"
        onClick={toggle}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition-transform active:scale-95"
        aria-label={playing ? "Пауза" : `Слушать «${title}»`}
      >
        {playing ? <Pause className="size-[18px] fill-current" /> : <Play className="ml-0.5 size-[18px] fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-[14px] font-medium">{title}</p>
          <span className="tnum shrink-0 text-[12px] text-ink-3">
            {playing || time > 0 ? `${timecode(time)} / ` : ""}
            {timecode(len)}
          </span>
        </div>
        <div className="mt-2 flex items-center">
          <input
            type="range"
            min={0}
            max={len || 1}
            step={0.1}
            value={time}
            onChange={(e) => {
              const t = Number(e.target.value);
              setTime(t);
              if (audio.current) audio.current.currentTime = t;
            }}
            aria-label="Перемотка"
            className={cn("bal-range h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-line")}
            style={{ background: `linear-gradient(to right, var(--accent) ${pct}%, var(--line-strong) ${pct}%)` }}
          />
        </div>
      </div>
      <a
        href={src}
        download={filename}
        className="grid size-9 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-hover hover:text-ink"
        aria-label={`Скачать «${title}»`}
        title="Скачать"
      >
        <Download className="size-[18px]" />
      </a>
    </div>
  );
}
