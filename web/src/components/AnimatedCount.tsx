import { useEffect, useRef } from "react";

/** Animate confirmed changes to the displayed value without rolling through invented counts. */
export function AnimatedCount({ value, className }: { value: string; className?: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (!value || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = element.current?.animate?.(
      [{ opacity: 0.45, transform: "translateY(0.3em)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 220, easing: "ease-out" },
    );
    return () => animation?.cancel();
  }, [value]);
  return <span ref={element} className={className} style={{ display: value ? "inline-block" : "none" }}>{value}</span>;
}
