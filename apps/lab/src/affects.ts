/**
 * Who affects whom: every pair of parts where one changes the other, from what the walks say other parts do to each
 * part (the Behaviour tab's "From other parts") and the parts a part makes. A pair keeps its effects, so a page can
 * show each way the same as the Behaviour tab does.
 */
import type { Doing, OtherEffect } from "./behaviour.ts";

/** What one part does to another, in the few kinds the page colours. */
export type AffectKind = "remove" | "mark" | "push" | "make" | "touch" | "change";

/** The kinds, from the one that says most about the pair to the least; a square shows the first it has. */
export const AFFECT_KINDS: readonly AffectKind[] = ["remove", "mark", "push", "make", "touch", "change"];

export const AFFECT_LABELS: Record<AffectKind, string> = {
  remove: "Takes out of play",
  mark: "Sets a goal mark",
  push: "Pushes or moves",
  make: "Makes",
  touch: "Marks a contact",
  change: "Changes another field",
};

/** The colour of each kind, from the lab's own state colours. */
export const AFFECT_COLOURS: Record<AffectKind, string> = {
  remove: "var(--color-error)",
  mark: "var(--color-hypothesis)",
  push: "var(--color-accent)",
  make: "var(--color-decoded)",
  touch: "var(--color-partial)",
  change: "var(--color-soft)",
};

/** How the part reaches the other: by touching it, by reaching it (a fan's wind, a vacuum's pull), or both. */
export type AffectHow = "touch" | "reach" | "both";

export interface AffectPair {
  source: number;
  target: number;
  kinds: AffectKind[];
  how: AffectHow;
  /** What the source does to the target, one entry for each row of the target's "From other parts". */
  effects: OtherEffect[];
  /** The ways the source makes the target, for a part it creates. */
  made: Doing[];
}

/** The fields that move a part: its velocity, the fine position, or a speed in a direction. */
const MOVES = /^(velocity[XY]?|speed( away)?|fine [XY].*|position[XY]|)$/;

/** The kind of one setting of an effect. */
export function kindOf(set: OtherEffect["sets"][number]): AffectKind {
  if (set.what === "out-of-play flag" && set.value === "set") return "remove";
  if (set.what.startsWith("goal mark")) return "mark";
  if (set.what === "contact flag" || set.what === "contactPart") return "touch";
  if (MOVES.test(set.what)) return "push";
  return "change";
}

/** The part type a "Creates …" sentence names, like "Creates a cannonball (type 43, …)". */
const madeType = (d: Doing) => {
  const m = /^Creates an? .+? \(type (\d+)/.exec(d.description);
  return m ? Number(m[1]) : undefined;
};

/** Every pair of a source and a target, by `source:target`, from the walks' effects and doings. */
export function affectPairs(
  effects: Readonly<Record<number, readonly OtherEffect[]>>,
  doings: Readonly<Record<number, readonly Doing[]>> = {},
): AffectPair[] {
  const pairs = new Map<string, AffectPair & { touches: boolean; reaches: boolean }>();
  const pairOf = (source: number, target: number) => {
    const key = `${source}:${target}`;
    let p = pairs.get(key);
    if (!p) {
      p = { source, target, kinds: [], how: "reach", effects: [], made: [], touches: false, reaches: false };
      pairs.set(key, p);
    }
    return p;
  };
  for (const [target, list] of Object.entries(effects))
    for (const e of list) {
      const p = pairOf(e.sourceType, Number(target));
      p.effects.push(e);
      if (e.touch) p.touches = true;
      else p.reaches = true;
      for (const s of e.sets) {
        const k = kindOf(s);
        if (!p.kinds.includes(k)) p.kinds.push(k);
      }
    }
  for (const [source, list] of Object.entries(doings))
    for (const d of list) {
      const target = d.on === "created" ? madeType(d) : undefined;
      if (target === undefined) continue;
      const p = pairOf(Number(source), target);
      p.made.push(d);
      p.reaches = true;
      if (!p.kinds.includes("make")) p.kinds.push("make");
    }
  return [...pairs.values()].map(({ touches, reaches, ...p }) => ({
    ...p,
    kinds: AFFECT_KINDS.filter((k) => p.kinds.includes(k)),
    how: touches && reaches ? "both" : touches ? "touch" : "reach",
  }));
}
