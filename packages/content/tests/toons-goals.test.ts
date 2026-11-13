import { describe, expect, it } from "vitest";
import { describeGoal, type GoalNames } from "../src/read/describe-goals.ts";
import { conditionText, summariseGoal } from "../src/read/goal-conditions.ts";
import {
  FAR_WORDS,
  readGoalRoutines,
  runGoal,
  type GoalRoutine,
  type GoalStatement,
  type GoalTest,
  type GoalValue,
} from "../src/read/puzzle-goals.ts";
import type { ToonsMemory } from "../src/read/toons-drawing.ts";
import { findToonsGoalTable } from "../src/read/toons-goals.ts";

const hex = (text: string) => Uint8Array.from(text.match(/../g)!.map((b) => parseInt(b, 16)));
function image(size: number, pieces: [number, string][]) {
  const bytes = new Uint8Array(size);
  for (const [at, code] of pieces) bytes.set(hex(code), at);
  return bytes;
}
const names: GoalNames = {
  fields: new Map([
    [0x04, "type"],
    [0x0e, "state"],
  ]),
  types: new Map([[36, "al-e-cat"]]),
  lists: [],
  words: new Map([[0x470d, "the goal's countdown"]]),
  mode: { word: 0x470d },
  finder: 0x262d,
};

describe("readGoalRoutines for Toons", () => {
  it("reads a word of a far segment the routine loads into es, and doesn't say the segment's load", () => {
    // mov ax, 5; mov dx, 0x340f; mov es, dx; mov es:[0x7514], ax
    const routines = readGoalRoutines(image(0x20, [[0, "558becb80500ba0f348ec226a314755dcb"]]), 0, 0, new Map(), {
      farWords: true,
    });
    expect((routines.get(0) as GoalRoutine).body).toEqual([
      { kind: "set", target: { kind: "register", name: "ax" }, value: { kind: "constant", value: 5 } },
      {
        kind: "set",
        target: { kind: "word", address: { kind: "constant", value: FAR_WORDS + 0x340f * 0x10000 + 0x7514 } },
        value: { kind: "register", name: "ax" },
      },
    ]);
    expect(readGoalRoutines(image(0x20, [[0, "558becb80500ba0f348ec226a314755dcb"]]), 0, 0).get(0)).toMatchObject({
      reason: "the register es",
    });
  });

  it("reads a loop whose test leaves early, as `while (di < n && si)` is compiled", () => {
    // xor di, di; mov si, [bp+6]; jmp test; body: mov si, [si]; inc di; test: cmp di, [bp+8]; jge out; or si, si;
    // jne body; out: mov ax, di
    const code = "558bec33ff8b7606eb038b34473b7e087d040bf675f48bc75dcb";
    expect(describeGoal(readGoalRoutines(image(0x40, [[0, code]]), 0, 0), 0, names)).toEqual([
      "di = 0",
      "si = argument 1",
      "repeat:",
      "  if di ≥ argument 2:",
      "    stop the loop",
      "  stop repeating unless si ≠ 0",
      "  si = si.next",
      "  di += 1",
      "ax = di",
    ]);
  });
});

describe("readGoalRoutines for Toons' byte counters, long loops and sums", () => {
  /** Runs a read routine over a memory of words, from words given, and gives the words it leaves. */
  const run = (code: string, words: Record<number, number> = {}) => {
    const routines = readGoalRoutines(image(0x40, [[0, code]]), 0, 0);
    expect(routines.get(0)).toHaveProperty("body");
    const memory = new Map(Object.entries(words).map(([a, v]) => [Number(a), v]));
    runGoal(routines, 0, { read: (a) => memory.get(a) ?? 0, write: (a, v) => memory.set(a, v) });
    return memory;
  };

  it("reads a byte local counted up to a number, and a byte loaded into al with ah cleared", () => {
    // sub sp, 2; mov byte [bp-1], 0; jmp test; body: mov al, [bp-1]; mov ah, 0; mov [0x10], ax; inc byte [bp-1];
    // test: cmp byte [bp-1], 3; jb body; mov sp, bp
    const code = "558bec83ec02c646ff00eb0b8a46ffb400a31000fe46ff807eff0372ef8be55dcb";
    expect(run(code).get(0x10)).toBe(2);
  });

  it("reads a loop whose test leaves it, with a jump back to a body too far for a short branch", () => {
    // xor si, si; jmp test; body: inc si; test: cmp si, 3; jge out; jmp body; out: mov [0x10], si
    expect(run("558bec33f6eb014683fe037d03e9f7ff893610005dcb").get(0x10)).toBe(3);
  });

  it("reads an ordered branch on a sum as the sum without overflow, as the processor's flags say it", () => {
    // mov ax, [0x10]; add ax, [0x12]; jge skip; mov word [0x14], 1; skip:
    const code = "558beca1100003061200" + "7d06c70614000100" + "5dcb";
    const sumBelowZero = (a: number, b: number) => run(code, { 0x10: a & 0xffff, 0x12: b & 0xffff }).get(0x14) === 1;
    expect(sumBelowZero(0x7fff, 1)).toBe(false);
    expect(sumBelowZero(-1, -0x8000)).toBe(true);
    expect(sumBelowZero(0, -0x8000)).toBe(true);
    expect(sumBelowZero(5, -3)).toBe(false);
    expect(sumBelowZero(-5, 3)).toBe(true);
  });
});

