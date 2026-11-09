import { describe, expect, it } from "vitest";
import { describeGoal, type GoalNames } from "../src/read/describe-goals.ts";
import { findGoalTable, findStepCounts, readGoalRoutines, runGoal, UnsetValue } from "../src/read/puzzle-goals.ts";

// Even More, English floppy. The dispatcher at 0x14ae calls the goal the puzzle number in [0x4ac1] picks from the far
// pointers at 0x201a.
const DISPATCHER_EVEN_MORE = "558bec8b1ec14ad1e3d1e3ff9f1a205dcb";
// TIM 1, French, at 0x1496: the same with `mov cl, 2; shl bx, cl` and the table at 0x27c0.
const DISPATCHER_TIM = "558bec8b1e3d50b102d3e3ff9fc0275dcb";
// Even More, English CD, at 0x9e05: the table in a segment of its own, 0x3180, loaded into es (puzzle 1 at 0x3180:0).
const DISPATCHER_CD = "558bec8b1ea74ad1e3d1e3b880318ec026ff9ffcff5dcb";
const EMPTY_ROUTINE = "558bec5dcb";

// Puzzle 2's goal (0x14bf): met when every bowling ball (type 0) on the moving list [0x4d7d] is at positionY 264 and
// was there the step before too (previousY at 0x24).
const EVERY_BALL_AT_REST =
  "558bec56ba01008b367d4deb19837c04007511817c20080175088b44203b4424740233d28b340bf675e30bd27406c7066d4a00025e5dcb";
// Puzzle 78's goal (0x159b): walks the fixed list and then the moving list with the list head and next routines, and
// fails on a cat (12) that isn't right of where it started or isn't on frame 0, a fish bowl (15) on frame 11 or more, a
// birdcage (11) that hasn't risen 8 above where it started, and a mouse motor (6) with 0x8000 in its flags that has
// never turned (it remembers turns in the words from 0x5068).
const FIRST_FIXED_THEN_MOVING =
  "558bec83ec025657c746fe0000bf0100b8003050900ee87b5259eb78837c040c75118b441e3b848c007e06837c0c00740233ff837c040f7508837c0c0b7c0233ff837c040b750e8b44200508003b848e007c0233ff837c0406752df7440600807426837c120075128b5efed1e383bf685000751133ffeb0deb0b8b5efed1e3c78768500100ff46feb800105056900ee8425259598bf00bf675820bff7406c7066d4a00025f5e8be55dcb";
// The list head (0x682f) and list next (0x686f) routines.
const LIST_ROUTINES =
  "558bec8b5606833e1f4e00740bf7c200207405a11f4eeb26833e7d4d00740bf7c200107405a17d4deb14833edb4c00740bf7c200087405a1db4ceb0233c05dcb558bec56578b76068b7e08833c0074048b04eb23f7440600207408570ee8a0ff59eb14f744060010740bf7c700087405a1db4ceb0233c05f5e5dcb";

const MODE = 0x4a6d;
const MOVING = 0x4d7d;
const FIXED = 0x4e1f;

function image(size: number, pieces: [number, string][]) {
  const bytes = new Uint8Array(size);
  for (const [at, code] of pieces) bytes.set(Buffer.from(code, "hex"), at);
  return bytes;
}

const put = (bytes: Uint8Array, at: number, value: number) => {
  bytes[at] = value & 0xff;
  bytes[at + 1] = value >> 8;
};

/** A data segment of words, with parts laid out at 0x8000 on the lists given, each part's fields by offset. */
function world(lists: Record<number, Record<number, number>[]>, words: Record<number, number> = {}) {
  const memory = new Map<number, number>(Object.entries(words).map(([a, v]) => [Number(a), v]));
  let at = 0x8000;
  for (const [head, parts] of Object.entries(lists)) {
    const places = parts.map(() => (at += 0xa0));
    memory.set(Number(head), places[0] ?? 0);
    parts.forEach((fields, k) => {
      for (const [offset, value] of Object.entries(fields)) memory.set(places[k]! + Number(offset), value);
      memory.set(places[k]!, places[k + 1] ?? 0);
    });
  }
  return {
    memory,
    read: (address: number) => memory.get(address) ?? 0,
    write: (address: number, value: number) => void memory.set(address, value),
  };
}

