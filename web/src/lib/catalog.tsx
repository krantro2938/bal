import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
