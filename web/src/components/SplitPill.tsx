import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Two buttons in one pill, like YouTube's like | dislike: each half highlights to the
 * pill's edge, and the divider stays in the centre above the highlight.
 */
export function SplitPill({ label, className, children }: { label: string; className?: string; children: [ReactNode, ReactNode] }) {
  return (
    <div className={cn("relative grid h-9 shrink-0 grid-cols-[1fr_1fr] rounded-full bg-surface-2", className)} role="group" aria-label={label}>
      {children}
      <span className="pointer-events-none absolute top-1/2 left-1/2 h-5 w-px -translate-x-1/2 -translate-y-1/2 bg-line-strong" />
    </div>
  );
}

export const splitHalf = (side: "l" | "r") =>
  cn(
    "flex h-full items-center justify-center gap-2 text-sm font-medium transition-colors hover:bg-line",
    side === "l" ? "rounded-l-full pr-3 pl-3.5" : "rounded-r-full pr-3.5 pl-3",
  );
