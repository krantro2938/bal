import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Empty / unavailable / error message: one sentence, one action. */
export function StateBlock({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("border-t border-line py-8", className)}>
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 max-w-[52ch] text-[15px] text-ink-2">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
