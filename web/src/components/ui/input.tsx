import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-[var(--radius-frame)] border border-line bg-surface-2 px-3.5 text-base text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full resize-y rounded-[var(--radius-frame)] border border-line bg-surface-2 px-3.5 py-3 text-base text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}
