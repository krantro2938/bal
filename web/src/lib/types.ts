export type DanceSummary = {
  slug: string;
  order: number;
  title: string;
  kind: "dance" | "glossary";
  description: string;
  available: boolean;
  duration?: number;
  poster?: string;
  posterSmall?: string;
  hasScheme: boolean;
  hasAudio: boolean;
  chapters?: { title: string; start: number }[];
  sourcePost: string;
  version?: string;
  preview?: string;
  likes: number;
  dislikes: number;
  myReaction: -1 | 0 | 1;
  views: number;
  published?: string;
};

export type Catalog = { edition: string; channel: string; shareUrl?: string; dances: DanceSummary[] };

export type Chapter = { start: number; end: number; title: string };

export type DanceDetail = DanceSummary & {
  caption: string;
  captionPost: string;
  video?: { url: string; width: number; height: number; fps: string; bytes: number; duration: number };
  thumbnails?: string;
  chapterList: Chapter[];
  chaptersSource?: string;
  schemes: { path: string; thumb: string; width: number; height: number; post: string }[];
  audio: { path: string; title: string; duration: number; post: string; original: string }[];
  assets: { kind: "video" | "scheme" | "audio"; post: string; status: string; originalFilename: string }[];
};

export type User = { id: number; name: string; username: string; picture?: string; email?: string };

export type AuthConfig = { google: boolean; password: boolean; dev: boolean; analytics?: boolean };

export type Note = {
  id: number;
  dance: string;
  version: string;
  t: number;
  text: string;
  createdAt: number;
  updatedAt: number;
};

export type Progress = { dance: string; version: string; position: number; updatedAt: number };

export type UserState = { favorites: string[]; learned: string[]; progress: Progress[]; notes: Note[] };

/** verified: the site's own account (a badge and a pill around its handle, like a channel owner on YouTube). */
export type Author = { id: number; name: string; username: string; picture?: string; verified?: boolean };

export type Comment = {
  id: number;
  dance: string;
  parentId?: number;
  author: Author;
  body: string;
  /** "held" comments wait for a moderator; only their author and moderators get them. */
  status: "published" | "held";
  /** Deleted but kept for its replies: no text, no author. */
  deleted?: boolean;
  pinned?: boolean;
  createdAt: number;
  likes: number;
  liked?: boolean;
};

export type CommentEvent =
  | { type: "comment"; comment: Comment }
  | { type: "removed"; id: number }
  | { type: "likes"; id: number; likes: number }
  | { type: "pinned"; id?: number };

export type Notification = {
  id: number;
  kind: "reply" | "mention";
  createdAt: number;
  read: boolean;
  comment: Comment;
  danceTitle: string;
};
