import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** The four-point sparkle from the ball's posters; the site's only ornament. */
export function Star({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("inline-block size-[0.9em]", className)} style={style}>
      <path d="M12 1.5c.7 5.4 4.1 9.4 10.5 10.5-6.4 1.1-9.8 5.1-10.5 10.5-.7-5.4-4.1-9.4-10.5-10.5C7.9 10.9 11.3 6.9 12 1.5z" fill="currentColor" />
    </svg>
  );
}
