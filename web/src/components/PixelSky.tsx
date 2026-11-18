import { useEffect, useRef, useState } from "react";

// Poster palette, dark to light, plus the moon's ivory ramp.
const SKY = ["#03060f", "#05091a", "#081028", "#0d1a45", "#16276a", "#24378a", "#3c4f9e"];
const MOON = ["#2a2a33", "#5d584f", "#8f8674", "#b9ad94", "#d9cdb1", "#ece2c8"];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

function hash(x: number, y: number, seed: number) {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * s(xf) + (c - a) * s(yf) + (a - b - c + d) * s(xf) * s(yf);
}

function fbm(x: number, y: number, seed: number) {
  let v = 0;
  let amp = 0.5;
  for (let o = 0; o < 4; o++) {
    v += amp * noise(x, y, seed + o);
    x *= 2;
    y *= 2;
    amp /= 2;
  }
  return v;
}

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const SKY_RGB = SKY.map(hex);
const MOON_RGB = MOON.map(hex);

/**
 * A dithered pixel-art night sky in the ball's palette: nebula, the moon,
 * twinkling four-point stars and a constellation.
 * Drawn at low resolution and scaled up with nearest-neighbour.
 */
export function PixelSky({ className, pixel = 3, still = false }: { className?: string; pixel?: number; still?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<[number, number] | null>(null);

  // One art pixel per `pixel` CSS pixels: bigger panels get more detail, not bigger blocks.
  useEffect(() => {
    const el = ref.current!;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setSize([Math.max(60, Math.round(r.width / pixel)), Math.max(60, Math.round(r.height / pixel))]);
    };
    measure();
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(measure, 150);
    });
    let t = 0;
    ro.observe(el);
    return () => ro.disconnect();
  }, [pixel]);

  useEffect(() => {
    if (!size) return;
    const canvas = ref.current!;
    const [W, H] = size;
    const k = Math.min(W / 180, H / 240); // detail scale relative to the original 180×240 design
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const base = ctx.createImageData(W, H);
    const px = base.data;
    const set = (x: number, y: number, rgb: number[]) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = (y * W + x) * 4;
      px[i] = rgb[0];
      px[i + 1] = rgb[1];
      px[i + 2] = rgb[2];
      px[i + 3] = 255;
    };

    // Sky: vertical gradient + nebula noise, quantised with ordered dithering.
    const moon = { x: W * 0.22, y: H * 1.02, r: Math.min(W * 0.62, H * 0.5) };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = BAYER[(y % 4) * 4 + (x % 4)];
        const dx = x - moon.x;
        const dy = y - moon.y;
        const inMoon = dx * dx + dy * dy < moon.r * moon.r;
        if (inMoon) {
          // Sphere shading from the upper right, craters from noise.
          const nz = Math.sqrt(Math.max(0, 1 - (dx * dx + dy * dy) / (moon.r * moon.r)));
          const light = Math.max(0, (dx / moon.r) * 0.45 - (dy / moon.r) * 0.55 + nz * 0.55);
          const crater = fbm(x / (9 * k), y / (9 * k), 7) * 0.7 + fbm(x / (3.5 * k), y / (3.5 * k), 9) * 0.3 - 0.5;
          const v = Math.min(0.999, Math.max(0, light * 0.95 + crater * 0.55));
          set(x, y, MOON_RGB[Math.min(MOON.length - 1, Math.floor(v * MOON.length + d - 0.5 + 0.5))]);
        } else {
          const neb = fbm(x / (34 * k), y / (30 * k), 3);
          const band = Math.exp(-(((x - W * 0.75 - (y - H * 0.4) * 0.6) / (W * 0.45)) ** 2));
          const halo = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / (moon.r * 1.35));
          let v = 0.12 + (1 - y / H) * 0.12 + neb * band * 0.55 + halo * 0.18;
          v = Math.min(0.999, Math.max(0, v));
          set(x, y, SKY_RGB[Math.min(SKY.length - 1, Math.floor(v * SKY.length + d - 0.5))]);
        }
      }
    }

    // Stars outside the moon.
    type StarPx = { x: number; y: number; big: boolean; phase: number; speed: number };
    const stars: StarPx[] = [];
    const count = Math.round((W * H) / 300);
    for (let i = 0; i < count; i++) {
      const x = Math.floor(hash(i, 1, 11) * W);
      const y = Math.floor(hash(i, 2, 11) * H);
      const dx = x - moon.x;
      const dy = y - moon.y;
      if (dx * dx + dy * dy < (moon.r + 3) ** 2) continue;
      stars.push({ x, y, big: hash(i, 3, 11) > 0.96, phase: hash(i, 4, 11) * 6.28, speed: 0.6 + hash(i, 5, 11) * 2 });
    }

    // A constellation joining a few stars in the upper half.
    const constellation = [
      [0.66, 0.14], [0.77, 0.22], [0.73, 0.33], [0.86, 0.4], [0.81, 0.51], [0.62, 0.45],
    ].map(([fx, fy]) => [Math.round(fx * W), Math.round(fy * H)]);
    const line = (a: number[], b: number[]) => {
      let [x0, y0] = a;
      const [x1, y1] = b;
      const dx = Math.abs(x1 - x0);
      const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let k = 0; ; k++) {
        if (k % 2 === 0) set(x0, y0, [120, 128, 170]);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x0 += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y0 += sy;
        }
      }
    };
    for (let i = 1; i < constellation.length; i++) line(constellation[i - 1], constellation[i]);
    constellation.forEach(([x, y], i) => stars.push({ x, y, big: i % 2 === 0, phase: i, speed: 1.2 }));

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 90) return;
      last = now;
      const t = now / 1000;
      const img = new ImageData(new Uint8ClampedArray(px), W, H);
      const put = (x: number, y: number, c: number) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const i = (y * W + x) * 4;
        img.data[i] = Math.max(img.data[i], c);
        img.data[i + 1] = Math.max(img.data[i + 1], c * 0.95);
        img.data[i + 2] = Math.max(img.data[i + 2], c * 0.85);
      };
      for (const s of stars) {
        const tw = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(t * s.speed + s.phase);
        const c = 120 + 135 * tw;
        put(s.x, s.y, c);
        if (s.big) {
          const arm = Math.max(2, Math.round((tw > 0.7 ? 3 : 2) * Math.sqrt(k)));
          for (let k = 1; k <= arm; k++) {
            const f = c * (1 - k / (arm + 1));
            put(s.x + k, s.y, f);
            put(s.x - k, s.y, f);
            put(s.x, s.y + k, f);
            put(s.x, s.y - k, f);
          }
        }
      }
      ctx.putImageData(img, 0, 0);
      if (reduced || still) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, still]);
  return <canvas ref={ref} className={className} style={{ imageRendering: "pixelated" }} aria-hidden />;
}
