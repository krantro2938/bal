import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { VideoCard } from "@/components/DanceCard";
import { StateBlock } from "@/components/StateBlock";
import { Button } from "@/components/ui/button";
import { useCatalog } from "@/lib/catalog";
import { plural, searchKey } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { DanceSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

type Filter = "all" | "waltz" | "favorites" | "learned" | "todo";

export function Catalog() {
  const { data, error, retry } = useCatalog();
  const { user, state } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const filter = (params.get("f") as Filter) || "all";

  useEffect(() => {
    document.title = q ? `${q} · Звёздная одиссея` : "Звёздная одиссея · Репетиции";
  }, [q]);

  const chips: { id: Filter; label: string; show: boolean }[] = [
    { id: "all", label: "Все", show: true },
    { id: "waltz", label: "Вальсы", show: true },
    { id: "favorites", label: "Избранное", show: !!user },
    { id: "learned", label: "Выучено", show: !!user },
    { id: "todo", label: "Ещё учу", show: !!user },
  ];

  const results = useMemo(() => {
    if (!data) return [];
    const key = searchKey(q);
    const pass: Record<Filter, (d: DanceSummary) => boolean> = {
      all: () => true,
      waltz: (d) => /вальс/i.test(d.title),
      favorites: (d) => !!state?.favorites.includes(d.slug),
      learned: (d) => !!state?.learned.includes(d.slug),
      todo: (d) => d.kind === "dance" && !state?.learned.includes(d.slug),
    };
    return data.dances.filter(
      (d) =>
        pass[filter](d) &&
        (!key || searchKey([d.title, d.description, ...(d.chapters ?? []).map((c) => c.title)].join(" ")).includes(key)),
    );
  }, [data, q, filter, state]);

  const glossaryHit = (d: DanceSummary) => {
    const key = searchKey(q);
    const hit = key && d.chapters?.find((c) => searchKey(c.title).includes(key));
    return hit ? `«${hit.title}»` : undefined;
  };

  const setFilter = (f: Filter) => {
    const next = new URLSearchParams(params);
    if (f === "all") next.delete("f");
    else next.set("f", f);
    setParams(next, { replace: true });
  };

  return (
    <main className="px-3 pb-20 sm:px-6 lg:px-8">
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pt-2 pb-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {chips
          .filter((c) => c.show)
          .map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setFilter(c.id)}
              aria-pressed={filter === c.id}
              className={cn(
                "h-8 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors",
                filter === c.id ? "bg-ink text-bg" : "bg-surface-2 text-ink hover:bg-line",
              )}
            >
              {c.label}
            </button>
          ))}
        {q ? (
          <span className="tnum flex shrink-0 items-center pl-2 text-[13px] text-ink-3">
            {results.length} {plural(results.length, "результат", "результата", "результатов")} по «{q}»
          </span>
        ) : null}
      </div>

      {error ? (
        <StateBlock title="Каталог не загрузился" action={<Button onClick={retry}>Повторить</Button>}>
          Проверьте соединение. {error}
        </StateBlock>
      ) : !data ? (
        <div className="grid gap-x-5 gap-y-12 pt-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label="Загрузка">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i}>
              <div className="aspect-video rounded-[var(--radius-frame)] bg-surface-2" />
              <div className="mt-3 flex gap-3">
                <div className="size-9 rounded-full bg-surface-2" />
                <div className="h-5 w-2/3 rounded-md bg-surface-2" />
              </div>
            </div>
          ))}
        </div>
      ) : results.length === 0 ? (
        <StateBlock
          title={q ? `Ничего не нашлось по «${q}»` : "Здесь пока пусто"}
          action={
            q ? (
              <Link to="/dance/slovar-dvizheniy" className="text-accent underline underline-offset-4">
                Открыть словарь движений
              </Link>
            ) : (
              <Button onClick={() => setFilter("all")}>Показать все танцы</Button>
            )
          }
        >
          {q
            ? "Названия движений — алеман, балансе, шен — собраны в словаре с тайм-кодами."
            : filter === "favorites"
              ? "Сохраните танец закладкой под видео или через ⋮ на карточке."
              : "Отметьте танец кнопкой «Выучено» под видео."}
        </StateBlock>
      ) : (
        <div className="grid gap-x-5 gap-y-12 pt-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {results.map((d, i) => (
            <VideoCard
              key={d.slug}
              dance={d}
              eager={i < 4}
              badge={d.kind === "glossary" ? glossaryHit(d) : state?.learned.includes(d.slug) ? "выучено" : undefined}
            />
          ))}
        </div>
      )}

      {data ? (
        <footer className="mt-16 border-t border-line pt-6 text-[13px] text-ink-3">
          Видео, схемы и музыка — из канала{" "}
          <a href={data.channel} className="underline underline-offset-4 hover:text-ink" rel="noopener" target="_blank">
            Традиционного бала РТУ МИРЭА
          </a>
          . У каждого танца есть ссылка на исходный пост.
        </footer>
      ) : null}
    </main>
  );
}
