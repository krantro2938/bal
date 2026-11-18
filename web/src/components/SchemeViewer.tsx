import { ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { cn } from "@/lib/utils";

type View = { s: number; x: number; y: number };
const FIT: View = { s: 1, x: 0, y: 0 };
const MAX = 6;

/** Full-screen scheme: fits the page, zoom with wheel / pinch / double-click / buttons, drag to move. */
export function SchemeViewer({
  pages,
  title,
  index,
  onIndex,
  onClose,
}: {
  pages: { path: string }[];
  title: string;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; view: View } | null>(null);
  const dragged = useRef(false);

  useEffect(() => setView(FIT), [index]);

  // Zoom to scale s keeping the screen point (cx, cy) fixed.
  const zoomAt = useCallback((s: number, cx: number, cy: number, from: View) => {
    const r = box.current!.getBoundingClientRect();
    const px = cx - (r.left + r.width / 2);
    const py = cy - (r.top + r.height / 2);
    const ns = Math.min(MAX, Math.max(1, s));
    if (ns === 1) return FIT;
    return { s: ns, x: px - ((px - from.x) * ns) / from.s, y: py - ((py - from.y) * ns) / from.s };
  }, []);

  const zoomCenter = (factor: number) => {
    const r = box.current!.getBoundingClientRect();
    setView((v) => zoomAt(v.s * factor, r.left + r.width / 2, r.top + r.height / 2, v));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < pages.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (e.key === "+" || e.key === "=") zoomCenter(1.5);
      if (e.key === "-") zoomCenter(1 / 1.5);
      if (e.key === "0") setView(FIT);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  });

  const onWheel = (e: WheelEvent) => {
    setView((v) => zoomAt(v.s * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY, v));
  };
  const onDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragged.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), view };
    }
  };
  const onMove = (e: PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setView(zoomAt((pinch.current.view.s * d) / pinch.current.d, (a.x + b.x) / 2, (a.y + b.y) / 2, pinch.current.view));
      dragged.current = true;
    } else if (view.s > 1) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) dragged.current = true;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };
  const onUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const arrow = "absolute top-1/2 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 disabled:pointer-events-none disabled:opacity-0";
  return (
    <div className="fixed inset-0 z-50 bg-[#05091a]/95 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${title}: схема`}>
      <div className="absolute top-4 left-5 z-10 text-sm text-white/70">
        <span className="font-medium text-white">{title}</span>
        {pages.length > 1 ? <span className="tnum"> · {index + 1} / {pages.length}</span> : null}
      </div>
      <button type="button" onClick={onClose} className="absolute top-3 right-3 z-10 grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Закрыть">
        <X className="size-5" />
      </button>

      <div
        ref={box}
        className={cn("absolute inset-x-4 top-16 bottom-20 touch-none overflow-hidden sm:inset-x-20", view.s > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={(e) => setView((v) => (v.s > 1 ? FIT : zoomAt(2.5, e.clientX, e.clientY, v)))}
      >
        <img
          src={pages[index].path}
          alt={`${title}, страница ${index + 1}`}
          draggable={false}
          className="absolute inset-0 m-auto max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transition: pointers.current.size ? "none" : "transform 120ms ease-out" }}
        />
      </div>

      <button type="button" className={cn(arrow, "left-3 sm:left-5")} disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="Предыдущая страница">
        <ChevronLeft className="size-6" />
      </button>
      <button type="button" className={cn(arrow, "right-3 sm:right-5")} disabled={index === pages.length - 1} onClick={() => onIndex(index + 1)} aria-label="Следующая страница">
        <ChevronRight className="size-6" />
      </button>

      <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/10 p-1 text-white backdrop-blur">
        <button type="button" onClick={() => zoomCenter(1 / 1.5)} disabled={view.s <= 1} className="grid size-10 place-items-center rounded-full hover:bg-white/15 disabled:opacity-40" aria-label="Уменьшить">
          <Minus className="size-5" />
        </button>
        <button type="button" onClick={() => setView(FIT)} className="tnum h-10 min-w-16 rounded-full px-3 text-sm font-medium hover:bg-white/15" aria-label="Вписать в экран">
          {Math.round(view.s * 100)}%
        </button>
        <button type="button" onClick={() => zoomCenter(1.5)} disabled={view.s >= MAX} className="grid size-10 place-items-center rounded-full hover:bg-white/15 disabled:opacity-40" aria-label="Увеличить">
          <Plus className="size-5" />
        </button>
      </div>
    </div>
  );
}
