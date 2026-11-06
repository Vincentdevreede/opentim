import { describe, expect, it } from "vitest";
import type { Field } from "../src/fields.ts";
import type { Marker } from "../src/markers.ts";
import { buildTree, pathTo, visibleRows } from "../src/structure.ts";

const field = (offset: number, size: number, label: string, group?: string): Field => ({
  offset,
  size,
  label,
  name: label,
  value: "1",
  kind: "setting",
  type: "u16 LE",
  group,
});
const marker = (offset: number, end: number, label: string, depth: number): Marker => ({
  offset,
  end,
  label,
  detail: "",
  depth,
});

// A container chunk at 0 holding two chunks; the second holds three fields.
const markers = [marker(0, 30, "BMP:", 0), marker(8, 18, "INF:", 1), marker(18, 30, "OFF:", 1)];
const fields = [field(16, 2, "count"), field(26, 2, "a"), field(28, 2, "b")];

describe("buildTree", () => {
  it("nests markers by depth and hangs the fields under the nodes without children", () => {
    const tree = buildTree(markers, [field(0, 4, "tag"), field(16, 2, "count"), field(24, 2, "x"), ...fields.slice(1)]);
    expect(tree).toHaveLength(1);
    const [inf, off] = tree[0]!.children;
    expect(inf!.children).toEqual([]);
    expect(off!.children.map((n) => n.label)).toEqual(["x", "a", "b"]);
  });

  it("groups fields by their group when there are no markers", () => {
    const tree = buildTree([], [field(0, 2, "magic", "header"), field(2, 2, "pages", "header"), field(4, 2, "word")]);
    expect(tree.map((n) => [n.label, n.offset, n.end, n.children.length])).toEqual([["header", 0, 4, 2]]);
  });

  it("skips markers where a decoder stopped", () => {
    expect(buildTree([{ ...marker(4, 8, "Stopped", 0), error: true }], [])).toEqual([]);
  });
});

describe("pathTo and visibleRows", () => {
  const tree = buildTree(markers, [field(20, 2, "x"), field(22, 2, "y"), ...fields.slice(1)]);

  it("finds the nodes down to the one holding a byte", () => {
    expect(pathTo(tree, 23).map((n) => n.label)).toEqual(["BMP:", "OFF:", "y"]);
    expect(pathTo(tree, 40)).toEqual([]);
  });

  it("shows the children of open nodes, and a window of a long list", () => {
    const open = new Set([tree[0]!.id, tree[0]!.children[1]!.id]);
    const rows = visibleRows(tree, open, 0);
    expect(rows.map((r) => ("node" in r ? `${r.depth}:${r.node.label}` : `more ${r.more}`))).toEqual([
      "0:BMP:",
      "1:INF:",
      "1:OFF:",
      "2:x",
      "2:y",
      "2:a",
      "2:b",
    ]);
    const window = visibleRows(tree, open, 27, 2);
    expect(window.map((r) => ("node" in r ? r.node.label : `more ${r.more}`))).toEqual([
      "BMP:",
      "INF:",
      "OFF:",
      "more 1",
      "y",
      "a",
      "more 1",
    ]);
  });
});
