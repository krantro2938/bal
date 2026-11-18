import { ArrowLeft, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useCatalog } from "@/lib/catalog";
import { searchKey, timecode } from "@/lib/format";
import { useThumbs } from "@/lib/thumbs";
import type { DanceSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Thumb } from "./Thumb";

type Suggestion =
  | { kind: "dance"; key: string; dance: DanceSummary; href: string }
  | { kind: "move"; key: string; title: string; start: number; href: string };

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Header search: as you type, matching dances and glossary movements appear with their frames. */
export function SearchBox({ onClose, autoFocus, className }: { onClose?: () => void; autoFocus?: boolean; className?: string }) {
  const { data } = useCatalog();
  const navigate = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const [q, setQ] = useState(loc.pathname === "/" ? (params.get("q") ?? "") : "");
  const dq = useDebounced(q, 150);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const glossary = data?.dances.find((d) => d.kind === "glossary");
  const cues = useThumbs(open && glossary ? `/media/${glossary.slug}/thumbs.vtt` : undefined);

  useEffect(() => {
    if (loc.pathname === "/") setQ(params.get("q") ?? "");
  }, [loc.pathname, params]);
  useEffect(() => setActive(-1), [dq]);

  const suggestions = useMemo<Suggestion[]>(() => {
    const key = searchKey(dq);
    if (!data || !key) return [];
    const out: Suggestion[] = [];
    for (const d of data.dances)
      if (searchKey(d.title).includes(key)) out.push({ kind: "dance", key: d.slug, dance: d, href: `/dance/${d.slug}` });
    glossary?.chapters?.forEach((c) => {
      if (searchKey(c.title).includes(key))
        out.push({ kind: "move", key: `m${c.start}`, title: c.title, start: c.start, href: `/dance/${glossary.slug}?t=${c.start}` });
    });
    return out.slice(0, 8);
  }, [data, dq, glossary]);

  const submit = (s?: Suggestion) => {
    setOpen(false);
    input.current?.blur();
    onClose?.();
    if (s) navigate(s.href);
    else navigate(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : "/");
  };

  const showList = open && searchKey(dq) !== "";

  return (
    <form
      role="search"
      className={cn("relative flex min-w-0 flex-1 items-center gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit(active >= 0 ? suggestions[active] : undefined);
      }}
    >
      {onClose ? (
        <button type="button" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-hover" aria-label="Закрыть поиск">
          <ArrowLeft className="size-5" />
        </button>
      ) : null}
      <div
        className={cn(
          "flex h-11 min-w-0 flex-1 items-center rounded-full bg-surface-2 transition-colors",
          showList ? "bg-surface" : "hover:bg-line/50",
        )}
      >
        <Search className="ml-4 size-[18px] shrink-0 text-ink-3" aria-hidden />
        <input
          ref={input}
          type="search"
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(suggestions.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(-1, a - 1));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Найти танец или движение"
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-[15px] text-ink placeholder:text-ink-3 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        {q ? (
          <button
            type="button"
            onClick={() => {
              setQ("");
              input.current?.focus();
              if (loc.pathname === "/") navigate("/", { replace: true });
            }}
            className="mr-1.5 grid size-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
            aria-label="Очистить"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {showList ? (
        <div className="absolute top-[52px] right-0 left-0 z-50 overflow-hidden rounded-[var(--radius-sheet)] bg-bg p-2 shadow-[var(--shadow-pop)]">
          {suggestions.length === 0 ? (
            <p className="px-3 py-3 text-[15px] text-ink-3">Ничего не нашлось по «{dq.trim()}»</p>
          ) : (
            <ul id={listId} role="listbox">
              {suggestions.map((s, i) => (
                <li key={s.key} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => submit(s)}
                    className={cn("flex w-full items-center gap-3 rounded-xl p-2 text-left", i === active && "bg-hover")}
                  >
                    {s.kind === "dance" ? (
                      <img src={s.dance.posterSmall} alt="" className="aspect-video w-[104px] shrink-0 rounded-lg bg-player object-cover" />
                    ) : (
                      <Thumb cues={cues} t={s.start + 1} width={104} />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium">{s.kind === "dance" ? s.dance.title : s.title}</span>
                      <span className="tnum flex gap-x-2 truncate text-[13px] text-ink-3">
                        {s.kind === "dance" ? (
                          <>
                            <span>{s.dance.kind === "glossary" ? "Словарь движений" : `Танец ${String(s.dance.order).padStart(2, "0")}`}</span>
                            {s.dance.duration ? <span>{timecode(s.dance.duration)}</span> : null}
                          </>
                        ) : (
                          <>
                            <span>Движение в словаре</span>
                            <span>{timecode(s.start)}</span>
                          </>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </form>
  );
}
