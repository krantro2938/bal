import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { User, UserState } from "./types";

type Session = {
  user: User | null;
  ready: boolean;
  state: UserState | null;
  refresh: () => Promise<void>;
  setMark: (kind: "favorite" | "learned", slug: string, on: boolean) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<UserState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me();
      setUser(user);
      setState(user ? await api.state() : null);
    } catch {
      setUser(null);
      setState(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Pick up changes made on another device when the tab regains focus.
    const onFocus = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [refresh]);

  const setMark = useCallback(
    async (kind: "favorite" | "learned", slug: string, on: boolean) => {
      const key = kind === "favorite" ? "favorites" : "learned";
      setState((s) =>
        s ? { ...s, [key]: on ? [slug, ...s[key].filter((x) => x !== slug)] : s[key].filter((x) => x !== slug) } : s,
      );
      try {
        await api.mark(kind, slug, on);
      } catch (e) {
        await refresh();
        throw e;
      }
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setState(null);
  }, []);

  const value = useMemo(() => ({ user, ready, state, refresh, setMark, logout }), [user, ready, state, refresh, setMark, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
