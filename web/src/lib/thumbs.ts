import { useEffect, useState } from "react";

export type ThumbCue = { start: number; end: number; url: string; x: number; y: number; w: number; h: number };

const cache = new Map<string, Promise<ThumbCue[]>>();

function parseTime(s: string) {
  const [h, m, rest] = s.split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(rest);
}

/** Parses the sprite WebVTT written by `bal prepare` (one cue per 2 s). */
export function loadThumbs(url: string): Promise<ThumbCue[]> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => {
        const cues: ThumbCue[] = [];
        for (const block of text.split(/\n\n+/)) {
          const m = block.match(/([\d:.]+) --> ([\d:.]+)\n(.+)#xywh=(\d+),(\d+),(\d+),(\d+)/);
          if (m) cues.push({ start: parseTime(m[1]), end: parseTime(m[2]), url: m[3], x: +m[4], y: +m[5], w: +m[6], h: +m[7] });
        }
        return cues;
      })
      .catch(() => []);
    cache.set(url, p);
  }
  return p;
}

export function useThumbs(url?: string) {
  const [cues, setCues] = useState<ThumbCue[]>([]);
  useEffect(() => {
    if (url) loadThumbs(url).then(setCues);
  }, [url]);
  return cues;
}

export function cueAt(cues: ThumbCue[], t: number) {
  return cues.find((c) => t >= c.start && t < c.end) ?? cues[cues.length - 1];
}
