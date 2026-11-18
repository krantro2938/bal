import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Bottom sheet on phones, centred panel from 640px up. On phones it is a drawer like
 * shadcn's: a handle on top, and dragging the top part down far or fast enough closes it.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const [dy, setDy] = useState(0);
  const drag = useRef<{ y: number; t: number } | null>(null);
  const phone = () => !matchMedia("(min-width: 640px)").matches;

  const onDown = (e: PointerEvent) => {
    if (!phone() || (e.target as HTMLElement).closest("button")) return;
    drag.current = { y: e.clientY, t: e.timeStamp };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (drag.current) setDy(Math.max(0, e.clientY - drag.current.y));
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const moved = e.clientY - d.y;
    const speed = moved / Math.max(1, e.timeStamp - d.t);
    if (moved > 120 || speed > 0.6) onOpenChange(false);
    setDy(0);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setDy(0);
        onOpenChange(o);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--scrim)]" style={dy ? { opacity: Math.max(0.2, 1 - dy / 400) } : undefined} />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-[var(--radius-sheet)] bg-[var(--sheet)] px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-sheet)]",
            "max-sm:animate-[sheet-up_.28s_cubic-bezier(.32,.72,0,1)]",
            "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[440px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[24px] sm:p-7",
            !dy && "transition-transform duration-200",
            className,
          )}
          style={dy ? { transform: `translateY(${dy}px)` } : undefined}
        >
          {/* Drag zone: the handle and the heading. */}
          <div className="touch-none select-none sm:touch-auto sm:select-auto" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-line-strong sm:hidden" aria-hidden />
            <div className="mb-7 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="font-title text-[24px]">{title}</Dialog.Title>
                {description ? <Dialog.Description className="mt-2 text-[15px] leading-relaxed text-ink-2">{description}</Dialog.Description> : null}
              </div>
              <Dialog.Close className="-mt-1 -mr-1 grid size-9 place-items-center rounded-full text-ink-2 hover:bg-surface-2 max-sm:hidden" aria-label="Закрыть">
                <X className="size-5" />
              </Dialog.Close>
            </div>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
