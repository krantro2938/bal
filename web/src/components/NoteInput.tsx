import { useLayoutEffect, useRef, type Ref } from "react";
import { cn } from "@/lib/utils";

/** Auto-growing textarea for inline notes; Ctrl/⌘+Enter saves, Escape cancels. */
export function NoteInput({
  ref,
  value,
  onChange,
  onCancel,
  placeholder,
  autoFocus,
  className,
}: {
  ref?: Ref<HTMLTextAreaElement>;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = own.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={(el) => {
        own.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      rows={1}
      autoFocus={autoFocus}
      value={value}
      maxLength={2000}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
      }}
      className={cn(
        "block w-full resize-none overflow-hidden border-0 border-b-2 border-ink-2 bg-transparent pb-2 text-[15px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none",
        className,
      )}
    />
  );
}
