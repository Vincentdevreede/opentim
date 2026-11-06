import { describe, expect, it } from "vitest";
import { bookmarksIn, parseStore, removeBookmark, toggleBookmark, versionKey } from "../src/bookmarks.ts";
import { PROFILES } from "../src/edition.ts";

const mark = (file: string, offset: number, name = "x") => ({ file, offset, end: offset + 2, name });

describe("bookmarks", () => {
  it("keeps a version's bookmarks per file, by offset", () => {
    const store = {};
    toggleBookmark(store, "tim1-en", mark("L1.LEV", 0x79));
    toggleBookmark(store, "tim1-en", mark("L1.LEV", 0x65));
    toggleBookmark(store, "tim1-en", mark("TIM.PAL", 8));
    toggleBookmark(store, "tim2-en", mark("L1.LEV", 4));
    expect(bookmarksIn(store, "tim1-en", "L1.LEV").map((b) => b.offset)).toEqual([0x65, 0x79]);
    expect(bookmarksIn(store, "tim2-en", "L1.LEV")).toHaveLength(1);
    expect(bookmarksIn(store, "other", "L1.LEV")).toEqual([]);
  });

  it("removes a bookmark when it is toggled again at the same byte, or removed", () => {
    const store = {};
    toggleBookmark(store, "v", mark("A", 4, "first"));
    toggleBookmark(store, "v", mark("A", 4, "second"));
    expect(bookmarksIn(store, "v", "A")).toEqual([]);
    toggleBookmark(store, "v", mark("A", 4));
    removeBookmark(store, "v", mark("A", 4));
    expect(bookmarksIn(store, "v", "A")).toEqual([]);
  });

  it("reads stored bookmarks and drops what isn't one", () => {
    const text = JSON.stringify({ v: [mark("A", 1), { file: "B" }, null, mark("C", 2.5)], w: "nope" });
    expect(parseStore(text)).toEqual({ v: [mark("A", 1)], w: [] });
    expect(parseStore("not json")).toEqual({});
    expect(parseStore("[1]")).toEqual({});
    expect(parseStore(null)).toEqual({});
  });

  it("keys bookmarks by the recognized version", () => {
    const profile = PROFILES[0]!;
    expect(versionKey({ status: "recognized", profile })).toBe(profile.id);
    expect(versionKey({ status: "unknown" })).toBe("unknown");
    expect(versionKey(undefined)).toBe("unknown");
  });
});
