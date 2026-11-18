import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Bottom sheet on phones, centred panel from 640px up. */
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
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--scrim)]" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-[var(--radius-sheet)] bg-[var(--sheet)] px-5 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-sheet)]",
            "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[440px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[24px] sm:p-7",
            className,
          )}
        >
          <div className="mb-7 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-title text-[24px]">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-2 text-[15px] leading-relaxed text-ink-2">{description}</Dialog.Description> : null}
            </div>
            <Dialog.Close className="-mt-1 -mr-1 grid size-9 place-items-center rounded-full text-ink-2 hover:bg-surface-2" aria-label="Закрыть">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
