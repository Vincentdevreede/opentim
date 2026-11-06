/**
 * The behaviour of one part laid out for the behaviour tab: the paths of a routine that make the same change become
 * one row, conditions lose the terms that say nothing, and a target that depends only on the state is worked out.
 */

import type { Confidence } from "@opentim/content";
import {
  NAMED_TERMS,
  statesText,
  type Change,
  type PartSummary,
  type Walk,
  type WalkPath,
  type WalkStart,
  type Write,
} from "./behaviour.ts";

/** The least sure of a few findings. */
export const weakest = (list: readonly Confidence[]): Confidence =>
  list.includes("unresolved") ? "unresolved" : list.includes("inferred") ? "inferred" : "checked";

/** A term written shorter: `(x ^ (x >> 15)) - (x >> 15)` as `|x|`, and adding 0xffe0 as subtracting 32. */
export function tidyTerm(term: string): string {
  return (
    term
      .replace(/\(\(\((.+?)\) \^ \(\(\1\) >> 15\)\) - \(\(\1\) >> 15\)\)/g, "|$1|")
      .replace(/\(\((.+?)\) \^ \(\(\1\) >> 15\)\) - \(\(\1\) >> 15\)/g, "|$1|")
      .replace(
        /\(\(([\w.]+)\) \^ \(\1 >> 15\)\) - \(\1 >> 15\)|\(([\w.]+) \^ \(\2 >> 15\)\) - \(\2 >> 15\)/g,
        (_, a, b) => `|${a ?? b}|`,
      )
      .replace(/ \+ 0x([89a-f][0-9a-f]{3})\b/g, (_, n: string) => ` - ${0x10000 - parseInt(n, 16)}`)
      .replace(/ - 0x([89a-f][0-9a-f]{3})\b/g, (_, n: string) => ` + ${0x10000 - parseInt(n, 16)}`)
      // Equal or not equal to a 16-bit word is the same test with its signed value.
      .replace(/ (==|!=) 0x([89a-f][0-9a-f]{3})$/, (_, op: string, n: string) => ` ${op} ${parseInt(n, 16) - 0x10000}`)
  );
}

const COMPARE = /^(.+) (==|!=|<|<=|>|>=) (-?\d+|0x[0-9a-f]+)$/;

/** The terms of a condition, tidied, without repeats, comparisons of two numbers, or terms another one implies. */
export function tidyTerms(terms: readonly string[]): string[] {
  const number = "(-?\\d+|0x[0-9a-f]+)";
  const numbers = new RegExp(`^${number} (==|!=|<|<=|>|>=) ${number}$`);
  const list = [...new Set(terms.map(tidyTerm))].filter((t) => !numbers.test(t));
  const has = (t: string) => list.includes(t);
  return list.filter((t) => {
    const m = COMPARE.exec(t);
    if (!m) return true;
    const [, left, op, value] = m;
    // Equal to one number already says it isn't another.
    if (op === "!=")
      return (
        !has(`${left} < ${value}`) &&
        !has(`${left} > ${value}`) &&
        !list.some((other) => other.startsWith(`${left} == `) && other !== `${left} == ${value}`)
      );
    if (op === "<=") return !has(`${left} < ${value}`);
    if (op === ">=") return !has(`${left} > ${value}`);
    return true;
  });
}

const SIDES = ["right", "top right", "top", "top left", "left", "bottom left", "bottom", "bottom right"];

/**
 * The side each edge of a part's outline faces, when its reset routine writes the points as numbers. The program
 * gives an edge from a point to the next the direction 0xc000 - (atan2(dy, dx) - a quarter turn) (0x69e8), and
 * outlines run clockwise on screen, so the outside of an edge faces a quarter turn further.
 */
