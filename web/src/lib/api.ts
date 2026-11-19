import type { AuthConfig, Catalog, Comment, DanceDetail, Note, Notification, Profile, ProfileComment, User, UserState } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
  });
  if (!res.ok) {
    let msg = "Не удалось связаться с сервером";
    let field: string | undefined;
    try {
      const j = await res.json();
      msg = j.error ?? msg;
      field = j.field;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg, field);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  catalog: () => request<Catalog>("GET", "/api/catalog"),
  dance: (slug: string) => request<DanceDetail>("GET", `/api/dances/${encodeURIComponent(slug)}`),
  me: () => request<{ user: User | null }>("GET", "/api/me"),
  authConfig: () => request<AuthConfig>("GET", "/api/auth/config"),
  register: (b: { name: string; email: string; password: string }) => request<{ user: User }>("POST", "/api/auth/register", b),
  login: (b: { email: string; password: string }) => request<{ user: User }>("POST", "/api/auth/login", b),
  view: (slug: string) => request<void>("POST", `/api/dances/${encodeURIComponent(slug)}/view`),
  react: (slug: string, value: -1 | 0 | 1) =>
    request<{ likes: number; dislikes: number; mine: -1 | 0 | 1 }>("PUT", `/api/dances/${encodeURIComponent(slug)}/reaction`, { value }),
  devLogin: (name: string) => request<{ user: User }>("POST", "/api/auth/dev", { name }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  pushSubscribe: (sub: PushSubscriptionJSON) => request<void>("POST", "/api/push", sub),
  pushUnsubscribe: (endpoint: string) => request<void>("DELETE", "/api/push", { endpoint }),
  state: () => request<UserState>("GET", "/api/me/state"),
  notes: (dance: string) => request<Note[]>("GET", `/api/notes?dance=${encodeURIComponent(dance)}`),
  createNote: (n: { dance: string; version: string; t: number; text: string }) => request<Note>("POST", "/api/notes", n),
  updateNote: (id: number, patch: { text?: string; t?: number }) => request<Note>("PATCH", `/api/notes/${id}`, patch),
  deleteNote: (id: number) => request<void>("DELETE", `/api/notes/${id}`),
  mark: (kind: "favorite" | "learned", slug: string, on: boolean) =>
    request<void>(on ? "PUT" : "DELETE", `/api/marks/${kind}/${encodeURIComponent(slug)}`),
  profile: (username: string) => request<{ profile: Profile; comments: ProfileComment[] }>("GET", `/api/users/${encodeURIComponent(username)}`),
  comments: (slug: string) => request<{ comments: Comment[]; moderator: boolean; pinnedBy?: string }>("GET", `/api/dances/${encodeURIComponent(slug)}/comments`),
  createComment: (slug: string, body: string, parentId?: number) =>
    request<{ comment: Comment; notice?: string }>("POST", `/api/dances/${encodeURIComponent(slug)}/comments`, { body, parentId }),
  /** A comment with replies comes back as a placeholder; otherwise the removed ids. */
  deleteComment: (id: number) => request<{ placeholder?: Comment; removed?: number[] }>("DELETE", `/api/comments/${id}`),
  likeComment: (id: number, on: boolean) => request<{ likes: number; liked: boolean }>("PUT", `/api/comments/${id}/like`, { on }),
  reportComment: (id: number) => request<void>("POST", `/api/comments/${id}/report`),
  approveComment: (id: number) => request<Comment>("POST", `/api/comments/${id}/approve`),
  pinComment: (id: number, on: boolean) => request<void>("PUT", `/api/comments/${id}/pin`, { on }),
  notifications: () => request<{ items: Notification[]; unread: number }>("GET", "/api/notifications"),
  readNotifications: () => request<void>("POST", "/api/notifications/read"),
  setUsername: (username: string) => request<{ user: User }>("PATCH", "/api/me", { username }),
  usernameFree: (u: string) => request<{ valid: boolean; free: boolean }>("GET", `/api/me/username?u=${encodeURIComponent(u)}`),
  progress: (slug: string, version: string, position: number) =>
    request<void>("PUT", `/api/progress/${encodeURIComponent(slug)}`, { version, position }, { keepalive: true }),
};
