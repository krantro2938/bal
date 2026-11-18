import { Bookmark, EllipsisVertical, Share2, ThumbsUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useCatalog } from "@/lib/catalog";
import { ago, timecode, viewsLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { shareLink } from "@/lib/share";
import type { DanceSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AuthPrompt } from "./AuthPrompt";
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

/**
 * Touch screens: one card plays at a time — the one under a line across the screen.
 * The line sits a bit above the middle, moves down while scrolling up so the card coming
 * into view wins, and at the bottom of the page the lowest visible card plays.
 */
const cards = new Map<HTMLElement, (on: boolean) => void>();
let lastY = 0;
let down = true;
let frame = 0;
function pickCard() {
  frame = 0;
  const y = window.scrollY;
  if (y !== lastY) down = y > lastY;
  lastY = y;
  const h = window.innerHeight;
  const atEnd = y + h >= document.documentElement.scrollHeight - 8;
  const line = h * (down ? 0.4 : 0.55);
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of cards.keys()) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > h) continue;
    const visible = r.top >= 0 && r.bottom <= h;
    // at the end of the page the lowest fully visible card wins; otherwise the closest to the line
    const score = atEnd ? (visible ? -r.top : Infinity) : r.top <= line && r.bottom >= line ? 0 : Math.min(Math.abs(r.top - line), Math.abs(r.bottom - line)) + 1;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  // only a card close to the line plays; gaps between cards play nothing
  if (!atEnd && bestScore > 40) best = null;
  for (const [el, set] of cards) set(el === best);
}
const schedule = () => (frame ||= requestAnimationFrame(pickCard));

function usePreview() {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || !matchMedia("(hover: none)").matches) return;
    cards.set(el, setOn);
    if (cards.size === 1) {
      lastY = window.scrollY;
      window.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule);
    }
    schedule();
    return () => {
      cards.delete(el);
      if (!cards.size) {
        window.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", schedule);
      }
    };
  }, []);
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
  const { ref, on, handlers } = usePreview();
  const to = `/dance/${dance.slug}`;
  return (
    <div ref={ref} className="group relative isolate hover:z-10 has-[[data-open]]:z-20" {...handlers}>
      {/* YouTube-style backdrop that grows out of the card on hover */}
      <div className="pointer-events-none absolute -inset-2.5 -z-10 scale-95 rounded-[22px] bg-[var(--card-hover)] opacity-0 shadow-[var(--card-hover-shadow)] transition duration-200 [@media(hover:hover)]:group-hover:scale-100 [@media(hover:hover)]:group-hover:opacity-100" />
      <Link to={to} tabIndex={-1} aria-hidden className="block rounded-[var(--radius-frame)]">
        <Cover dance={dance} eager={eager} playing={on && dance.available} />
      </Link>
      <div className="mt-3 flex gap-1">
        <Link to={to} className="flex min-w-0 flex-1 gap-3 rounded-lg focus-visible:outline-offset-4">
          <Badge dance={dance} />
          <div className="min-w-0">
            <h2 className="line-clamp-2 font-title text-[18px] leading-snug">{dance.title}</h2>
            <p className="tnum mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-3">
              <span>{viewsLabel(dance.views)}</span>
              {dance.published ? <span>{ago(dance.published)}</span> : null}
              {badge ? <span className="text-accent">{badge}</span> : null}
            </p>
          </div>
        </Link>
        <CardMenu dance={dance} />
      </div>
    </div>
  );
}

/** The ⋮ menu under a card: save and share without opening the video. */
function CardMenu({ dance }: { dance: DanceSummary }) {
  const { user, state, setMark } = useSession();
  const catalog = useCatalog();
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const saved = !!state?.favorites.includes(dance.slug);
  const save = () => {
    setOpen(false);
    if (!user) return setAsk("Чтобы сохранять танцы и видеть их на всех устройствах.");
    setMark("favorite", dance.slug, !saved).then(
      () => toast(saved ? "Убрано из сохранённых" : "Сохранено — танец есть в «Избранном»"),
      () => toast("Не удалось сохранить, попробуйте ещё раз"),
    );
  };
  const share = () => {
    setOpen(false);
    shareLink(`${catalog.data?.shareUrl || location.origin}/dance/${dance.slug}`, dance.title);
  };
  const item = "flex h-10 w-full items-center gap-3 px-4 text-left text-[14px] hover:bg-hover [&_svg]:size-[18px]";
  return (
    <div ref={ref} className="relative -mr-2 shrink-0" data-open={open || undefined}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Действия"
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "grid size-9 place-items-center rounded-full text-ink-2 hover:bg-hover hover:text-ink",
          !open && "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100",
        )}
      >
        <EllipsisVertical className="size-5" />
      </button>
      {open ? (
        <div role="menu" className="absolute top-10 right-0 z-30 w-60 overflow-hidden rounded-xl bg-[var(--sheet)] py-2 shadow-[var(--shadow-pop)]">
          <button type="button" role="menuitem" onClick={save} className={item}>
            <Bookmark className={cn(saved && "fill-current")} />
            {saved ? "Убрать из сохранённых" : "Сохранить"}
          </button>
          <button type="button" role="menuitem" onClick={share} className={item}>
            <Share2 />
            Поделиться
          </button>
        </div>
      ) : null}
      {ask ? <AuthPrompt reason={ask} returnTo={() => location.pathname + location.search} onClose={() => setAsk(null)} /> : null}
    </div>
  );
}

/** Small row for the "next" list beside the player. */
export function CompactCard({ dance, current }: { dance: DanceSummary; current?: boolean }) {
  const { ref, on, handlers } = usePreview();
  return (
    <div ref={ref} {...handlers}>
      <Link
        to={`/dance/${dance.slug}`}
        aria-current={current ? "page" : undefined}
        className={cn("flex gap-2.5 rounded-[var(--radius-frame)] p-1 hover:bg-hover", current && "bg-hover")}
      >
        <Cover dance={dance} playing={on && dance.available && !current} className="w-[168px] shrink-0 rounded-lg sm:w-[208px]" />
        <div className="min-w-0 py-0.5">
          <h3 className="line-clamp-2 text-[15px] leading-snug font-medium text-ink-soft">{dance.title}</h3>
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