export function outlineSides(part: PartSummary): string[] | undefined {
  const points: { x?: number; y?: number }[] = [];
  for (const w of part.reset) {
    const m = /^outline\[(\d+)\]\.([xy])$/.exec(w.target);
    if (!m) continue;
    const value = Number(w.value);
    if (w.condition !== "always" || !Number.isInteger(value)) return undefined;
    const point = (points[Number(m[1])] ??= {});
    if (point[m[2] as "x" | "y"] !== undefined && point[m[2] as "x" | "y"] !== value) return undefined;
    point[m[2] as "x" | "y"] = value;
  }
  if (points.length < 2 || points.some((p) => p?.x === undefined || p.y === undefined)) return undefined;
  return points.map((p, k) => {
    const next = points[(k + 1) % points.length]!;
    // On screen y grows downward, so the angle with y up is the negative one.
    const angle = Math.atan2(p.y! - next.y!, next.x! - p.x!) / (2 * Math.PI);
    return SIDES[Math.round((angle + 0.25) * 8) & 7]!;
  });
}

/**
 * A term in words where the program's code shows what it tests: which way the surface that was hit faces, from its
 * direction word (0x0d98, 0x09ff), and which edge of the outline was hit.
 */
export function readTerm(term: string, sides?: readonly string[]): string {
  const angle = /^\((\w+)\.contactAngle \+ 0x4000\) & 0x8000 (==|!=) 0$/.exec(term);
  if (angle) return angle[2] === "==" ? "hit from above" : "hit from below";
  const edge = /^(\w+)\.contactEdge (==|!=|<|<=|>|>=) (\d+)$/.exec(term);
  if (!edge) return term;
  const [, , op, text] = edge;
  const n = Number(text);
  const side = sides?.[n] ? `the ${sides[n]} (edge ${n})` : `edge ${n}`;
  if (op === "==") return `hit on ${side}`;
  if (op === "!=") return `not on ${side}`;
  if (op === "<") return n === 1 ? "hit on edge 0" : `hit on edges 0–${n - 1}`;
  if (op === ">=") return `hit on edge ${n} or later`;
  return `hit on edge ${op} ${n}`;
}

/**
 * What the lab's own names in some conditions stand for, a line each for the tips: the name, the analysis's raw form
 * and what it is, like "ropeKind is argument+0x0c: the kind of pull, with 0x8000 when it only asks."
 */
export function namedTermLines(texts: readonly string[]): string[] {
  const all = texts.join(" ");
  return NAMED_TERMS.filter(({ name }) => new RegExp(`\\b${name}\\b`).test(all)).map(
    ({ name, raw, meaning }) => `${name} is ${raw}: ${meaning}.`,
  );
}

/** The terms of a condition as the lab writes it, like `a != 0 and b == 4`. */
export const termsOf = (condition: string): string[] => (condition === "always" ? [] : condition.split(" and "));

/** The targets of a change as short text: one number, or up to three runs like `0–3→0 · 4–7→4`. */
export function targetsText(from: readonly number[], targets: readonly number[]): string | number | undefined {
  if (!targets.length || from.length !== targets.length) return undefined;
  if (new Set(targets).size === 1) return targets[0];
  const runs: { start: number; end: number; to: number }[] = [];
  from.forEach((state, i) => {
    const last = runs.at(-1);
    if (last && last.to === targets[i] && last.end === state - 1) last.end = state;
    else runs.push({ start: state, end: state, to: targets[i]! });
  });
  if (runs.length > 3) return undefined;
  return runs.map((r) => `${r.start === r.end ? r.start : `${r.start}–${r.end}`}→${r.to}`).join(" · ");
}

/** The paths of a routine that change the state from the same states to the same value. */
export interface ChangeRow {
  key: string;
  routine: string;
  from: number[] | null;
  fromText: string;
  /** The state it ends in when it is one number. */
  toState?: number;
  /** What it changes to as text: a number, runs of targets per state, or the expression. */
  target: string;
  /** The expression of the new state, when `target` shows something worked out from it. */
  expression?: string;
  keeps: boolean;
  confidence: Confidence;
  /** The terms all its paths share, tidied. */
  shared: string[];
  /** What each path adds to them, when there is more than one. */
  variants: string[][];
  paths: Change[];
}

const stateBound = /^state (==|!=|<|<=|>|>=) -?\d+$/;

/** The shared terms that the start states don't already say. */
export const ownTerms = (row: ChangeRow) => (row.from ? row.shared.filter((t) => !stateBound.test(t)) : row.shared);

