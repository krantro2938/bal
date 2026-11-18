import { useEffect, useLayoutEffect, useRef, type Ref } from "react";
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
  // Grows with the text. A hidden field (a collapsed section) measures 0, so it is measured
  // again whenever its size changes, e.g. when the section opens.
  const fit = () => {
    const el = own.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight) el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(fit, [value]);
  useEffect(() => {
    const el = own.current;
    if (!el) return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        fit();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
