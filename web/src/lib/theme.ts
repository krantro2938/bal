import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "bal-theme";
const EVENT = "bal:theme";
const mq = () => window.matchMedia("(prefers-color-scheme: dark)");

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** Two states. The first visit follows the system; a click stores the choice. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? (mq().matches ? "dark" : "light"));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  // Several toggles (header, account menu) stay in step.
  useEffect(() => {
    const onSet = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener(EVENT, onSet);
    return () => window.removeEventListener(EVENT, onSet);
  }, []);
  useEffect(() => {
    if (stored()) return;
    const m = mq();
    const onChange = () => !stored() && setTheme(m.matches ? "dark" : "light");
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked: still applied for this visit */
    }
  };
  return [theme, toggle] as const;
}
