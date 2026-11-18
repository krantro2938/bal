import { useMediaState, type MediaPlayerInstance } from "@vidstack/react";
import { Repeat, Share2 } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { timecode } from "@/lib/format";
import type { ThumbCue } from "@/lib/thumbs";
import type { Chapter } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Thumb } from "./Thumb";

type Props = {
  chapters: Chapter[];
  cues: ThumbCue[];
  player: RefObject<MediaPlayerInstance | null>;
  onSeek: (t: number) => void;
  onLoop: (c: Chapter) => void;
  onShare: (t: number) => void;
};

/** YouTube-style chapter list: frame, title, timecode chip, share and repeat on the current one. */
export function ChaptersPanel({ chapters, cues, player, onSeek, onLoop, onShare }: Props) {
  const time = useMediaState("currentTime", player);
  const current = chapters.findIndex((c) => time >= c.start && time < c.end);
  return (
    <section className="overflow-hidden rounded-[var(--radius-sheet)] border border-line">
      <header className="flex items-baseline justify-between border-b border-line px-4 py-3">
        <h2 className="text-[17px] font-semibold">Фрагменты</h2>
        <span className="tnum text-[13px] text-ink-3">{chapters.length} движений</span>
      </header>
      <ol className="max-h-[min(560px,60dvh)] overflow-y-auto py-1">
        {chapters.map((c, i) => (
          <li key={c.start} className={cn("group flex items-center gap-3 px-3 py-1.5 hover:bg-hover", i === current && "bg-hover")}>
            <button type="button" onClick={() => onSeek(c.start)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <Thumb cues={cues} t={c.start + 1} width={96} />
              <span className="min-w-0">
                <span className="line-clamp-2 text-[14px] leading-snug font-medium">{c.title}</span>
                <span className="tnum mt-1 inline-block rounded-md bg-accent-soft px-1.5 py-0.5 text-[12px] font-medium text-accent">
                  {timecode(c.start)}
                </span>
              </span>
            </button>
            <div className={cn("flex shrink-0 gap-0.5", i === current ? "opacity-100" : "opacity-100 lg:opacity-0 lg:group-hover:opacity-100")}>
              <IconButton label={`Поделиться: ${c.title}`} onClick={() => onShare(c.start)}>
                <Share2 className="size-4" />
              </IconButton>
              <IconButton label={`Повторять: ${c.title}`} onClick={() => onLoop(c)}>
                <Repeat className="size-4" />
              </IconButton>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Horizontal strip of chapter cards for phones. */
export function ChaptersCarousel({ chapters, cues, player, onSeek }: Pick<Props, "chapters" | "cues" | "player" | "onSeek">) {
  const time = useMediaState("currentTime", player);
  return (
    <section>
      <h2 className="mb-2 text-[15px] font-semibold">Фрагменты <span className="tnum ml-1 font-normal text-ink-3">{chapters.length}</span></h2>
      <ol className="-mx-4 flex gap-3 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:-mx-6 sm:px-6">
        {chapters.map((c) => {
          const on = time >= c.start && time < c.end;
          return (
            <li key={c.start} className="w-[148px] shrink-0">
              <button type="button" onClick={() => onSeek(c.start)} className="w-full text-left">
                <Thumb cues={cues} t={c.start + 1} width={148} className={cn(on && "ring-2 ring-accent")} />
                <span className="mt-1.5 line-clamp-2 text-[13px] leading-snug font-medium">{c.title}</span>
                <span className="tnum text-[12px] text-accent">{timecode(c.start)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-hover hover:text-ink">
      {children}
    </button>
  );
}
