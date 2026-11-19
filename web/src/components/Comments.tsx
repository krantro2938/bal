import { ChevronDown, ChevronUp, CircleCheck, EllipsisVertical, Flag, Pin, PinOff, ShieldCheck, ThumbsUp, Timer, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { api, ApiError } from "@/lib/api";
import { since, timecode } from "@/lib/format";
import type { Author, Comment, CommentEvent, User } from "@/lib/types";
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
  onCount?: (n: number) => void;
  /** A comment to scroll to and highlight (from a notification link). */
  focusId?: number;
};

type Action = "delete" | "report" | "approve" | "pin" | "unpin";

const MAX_DEPTH = 3; // as on the server: top-level comments are depth 0

/** Drops a comment and everything under it. */
function without(list: Comment[], id: number) {
  const gone = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of list) if (c.parentId && gone.has(c.parentId) && !gone.has(c.id)) (gone.add(c.id), (grew = true));
  }
  return list.filter((c) => !gone.has(c.id));
}

/**
 * YouTube-style comments: top or newest first, one level of replies drawn as a tree,
 * likes, a pinned comment from the organizers, @mentions. New comments from others
 * arrive live over SSE; top-level ones wait behind a "show" pill so the list doesn't
 * jump while someone is reading.
 */
export function Comments({ slug, user, duration, now, onSeek, askLogin, onCount, focusId }: Props) {
  const [list, setList] = useState<Comment[] | null>(null);
  const [moderator, setModerator] = useState(false);
  const [pinnedBy, setPinnedBy] = useState<string>();
  const [pending, setPending] = useState<Comment[]>([]);
  const [sort, setSort] = useState<"top" | "new">("top");
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(!!focusId); // phones: the list opens from a teaser card
  // On computers the list is always open; on phones only after the teaser is tapped.
  const openRef = useRef(open);
  openRef.current = open || matchMedia("(min-width: 1024px)").matches;
  const userId = user?.id;

  const load = useCallback(() => {
    api.comments(slug).then(
      (r) => {
        setList(r.comments);
        setModerator(r.moderator);
        setPinnedBy(r.pinnedBy);
        setPending([]);
        setError(false);
      },
      () => setError(true),
    );
  }, [slug]);

  // Refetch on sign-in/out: held comments and "liked" depend on who is looking.
  useEffect(load, [load, userId]);

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
          if (l.some((x) => x.id === c.id)) return l.map((x) => (x.id === c.id ? { ...x, ...c, liked: c.deleted ? false : x.liked } : x));
          // Someone else's new thread waits behind the "new comments" pill only while the open list
          // has threads that someone might be reading; otherwise (empty, or folded on a phone) it goes straight in.
          const direct = !!c.parentId || c.author.id === userId || !openRef.current || !l.some((x) => !x.parentId);
          if (!direct) setPending((p) => (p.some((x) => x.id === c.id) ? p : [...p, c]));
          return direct ? [...l, c] : l;
        });
      } else if (e.type === "removed") {
        setList((l) => l && without(l, e.id));
        setPending((p) => without(p, e.id));
      } else if (e.type === "likes") {
        setList((l) => l && l.map((c) => (c.id === e.id ? { ...c, likes: e.likes } : c)));
      } else if (e.type === "pinned") {
        setList((l) => l && l.map((c) => ({ ...c, pinned: c.id === e.id })));
      }
    };
    return () => es.close();
  }, [slug, load, userId]);

  const replies = useMemo(() => {
    const m = new Map<number, Comment[]>();
    for (const c of list ?? []) if (c.parentId) m.set(c.parentId, [...(m.get(c.parentId) ?? []), c]);
    return m;
  }, [list]);
  const threads = useMemo(() => {
    const top = (list ?? []).filter((c) => !c.parentId && !pending.some((p) => p.id === c.id));
    const score = (c: Comment) => c.likes * 2 + (replies.get(c.id)?.length ?? 0);
    return top.sort(
      (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (sort === "top" ? score(b) - score(a) : 0) || b.createdAt - a.createdAt,
    );
  }, [list, replies, sort, pending]);
  // People to suggest after "@": everyone who wrote here, newest first.
  const people = useMemo(() => {
    const seen = new Map<number, Author>();
    for (const c of [...(list ?? [])].reverse()) if (!c.deleted && c.author.id !== userId && !seen.has(c.author.id)) seen.set(c.author.id, c.author);
    return [...seen.values()];
  }, [list, userId]);

  const count = (list ?? []).filter((c) => c.status === "published" && !c.deleted).length;
  useEffect(() => onCount?.(count), [count, onCount]);

  // Notification links: open the thread, scroll to the comment, flash it.
  const [flash, setFlash] = useState<number | null>(null);
  useEffect(() => {
    if (!focusId || !list) return;
    if (!list.some((c) => c.id === focusId)) return;
    setOpen(true);
    setFlash(focusId);
    const t = setTimeout(() => {
      const el = document.getElementById(`comment-${focusId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    const off = setTimeout(() => setFlash(null), 2600);
    return () => {
      clearTimeout(t);
      clearTimeout(off);
    };
  }, [focusId, list]);

  const patch = (id: number, p: Partial<Comment>) => setList((l) => l && l.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const post = async (body: string, parentId?: number) => {
    try {
      const r = await api.createComment(slug, body, parentId);
      track("comment");
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
      patch(c.id, await api.likeComment(c.id, on));
    } catch {
      patch(c.id, { liked: c.liked, likes: c.likes });
    }
  };

  const act = async (c: Comment, what: Action) => {
    try {
      if (what === "delete") {
        const r = await api.deleteComment(c.id);
        if (r.placeholder) patch(c.id, { ...r.placeholder, liked: false });
        else {
          const gone = new Set(r.removed ?? [c.id]);
          setList((l) => l && l.filter((x) => !gone.has(x.id)));
        }
        toast("Комментарий удалён");
      } else if (what === "report") {
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

  // Threads to open so a linked comment is visible: all of its ancestors.
  const expand = useMemo(() => {
    const out = new Set<number>();
    const byId = new Map((list ?? []).map((c) => [c.id, c]));
    for (let c = focusId ? byId.get(focusId) : undefined; c?.parentId; c = byId.get(c.parentId)) out.add(c.parentId);
    return out;
  }, [focusId, list]);

  const ctx: ThreadCtx = { user, moderator, pinnedBy, duration, now, people, flash, expand, children: replies, onSeek, post, like, act, askLogin };
  const first = threads[0];
  return (
    <div>
      {/* Phones: a teaser card like YouTube's app; tapping it opens the list. */}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="w-full rounded-[var(--radius-sheet)] bg-surface-2 p-3.5 text-left lg:hidden">
          <span className="flex items-center gap-2.5 text-[14px]">
            {first ? (
              <>
                <Avatar user={first.author} size={24} />
                <span className="line-clamp-1 min-w-0 flex-1">{first.body}</span>
              </>
            ) : (
              <span className="flex-1 text-ink-3">{list ? "Напишите первый комментарий" : "Загрузка…"}</span>
            )}
            <ChevronDown className="size-4 shrink-0 text-ink-3" />
          </span>
        </button>
      ) : null}

      <div className={cn(!open && "max-lg:hidden")}>
        <div className="mb-5 flex items-center gap-1 text-[14px]">
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
          {open ? (
            <button type="button" onClick={() => setOpen(false)} className="ml-auto grid size-9 place-items-center rounded-full hover:bg-hover lg:hidden" aria-label="Свернуть комментарии">
              <ChevronUp className="size-5" />
            </button>
          ) : null}
        </div>

        <Composer
          user={user}
          now={now}
          duration={duration}
          people={people}
          placeholder="Напишите комментарий…"
          onGuest={() => askLogin("Чтобы писать комментарии. Пишите уважительно — грубые комментарии не публикуются.")}
          onSubmit={(b) => post(b)}
        />

        {pending.length ? (
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={() => {
                setList((l) => [...(l ?? []).filter((c) => !pending.some((p) => p.id === c.id)), ...pending]);
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

        <ul className="mt-6 space-y-5">
          {threads.map((c) => (
            <li key={c.id}>
              <Thread c={c} depth={0} ctx={ctx} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type ThreadCtx = {
  user: User | null;
  moderator: boolean;
  /** The site's handle: pins are shown as its, like a channel's on YouTube. */
  pinnedBy?: string;
  duration: number;
  now: () => number;
  people: Author[];
  flash: number | null;
  expand: Set<number>;
  children: Map<number, Comment[]>;
  onSeek: (t: number) => void;
  post: (body: string, parentId?: number) => Promise<boolean>;
  like: (c: Comment) => void;
  act: (c: Comment, a: Action) => void;
  askLogin: (why: string) => void;
};

/**
 * A comment and its replies, recursively, joined YouTube-style by a line from the
 * comment's avatar with a rounded elbow into each row. Replies stay folded behind
 * "N ответов"; unfolded, a "Скрыть ответы" row closes the branch. The reply box
 * opens right under the comment being answered.
 */
function Thread({ c, depth, ctx }: { c: Comment; depth: number; ctx: ThreadCtx }) {
  const replies = ctx.children.get(c.id) ?? [];
  const [show, setShow] = useState(() => ctx.expand.has(c.id));
  useEffect(() => {
    if (ctx.expand.has(c.id)) setShow(true);
  }, [ctx.expand, c.id]);
  const [replying, setReplying] = useState(false);
  const startReply = () => {
    if (!ctx.user) return ctx.askLogin("Чтобы отвечать на комментарии.");
    setReplying(true);
  };
  // At the deepest level a reply lands beside this comment, so it names whom it answers.
  const prefill = depth >= MAX_DEPTH && c.author.id !== ctx.user?.id ? `@${c.author.username} ` : "";

  const avatar = depth === 0 ? 36 : 28;
  const indent = avatar + 12;
  const trunk = avatar / 2 - 1; // x of the line under this comment's avatar

  const rows: { key: string; node: ReactNode; elbow: number }[] = [];
  if (replying) {
    rows.push({
      key: "composer",
      elbow: 14,
      node: (
        <Composer
          user={ctx.user}
          now={ctx.now}
          duration={ctx.duration}
          people={ctx.people}
          small
          autoFocus
          initial={prefill}
          placeholder="Ваш ответ…"
          onGuest={() => ctx.askLogin("Чтобы отвечать на комментарии.")}
          onCancel={() => setReplying(false)}
          onSubmit={async (b) => {
            const ok = await ctx.post(b, c.id);
            if (ok) {
              setReplying(false);
              setShow(true);
            }
            return ok;
          }}
        />
      ),
    });
  }
  const toggle = (key: string) => ({
    key,
    elbow: 18,
    node: (
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-expanded={show}
        className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium text-accent hover:bg-accent-soft"
      >
        {show ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        {show ? "Скрыть ответы" : replyCount(replies.length)}
      </button>
    ),
  });
  // Unfolded: "Скрыть ответы" above the replies, and again below them when there are several.
  if (replies.length) rows.push(toggle("toggle"));
  if (replies.length && show) {
    for (const r of replies) rows.push({ key: `r${r.id}`, elbow: 14, node: <Thread c={r} depth={depth + 1} ctx={ctx} /> });
    if (replies.length > 1) rows.push(toggle("toggle-end"));
  }

  return (
    <div>
      <div className="relative">
        {rows.length ? <span className="absolute bottom-0 w-0 border-l-2 border-line" style={{ left: trunk, top: avatar + 8 }} aria-hidden /> : null}
        <CommentItem c={c} ctx={ctx} onReply={startReply} />
      </div>
      {rows.length ? (
        <ul style={{ paddingLeft: indent }}>
          {rows.map((row, i) => (
            <li key={row.key} className="relative pt-3">
              {/* the line continues past every row but the last; each row gets an elbow */}
              {i < rows.length - 1 ? (
                <span className="absolute top-0 bottom-0 w-0 border-l-2 border-line" style={{ left: trunk - indent }} aria-hidden />
              ) : null}
              <span
                className="absolute top-0 rounded-bl-[14px] border-b-2 border-l-2 border-line"
                style={{ left: trunk - indent, width: indent - trunk - 6, height: 12 + row.elbow }}
                aria-hidden
              />
              {row.node}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const replyCount = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? "ответ" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "ответа" : "ответов";
  return `${n} ${word}`;
};

function CommentItem({ c, ctx, onReply }: { c: Comment; ctx: ThreadCtx; onReply: () => void }) {
  const { user, moderator } = ctx;
  const reply = !!c.parentId;
  const mine = c.author.id === user?.id;
  const [long, setLong] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const body = useRef<HTMLParagraphElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Measured again whenever the text's box changes: on phones the list starts hidden behind
  // the teaser card (nothing to measure yet), and widths change with the window.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => el.clientHeight && setLong(el.scrollHeight > el.clientHeight + 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [c.body]);
  if (c.deleted) {
    return (
      <div id={`comment-${c.id}`} className="-mx-2 flex scroll-mt-40 gap-3 px-2">
        <span className={cn("shrink-0 rounded-full bg-surface-2", reply ? "size-7" : "size-9")} />
        <p className="self-center text-[14px] text-ink-3 italic">Комментарий удалён</p>
      </div>
    );
  }
  const items: MenuItem[] = [];
  if (moderator && c.status === "held") items.push({ label: "Опубликовать", icon: <ShieldCheck />, run: () => ctx.act(c, "approve") });
  if (moderator && !reply)
    items.push(c.pinned ? { label: "Открепить", icon: <PinOff />, run: () => ctx.act(c, "unpin") } : { label: "Закрепить", icon: <Pin />, run: () => ctx.act(c, "pin") });
  if (!mine && user) items.push({ label: "Пожаловаться", icon: <Flag />, run: () => ctx.act(c, "report") });
  if (mine || moderator) items.push({ label: "Удалить", icon: <Trash2 />, run: () => ctx.act(c, "delete"), danger: true });
  return (
    <div
      ref={root}
      id={`comment-${c.id}`}
      className={cn("group -mx-2 flex scroll-mt-40 gap-3 rounded-xl px-2 transition-colors duration-700", ctx.flash === c.id && "bg-accent-soft")}
    >
      <Avatar user={c.author} size={reply ? 28 : 36} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-[13px]">
          {c.pinned ? (
            // One line, not YouTube's separate «Pinned by» row: the pin is nearly always @bal's own comment.
            <span role="img" className="text-ink-3" title={ctx.pinnedBy ? `Закреплено пользователем @${ctx.pinnedBy}` : "Закреплено"} aria-label="Закреплено">
              <Pin className="size-3.5" />
            </span>
          ) : null}
          {c.author.verified ? (
            // The site's own account: its handle in a pill with a check, like a channel owner's on YouTube.
            <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-ink-2 pr-1.5 pl-2 font-medium text-bg" title={`${c.author.name} · официальный аккаунт сайта`}>
              @{c.author.username}
              <CircleCheck className="size-3.5 fill-current [&_path]:stroke-ink-2" strokeWidth={3} aria-label="Подтверждённый аккаунт" />
            </span>
          ) : (
            <span className="font-medium" title={c.author.name}>
              @{c.author.username}
            </span>
          )}
          <span className="text-ink-3" title={new Date(c.createdAt).toLocaleString("ru-RU")}>
            {since(c.createdAt)}
          </span>
          {c.status === "held" ? <span className="rounded-md bg-accent-soft px-1.5 text-[12px] font-medium text-accent">на проверке</span> : null}
        </p>
        <p ref={body} className={cn("mt-0.5 text-[15px] leading-normal break-words whitespace-pre-wrap", !expanded && "line-clamp-4")}>
          {headed(c) ? (
            <>
              <span className="font-medium">{richText(c.body.slice(0, c.body.indexOf("\n")), ctx.duration, ctx.onSeek)}</span>
              {richText(c.body.slice(c.body.indexOf("\n")), ctx.duration, ctx.onSeek)}
            </>
          ) : (
            richText(c.body, ctx.duration, ctx.onSeek)
          )}
        </p>
        {long || expanded ? (
          <button
            type="button"
            onClick={() => {
              setExpanded(!expanded);
              if (expanded) requestAnimationFrame(() => backToTop(root.current));
            }}
            className="mt-1 text-[14px] font-medium text-ink-2 hover:text-ink"
          >
            {expanded ? "Свернуть" : "Читать дальше"}
          </button>
        ) : null}
        <div className="mt-1 -ml-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => ctx.like(c)}
            aria-pressed={!!c.liked}
            aria-label="Нравится"
            className="flex h-8 items-center gap-1.5 rounded-full px-2 text-[13px] text-ink-2 hover:bg-hover hover:text-ink"
          >
            <ThumbsUp className={cn("size-4", c.liked && "fill-current text-ink")} />
            {c.likes ? <span className="tnum">{c.likes}</span> : null}
          </button>
          {c.status === "published" ? (
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

/** The site's own notes open with a heading line ending in «:», set in medium weight. */
const headed = (c: Comment) => !!c.author.verified && /^[^\n]+:\n/.test(c.body);

/**
 * After «Свернуть» on a long comment, the page glides back to where the comment starts if
 * that is now above the screen (like YouTube), just below the header, or below the player
 * where it sticks to the top (phones).
 */
function backToTop(el: HTMLElement | null) {
  if (!el) return;
  const player = document.querySelector<HTMLElement>("[data-sticky-player]");
  const covered = player && getComputedStyle(player).position === "sticky" ? player.getBoundingClientRect().bottom : 64;
  const top = el.getBoundingClientRect().top - covered - 12;
  if (top < 0) window.scrollBy({ top, behavior: "smooth" });
}

const TOKENS = /(^|[^\p{L}\d_.@:])(?:(\d{1,2}):([0-5]\d)(?![\d:])|@([a-z][a-z0-9_.]{2,29}))/giu;

/** Splits a comment into text, timecodes (within the video) and @mentions. */
function tokens(text: string, duration: number) {
  const out: ({ text: string } | { t: number; text: string } | { mention: string; text: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKENS)) {
    const start = m.index + m[1].length;
    const end = m.index + m[0].length;
    if (m[4]) out.push({ text: text.slice(last, start) }, { mention: m[4], text: text.slice(start, end) });
    else {
      const t = Number(m[2]) * 60 + Number(m[3]);
      if (duration && t > duration) continue;
      out.push({ text: text.slice(last, start) }, { t, text: text.slice(start, end) });
    }
    last = end;
  }
  out.push({ text: text.slice(last) });
  return out;
}

// Chips get their padding from a box-shadow so they keep the text's exact width (the composer's mirror depends on it).
const timeChip = "tnum rounded-[4px] bg-accent-soft text-accent shadow-[0_0_0_3px_var(--accent-soft)]";

/** A posted comment: timecodes are chips that seek the video; @mentions are blue, like YouTube's. */
function richText(text: string, duration: number, onSeek: (t: number) => void) {
  return tokens(text, duration).map((p, i) =>
    "t" in p ? (
      <button key={i} type="button" onClick={() => onSeek(p.t)} className={cn(timeChip, "mx-[3px] font-medium transition-colors hover:bg-accent hover:text-accent-ink")}>
        {p.text}
      </button>
    ) : "mention" in p ? (
      <span key={i} className="font-medium text-link">
        {p.text}
      </span>
    ) : (
      p.text
    ),
  );
}

/** The composer's mirror: same highlighting, but every character keeps its width so it lines up with the textarea. */
function highlight(text: string, duration: number) {
  return tokens(text, duration).map((p, i) =>
    "t" in p ? (
      <span key={i} className={timeChip}>
        {p.text}
      </span>
    ) : "mention" in p ? (
      <span key={i} className="text-link">
        {p.text}
      </span>
    ) : (
      p.text
    ),
  );
}

type MenuItem = { label: string; icon: ReactNode; run: () => void; danger?: boolean };

function ItemMenu({ items }: { items: MenuItem[] }) {
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
  duration,
  people,
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
  duration: number;
  people: Author[];
  placeholder: string;
  small?: boolean;
  autoFocus?: boolean;
  initial?: string;
  onGuest: () => void;
  onCancel?: () => void;
  onSubmit: (body: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(initial);
  const [caret, setCaret] = useState(initial.length);
  const [active, setActive] = useState(!!autoFocus);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const cancel = () => {
    setText("");
    setActive(false);
    onCancel?.();
  };
  const putAt = (from: number, to: number, insert: string) => {
    setText(text.slice(0, from) + insert + text.slice(to));
    const pos = from + insert.length;
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };
  const insertTime = () => {
    const at = input.current?.selectionStart ?? text.length;
    const pad = at > 0 && !/\s$/.test(text.slice(0, at)) ? " " : "";
    putAt(at, at, `${pad}${timecode(now())} `);
  };
  // "@an" right before the caret: suggest people who wrote in this discussion.
  const typed = /(^|\s)@([a-z0-9_.]*)$/i.exec(text.slice(0, caret));
  const suggestions = typed ? people.filter((p) => p.username.startsWith(typed[2].toLowerCase()) || p.name.toLowerCase().includes(typed[2].toLowerCase())).slice(0, 5) : [];

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
      <div
        className="relative min-w-0 flex-1"
        onFocus={() => setActive(true)}
        onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
      >
        {/* The text is drawn by a mirror behind the (transparent-text) textarea, so timecodes and
            @mentions are highlighted while typing exactly as in a posted comment. */}
        <div className="relative">
          <div aria-hidden className="pointer-events-none absolute inset-0 border-b-2 border-transparent pb-2 text-[15px] break-words whitespace-pre-wrap text-ink">
            {highlight(text, duration)}
            {"\u200b"}
          </div>
          <NoteInput
            ref={input}
            autoFocus={autoFocus}
            value={text}
            onChange={(v) => {
              setText(v);
              setCaret(input.current?.selectionStart ?? v.length);
            }}
            onCancel={cancel}
            placeholder={placeholder}
            className="relative text-transparent caret-ink"
          />
        </div>
        {suggestions.length ? (
          <ul className="absolute top-full left-0 z-30 mt-1 w-64 overflow-hidden rounded-xl bg-[var(--sheet)] py-1.5 shadow-[var(--shadow-pop)]">
            {suggestions.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => putAt(caret - typed![2].length - 1, caret, `@${p.username} `)}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-hover"
                >
                  <Avatar user={p} size={24} />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium">@{p.username}</span>
                    <span className="block truncate text-[12px] text-ink-3">{p.name}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {active ? (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={insertTime}
              className="tnum flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-accent hover:bg-accent-soft"
              title="Вставить текущее время видео — оно станет ссылкой"
            >
              <Timer className="size-4 shrink-0" />
              <span className="leading-none">{timecode(now())}</span>
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
