import { useMemo } from "react";

const W = 72;
const H = 30;

/** A pixel magnifier sweeping a twinkling night sky — the "nothing found" picture. */
export function PixelSearch({ className }: { className?: string }) {
  const { stars, lens } = useMemo(() => {
    // fixed pseudo-random stars so the picture is the same on every render
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const stars = Array.from({ length: 34 }, () => ({ x: Math.floor(rnd() * W), y: Math.floor(rnd() * H), d: rnd() * 3, big: rnd() < 0.15 }));
    const lens: [number, number][] = [];
    const r = 6.2;
    for (let y = -8; y <= 8; y++)
      for (let x = -8; x <= 8; x++) {
        const d = Math.hypot(x, y);
        if (Math.abs(d - r) < 0.75) lens.push([x, y]);
      }
    for (let i = 0; i < 5; i++) lens.push([5 + i, 5 + i], [6 + i, 5 + i]);
    return { stars, lens };
  }, []);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} shapeRendering="crispEdges" aria-hidden>
      <style>{`
        .ps-star { animation: ps-twinkle 2.4s steps(3) infinite; }
        .ps-lens { animation: ps-sweep 7s steps(28) infinite alternate; }
        @keyframes ps-twinkle { 0%, 100% { opacity: .25 } 50% { opacity: 1 } }
        @keyframes ps-sweep { from { transform: translate(14px, 12px) } 50% { transform: translate(36px, 15px) } to { transform: translate(56px, 11px) } }
      `}</style>
      {stars.map((s, i) => (
        <g key={i} className="ps-star" style={{ animationDelay: `${-s.d}s` }} fill="var(--ink-3)">
          <rect x={s.x} y={s.y} width={1} height={1} />
          {s.big ? <path d={`M${s.x - 1} ${s.y}h1v1h-1zM${s.x + 1} ${s.y}h1v1h-1zM${s.x} ${s.y - 1}h1v1h-1zM${s.x} ${s.y + 1}h1v1h-1z`} opacity={0.6} /> : null}
        </g>
      ))}
      <g className="ps-lens">
        <circle cx={0.5} cy={0.5} r={5.4} fill="var(--accent-soft)" />
        {lens.map(([x, y]) => (
          <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill="var(--accent)" />
        ))}
        <rect x={-1} y={-2} width={1} height={1} fill="var(--accent)" opacity={0.5} />
        <rect x={-2} y={-1} width={1} height={1} fill="var(--accent)" opacity={0.5} />
      </g>
    </svg>
  );
}