export function changeRows(changes: readonly Change[]): ChangeRow[] {
  const groups = new Map<string, Change[]>();
  for (const c of changes) {
    const key = `${c.routine}|${JSON.stringify(c.from)}|${c.to}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups].map(([key, paths]) => {
    const first = paths[0]!;
    const terms = paths.map((p) => tidyTerms(termsOf(p.condition)));
    const shared = terms[0]!.filter((t) => terms.every((list) => list.includes(t)));
    const worked = first.from && first.targets ? targetsText(first.from, first.targets) : undefined;
    const toState = first.toState ?? (typeof worked === "number" ? worked : undefined);
    return {
      key,
      routine: first.routine,
      from: first.from,
      fromText: first.from?.length === 0 ? "none of its own" : statesText(first.from),
      toState,
      target: toState !== undefined ? `→ ${toState}` : typeof worked === "string" ? worked : `→ ${tidyTerm(first.to)}`,
      expression: worked !== undefined && first.toState === undefined ? tidyTerm(first.to) : undefined,
      keeps: first.keeps,
      confidence: weakest(paths.map((p) => p.confidence)),
      shared,
      variants: paths.length > 1 ? terms.map((list) => list.filter((t) => !shared.includes(t))) : [],
      paths,
    };
  });
}

/** The writes of a routine to one field. */
export interface WriteRow {
  key: string;
  routine: string;
  target: string;
  values: string[];
  confidence: Confidence;
  writes: Write[];
}

const OUTLINE = /^outline\[(\d+)\]\.([xy])$/;

/** The points a routine writes to the outline, like `(8,0)`, when it writes each as one number. */
function outlinePoints(list: readonly Write[]): string[] | undefined {
  const points: { x?: string; y?: string }[] = [];
  for (const w of list) {
    const [, k, axis] = OUTLINE.exec(w.target)!;
    const point = (points[Number(k)] ??= {});
    if (w.condition !== "always" || point[axis as "x" | "y"] !== undefined) return undefined;
    point[axis as "x" | "y"] = tidyTerm(w.value);
  }
  return points.some((p) => p?.x === undefined || p.y === undefined) ? undefined : points.map((p) => `(${p.x},${p.y})`);
}

/**
 * The outline a part's reset routine sets, as points from the part's position, for a frame of this size. The points
 * are bytes, so `frameWidth + 0xff` is one less than the width. Undefined when reset doesn't write every point.
 */
export function outlineShape(part: PartSummary, size: { width: number; height: number }) {
  const points = outlinePoints(part.reset.filter((w) => OUTLINE.test(w.target)));
  if (!points || points.length < 2) return undefined;
  const values: Record<string, number> = { frameWidth: size.width, frameHeight: size.height };
  const value = (text: string) => {
    const m = /^(\w+)(?: ([+-]) (\w+))?$/.exec(text);
    if (!m) return undefined;
    const number = (t: string) => (t in values ? values[t] : /^(0x[0-9a-f]+|\d+)$/.test(t) ? Number(t) : undefined);
    const left = number(m[1]!);
    const right = m[3] === undefined ? 0 : number(m[3]);
    if (left === undefined || right === undefined) return undefined;
    return (m[2] === "-" ? left - right : left + right) & 0xff;
  };
  const shape = points.map((p) => {
    const [x, y] = p.slice(1, -1).split(",").map(value);
    return x === undefined || y === undefined ? undefined : { x, y };
  });
  return shape.every((p) => p) ? (shape as { x: number; y: number }[]) : undefined;
}

/** The writes of each routine by field, with a routine's writes to the outline points as one row. */
export function writeRows(writes: readonly Write[]): WriteRow[] {
  const groups = new Map<string, Write[]>();
  for (const w of writes) {
    const key = `${w.routine}|${OUTLINE.test(w.target) ? "outline" : w.target}`;
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  return [...groups].map(([key, list]) => {
    const points = key.endsWith("|outline") ? outlinePoints(list) : undefined;
    const outline = key.endsWith("|outline");
    return {
      key,
      routine: list[0]!.routine,
      target: outline ? "outline" : list[0]!.target,
      values: points ?? [...new Set(list.map((w) => (outline ? `${w.target} = ` : "") + tidyTerm(w.value)))],
      confidence: weakest(list.map((w) => w.confidence)),
      writes: list,
    };
  });
}

/** A routine of the part with everything it does. */
export interface RoutineGroup {
  role: string;
  at?: string;
  address?: number;
  confidence?: Confidence;
  empty: boolean;
  changes: ChangeRow[];
  /** How many paths keep the state as it was. */
  kept: number;
  /** Writes to how the part is drawn. */
  draws: WriteRow[];
  /** Writes when the machine is put back. */
  sets: WriteRow[];
  open: boolean;
}

/** The part's routines in the order of its record, then any other routine that changes it. */
export function routineGroups(part: PartSummary): RoutineGroup[] {
  const rows = changeRows(part.changes);
  const draws = writeRows(part.effects.filter((w) => w.target !== "state"));
  const sets = writeRows(part.reset);
  const roles = [
    ...part.routines.map((r) => r.role),
    ...[...rows, ...draws, ...sets].map((r) => r.routine).filter((r) => !part.routines.some((x) => x.role === r)),
  ];
  return [...new Set(roles)].map((role) => {
    const routine = part.routines.find((r) => r.role === role);
    const changes = rows.filter((r) => r.routine === role && !r.keeps);
    const own = <T extends { routine: string }>(list: T[]) => list.filter((r) => r.routine === role);
    const group = { changes, draws: own(draws), sets: own(sets) };
    return {
      role,
      at: routine?.at,
      address: routine?.address,
      confidence: routine?.confidence,
      empty: routine?.empty ?? false,
      ...group,
      kept: rows.filter((r) => r.routine === role && r.keeps).reduce((n, r) => n + r.paths.length, 0),
      open: [...group.changes, ...group.draws, ...group.sets].some((r) => r.confidence === "unresolved"),
    };
  });
}

/** The changes by the states they start from, any state first and changes of other parts' states last. */
export function stateGroups(part: PartSummary): { fromText: string; from: number[] | null; rows: ChangeRow[] }[] {
  const groups = new Map<string, { fromText: string; from: number[] | null; rows: ChangeRow[] }>();
  for (const row of changeRows(part.changes).filter((r) => !r.keeps)) {
    const group = groups.get(row.fromText) ?? { fromText: row.fromText, from: row.from, rows: [] };
    group.rows.push(row);
    groups.set(row.fromText, group);
  }
  const order = (from: number[] | null) => (from === null ? -1 : from.length ? from[0]! : Infinity);
  return [...groups.values()].sort((a, b) => order(a.from) - order(b.from));
}

/** Walks from the same trigger and start that follow the same path, as one row. */
export interface WalkRow {
  key: string;
  trigger: string;
  start: WalkStart;
  /** The path, with the conditions of its branches tidied. */
  path: WalkPath;
  confidence: Confidence;
  /** The terms every walk of the row needs, tidied. */
  shared: string[];
  /** What each walk adds to them, when there is more than one. */
  variants: string[][];
  /** The trigger and the walk in the analysis's own words, without repeats. */
  about: string[];
  descriptions: string[];
}

/** The order walks start in: from how the part was placed, after it is created, from rest, then while it runs. */
const STARTS: WalkStart[] = ["reset", "creation", "documented-rest", "run-guard"];

const tidyPath = (path: WalkPath): WalkPath => ({
  ...path,
  branches: path.branches.map((b) => ({ condition: tidyTerms(b.condition), path: tidyPath(b.path) })),
});

/** The walks of a part by trigger, `run` first, each with its rows in the order they start. */
export function walkGroups(walks: readonly Walk[]): { trigger: string; rows: WalkRow[] }[] {
  const rows = new Map<string, { walks: Walk[]; path: WalkPath }>();
  for (const w of walks) {
    const path = tidyPath(w);
    const { confidence, frames, end, loopFrom, cycle, reason, branches, settled, ways } = path;
    const shape = { confidence, frames, end, loopFrom, cycle, reason, branches, settled, ways };
    const key = `${w.trigger}|${w.start}|${JSON.stringify(shape)}`;
    const row = rows.get(key) ?? { walks: [], path: shape };
    row.walks.push(w);
    rows.set(key, row);
  }
  const groups = new Map<string, WalkRow[]>();
  for (const [key, { walks: list, path }] of rows) {
    const terms = list.map((w) => tidyTerms(w.condition));
    const shared = terms[0]!.filter((t) => terms.every((x) => x.includes(t)));
    const variants = list.length > 1 ? terms.map((x) => x.filter((t) => !shared.includes(t))) : [];
    const first = list[0]!;
    const row: WalkRow = {
      key,
      trigger: first.trigger,
      start: first.start,
      path,
      confidence: weakest(list.map((w) => w.confidence)),
      shared,
      // Walks that differ in nothing the tab shows are one case.
      variants: variants.some((v) => v.length) ? variants : [],
      about: [...new Set(list.map((w) => w.about))],
      descriptions: [...new Set(list.flatMap((w) => (w.description ? [w.description] : [])))],
    };
    groups.set(row.trigger, [...(groups.get(row.trigger) ?? []), row]);
  }
  return [...groups]
    .map(([trigger, list]) => ({
      trigger,
      rows: list.sort((a, b) => STARTS.indexOf(a.start) - STARTS.indexOf(b.start)),
    }))
    .sort((a, b) => Number(b.trigger === "run") - Number(a.trigger === "run"));
}

/** How a path ends, in a few words. */
export function endText(path: WalkPath): string {
  switch (path.end) {
    case "rest":
      return path.frames.length ? "rests" : "rests as it is";
    case "loop":
      return `loops to ${path.frames[path.loopFrom ?? 0] ?? "the start"}`;
    case "limit":
      return "goes on";
    case "hold":
      return "keeps its frame";
    case "cycle":
      return `cycles ${path.cycle?.period ?? ""} frames ${path.cycle?.direction === -1 ? "down" : "up"}`.replace(
        "  ",
        " ",
      );
    case "joins":
      return "continues like another way";
    case "branches": {
      const ways = path.ways ?? path.branches.length;
      if (ways === 1) return path.settled ? "1 way, it ends" : "1 way";
      return path.settled ? `${ways} ways, all end` : `${ways} ways`;
    }
    case "stop":
      return "stops";
  }
}

/** Where a walk starts, in a word. */
export const START_WORDS: Record<WalkStart, string> = {
  reset: "placed",
  creation: "created",
  "documented-rest": "at rest",
  "run-guard": "running",
};

/** How the reset leaves a part's frame, in a few words, when it isn't one frame. */
export const RESET_WORDS: Record<"saved" | "sockets" | "unresolved", string> = {
  saved: "keeps the saved frame",
  sockets: "from its plugs",
  unresolved: "unresolved",
};

/** Why a part rests on a frame, in a few words: how many walks end there, or a run that keeps it. */
export const restingWords = (frame: { walks?: number }) =>
  frame.walks ? `${frame.walks} ${frame.walks === 1 ? "walk ends" : "walks end"} here` : "a run keeps it";

/** A trigger with more walk rows than this folds them by where they start. */
export const FOLD_ROWS = 12;

/**
 * The rows of a trigger by where they start: how the part was, then the frame it starts on, like "running from 3".
 * Placed and created first, then rows without a first frame, then by frame.
 */
export function startGroups(
  rows: readonly WalkRow[],
): { key: string; label: string; first?: number; rows: WalkRow[] }[] {
  const groups = new Map<string, { key: string; label: string; first?: number; start: WalkStart; rows: WalkRow[] }>();
  for (const row of rows) {
    const first = row.path.frames[0];
    const key = `${row.start} ${first ?? ""}`;
    const group = groups.get(key) ?? {
      key,
      label: `${START_WORDS[row.start]}${first === undefined ? "" : ` from ${first}`}`,
      first,
      start: row.start,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => STARTS.indexOf(a.start) - STARTS.indexOf(b.start) || (a.first ?? -1) - (b.first ?? -1))
    .map(({ key, label, first, rows: list }) => ({ key, label, first, rows: list }));
}
