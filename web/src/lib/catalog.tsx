import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { api } from "./api";
import { useSession } from "./session";
import type { Catalog, DanceSummary } from "./types";

type CatalogState = {
  data: Catalog | null;
  error: string | null;
  retry: () => void;
  /** Patch one dance locally (e.g. new like counts) without refetching. */
  patch: (slug: string, p: Partial<DanceSummary>) => void;
};

const Ctx = createContext<CatalogState | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const { pathname } = useLocation();
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .catalog()
      .then((c) => alive && setData(c))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // refetch when the signed-in user changes: "my reaction" differs
  }, [attempt, user?.id]);
  useEffect(() => {
    if (pathname !== "/") return;
    let active = true;
    let inFlight = false;
    const refreshCounts = async () => {
      if (!active || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const latest = await api.catalog();
        if (!active) return;
        const counts = new Map(latest.dances.map((d) => [d.slug, d]));
        setData((current) => {
          if (!current) return current;
          const dances = current.dances.map((d) => {
            const fresh = counts.get(d.slug);
            if (!fresh || (fresh.views === d.views && fresh.comments === d.comments)) return d;
            return { ...d, views: fresh.views, comments: fresh.comments };
          });
          return dances.some((d, i) => d !== current.dances[i]) ? { ...current, dances } : current;
        });
      } catch {
        // Keep the last confirmed counts until the next refresh.
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(refreshCounts, 20_000);
    document.addEventListener("visibilitychange", refreshCounts);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshCounts);
    };
  }, [pathname]);
  const patch = useCallback((slug: string, p: Partial<DanceSummary>) => {
    setData((c) => (c ? { ...c, dances: c.dances.map((d) => (d.slug === slug ? { ...d, ...p } : d)) } : c));
  }, []);
  const value = useMemo(() => ({ data, error, retry: () => setAttempt((a) => a + 1), patch }), [data, error, patch]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCatalog() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCatalog outside CatalogProvider");
  return c;
}
