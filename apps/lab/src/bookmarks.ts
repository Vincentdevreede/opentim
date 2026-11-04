/**
 * Bookmarks on the bytes of resources, with a name, kept in this browser per version of the game. They mark what is
 * worth coming back to while working out a file.
 */

import { ref, watch } from "vue";
import type { Edition } from "./edition.ts";

const STORAGE_KEY = "opentim.lab.bookmarks";

export interface Bookmark {
  /** The resource, like `L1.LEV`. */
  file: string;
  /** The first byte. */
  offset: number;
  /** The byte after the last one. */
  end: number;
  name: string;
}

/** Bookmarks by version, keyed by {@link versionKey}. */
type Store = Record<string, Bookmark[]>;

const isBookmark = (b: unknown): b is Bookmark =>
  !!b &&
  typeof b === "object" &&
  typeof (b as Bookmark).file === "string" &&
  Number.isInteger((b as Bookmark).offset) &&
  Number.isInteger((b as Bookmark).end) &&
  typeof (b as Bookmark).name === "string";

/** Reads the stored bookmarks, dropping anything that isn't one. */
export function parseStore(text: string | null): Store {
  try {
    const data: unknown = JSON.parse(text ?? "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(
      Object.entries(data).map(([key, list]) => [key, Array.isArray(list) ? list.filter(isBookmark) : []]),
    );
  } catch {
    return {};
  }
}

function load(): Store {
  try {
    return parseStore(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

export const bookmarks = ref<Store>(load());

watch(
  bookmarks,
  (store) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Without storage the bookmarks last as long as the tab.
    }
  },
  { deep: true },
);

/** The key a version's bookmarks are kept under: its profile id, or `unknown` for files the lab doesn't recognize. */
export const versionKey = (edition?: Edition) => (edition?.status === "recognized" ? edition.profile.id : "unknown");

/** The bookmarks in a file, by offset. */
export const bookmarksIn = (store: Store, version: string, file: string) =>
  (store[version] ?? []).filter((b) => b.file === file).sort((a, b) => a.offset - b.offset);

/** Adds a bookmark, or removes the one that starts at the same byte of the same file. */
export function toggleBookmark(store: Store, version: string, bookmark: Bookmark) {
  const list = (store[version] ??= []);
  const at = list.findIndex((b) => b.file === bookmark.file && b.offset === bookmark.offset);
  if (at >= 0) list.splice(at, 1);
  else list.push(bookmark);
}

export function removeBookmark(store: Store, version: string, bookmark: Bookmark) {
  const list = store[version] ?? [];
  const at = list.findIndex((b) => b.file === bookmark.file && b.offset === bookmark.offset);
  if (at >= 0) list.splice(at, 1);
}
