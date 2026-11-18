import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Empty / unavailable / error message: one sentence, one action; with `art`, a centred picture on top. */
export function StateBlock({
  title,
  children,
  action,
  art,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  art?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(art ? "flex flex-col items-center py-12 text-center" : "border-t border-line py-8", className)}>
      {art}
      <p className={cn("font-medium", art && "mt-6 text-[18px] break-words")}>{title}</p>
      {children ? <div className="mt-1 max-w-[52ch] text-[15px] text-ink-2">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