describe("findGoalTable", () => {
  it("finds the dispatcher, the puzzle word and the goal routines in the data segment", () => {
    const bytes = image(0x3100, [
      [0x10, DISPATCHER_EVEN_MORE],
      [0x40, EMPTY_ROUTINE],
      [0x50, EMPTY_ROUTINE],
    ]);
    // Data segment 0x100: the table at 0x201a, puzzles 1 and 2, then an entry that isn't a routine.
    put(bytes, 0x1000 + 0x201a + 4, 0x40);
    put(bytes, 0x1000 + 0x201a + 8, 0x50);
    expect(findGoalTable(bytes, 0x100)).toEqual({
      dispatcher: 0x10,
      puzzleWord: 0x4ac1,
      table: 0x1000 + 0x201a,
      routines: [
        { puzzle: 1, segment: 0, offset: 0x40, address: 0x40 },
        { puzzle: 2, segment: 0, offset: 0x50, address: 0x50 },
      ],
    });
  });

  it("reads TIM 1's shift by cl", () => {
    const bytes = image(0x3800, [
      [0x10, DISPATCHER_TIM],
      [0x40, EMPTY_ROUTINE],
    ]);
    put(bytes, 0x1000 + 0x27c0 + 4, 0x40);
    expect(findGoalTable(bytes, 0x100)?.routines.map((r) => r.puzzle)).toEqual([1]);
  });

  it("reads the CD's table in a segment it loads into es, with the routines' own segments", () => {
    const bytes = image(0x31810, [
      [0x10, DISPATCHER_CD],
      [0x2040, EMPTY_ROUTINE],
    ]);
    put(bytes, 0x31800, 0x40);
    put(bytes, 0x31802, 0x200);
    expect(findGoalTable(bytes, 0x3200)).toMatchObject({
      puzzleWord: 0x4aa7,
      table: 0x31800 - 4,
      routines: [{ puzzle: 1, segment: 0x200, offset: 0x40, address: 0x2040 }],
    });
  });
});

describe("findStepCounts", () => {
  it("finds the run loop by its call of the dispatcher, and the words it and its callees add 1 to", () => {
    // The run loop at 0x40: inc word [0x4aab]; push cs; call 0x60; push cs; call the dispatcher at 0x10.
    // The routine at 0x60: inc word [0x4a8b].
    const bytes = image(0x1100, [
      [0x10, DISPATCHER_EVEN_MORE],
      [0x40, "558becff06ab4a0ee815000ee8c1ff5dcb"],
      [0x60, "558becff068b4a5dcb"],
    ]);
    const table = { dispatcher: 0x10, puzzleWord: 0x4ac1, table: 0x301a, routines: [] };
    expect(findStepCounts(bytes, 0x100, table)).toEqual({
      runLoop: 0x40,
      own: [0x4aab],
      called: [{ routine: 0x60, words: [0x4a8b] }],
    });
  });
});

