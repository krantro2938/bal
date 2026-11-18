import { ThumbsUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ago, timecode, viewsLabel } from "@/lib/format";
import type { DanceSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Star } from "./Star";

export function Cover({
  dance,
  className,
  eager,
  quiet,
  playing,
}: {
  dance: DanceSummary;
  className?: string;
  eager?: boolean;
  quiet?: boolean;
  playing?: boolean;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!playing) setShown(false);
  }, [playing]);
  return (
    <div className={cn("relative aspect-video overflow-hidden rounded-[var(--radius-frame)] bg-player", className)}>
      {dance.posterSmall ? (
        <img
          src={dance.posterSmall}
          srcSet={`${dance.posterSmall} 640w, ${dance.poster} 1280w`}
          sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          className={cn("size-full object-cover", !dance.available && "opacity-40")}
        />
      ) : (
        <div className="grid size-full place-items-center px-6 text-center text-sm text-[#a7aecb]">{quiet ? null : "Видео ещё не загружено на сайт"}</div>
      )}
      {playing && dance.preview ? (
        <video
          src={dance.preview}
          muted
          loop
          autoPlay
          playsInline
          preload="auto"
          disablePictureInPicture
          onPlaying={() => setShown(true)}
          className={cn("absolute inset-0 size-full object-cover transition-opacity duration-300", shown ? "opacity-100" : "opacity-0")}
        />
      ) : null}
      {isNew(dance) && !quiet ? (
        <span className="absolute top-2 left-2">
          <NewBadge />
        </span>
      ) : null}
      {dance.duration ? (
        <span className="tnum absolute right-2 bottom-2 rounded-md bg-[#05091a]/80 px-1.5 py-0.5 text-[12px] font-medium text-[#ece6d6]">
          {timecode(dance.duration)}
        </span>
      ) : null}
    </div>
  );
}

/** The order number in a round badge, where YouTube puts the channel avatar. */
export function Badge({ dance, size = 36 }: { dance: DanceSummary; size?: number }) {
  return (
    <span
      className="tnum grid shrink-0 place-items-center rounded-full bg-[#081028] font-display font-semibold text-[#e8ddc2] ring-1 ring-line"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {dance.kind === "glossary" ? <Star className="size-[45%]" /> : String(dance.order).padStart(2, "0")}
    </span>
  );
}

/** Published in the last five days. */
export const isNew = (d: DanceSummary) => !!d.published && Date.now() - new Date(d.published).getTime() < 5 * 86400000;

export function NewBadge() {
  return <span className="rounded-md bg-white px-1.5 py-0.5 text-[12px] font-semibold text-[#0a1028] shadow-sm">Новое</span>;
}

const PREVIEW_EVENT = "bal:preview";

/** Plays the preview on mouse hover, or when the card is fully in view on touch screens. */
function usePreview(slug: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || !matchMedia("(hover: none)").matches) return;
    const onOther = (e: Event) => setOn((e as CustomEvent<string>).detail === slug);
    window.addEventListener(PREVIEW_EVENT, onOther);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= 0.95) window.dispatchEvent(new CustomEvent(PREVIEW_EVENT, { detail: slug }));
        else setOn(false);
      },
      { threshold: [0, 0.95] },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.removeEventListener(PREVIEW_EVENT, onOther);
    };
  }, [slug]);
  const handlers = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setOn(true), 350);
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      window.clearTimeout(timer.current);
      setOn(false);
    },
  };
  return { ref, on, handlers };
}

export function VideoCard({ dance, eager, badge }: { dance: DanceSummary; eager?: boolean; badge?: string }) {
  const { ref, on, handlers } = usePreview(dance.slug);
  return (
    <div ref={ref} className="group relative isolate hover:z-10" {...handlers}>
      {/* YouTube-style backdrop that grows out of the card on hover */}
      <div className="pointer-events-none absolute -inset-2.5 -z-10 scale-95 rounded-[22px] bg-[var(--card-hover)] opacity-0 shadow-[var(--card-hover-shadow)] transition duration-200 [@media(hover:hover)]:group-hover:scale-100 [@media(hover:hover)]:group-hover:opacity-100" />
      <Link to={`/dance/${dance.slug}`} className="block rounded-[var(--radius-frame)] focus-visible:outline-offset-4">
        <Cover dance={dance} eager={eager} playing={on && dance.available} />
        <div className="mt-3 flex gap-3">
          <Badge dance={dance} />
          <div className="min-w-0 pr-1">
            <h2 className="line-clamp-2 font-title text-[18px] leading-snug">{dance.title}</h2>
            <p className="tnum mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-3">
              <span>{viewsLabel(dance.views)}</span>
              {dance.published ? <span>{ago(dance.published)}</span> : null}
              <span className="inline-flex items-center gap-1">
                <ThumbsUp className="size-3.5" /> {dance.likes}
              </span>
              {badge ? <span className="text-accent">{badge}</span> : null}
            </p>
          </div>
        </div>
      </Link>
    </div>
  );
}

/** Small row for the "next" list beside the player. */
export function CompactCard({ dance, current }: { dance: DanceSummary; current?: boolean }) {
  const { ref, on, handlers } = usePreview(`compact-${dance.slug}`);
  return (
    <div ref={ref} {...handlers}>
      <Link
        to={`/dance/${dance.slug}`}
        aria-current={current ? "page" : undefined}
        className={cn("flex gap-2.5 rounded-[var(--radius-frame)] p-1 hover:bg-hover", current && "bg-hover")}
      >
        <Cover dance={dance} playing={on && dance.available && !current} className="w-[168px] shrink-0 rounded-lg" />
        <div className="min-w-0 py-0.5">
          <h3 className="line-clamp-2 text-[15px] leading-snug font-medium">{dance.title}</h3>
          <p className="mt-1 text-[12px] text-ink-3">{dance.kind === "glossary" ? "Словарь движений" : `Танец ${String(dance.order).padStart(2, "0")}`}</p>
          <p className="tnum flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
            <span>{viewsLabel(dance.views)}</span>
            <span className="inline-flex items-center gap-1">
              <ThumbsUp className="size-3" /> {dance.likes}
            </span>
            {current ? <span className="text-accent">сейчас</span> : null}
          </p>
        </div>
      </Link>
    </div>
  );
}
