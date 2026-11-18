import { ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { SplitPill, splitHalf } from "./SplitPill";

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
    <SplitPill label="Оценка" className="sm:h-10 sm:text-[15px] sm:[&_svg]:size-5">
      <button type="button" onClick={() => onReact(mine === 1 ? 0 : 1)} aria-pressed={mine === 1} className={splitHalf("l")} title="Нравится">
        <ThumbsUp className={cn("size-[18px]", mine === 1 && "fill-current")} />
        <span className="tnum">{fmt.format(likes)}</span>
      </button>
      <button type="button" onClick={() => onReact(mine === -1 ? 0 : -1)} aria-pressed={mine === -1} className={splitHalf("r")} title="Не нравится">
        <ThumbsDown className={cn("size-[18px]", mine === -1 && "fill-current")} />
        <span className="tnum">{fmt.format(dislikes)}</span>
      </button>
    </SplitPill>
  );
}