describe("readGoalRoutines and runGoal", () => {
  const ballGoal = () => {
    const routines = readGoalRoutines(image(0x1500, [[0x14bf, EVERY_BALL_AT_REST]]), 0, 0x14bf);
    return (lists: Record<number, Record<number, number>[]>) => {
      const w = world(lists, { [MODE]: 0x2000 });
      runGoal(routines, 0x14bf, w);
      return w.memory.get(MODE) === 0x200;
    };
  };

  it("reads a loop over the moving list into a goal that holds when every bowling ball is at rest at y 264", () => {
    const met = ballGoal();
    const ball = (y: number, previousY: number) => ({ 4: 0, 0x20: y, 0x24: previousY });
    expect(met({ [MOVING]: [ball(264, 264), { 4: 9, 0x20: 10 }, ball(264, 264)] })).toBe(true);
    expect(met({ [MOVING]: [ball(264, 264), ball(264, 250)] })).toBe(false);
    expect(met({ [MOVING]: [ball(263, 263)] })).toBe(false);
    // With no bowling ball at all, nothing fails.
    expect(met({ [MOVING]: [{ 4: 9 }] })).toBe(true);
  });

  it("reads the routines a goal calls, with the arguments it pushes, and the words it remembers", () => {
    const bytes = image(0x6900, [
      [0x159b, FIRST_FIXED_THEN_MOVING],
      [0x682f, LIST_ROUTINES],
    ]);
    const routines = readGoalRoutines(bytes, 0, 0x159b);
    expect([...routines.keys()].sort((a, b) => a - b)).toEqual([0x159b, 0x682f, 0x686f]);
    expect([...routines.values()].every((r) => "body" in r)).toBe(true);
    const met = (lists: Record<number, Record<number, number>[]>, words: Record<number, number> = {}) => {
      const w = world(lists, { [MODE]: 0x2000, ...words });
      runGoal(routines, 0x159b, w);
      return { met: w.memory.get(MODE) === 0x200, memory: w.memory };
    };
    const cat = (x: number, state: number) => ({ 4: 12, 6: 0x1000, 0x1e: x, 0x8c: 100, 0x0c: state });
    const fishBowl = (state: number) => ({ 4: 15, 6: 0x2000, 0x0c: state });
    expect(met({ [FIXED]: [fishBowl(3)], [MOVING]: [cat(200, 0)] }).met).toBe(true);
    expect(met({ [FIXED]: [fishBowl(3)], [MOVING]: [cat(200, 1)] }).met).toBe(false);
    expect(met({ [FIXED]: [fishBowl(3)], [MOVING]: [cat(100, 0)] }).met).toBe(false);
    // The fixed list is walked too.
    expect(met({ [FIXED]: [fishBowl(11)], [MOVING]: [cat(200, 0)] }).met).toBe(false);
    // A mouse motor that turns this step is remembered in the word for its place among them.
    const motor = (turning: number) => ({ 4: 6, 6: 0x9000, 0x12: turning });
    const turned = met({ [MOVING]: [motor(0), motor(1)] }, { 0x5068: 1, 0x506a: 0 });
    expect(turned.met).toBe(true);
    expect(turned.memory.get(0x506a)).toBe(1);
    expect(met({ [MOVING]: [motor(0)] }, { 0x5068: 0 }).met).toBe(false);
  });

  it("says when a goal reads a local it never set", () => {
    // push bp; mov bp, sp; mov ax, [bp-2]; mov [0x100], ax; pop bp; retf
    const routines = readGoalRoutines(image(0x20, [[0, "558bec8b46fea300015dcb"]]), 0, 0);
    expect(() => runGoal(routines, 0, world({}))).toThrow(UnsetValue);
  });

  it("names a routine it can't read and why", () => {
    // push bp; mov bp, sp; call far [bx]; pop bp; retf
    const routines = readGoalRoutines(image(0x20, [[0, "558becff1f5dcb"]]), 0, 0);
    expect(routines.get(0)).toMatchObject({ address: 0, at: 3, reason: expect.stringContaining("indirect call") });
  });
});

describe("describeGoal", () => {
  const names: GoalNames = {
    fields: new Map([
      [0x04, "type"],
      [0x06, "listFlags"],
      [0x0c, "state"],
      [0x12, "stateDelta"],
      [0x1e, "positionX"],
      [0x20, "positionY"],
      [0x24, "previousY"],
      [0x8c, "savedPositionX"],
      [0x8e, "savedPositionY"],
    ]),
    types: new Map([
      [0, "bowling-ball"],
      [6, "mouse-motor"],
      [11, "birdcage"],
      [12, "cat"],
      [15, "fish-bowl"],
    ]),
    lists: [
      { head: FIXED, bit: 0x2000, name: "the fixed list" },
      { head: MOVING, bit: 0x1000, name: "the moving list" },
      { head: 0x4cdb, bit: 0x0800, name: "the third list" },
    ],
    listHead: 0x682f,
    listNext: 0x686f,
    words: new Map([[MODE, "the game mode"]]),
    mode: { word: MODE, met: 0x200 },
  };

  it("says a walk over the moving list with the parts' fields and types by name", () => {
    const routines = readGoalRoutines(image(0x1500, [[0x14bf, EVERY_BALL_AT_REST]]), 0, 0x14bf);
    expect(describeGoal(routines, 0x14bf, names)).toEqual([
      "dx = 1",
      "for each part on the moving list:",
      "  if part.type is bowling-ball:",
      "    if part.positionY ≠ 264:",
      "      dx = 0",
      "    else:",
      "      ax = part.positionY",
      "      if ax ≠ part.previousY:",
      "        dx = 0",
      "if dx ≠ 0:",
      "  the goal is met",
    ]);
  });

  it("says a walk through the list routines by the lists their masks pick", () => {
    const bytes = image(0x6900, [
      [0x159b, FIRST_FIXED_THEN_MOVING],
      [0x682f, LIST_ROUTINES],
    ]);
    const lines = describeGoal(readGoalRoutines(bytes, 0, 0x159b), 0x159b, names);
    expect(lines.slice(0, 4)).toEqual([
      "local 2 = 0",
      "di = 1",
      "for each part on the fixed list, then the moving list:",
      "  if part.type is cat:",
    ]);
    expect(lines).toContain("        if word 0x5068[bx] = 0:");
    expect(lines.slice(-2)).toEqual(["if di ≠ 0:", "  the goal is met"]);
    expect(lines.join("\n")).not.toContain("0x682f");
  });
});
