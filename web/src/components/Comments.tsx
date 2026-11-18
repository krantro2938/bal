import { ChevronDown, ChevronUp, EllipsisVertical, Flag, Pin, PinOff, ShieldCheck, ThumbsUp, Timer, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { since, timecode } from "@/lib/format";
import type { Comment, CommentEvent, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar } from "./Header";
import { NoteInput } from "./NoteInput";
import { Button } from "./ui/button";

type Props = {
  slug: string;
  user: User | null;
  duration: number;
  now: () => number;
  onSeek: (t: number) => void;
  askLogin: (why: string) => void;
};

/**
 * YouTube-style comments: newest or top first, one level of replies, likes, a pinned
 * comment from the organizers. New comments from others arrive live over SSE; top-level
 * ones wait behind a "show" pill so the list doesn't jump while someone is reading.
 */
export function Comments({ slug, user, duration, now, onSeek, askLogin }: Props) {
  const [list, setList] = useState<Comment[] | null>(null);
  const [moderator, setModerator] = useState(false);
  const [pending, setPending] = useState<Comment[]>([]);
  const [sort, setSort] = useState<"top" | "new">("top");
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false); // phones: the list opens from a teaser card

  const load = useCallback(() => {
    api.comments(slug).then(
      (r) => {
        setList(r.comments);
        setModerator(r.moderator);
        setPending([]);
        setError(false);
      },
      () => setError(true),
    );
  }, [slug]);

  // Refetch on sign-in/out: held comments and "liked" depend on who is looking.
  useEffect(load, [load, user?.id]);

  useEffect(() => {
    const es = new EventSource(`/api/dances/${encodeURIComponent(slug)}/events`);
    let opened = 0;
    // A reconnect may have missed events: reload the list.
    es.onopen = () => opened++ && load();
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as CommentEvent;
      if (e.type === "comment") {
        const c = e.comment;
        setList((l) => {
          if (!l) return l;
          const i = l.findIndex((x) => x.id === c.id);
          if (i >= 0) return l.map((x) => (x.id === c.id ? { ...x, ...c, liked: x.liked } : x));
          if (c.parentId || c.author.id === user?.id) return [...l, c];
          setPending((p) => (p.some((x) => x.id === c.id) ? p : [...p, c]));
          return l;
        });
      } else if (e.type === "removed") {
        const gone = (c: Comment) => c.id === e.id || c.parentId === e.id;
        setList((l) => l && l.filter((c) => !gone(c)));
        setPending((p) => p.filter((c) => !gone(c)));
      } else if (e.type === "likes") {
        setList((l) => l && l.map((c) => (c.id === e.id ? { ...c, likes: e.likes } : c)));
      } else if (e.type === "pinned") {
        setList((l) => l && l.map((c) => ({ ...c, pinned: c.id === e.id })));
      }
    };
    return () => es.close();
  }, [slug, load, user?.id]);

  const replies = useMemo(() => {
    const m = new Map<number, Comment[]>();
    for (const c of list ?? []) if (c.parentId) m.set(c.parentId, [...(m.get(c.parentId) ?? []), c]);
    return m;
  }, [list]);
  const threads = useMemo(() => {
    const top = (list ?? []).filter((c) => !c.parentId);
    const score = (c: Comment) => c.likes * 2 + (replies.get(c.id)?.length ?? 0);
    return top.sort(
      (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (sort === "top" ? score(b) - score(a) : 0) || b.createdAt - a.createdAt,
    );
  }, [list, replies, sort]);
  const count = (list ?? []).filter((c) => c.status === "published").length;

  const patch = (id: number, p: Partial<Comment>) => setList((l) => l && l.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const post = async (body: string, parentId?: number) => {
    try {
      const r = await api.createComment(slug, body, parentId);
      setList((l) => (l && !l.some((c) => c.id === r.comment.id) ? [...l, r.comment] : l));
      if (r.notice) toast(r.notice);
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось отправить комментарий");
      return false;
    }
  };

  const like = async (c: Comment) => {
    if (!user) return askLogin("Чтобы отмечать комментарии.");
    const on = !c.liked;
    patch(c.id, { liked: on, likes: c.likes + (on ? 1 : -1) });
    try {
      const r = await api.likeComment(c.id, on);
      patch(c.id, r);
    } catch {
      patch(c.id, { liked: c.liked, likes: c.likes });
    }
  };

  const act = async (c: Comment, what: "delete" | "report" | "approve" | "pin" | "unpin") => {
    try {
      if (what === "delete") {
        await api.deleteComment(c.id);
        setList((l) => l && l.filter((x) => x.id !== c.id && x.parentId !== c.id));
        toast("Комментарий удалён");
      } else if (what === "report") {
        if (!user) return askLogin("Чтобы пожаловаться на комментарий.");
        await api.reportComment(c.id);
        toast("Спасибо, организаторы посмотрят");
      } else if (what === "approve") {
        patch(c.id, await api.approveComment(c.id));
      } else {
        await api.pinComment(c.id, what === "pin");
        setList((l) => l && l.map((x) => ({ ...x, pinned: what === "pin" && x.id === c.id })));
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не получилось, попробуйте ещё раз");
    }
  };

  const item = (c: Comment, reply?: { onReply: () => void }) => (
    <CommentItem
      key={c.id}
      c={c}
      reply={!!c.parentId}
      mine={c.author.id === user?.id}
      moderator={moderator}
      signedIn={!!user}
      duration={duration}
      onSeek={onSeek}
      onLike={() => like(c)}
      onReply={reply?.onReply}
      onAction={(w) => act(c, w)}
    />
  );

  const first = threads[0];
  return (
    <section className="mt-10">
      {/* Phones: a teaser card like YouTube's app; tapping it opens the list. */}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="w-full rounded-[var(--radius-sheet)] bg-surface-2 p-3.5 text-left lg:hidden">
          <span className="text-[15px] font-semibold">
            Комментарии <span className="tnum ml-1 font-normal text-ink-3">{count || ""}</span>
          </span>
          <span className="mt-2 flex items-center gap-2.5 text-[14px]">
            {first ? (
              <>
                <Avatar user={first.author} size={24} />
                <span className="line-clamp-1 min-w-0 flex-1">{first.body}</span>
              </>
            ) : (
              <span className="text-ink-3">{list ? "Напишите первый комментарий" : "Загрузка…"}</span>
            )}
            <ChevronDown className="size-4 shrink-0 text-ink-3" />
          </span>
        </button>
      ) : null}

      <div className={cn(!open && "max-lg:hidden")}>
        <header className="mb-5 flex items-center gap-6">
          <h2 className="text-[20px] font-semibold">
            Комментарии <span className="tnum ml-1 font-normal text-ink-3">{count || ""}</span>
          </h2>
          <div className="flex gap-1 text-[14px]">
            {(["top", "new"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                aria-pressed={sort === s}
                className={cn("h-8 rounded-lg px-3 font-medium", sort === s ? "bg-ink text-bg" : "bg-surface-2 hover:bg-line")}
              >
                {s === "top" ? "Популярные" : "Новые"}
              </button>
            ))}
          </div>
          {open ? (
            <button type="button" onClick={() => setOpen(false)} className="ml-auto grid size-9 place-items-center rounded-full hover:bg-hover lg:hidden" aria-label="Свернуть комментарии">
              <ChevronUp className="size-5" />
            </button>
          ) : null}
        </header>

        <Composer
          user={user}
          now={now}
          placeholder="Напишите комментарий… Время вида 1:20 станет ссылкой на момент видео"
          onGuest={() => askLogin("Чтобы писать комментарии. Пишите уважительно — грубые комментарии не публикуются.")}
          onSubmit={(b) => post(b)}
        />

        {pending.length ? (
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={() => {
                setList((l) => [...(l ?? []), ...pending]);
                setPending([]);
                setSort("new");
              }}
              className="h-9 rounded-full bg-accent px-4 text-sm font-medium text-accent-ink"
            >
              Новые комментарии: {pending.length}
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="mt-6 text-[15px] text-ink-3">
            Не удалось загрузить комментарии.{" "}
            <button type="button" onClick={load} className="font-medium text-accent">
              Повторить
            </button>
          </p>
        ) : null}

        <ul className="mt-6 space-y-6">
          {threads.map((c) => (
            <Thread key={c.id} c={c} replies={replies.get(c.id) ?? []} item={item} user={user} now={now} onGuest={() => askLogin("Чтобы отвечать на комментарии.")} onPost={post} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function Thread({
  c,
  replies,
  item,
  user,
  now,
  onGuest,
  onPost,
}: {
  c: Comment;
  replies: Comment[];
  item: (c: Comment, reply?: { onReply: () => void }) => ReactNode;
  user: User | null;
  now: () => number;
  onGuest: () => void;
  onPost: (body: string, parentId?: number) => Promise<boolean>;
}) {
  const [show, setShow] = useState(false);
  const [replyTo, setReplyTo] = useState<{ prefill: string } | null>(null);
  const startReply = (to?: Comment) => {
    if (!user) return onGuest();
    setShow(true);
    setReplyTo({ prefill: to && to.author.id !== user.id ? `@${to.author.name} ` : "" });
  };
  return (
    <li>
      {item(c, { onReply: () => startReply() })}
      <div className="pl-12">
        {replyTo ? (
          <div className="mt-3">
            <Composer
              key={replyTo.prefill}
              user={user}
              now={now}
              small
              autoFocus
              initial={replyTo.prefill}
              placeholder="Ваш ответ…"
              onGuest={onGuest}
              onCancel={() => setReplyTo(null)}
              onSubmit={async (b) => {
                const ok = await onPost(b, c.id);
                if (ok) setReplyTo(null);
                return ok;
              }}
            />
          </div>
        ) : null}
        {replies.length ? (
          <>
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="mt-1.5 -ml-3 flex h-9 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium text-accent hover:bg-accent-soft"
            >
              {show ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              {replyCount(replies.length)}
            </button>
            {show ? <ul className="mt-2 space-y-4">{replies.map((r) => <li key={r.id}>{item(r, { onReply: () => startReply(r) })}</li>)}</ul> : null}
          </>
        ) : null}
      </div>
    </li>
  );
}

const replyCount = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? "ответ" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "ответа" : "ответов";
  return `${n} ${word}`;
};

function CommentItem({
  c,
  reply,
  mine,
  moderator,
  signedIn,
  duration,
  onSeek,
  onLike,
  onReply,
  onAction,
}: {
  c: Comment;
  reply: boolean;
  mine: boolean;
  moderator: boolean;
  signedIn: boolean;
  duration: number;
  onSeek: (t: number) => void;
  onLike: () => void;
  onReply?: () => void;
  onAction: (w: "delete" | "report" | "approve" | "pin" | "unpin") => void;
}) {
  const [long, setLong] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const body = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = body.current;
    if (el) setLong(el.scrollHeight > el.clientHeight + 2);
  }, [c.body]);
  const items: { label: string; icon: ReactNode; run: () => void; danger?: boolean }[] = [];
  if (moderator && c.status === "held") items.push({ label: "Опубликовать", icon: <ShieldCheck />, run: () => onAction("approve") });
  if (moderator && !reply) items.push(c.pinned ? { label: "Открепить", icon: <PinOff />, run: () => onAction("unpin") } : { label: "Закрепить", icon: <Pin />, run: () => onAction("pin") });
  if (!mine && signedIn) items.push({ label: "Пожаловаться", icon: <Flag />, run: () => onAction("report") });
  if (mine || moderator) items.push({ label: "Удалить", icon: <Trash2 />, run: () => onAction("delete"), danger: true });
  return (
    <div className="group flex gap-3">
      <Avatar user={c.author} size={reply ? 28 : 36} />
      <div className="min-w-0 flex-1">
        {c.pinned ? (
          <p className="mb-0.5 flex items-center gap-1 text-[12px] text-ink-3">
            <Pin className="size-3" /> Закреплено организаторами
          </p>
        ) : null}
        <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
          <span className="font-medium">{c.author.name}</span>
          <span className="text-ink-3" title={new Date(c.createdAt).toLocaleString("ru-RU")}>
            {since(c.createdAt)}
          </span>
          {c.status === "held" ? <span className="rounded-md bg-accent-soft px-1.5 text-[12px] font-medium text-accent">на проверке</span> : null}
        </p>
        <p ref={body} className={cn("mt-0.5 text-[15px] leading-snug break-words whitespace-pre-wrap", !expanded && "line-clamp-4")}>
          {linkify(c.body, duration, onSeek)}
        </p>
        {long || expanded ? (
          <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-1 text-[14px] font-medium text-ink-2 hover:text-ink">
            {expanded ? "Свернуть" : "Читать дальше"}
          </button>
        ) : null}
        <div className="mt-1 -ml-2 flex items-center gap-1">
          <button
            type="button"
            onClick={onLike}
            aria-pressed={!!c.liked}
            aria-label="Нравится"
            className="flex h-8 items-center gap-1.5 rounded-full px-2 text-[13px] text-ink-2 hover:bg-hover hover:text-ink"
          >
            <ThumbsUp className={cn("size-4", c.liked && "fill-current text-ink")} />
            {c.likes ? <span className="tnum">{c.likes}</span> : null}
          </button>
          {onReply && c.status === "published" ? (
            <button type="button" onClick={onReply} className="h-8 rounded-full px-3 text-[13px] font-medium hover:bg-hover">
              Ответить
            </button>
          ) : null}
        </div>
      </div>
      {items.length ? <ItemMenu items={items} /> : null}
    </div>
  );
}

/** Timecodes like 1:20 inside a comment become buttons that seek the video. */
function linkify(text: string, duration: number, onSeek: (t: number) => void) {
  const out: ReactNode[] = [];
  const re = /(^|[^\d:])(\d{1,2}):([0-5]\d)(?![\d:])/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const t = Number(m[2]) * 60 + Number(m[3]);
    if (duration && t > duration) continue;
    const start = m.index + m[1].length;
    out.push(text.slice(last, start));
    out.push(
      <button key={start} type="button" onClick={() => onSeek(t)} className="tnum font-medium text-accent hover:underline">
        {timecode(t)}
      </button>,
    );
    last = start + m[2].length + 1 + m[3].length;
  }
  out.push(text.slice(last));
  return out;
}

function ItemMenu({ items }: { items: { label: string; icon: ReactNode; run: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Действия с комментарием"
        aria-expanded={open}
        className={cn(
          "grid size-8 place-items-center rounded-full text-ink-2 hover:bg-hover hover:text-ink",
          !open && "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100",
        )}
      >
        <EllipsisVertical className="size-[18px]" />
      </button>
      {open ? (
        <div role="menu" className="absolute top-9 right-0 z-30 w-52 overflow-hidden rounded-xl bg-[var(--sheet)] py-2 shadow-[var(--shadow-pop)]">
          {items.map((i) => (
            <button
              key={i.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                i.run();
              }}
              className={cn("flex h-10 w-full items-center gap-3 px-4 text-left text-[14px] hover:bg-hover [&_svg]:size-[18px]", i.danger && "text-danger")}
            >
              {i.icon}
              {i.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Composer({
  user,
  now,
  placeholder,
  small,
  autoFocus,
  initial = "",
  onGuest,
  onCancel,
  onSubmit,
}: {
  user: User | null;
  now: () => number;
  placeholder: string;
  small?: boolean;
  autoFocus?: boolean;
  initial?: string;
  onGuest: () => void;
  onCancel?: () => void;
  onSubmit: (body: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(initial);
  const [active, setActive] = useState(!!autoFocus);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const cancel = () => {
    setText("");
    setActive(false);
    onCancel?.();
  };
  const insertTime = () => {
    const el = input.current;
    const t = `${timecode(now())} `;
    const at = el?.selectionStart ?? text.length;
    const before = text.slice(0, at);
    const pad = before && !/\s$/.test(before) ? " " : "";
    setText(before + pad + t + text.slice(at));
    requestAnimationFrame(() => {
      el?.focus();
      const pos = at + pad.length + t.length;
      el?.setSelectionRange(pos, pos);
    });
  };
  if (!user) {
    return (
      <div className="flex gap-3">
        <span className={cn("shrink-0 rounded-full bg-surface-2", small ? "size-7" : "size-9")} />
        <button type="button" onClick={onGuest} className="min-w-0 flex-1 border-b border-line pt-2 pb-2 text-left text-[15px] text-ink-3 hover:border-ink-2">
          Войдите, чтобы написать комментарий
        </button>
      </div>
    );
  }
  return (
    <form
      className="flex gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        const ok = await onSubmit(text.trim());
        setBusy(false);
        if (ok) cancel();
      }}
    >
      <Avatar user={user} size={small ? 28 : 36} />
      <div className="min-w-0 flex-1" onFocus={() => setActive(true)}>
        <NoteInput ref={input} autoFocus={autoFocus} value={text} onChange={setText} onCancel={cancel} placeholder={placeholder} />
        {active ? (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={insertTime}
              className="tnum flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-accent hover:bg-accent-soft"
              title="Вставить текущее время видео"
            >
              <Timer className="size-4" /> {timecode(now())}
            </button>
            <span className="flex-1" />
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>
              Отмена
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={!text.trim() || busy}>
              {small ? "Ответить" : "Отправить"}
            </Button>
          </div>
        ) : null}
      </div>
    </form>
  );
}
