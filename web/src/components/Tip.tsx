/** Tooltip under a button after half a second of mouse hover; the button needs `group/tip relative`. */
export function Tip({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-full left-1/2 z-30 mt-2 -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-[12px] font-medium whitespace-nowrap text-bg opacity-0 transition-opacity [@media(hover:hover)]:group-hover/tip:opacity-100 [@media(hover:hover)]:group-hover/tip:delay-500"
    >
      {label}
    </span>
  );
}
