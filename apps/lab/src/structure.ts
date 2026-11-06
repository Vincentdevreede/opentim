/**
 * The structure of a file as a tree, for the Files page: the markers the decoders set (chunks, a level's header and
 * parts), with the fields inside each one as its leaves. Files without markers are grouped by the fields' groups.
 */

import type { Field } from "./fields.ts";
import type { Marker } from "./markers.ts";

export interface TreeNode {
  /** Stable while the file stays the same, to remember which nodes are open. */
  id: string;
  offset: number;
  /** The byte after the node. */
  end: number;
  label: string;
  detail: string;
  children: TreeNode[];
  /** Set on leaves, the fields themselves. */
  field?: Field;
}

const fieldNode = (field: Field): TreeNode => ({
  id: `f${field.offset}`,
  offset: field.offset,
  end: field.offset + field.size,
  label: field.label || field.name,
  detail: field.value,
  children: [],
  field,
});

/** The fields that start inside a range, found by halving the sorted list. */
function fieldsIn(fields: readonly Field[], start: number, end: number): Field[] {
  let low = 0;
  let high = fields.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (fields[mid]!.offset < start) low = mid + 1;
    else high = mid;
  }
  const out: Field[] = [];
  for (let i = low; i < fields.length && fields[i]!.offset < end; i++) out.push(fields[i]!);
  return out;
}

/** Builds the tree from markers nested by their depth, then hangs the fields under the nodes without children. */
export function buildTree(markers: readonly Marker[], fields: readonly Field[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: { node: TreeNode; depth: number }[] = [];
  for (const m of markers) {
    if (m.error || m.offset === undefined || m.end === undefined) continue;
    const node: TreeNode = {
      id: `m${m.offset}.${m.depth}.${m.label}`,
      offset: m.offset,
      end: m.end,
      label: m.label,
      detail: m.detail,
      children: [],
    };
    while (stack.length && stack.at(-1)!.depth >= m.depth) stack.pop();
    (stack.at(-1)?.node.children ?? roots).push(node);
    stack.push({ node, depth: m.depth });
  }
  const attach = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.children.length) attach(node.children);
      else {
        const inside = fieldsIn(fields, node.offset, node.end);
        if (inside.length > 1) node.children = inside.map(fieldNode);
      }
    }
  };
  attach(roots);
  if (roots.length) return roots;

  // Without markers, fields that share a group, like the header of a program, make a node together.
  const groups: TreeNode[] = [];
  for (const field of fields) {
    if (!field.group) continue;
    const last = groups.at(-1);
    if (last?.label === field.group && last.end === field.offset) {
      last.children.push(fieldNode(field));
      last.end = field.offset + field.size;
    } else
      groups.push({
        id: `g${field.offset}`,
        offset: field.offset,
        end: field.offset + field.size,
        label: field.group,
        detail: "",
        children: [fieldNode(field)],
      });
  }
  for (const g of groups) g.detail = `${g.children.length} fields · ${g.end - g.offset} B`;
  return groups;
}

/** The nodes from the root to the deepest one holding a byte. */
export function pathTo(nodes: readonly TreeNode[], offset: number): TreeNode[] {
  const path: TreeNode[] = [];
  let level = nodes;
  for (;;) {
    const node = level.findLast((n) => offset >= n.offset && offset < n.end);
    if (!node) return path;
    path.push(node);
    level = node.children;
  }
}

export type Row = { node: TreeNode; depth: number } | { more: number; depth: number };

/**
 * The rows to show: the roots, and the children of every open node, each with how deep it is. A node with more than
 * `limit` children shows that many around the one holding `focus`, and a row that counts the others.
 */
export function visibleRows(
  nodes: readonly TreeNode[],
  open: ReadonlySet<string>,
  focus: number,
  limit = 400,
  depth = 0,
): Row[] {
  let shown = nodes;
  let before = 0;
  if (nodes.length > limit) {
    const at = Math.max(
      0,
      nodes.findIndex((n) => focus >= n.offset && focus < n.end),
    );
    before = Math.min(Math.max(0, at - limit / 2), nodes.length - limit);
    shown = nodes.slice(before, before + limit);
  }
  const after = nodes.length - before - shown.length;
  return [
    ...(before ? [{ more: before, depth }] : []),
    ...shown.flatMap((node) => [
      { node, depth },
      ...(open.has(node.id) ? visibleRows(node.children, open, focus, limit, depth + 1) : []),
    ]),
    ...(after ? [{ more: after, depth }] : []),
  ];
}
