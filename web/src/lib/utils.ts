import type { CSSProperties } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Each person's colour: the letter in place of a missing photo, and the «Открыть профиль»
// button on their account page. Picked by id, so it survives a new name or @handle.
const HUES = [212, 236, 262, 288, 322, 350, 14, 32, 152, 172, 192];
export function userHue(u: { id?: number; name: string }) {
  const n = u.id ?? [...u.name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return HUES[n % HUES.length];
}

/** `style` for a node whose classes use var(--hue) (e.g. bg-[hsl(var(--hue)_50%_44%)]). */
export const hueStyle = (hue: number) => ({ "--hue": hue }) as CSSProperties;