describe("runGoal for Toons", () => {
  const c = (value: number) => ({ kind: "constant", value }) as const;
  const far = (offset: number) => FAR_WORDS + 0x340f * 0x10000 + offset;

  it("keeps a far segment's words apart from the data segment's, also at a place worked out from a counter", () => {
    const si = { kind: "register", name: "si" } as const;
    const body: GoalStatement[] = [
      { kind: "set", target: si, value: c(4) },
      { kind: "set", target: { kind: "word", address: c(far(0x7514)) }, value: c(5) },
      {
        kind: "set",
        target: { kind: "word", address: { kind: "binary", op: "+", left: si, right: c(far(0x7584)) } },
        value: c(6),
      },
    ];
    const written = new Map<number, number>();
    runGoal(new Map([[0, { address: 0, segment: 0, offset: 0, body }]]), 0, {
      read: () => 0,
      write: (a, v) => written.set(a, v),
    });
    expect(written).toEqual(
      new Map([
        [far(0x7514), 5],
        [far(0x7588), 6],
      ]),
    );
  });

  it("leaves a loop on a break in its test's part, as `while (a && b)` does", () => {
    // xor di, di; mov si, [bp+6]; jmp test; body: mov si, [si]; inc di; test: cmp di, [bp+8]; jge out; or si, si;
    // jne body; out: mov ax, di, then store ax at 0x10
    const code = "558bec33ff8b7606eb038b34473b7e087d040bf675f48bc7a310005dcb";
    const routines = readGoalRoutines(image(0x40, [[0, code]]), 0, 0);
    const body: GoalStatement[] = [
      { kind: "set", target: { kind: "local", offset: -2 }, value: c(3) },
      { kind: "set", target: { kind: "local", offset: -4 }, value: c(0x100) },
      { kind: "call", routine: 0, segment: 0, offset: 0, stack: -4 },
    ];
    routines.set(0x100, { address: 0x100, segment: 0, offset: 0x100, body });
    const memory = new Map([
      [0x100, 0x200],
      [0x200, 0x300],
      [0x300, 0x400],
      [0x400, 0],
    ]);
    runGoal(routines, 0x100, { read: (a) => memory.get(a) ?? 0, write: (a, v) => memory.set(a, v) });
    // Three steps along the list, stopped by the count before the list's end.
    expect(memory.get(0x10)).toBe(3);
  });
});

describe("describeGoal for Toons", () => {
  it("says a call to the finder as the part it finds, and a write of the countdown as the goal met", () => {
    const ax = { kind: "register", name: "ax" } as const;
    const constant = (value: number) => ({ kind: "constant", value }) as const;
    const far = { kind: "word", address: constant(FAR_WORDS + 0x340f * 0x10000 + 0x7514) } as const;
    const body: GoalStatement[] = [
      { kind: "set", target: ax, value: constant(0x1000) },
      { kind: "set", target: { kind: "local", offset: -2 }, value: ax },
      { kind: "set", target: ax, value: constant(1) },
      { kind: "set", target: { kind: "local", offset: -4 }, value: ax },
      { kind: "set", target: ax, value: constant(36) },
      { kind: "set", target: { kind: "local", offset: -6 }, value: ax },
      { kind: "call", routine: 0x262d, segment: 0, offset: 0x262d, stack: -6 },
      { kind: "set", target: far, value: ax },
      { kind: "set", target: { kind: "word", address: constant(0x470d) }, value: constant(10) },
    ];
    const routines = new Map([[0, { address: 0, segment: 0, offset: 0, body }]]);
    expect(describeGoal(routines, 0, names)).toEqual([
      "word 0x340f:7514 = the 1st al-e-cat on the moving list, or 0 if there is none",
      "the goal is met, and the run ends 10 steps later",
    ]);
  });
});

