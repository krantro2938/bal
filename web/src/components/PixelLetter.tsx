import { useEffect, useRef } from "react";

// The posters' palette: night sky, star blues, and the moon's ivory ramp for the letter.
const SKY = "#05091a";
const STARS = ["#24378a", "#3c4f9e", "#8f8674", "#d9cdb1"];
const MOON = ["#b9ad94", "#d9cdb1", "#ece2c8", "#fff6df"];
const CELL = 5; // CSS pixels per art pixel

type Dot = {
  x: number;
  y: number;
  sx: number;
  sy: number;
  delay: number;
  phase: number;
  shade: number;
};

/**
 * A profile's initial drawn by the night sky: star pixels drift in from everywhere and
 * settle into the letter (set in the posters' display face), which then twinkles softly.
 */
export function PixelLetter({
  letter,
  className,
}: {
  letter: string;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ch = (letter.trim().charAt(0) || "★").toUpperCase();
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let stop = false;

    const start = async () => {
      await document.fonts.load('700 64px "Playfair Display"').catch(() => {});
      if (stop) return;
      const r = canvas.getBoundingClientRect();
      const W = Math.max(40, Math.round(r.width / CELL));
      const H = Math.max(30, Math.round(r.height / CELL));
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;

      // Rasterise the letter at art-pixel size and keep its solid pixels as targets.
      const off = document.createElement("canvas");
      off.width = W;
      off.height = H;
      const o = off.getContext("2d")!;
      o.fillStyle = "#fff";
      o.textAlign = "center";
      o.textBaseline = "middle";
      o.font = `700 ${Math.round(H * 0.78)}px "Playfair Display", serif`;
      o.fillText(ch, W / 2, H / 2 + H * 0.04);
      const a = o.getImageData(0, 0, W, H).data;
      const dots: Dot[] = [];
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          if (a[(y * W + x) * 4 + 3] > 110)
            dots.push({
              x,
              y,
              sx: Math.random() * W,
              sy: Math.random() * H,
              delay: Math.random() * 700,
              phase: Math.random() * Math.PI * 2,
              shade: Math.min(
                MOON.length - 1,
                Math.floor(
                  (1 - y / H) * MOON.length * 0.9 + Math.random() * 1.2,
                ),
              ),
            });

      // A few background stars that twinkle on their own.
      const sky = Array.from({ length: Math.round((W * H) / 70) }, () => ({
        x: Math.floor(Math.random() * W),
        y: Math.floor(Math.random() * H),
        c: STARS[Math.floor(Math.random() * STARS.length)],
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 1.5,
      }));

      const t0 = performance.now();
      let last = 0;
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        if (now - last < 45 && !still) return; // ~20 fps is plenty for pixel art
        last = now;
        const t = still ? 1e9 : now - t0;
        ctx.fillStyle = SKY;
        ctx.fillRect(0, 0, W, H);
        for (const s of sky) {
          if (Math.sin((t / 600) * s.speed + s.phase) < 0.2) continue;
          ctx.fillStyle = s.c;
          ctx.fillRect(s.x, s.y, 1, 1);
        }
        for (const d of dots) {
          const k = Math.min(1, Math.max(0, (t - d.delay) / 1100));
          const e = 1 - (1 - k) ** 3;
          const x = Math.round(d.sx + (d.x - d.sx) * e);
          const y = Math.round(d.sy + (d.y - d.sy) * e);
          // Settled pixels shimmer by a shade now and then.
          const tw = k === 1 && Math.sin(t / 500 + d.phase) > 0.93 ? 1 : 0;
          ctx.fillStyle =
            k < 1 ? STARS[3] : MOON[Math.min(MOON.length - 1, d.shade + tw)];
          ctx.fillRect(x, y, 1, 1);
        }
        if (still) cancelAnimationFrame(raf);
      };
      raf = requestAnimationFrame(frame);
    };
    start();
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
    };
  }, [letter]);

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ imageRendering: "pixelated" }}
      aria-hidden
    />
  );
}
