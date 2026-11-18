import { ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

const fmt = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });

/** Like | dislike pill with counts, like YouTube's. */
export function ReactionPill({
  likes,
  dislikes,
  mine,
  onReact,
}: {
  likes: number;
  dislikes: number;
  mine: -1 | 0 | 1;
  onReact: (v: -1 | 0 | 1) => void;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center rounded-full bg-surface-2" role="group" aria-label="Оценка">
      <button
        type="button"
        onClick={() => onReact(mine === 1 ? 0 : 1)}
        aria-pressed={mine === 1}
        className="flex h-full items-center gap-2 rounded-l-full pr-3 pl-3.5 text-sm font-medium hover:bg-line"
        title="Нравится"
      >
        <ThumbsUp className={cn("size-[18px]", mine === 1 && "fill-current")} />
        <span className="tnum">{fmt.format(likes)}</span>
      </button>
      <span className="h-5 w-px bg-line-strong" />
      <button
        type="button"
        onClick={() => onReact(mine === -1 ? 0 : -1)}
        aria-pressed={mine === -1}
        className="flex h-full items-center gap-2 rounded-r-full pr-3.5 pl-3 text-sm font-medium hover:bg-line"
        title="Не нравится"
      >
        <ThumbsDown className={cn("size-[18px]", mine === -1 && "fill-current")} />
        <span className="tnum">{fmt.format(dislikes)}</span>
      </button>
    </div>
  );
}
