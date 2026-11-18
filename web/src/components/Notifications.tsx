import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { since } from "@/lib/format";
import type { Notification } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar } from "./Header";

/** Bell with replies and @mentions; new ones arrive over the user's event stream. */
export function NotificationsBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const loc = useLocation();

  const load = useCallback(() => {
    api.notifications().then(
      (r) => {
        setItems(r.items);
        setUnread(r.unread);
      },
      () => {},
    );
  }, []);

  useEffect(() => {
    load();
    const es = new EventSource("/api/me/events");
    es.onmessage = load;
    window.addEventListener("focus", load);
    return () => {
      es.close();
      window.removeEventListener("focus", load);
    };
  }, [load]);

  useEffect(() => setOpen(false), [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    setOpen((o) => !o);
    if (!open && unread) {
      setUnread(0);
      api.readNotifications().catch(() => {});
    }
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread ? `Уведомления: ${unread} новых` : "Уведомления"}
        aria-expanded={open}
        className="relative grid size-10 place-items-center rounded-full text-ink-2 transition-colors hover:bg-hover hover:text-ink"
      >
        <Bell className="size-5" />
        {unread ? (
          <span className="tnum absolute top-1 right-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[11px] font-semibold text-white ring-2 ring-bg">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="fixed inset-x-3 top-16 z-50 max-h-[min(560px,75dvh)] overflow-y-auto rounded-[var(--radius-sheet)] bg-[var(--sheet)] py-2 shadow-[var(--shadow-pop)] sm:absolute sm:inset-x-auto sm:top-12 sm:right-0 sm:w-[400px]">
          <p className="px-4 pt-1 pb-2 text-[15px] font-semibold">Уведомления</p>
          {items.length === 0 ? (
            <p className="px-4 pb-4 text-[14px] text-ink-3">Здесь появятся ответы на ваши комментарии и упоминания вашего @имени.</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/dance/${n.comment.dance}?c=${n.comment.id}`)}
                    className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-hover"
                  >
                    <Avatar user={n.comment.author} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] leading-snug">
                        {n.kind === "reply" ? "Ответ от " : "Упоминание от "}
                        <b className="font-semibold">@{n.comment.author.username}</b>
                        {n.danceTitle ? <span className="text-ink-2"> · {n.danceTitle}</span> : null}
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-[14px] text-ink-2">{n.comment.body}</span>
                      <span className="mt-0.5 block text-[12px] text-ink-3">{since(n.createdAt)}</span>
                    </span>
                    <span className={cn("mt-2 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-accent")} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
