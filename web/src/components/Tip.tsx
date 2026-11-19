/** Tooltip under a button after half a second of mouse hover; the button needs `group/tip relative`.
 *  `end` keeps it inside the page for buttons at the right edge. Touch screens never show it, so
 *  there it isn't laid out at all (it would make a row it sticks out of scrollable). */
export function Tip({ label, align = "center" }: { label: string; align?: "center" | "end" }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute top-full z-30 mt-2 [@media(hover:none)]:hidden ${align === "end" ? "right-0" : "left-1/2 -translate-x-1/2"} rounded-md bg-ink px-2 py-1 text-[12px] font-medium whitespace-nowrap text-bg opacity-0 transition-opacity [@media(hover:hover)]:group-hover/tip:opacity-100 [@media(hover:hover)]:group-hover/tip:delay-500`}
    >
      {label}
    </span>
  );
}
