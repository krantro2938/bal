import { Pause, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { closeMini, miniVideo, registerMiniVideo, useMini } from "@/lib/mini";
import { cn } from "@/lib/utils";

/** Phones: the dance dragged down from its page keeps playing here; tap to go back to it. */
export function MiniPlayer() {
  const dance = useMini();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [paused, setPaused] = useState(true);
  const [progress, setProgress] = useState(0);

  // Opening any dance page takes over from the bar.
  useEffect(() => {
    if (pathname.startsWith("/dance/")) closeMini();
  }, [pathname]);

  const expand = () => {
    const v = miniVideo();
    if (!dance) return;
    const t = Math.floor(v?.currentTime ?? 0);
    const playing = !!v && !v.paused;
    closeMini();
    navigate(`/dance/${dance.slug}?t=${t}`, { state: { play: playing } });
  };

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-line bg-[var(--sheet)] pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-pop)] sm:hidden",
        !dance && "hidden",
      )}
    >
      <div className="absolute inset-x-0 top-0 h-0.5 bg-accent" style={{ width: `${progress * 100}%` }} />
      <div className="flex h-16 items-center gap-3 pr-1.5">
        <button type="button" onClick={expand} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={dance ? `Открыть «${dance.title}»` : undefined}>
          <video
            ref={registerMiniVideo}
            playsInline
            // Explicit size: Vidstack's stylesheet stretches any <video> without one to full width.
            width={114}
            height={64}
            poster={dance?.poster}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
            className="h-16 w-[114px] shrink-0 bg-black object-cover"
          />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-medium">{dance?.title}</span>
            <span className="block text-[12px] text-ink-3">{dance?.kind === "dance" ? `Танец ${String(dance.order).padStart(2, "0")}` : "Звёздная одиссея"}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            const v = miniVideo();
            if (v) (v.paused ? v.play() : (v.pause(), Promise.resolve())).catch(() => {});
          }}
          className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-hover"
          aria-label={paused ? "Продолжить" : "Пауза"}
        >
          {paused ? <Play className="size-5 fill-current" /> : <Pause className="size-5 fill-current" />}
        </button>
        <button type="button" onClick={closeMini} className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-hover" aria-label="Закрыть">
          <X className="size-5" />
        </button>
      </div>
    </div>
  );
}
