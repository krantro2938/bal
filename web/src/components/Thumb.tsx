import { cueAt, type ThumbCue } from "@/lib/thumbs";
import { cn } from "@/lib/utils";

const COLS = 8;
const ROWS = 8;

/** One frame from the timeline sprite sheets, scaled to `width` px. */
export function Thumb({ cues, t, width, className }: { cues: ThumbCue[]; t: number; width: number; className?: string }) {
  const c = cueAt(cues, t);
  if (!c) return <div className={cn("aspect-video shrink-0 rounded-lg bg-player", className)} style={{ width }} />;
  const k = width / c.w;
  return (
    <div
      className={cn("aspect-video shrink-0 rounded-lg bg-player bg-no-repeat", className)}
      style={{
        width,
        backgroundImage: `url(${c.url})`,
        backgroundSize: `${COLS * c.w * k}px ${ROWS * c.h * k}px`,
        backgroundPosition: `${-c.x * k}px ${-c.y * k}px`,
      }}
      aria-hidden
    />
  );
}