describe("findToonsGoalTable", () => {
  it("finds the dispatcher, a routine per puzzle named by its level, and the run loop's words", () => {
    const memory = image(0x2000, [
      // The dispatcher: mov al, [0x48c]; mov ah, 0; shl ax, 1 (twice); mov bx, ax; mov ax, [bx+0xaa]; or ax, [bx+0xac]
      [0x100, "558beca08c04b400d1e0d1e08bd88b87aa000b87ac00"],
      // The goal table in the data segment (0x100): two routines at 0x30:0 and 0x30:5.
      [0x10aa, "00003000050030000000"],
      [0x300, "558bec5dcb558bec5dcb"],
      // The file name: the sets' first puzzles at 0x82, their names' pointers at 0x87.
      [0x200, "8a848300b4003b46fe7ef48a848200b4008b56fe2bd04252ffb78700"],
      [0x1082, "00010200008b00950043414b4500"],
      [0x1095, "4252414e00"],
      // The run loop: cmp word [0x70d], 0; jge; nop; push cs; call the dispatcher; cmp; jne; mov word [0x6db], 0x200
      [0x400, "833e0d07007d05900ee8f4fc833e0d07007508c706db060002"],
      [0x430, "ff060f07"],
    ]);
    const toons: ToonsMemory = {
      memory,
      dataSegment: 0x100,
      codeSegments: [0],
      resolve: (segment, offset) => ({ segment, offset }),
      fileOffset: (address) => address + 0x200,
    };
    expect(findToonsGoalTable(toons)).toEqual({
      dispatcher: 0x300,
      table: 0x12aa,
      routines: [
        { puzzle: 0, name: "CAKE1", segment: 0x30, offset: 0, address: 0x300 },
        { puzzle: 1, name: "BRAN1", segment: 0x30, offset: 5, address: 0x305 },
      ],
      words: { countdown: 0x70d, mode: 0x6db, steps: 0x70f },
    });
  });
});

describe("summariseGoal for Toons", () => {
  const STEPS = 0x470f;
  const COUNTDOWN = 0x470d;
  const FINDER = 0x262d;
  const KEPT = FAR_WORDS + 0x340f * 0x10000;
  const c = (value: number): GoalValue => ({ kind: "constant", value });
  const r = (name: string): GoalValue => ({ kind: "register", name });
  const word = (address: GoalValue | number): Extract<GoalValue, { kind: "word" }> => ({
    kind: "word",
    address: typeof address === "number" ? c(address) : address,
  });
  const plus = (left: GoalValue, right: GoalValue): GoalValue => ({ kind: "binary", op: "+", left, right });
  const field = (part: GoalValue, offset: number) => word(plus(part, c(offset)));
  const set = (target: GoalValue, value: GoalValue): GoalStatement => ({ kind: "set", target, value }) as GoalStatement;
  const test = (left: GoalValue, op: GoalTest["op"], right: GoalValue): GoalTest => ({ op, signed: true, left, right });
  const when = (t: GoalTest, then: GoalStatement[], otherwise: GoalStatement[] = []): GoalStatement => ({
    kind: "if",
    test: t,
    then,
    else: otherwise,
  });
  /** The finder's call as TOONS.EXE makes it: the mask, n and the type pushed, and the part stored. */
  const find = (type: number, nth: GoalValue, mask: number, into: GoalValue): GoalStatement[] => [
    set({ kind: "local", offset: -2 }, c(mask)),
    set({ kind: "local", offset: -4 }, nth),
    set({ kind: "local", offset: -6 }, c(type)),
    { kind: "call", routine: FINDER, segment: 0, offset: FINDER, stack: -6 },
    set(into, r("ax")),
  ];
  const met = set(word(COUNTDOWN), c(10));
  const toons: GoalNames = {
    fields: new Map([
      [0x04, "type"],
      [0x08, "drawingFlags"],
      [0x0c, "action"],
      [0x0e, "state"],
      [0x1f, "positionX"],
    ]),
    types: new Map([
      [36, "al-e-cat"],
      [23, "balloon"],
    ]),
    lists: [],
    words: new Map([
      [COUNTDOWN, "the goal's countdown"],
      [STEPS, "the step count"],
    ]),
    mode: { word: COUNTDOWN },
    finder: FINDER,
    partSize: 0xb3,
    firstStep: STEPS,
    countedLoops: true,
    valueName: (type, offset, value, part) =>
      type === 36 && offset === 0x0c && value === 50
        ? "CATFISH"
        : type === 36 && offset === 0x0e && part.get(0x0c) === 50
          ? `CATFISH frame ${value - 401} of 16`
          : undefined,
  };
  const summary = (body: GoalStatement[]) =>
    summariseGoal(new Map([[0, { address: 0, segment: 0, offset: 0, body }]]), 0, toons);
  const al = word(KEPT + 0x7470);

  it("reads a word set to the part the finder found in the first step as that part in every step", () => {
    const s = summary([
      when(test(word(STEPS), "==", c(0)), find(36, c(1), 0x1000, al)),
      set(r("bx"), al),
      when(test(field(r("bx"), 0x0c), "==", c(50)), [
        set(r("bx"), al),
        when(test(field(r("bx"), 0x0e), "==", c(417)), [met]),
      ]),
    ]);
    expect(s.problem).toBeUndefined();
    expect(s.ways.map((w) => w.map(conditionText))).toEqual([
      ["the 1st al-e-cat on the moving list: action = 50 (CATFISH), state = 417 (CATFISH frame 16 of 16)"],
    ]);
    expect(s.remembered).toEqual([]);
  });

  it("reads a word set to 0 in the first step and to 1 when a test holds as the test held at some step so far", () => {
    const flag = word(0x4c78);
    const s = summary([
      when(test(word(STEPS), "==", c(0)), [...find(36, c(1), 0x1000, al), set(flag, c(0))]),
      set(r("bx"), al),
      when(test(field(r("bx"), 0x0c), "==", c(50)), [set(flag, c(1))]),
      when(test(flag, "!=", c(0)), [met]),
    ]);
    expect(s.ways.map((w) => w.map(conditionText))).toEqual([
      ["at some step so far, the 1st al-e-cat on the moving list: action = 50 (CATFISH)"],
    ]);
    expect(s.ways[0]![0]!.once).toBe("so far");
  });

  it("doesn't read a word the goal counts with from step to step", () => {
    const count = word(0x4c7a);
    const s = summary([
      when(test(word(STEPS), "==", c(0)), [...find(36, c(1), 0x1000, al), set(count, c(0))]),
      set(r("bx"), al),
      when(test(field(r("bx"), 0x0c), "==", c(50)), [set(count, plus(count, c(1)))]),
      when(test(count, "==", c(2)), [met]),
    ]);
    expect(s.problem).toMatch(/keeps a word from step to step/);
  });

  // si = 0; while si < 3: bx = si << 1; bx = word 0x340f:7584[bx]; if <test of bx>: di += 1; si += 1
  const overParts = (pick: (bx: GoalValue) => GoalStatement[]): GoalStatement[] => {
    const slot = plus({ kind: "binary", op: "<<", left: r("si"), right: c(1) }, c(KEPT + 0x7584));
    return [
      when(test(word(STEPS), "==", c(0)), [
        set(r("si"), c(0)),
        {
          kind: "loop",
          before: [],
          test: test(r("si"), "<", c(3)),
          body: [...find(23, plus(r("si"), c(1)), 0x1000, word(slot)), set(r("si"), plus(r("si"), c(1)))],
        },
      ]),
      set(r("di"), c(0)),
      set(r("si"), c(0)),
      {
        kind: "loop",
        before: [],
        test: test(r("si"), "<", c(3)),
        body: [set(r("bx"), word(slot)), ...pick(r("bx")), set(r("si"), plus(r("si"), c(1)))],
      },
      when(test(r("di"), "==", c(3)), [met]),
    ];
  };

  it("runs a loop with a counter round by round, a condition for each part it found", () => {
    const flags = { kind: "binary", op: "&", left: field(r("bx"), 0x08), right: c(0x2000) } as const;
    const s = summary(overParts(() => [when(test(flags, "!=", c(0)), [set(r("di"), plus(r("di"), c(1)))])]));
    expect(s.ways.map((w) => w.map(conditionText))).toEqual([
      [1, 2, 3].map(
        (n) =>
          `the ${n === 1 ? "1st" : n === 2 ? "2nd" : "3rd"} balloon on the moving list: drawingFlags has the bits 0x2000`,
      ),
    ]);
  });

  it("says parts that each pass one of several tests as one condition each, with the tests as alternatives", () => {
    const inc = set(r("di"), plus(r("di"), c(1)));
    const s = summary(
      overParts((bx) => [
        when(test(field(bx, 0x1f), "<", c(0)), [inc], [when(test(field(bx, 0x1f), ">", c(640)), [inc])]),
      ]),
    );
    expect(s.problem).toBeUndefined();
    expect(s.ways).toHaveLength(1);
    expect(s.ways[0]!.map(conditionText)).toEqual(
      ["1st", "2nd", "3rd"].map((n) => `the ${n} balloon on the moving list: one of: positionX < 0 or positionX > 640`),
    );
  });
});
