import { describe, expect, it } from "vitest";
import { describeGoal, type GoalNames } from "../src/read/describe-goals.ts";
import { conditionText, summariseGoal, type GoalCondition } from "../src/read/goal-conditions.ts";
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
import type { Level } from "../src/read/level.ts";
import {
  findToonsGoalTable,
  readToonsBinKinds,
  toonsGoalParts,
  toonsListOrder,
  toonsPuzzleStart,
  toonsRopePlaces,
} from "../src/read/toons-goals.ts";

/** No sort words for the bin: a type keeps its number. */
const none = new Map<number, number>();

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

  it("says the segment's load when the routine reads the register again", () => {
    // mov bx, 0x340f; mov es, bx; mov ax, es:[0x7514]; mov [0x10], bx
    const code = "558becbb0f348ec326a11475891e10005dcb";
    const routines = readGoalRoutines(image(0x20, [[0, code]]), 0, 0, new Map(), { farWords: true });
    const memory = new Map<number, number>();
    runGoal(routines, 0, { read: (a) => memory.get(a) ?? 0, write: (a, v) => void memory.set(a, v) });
    expect(memory.get(0x10)).toBe(0x340f);
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

  it("doesn't read byte sums and shifts, or a signed branch after a byte, which words would get wrong", () => {
    const reason = (code: string) => {
      const routine = readGoalRoutines(image(0x40, [[0, `558bec83ec02${code}8be55dcb`]]), 0, 0).get(0);
      return routine && "reason" in routine ? routine.reason : undefined;
    };
    // mov byte [bp-1], 0xff; add byte [bp-1], 1: the processor keeps 0, a word 0x100.
    expect(reason("c646ffff" + "8046ff01")).toContain("a byte add");
    // mov byte [bp-1], 0; sub byte [bp-1], 1
    expect(reason("c646ff00" + "806eff01")).toContain("a byte sub");
    // mov byte [bp-1], 0x80; shl byte [bp-1], 1, and sar byte [bp-1], 1
    expect(reason("c646ff80" + "d066ff")).toContain("a byte shl");
    expect(reason("c646ff80" + "d07eff")).toContain("a byte sar");
    // mov byte [bp-1], 0x90; cmp byte [bp-1], 0x91; jl skip; mov word [0x14], 1: 0x90 is -112 to the processor.
    expect(reason("c646ff90" + "807eff91" + "7c06c70614000100")).toContain("a signed branch after a byte");
    // cmp byte [0x10], 0x90; jl skip; mov word [0x14], 1
    expect(reason("803e100090" + "7c06c70614000100")).toContain("a signed branch after a byte");
    // mov byte [bp-1], 0x7f; inc byte [bp-1]; js skip; mov word [0x14], 1: the byte is 0x80, below 0.
    expect(reason("c646ff7f" + "fe46ff" + "7806c70614000100")).toContain("a signed branch after a byte");
    // A byte shifted right and an unsigned branch after a byte stay read.
    expect(reason("c646ff80" + "d06eff" + "807eff40" + "7206c70614000100")).toBeUndefined();
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

  it("keeps a register the finder's type comes from, which the call doesn't change", () => {
    const si = { kind: "register", name: "si" } as const;
    const ax = { kind: "register", name: "ax" } as const;
    const constant = (value: number) => ({ kind: "constant", value }) as const;
    // ax = 0x1000; push ax; ax = 1; push ax; si = 36; push si; call the finder; [0x10] = ax; [0x12] = si
    const body: GoalStatement[] = [
      { kind: "set", target: ax, value: constant(0x1000) },
      { kind: "set", target: { kind: "local", offset: -2 }, value: ax },
      { kind: "set", target: ax, value: constant(1) },
      { kind: "set", target: { kind: "local", offset: -4 }, value: ax },
      { kind: "set", target: si, value: constant(36) },
      { kind: "set", target: { kind: "local", offset: -6 }, value: si },
      { kind: "call", routine: 0x262d, segment: 0, offset: 0x262d, stack: -6 },
      { kind: "set", target: { kind: "word", address: constant(0x10) }, value: ax },
      { kind: "set", target: { kind: "word", address: constant(0x12) }, value: si },
    ];
    const routines = new Map([[0, { address: 0, segment: 0, offset: 0, body }]]);
    expect(describeGoal(routines, 0, names)).toContain("si = 36");
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
      overlays: [],
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
  const summarise = (body: GoalStatement[], more: Partial<GoalNames> = {}) =>
    summariseGoal(new Map([[0, { address: 0, segment: 0, offset: 0, body }]]), 0, { ...toons, ...more });
  const summary = (body: GoalStatement[]) => summarise(body);
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

  it("reads a word the goal adds 1 to when a test holds as how many steps the test held at", () => {
    const count = word(0x4c7a);
    const s = summary([
      when(test(word(STEPS), "==", c(0)), [...find(36, c(1), 0x1000, al), set(count, c(0))]),
      set(r("bx"), al),
      when(test(field(r("bx"), 0x0c), "==", c(50)), [set(count, plus(count, c(1)))]),
      when(test(count, "==", c(2)), [met]),
    ]);
    expect(s.ways.map((w) => w.map(conditionText))).toEqual([
      ["at exactly 2 steps so far, the 1st al-e-cat on the moving list: action = 50 (CATFISH)"],
    ]);
    expect(s.ways[0]![0]!.steps).toEqual({ op: "==", value: 2 });
  });

  it("reads a word set to the step count when a test holds as the last step the test held at", () => {
    const at = word(KEPT + 0x7552);
    const s = summary([
      when(test(word(STEPS), "==", c(0)), [...find(36, c(1), 0x1000, al), set(at, c(0))]),
      set(r("bx"), al),
      when(test(field(r("bx"), 0x0c), "==", c(50)), [set(r("dx"), word(STEPS)), set(at, r("dx"))]),
      when(test(at, "!=", c(0)), [
        set(r("ax"), at),
        set(r("ax"), plus(r("ax"), c(30))),
        when(test(r("ax"), "==", word(STEPS)), [met]),
      ]),
    ]);
    expect(s.ways.map((w) => w.map(conditionText))).toEqual([
      ["last held 30 steps ago, not at the first step, the 1st al-e-cat on the moving list: action = 50 (CATFISH)"],
    ]);
  });

  it("reads a word of a few values by what happened in which order, and a test that never held", () => {
    // BRAN8: the switch's word becomes 1 when it is on, and 2 when it is off after being 1; Al's flag stays 0.
    const sw = word(KEPT + 0x74fa);
    const state = word(KEPT + 0x74fc);
    const flag = word(KEPT + 0x74fe);
    const on = (bx: GoalValue) => field(bx, 0x0e);
    const s = summary([
      when(test(word(STEPS), "==", c(0)), [
        ...find(36, c(1), 0x1000, al),
        ...find(23, c(1), 0x2000, sw),
        set(state, c(0)),
        set(flag, c(0)),
      ]),
      set(r("bx"), sw),
      when(test(on(r("bx")), "!=", c(0)), [set(state, c(1))]),
      set(r("bx"), sw),
      when(test(on(r("bx")), "==", c(0)), [when(test(state, "==", c(1)), [set(state, c(2))])]),
      set(r("bx"), al),
      when(test(field(r("bx"), 0x0c), "==", c(16)), [set(flag, c(1))]),
      when(test(flag, "==", c(0)), [when(test(state, "==", c(2)), [met])]),
    ]);
    expect(s.ways.map((w) => w.map(conditionText))).toEqual([
      [
        "at no step so far, the 1st al-e-cat on the moving list: action = 16",
        "at some step before this one, the 1st balloon on the fixed list: state ≠ 0",
        "the 1st balloon on the fixed list: state = 0",
      ],
    ]);
  });

  it("reads a loop that finds every part of a type, and a loop over the table it fills, as every part", () => {
    // HARD18: find the next message machine until there is none, then count those whose state isn't 0.
    const count = word(0x4c9a);
    const table = (index: GoalValue) => word(plus(index, c(0x4c86)));
    const s = summary([
      when(test(word(STEPS), "==", c(0)), [
        set(count, c(0)),
        {
          kind: "loop",
          before: [
            ...find(36, plus(count, c(1)), 0x2000, r("ax")).slice(0, 4),
            set(r("bx"), count),
            set(r("bx"), { kind: "binary", op: "<<", left: r("bx"), right: c(1) }),
            set(table(r("bx")), r("ax")),
          ],
          test: test(r("ax"), "!=", c(0)),
          body: [set(count, plus(count, c(1)))],
        },
      ]),
      set(r("di"), c(0)),
      set(r("si"), c(0)),
      {
        kind: "loop",
        before: [],
        test: test(r("si"), "<", count),
        body: [
          set(r("bx"), r("si")),
          set(r("bx"), { kind: "binary", op: "<<", left: r("bx"), right: c(1) }),
          set(r("bx"), table(r("bx"))),
          when(test(field(r("bx"), 0x0e), "!=", c(0)), [set(r("di"), plus(r("di"), c(1)))]),
          set(r("si"), plus(r("si"), c(1))),
        ],
      },
      when(test(r("di"), "==", count), [met]),
    ]);
    expect(s.ways.map((w) => w.map(conditionText))).toEqual([["every al-e-cat on the fixed list: state ≠ 0"]]);
  });

  it("reads a search from n = 0 that stops at the first part passing a test, with what a read through 0 finds", () => {
    // LOON7: the first balloon whose word at 0x6f isn't 0; through 0 the drawing flags are the copyright text's.
    const found = word(KEPT + 0x7474);
    const s = summarise(
      [
        when(test(word(STEPS), "==", c(0)), [
          set(r("si"), c(0)),
          {
            kind: "loop",
            before: [
              ...find(23, r("si"), 0x1000, found),
              when(test(r("ax"), "==", c(0)), [{ kind: "break" }], [set(r("bx"), found)]),
            ],
            test: test(field(r("bx"), 0x6f), "==", c(0)),
            body: [set(r("si"), plus(r("si"), c(1)))],
          },
        ]),
        set(r("bx"), found),
        when(test({ kind: "binary", op: "&", left: field(r("bx"), 0x08), right: c(0x2000) }, "!=", c(0)), [met]),
      ],
      { fixedWords: new Map([[0x08, 0x6e61]]) },
    );
    expect(s.ways.map((w) => w.map(conditionText))).toEqual([
      ["the first part on the moving list: type isn't balloon"],
      ["every balloon on the moving list: field 0x6f = 0"],
      ["the first balloon on the moving list where field 0x6f ≠ 0: drawingFlags has the bits 0x2000"],
    ]);
  });

  it("follows a field to the part it holds, and keeps the part it held when a test held", () => {
    // BRAN16: Al's angel, kept when he is shot, and met when it is off the top: its positionY + height below 0.
    const angel = word(KEPT + 0x7502);
    const height = (bx: GoalValue) => field(bx, 0x4f);
    const minus = (left: GoalValue, right: GoalValue): GoalValue => ({ kind: "binary", op: "-", left, right });
    const s = summarise(
      [
        when(test(word(STEPS), "==", c(0)), [...find(36, c(1), 0x1000, al), set(angel, c(0))]),
        set(r("bx"), al),
        when(test(field(r("bx"), 0x0c), "==", c(16)), [
          set(r("bx"), al),
          set(r("bx"), field(r("bx"), 0xb1)),
          when(test(field(r("bx"), 0x04), "==", c(36)), [
            set(r("bx"), al),
            set(r("ax"), field(r("bx"), 0xb1)),
            set(angel, r("ax")),
          ]),
        ]),
        when(test(angel, "!=", c(0)), [
          set(r("bx"), angel),
          set(r("ax"), field(r("bx"), 0x21)),
          set(r("ax"), plus(r("ax"), height(r("bx")))),
          when(
            { op: "==", signed: false, left: height(r("bx")), right: c(0x8000) },
            [met],
            [when(test(minus(r("ax"), height(r("bx"))), "<", minus(c(0), height(r("bx")))), [met])],
          ),
        ]),
      ],
      {
        fields: new Map([...toons.fields, [0x21, "positionY"], [0x4f, "height"], [0xb1, "linkedPart"]]),
        linkName: (type, offset) => (type === 36 && offset === 0xb1 ? "angel" : undefined),
        fixedWords: new Map([[0x04, 0x6f42]]),
        exactSums: true,
      },
    );
    expect(s.ways.map((w) => w.map(conditionText))).toEqual([
      [
        "at some step so far, the 1st al-e-cat on the moving list: action = 16, angel's type is al-e-cat",
        "the kept angel of the 1st al-e-cat on the moving list: positionY + height < 0",
      ],
    ]);
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

describe("toonsListOrder", () => {
  // Kinds as the type table gives them: Al 2000, the anvil 2000, Sid 1800, the rope 1005, the eye-hook 1006.
  const kinds = new Map([
    [36, 2000],
    [61, 2000],
    [37, 1800],
    [14, 1005],
    [15, 1006],
  ]);
  const level = (parts: [type: number, x: number, y: number][]) =>
    ({
      parts: parts.map(([type, x, y], index) => ({ index, group: "moving", type, position: { x, y } })),
    }) as unknown as Level;

  it("sorts a list by kind, and parts of one kind lower first, then further right, then in file order", () => {
    const l = level([
      [36, 10, 100],
      [37, 50, 50],
      [61, 10, 300],
      [36, 90, 100],
      [36, 90, 100],
    ]);
    expect(toonsListOrder(l, "the moving list", kinds)).toEqual([1, 2, 3, 4, 0]);
    expect(toonsListOrder(l, "the fixed list", kinds)).toEqual([]);
  });

  it("puts a rope before the others of its kind, and a part right after one before the others of its own", () => {
    const l = level([
      [14, 0, 0],
      [14, 0, 50],
      [15, 0, 50],
      [15, 0, 0],
      [15, 0, 90],
    ]);
    // The eye-hooks after the ropes: each new one goes first, whatever its place.
    expect(toonsListOrder(l, "the moving list", kinds)).toEqual([1, 0, 4, 3, 2]);
  });
});

describe("toonsGoalParts", () => {
  // The balloon sorts first (1), the eye-hook (1006) and the rope (1005) after it.
  const kinds = new Map([
    [23, 1],
    [14, 1005],
    [15, 1006],
  ]);
  const FIXED = 0x40;
  type Spec = { type: number; y: number; group?: "static" | "moving"; fixed?: boolean; tie?: [number, number] };
  // A rope ties its first end at that part's place 0 and its second at place 1.
  const level = (specs: Spec[]) =>
    ({
      parts: specs.map((p, index) => ({
        index,
        group: p.group ?? "moving",
        type: p.type,
        flags: [0, 0, p.fixed === false ? 0 : FIXED],
        position: { x: 0, y: p.y },
        ropes: [
          { at: { x: 0, y: 0 }, ...(p.tie ? { rope: { parts: p.tie, slots: [0, 1] } } : {}) },
          { at: { x: 0, y: 0 } },
        ],
        links: [null, null],
        belt: { at: { x: 0, y: 0 }, width: 0 },
      })),
    }) as unknown as Level;
  // Two balloons, the upper one (#1) tied at its first place to an eye-hook (#2) by a rope (#3), as in LOON7.
  const loon = level([
    { type: 23, y: 300 },
    { type: 23, y: 14 },
    { type: 15, y: 104, group: "static" },
    { type: 14, y: -100, group: "static", fixed: false, tie: [1, 2] },
  ]);
  const balloon = [{ type: 23, name: "balloon" }];
  const moving = "the moving list";

  it("puts each rope at the places it ties and at its own", () => {
    expect([...toonsRopePlaces(loon)].sort()).toEqual([
      [1, [true, false]],
      [2, [false, true]],
      [3, [true, false]],
    ]);
  });

  it("finds the first balloon with a rope at its first place, which depends on the ropes", () => {
    const c = {
      kind: "first",
      lists: moving,
      types: balloon,
      where: ["rope1 ≠ 0"],
      tests: ["drawingFlags has the bits 0x2000"],
    };
    expect(toonsGoalParts(loon, c as GoalCondition, kinds, none)).toEqual({ parts: [1], player: "ropes" });
  });

  it("decides tests of only the ropes and the type as the puzzle starts", () => {
    const first = { kind: "first", lists: moving, tests: ["type isn't balloon"] } as GoalCondition;
    expect(toonsGoalParts(loon, first, kinds, none)).toEqual({ parts: [0], holds: false });
    const every = { kind: "every", lists: moving, types: balloon, tests: ["rope1 = 0"] } as GoalCondition;
    expect(toonsGoalParts(loon, every, kinds, none)).toEqual({ parts: [0, 1], holds: false, player: "ropes" });
  });

  it("says when a part from the bin could come before the n-th part", () => {
    const nth = { kind: "nth", nth: 2, lists: moving, types: balloon, tests: [] } as unknown as GoalCondition;
    expect(toonsGoalParts(loon, nth, kinds, none)).toEqual({ parts: [1], holds: true });
    const binned = level([
      { type: 23, y: 300 },
      { type: 23, y: 14, fixed: false },
    ]);
    // The second balloon starts in the bin, so the moving list has only one as the puzzle starts.
    expect(toonsGoalParts(binned, nth, kinds, none)).toEqual({ parts: [], player: "bin" });
  });

  it("leaves out the rope places of a rope the puzzle start puts in the bin", () => {
    // As above, but the eye-hook goes to the bin and takes the rope with it.
    const loose = level([
      { type: 23, y: 300 },
      { type: 23, y: 14 },
      { type: 15, y: 104, group: "static", fixed: false },
      { type: 14, y: -100, group: "static", fixed: false, tie: [1, 2] },
    ]);
    expect([...toonsRopePlaces(loose, toonsPuzzleStart(loose, kinds, none))]).toEqual([[3, [true, false]]]);
    const c = { kind: "first", lists: moving, types: balloon, where: ["rope1 ≠ 0"], tests: [] };
    expect(toonsGoalParts(loose, c as unknown as GoalCondition, kinds, none)).toEqual({ parts: [], player: "ropes" });
  });
});

describe("toonsPuzzleStart", () => {
  const FIXED = 0x40;
  type Spec = {
    type: number;
    x?: number;
    group?: "static" | "moving";
    fixed?: boolean;
    tie?: [number, number];
    belt?: [number, number];
    links?: [number | null, number | null];
    tunnel?: number;
    state?: number;
    plugs?: [number | null, number | null];
    plugPlace?: number;
    /** Bits 0x1 and 0x2 of the third flag word: plugs into a part, takes plugs. */
    plug?: number;
    pulley?: number;
  };
  const level = (specs: Spec[]) =>
    ({
      parts: specs.map((p, index) => ({
        index,
        group: p.group ?? "static",
        type: p.type,
        flags: [0, 0, (p.fixed === false ? 0 : FIXED) | (p.plug ?? 0)],
        state: [p.state ?? 0, 0],
        position: { x: p.x ?? 0, y: 0 },
        ...(p.plugs ? { plugs: p.plugs } : {}),
        ...(p.plugPlace === undefined ? {} : { plugPlace: p.plugPlace }),
        ropes: [
          { at: { x: 0, y: 0 }, ...(p.tie ? { rope: { parts: p.tie, slots: [0, 0] } } : {}) },
          { at: { x: 0, y: 0 } },
        ],
        links: p.links ?? [null, null],
        belt: { at: { x: 0, y: 0 }, width: 0, ...(p.belt ? { parts: p.belt } : {}) },
        ...(p.tunnel === undefined ? {} : { tunnel: p.tunnel }),
        ...(p.pulley === undefined ? {} : { pulley: p.pulley }),
      })),
    }) as unknown as Level;
  const start = (l: Level) => {
    const s = toonsPuzzleStart(l, none, none);
    return { bin: [...s.bin].sort((a, b) => a - b), gone: [...s.gone] };
  };

  it("puts the parts without the fixed bit in the bin, and the ropes and belts tied to them", () => {
    const l = level([
      { type: 15 },
      { type: 15 },
      { type: 23, fixed: false },
      { type: 14, fixed: false, tie: [0, 1] },
      { type: 14, fixed: false, tie: [2, 1] },
      { type: 1, fixed: false, belt: [0, 1] },
      { type: 1, fixed: false, belt: [0, 2] },
    ]);
    expect(start(l)).toEqual({ bin: [2, 4, 6], gone: [] });
  });

  it("puts a rope in the bin with a pulley it runs over", () => {
    // The rope runs from #0 over the pulley to #1, which links back to the pulley.
    const l = level([
      { type: 15, links: [2, null] },
      { type: 15, links: [2, null] },
      { type: 17, fixed: false, links: [1, null] },
      { type: 14, fixed: false, tie: [0, 1] },
    ]);
    expect(start(l)).toEqual({ bin: [2, 3], gone: [] });
  });

  it("unties the rope over a pulley only when the pulley comes after the rope in the file", () => {
    // Rope #2 ties hook #1 to balloon #3, which goes to the bin and takes the rope with it. From the hook it runs over
    // pulley #4 and then pulley #0; the loader gave #0, read before the rope, no rope over it.
    const l = level([
      { type: 17, links: [3, null], pulley: 2 },
      { type: 15, links: [4, null] },
      { type: 14, fixed: false, tie: [1, 3] },
      { type: 23, fixed: false },
      { type: 17, links: [0, 1], pulley: 2 },
    ]);
    expect(toonsPuzzleStart(l, none, none).untied).toEqual([
      [1, 0],
      [4, 1],
    ]);
  });

  it("sorts the bin by the type's word, keeping parts of a type in the order the setup puts them there", () => {
    // The moving list first: the balloons #3 and #2 (further right first), then the fixed list's hook #0, whose rope
    // #4 goes with it. The sort words put the rope first and the hooks before the balloons.
    const l = level([
      { type: 15, fixed: false },
      { type: 15 },
      { type: 23, x: 10, group: "moving", fixed: false },
      { type: 23, x: 90, group: "moving", fixed: false },
      { type: 14, fixed: false, tie: [0, 1] },
    ]);
    const binKinds = new Map([
      [14, 0],
      [15, 1],
      [23, 2],
    ]);
    expect(toonsPuzzleStart(l, new Map(), binKinds).binOrder).toEqual([4, 0, 3, 2]);
    expect(toonsPuzzleStart(l, new Map(), new Map([...binKinds, [23, -1]])).binOrder).toEqual([3, 2, 4, 0]);
  });

  it("pulls a part's plug out of the switch on the board, and the switch shows its plugs again", () => {
    // Switch #0 (state 7: on, both places taken) stays; drier #1 in its first place goes to the bin, timer #2 in its
    // second place stays.
    const l = level([
      { type: 2, state: 7, plug: 2, plugs: [1, 2] },
      { type: 52, fixed: false, plug: 1, plugs: [0, null], plugPlace: 0 },
      { type: 38, plug: 1, plugs: [0, null], plugPlace: 1 },
    ]);
    const s = toonsPuzzleStart(l, none, none);
    expect([...s.bin]).toEqual([1]);
    expect(s.unplugged).toEqual([{ part: 1, into: 0, place: 0 }]);
    expect([...s.plugs]).toEqual([
      [0, [null, 2]],
      [1, [null, null]],
    ]);
    expect([...s.states]).toEqual([[0, 6]]);
  });

  it("lets go of both plugs when the switch goes to the bin", () => {
    const l = level([
      { type: 2, fixed: false, state: 3, plug: 2, plugs: [1, null] },
      { type: 52, plug: 1, plugs: [0, null], plugPlace: 0 },
    ]);
    const s = toonsPuzzleStart(l, none, none);
    expect(s.unplugged).toEqual([{ part: 1, into: 0, place: 0 }]);
    expect(s.plugs.get(1)).toEqual([null, null]);
    expect(s.states.size).toBe(0);
  });

  it("gives an anvil on the board state 0 when the rope at its first place goes to the bin", () => {
    const l = level([
      { type: 61, state: 1 },
      { type: 23, fixed: false },
      { type: 14, fixed: false, tie: [0, 1] },
    ]);
    expect([...toonsPuzzleStart(l, none, none).states]).toEqual([[0, 0]]);
  });

  it("puts the first tunnel of a pair in the bin and takes the other end off", () => {
    // On one list the part further right comes first.
    const l = level([
      { type: 46, x: 10, fixed: false, tunnel: 1 },
      { type: 46, x: 90, fixed: false, tunnel: 0 },
      { type: 46, x: 50, tunnel: 3 },
      { type: 46, x: 70, tunnel: 2 },
    ]);
    expect(start(l)).toEqual({ bin: [1], gone: [0] });
  });

  it("takes a rope end, a plug or a link to a part past the list as none", () => {
    // A damaged level: the rope from #0 ends at #9, the drier and the switch are plugged into #9 and the pulley links
    // to #9, and there are only five parts.
    const l = level([
      { type: 15, fixed: false },
      { type: 14, fixed: false, tie: [0, 9] },
      { type: 52, fixed: false, plug: 1, plugs: [9, null], plugPlace: 0 },
      { type: 2, fixed: false, plug: 2, plugs: [9, null] },
      { type: 17, fixed: false, links: [9, null] },
    ]);
    expect(start(l)).toEqual({ bin: [0, 1, 2, 3, 4], gone: [] });
    expect(toonsPuzzleStart(l, none, none).unplugged).toEqual([]);
  });
});

describe("readToonsBinKinds", () => {
  /**
   * A made-up program: code that reaches a table of three type records at segment 0x10 and walks it, and the start-up
   * code that writes each type's place in a table at segment 0x20 into the records at 0x2a.
   */
  function program() {
    const image = new Uint8Array(0x400);
    const put = (at: number, bytes: number[]) => image.set(bytes, at);
    // mov ax, si; mov dx, 70; imul dx; add ax, 0x0000; mov word [bp-0x28], 0x0010; inc si; cmp si, 3; jl back
    put(0x10, [0x8b, 0xc6, 0xba, 0x46, 0x00, 0xf7, 0xea, 0x05, 0x00, 0x00, 0xc7, 0x46, 0xd8, 0x10, 0x00]);
    put(0x1f, [0x46, 0x83, 0xfe, 0x03, 0x7c, 0x10 - 0x25]);
    // mov ax, 0x20; mov es, ax; mov ax, es:[bx+0x08]; mov dx, 70; imul dx; mov dx, 0x10; mov bx, ax; mov es, dx;
    // mov es:[bx+0x2a], cx
    put(0x40, [0xb8, 0x20, 0x00, 0x8e, 0xc0, 0x26, 0x8b, 0x87, 0x08, 0x00, 0xba, 0x46, 0x00, 0xf7, 0xea]);
    put(0x4f, [0xba, 0x10, 0x00, 0x8b, 0xd8, 0x8e, 0xc2, 0x26, 0x89, 0x8f, 0x2a, 0x00]);
    // The table: type 2 first, then 0, then 1.
    put(0x208, [2, 0, 0, 0, 1, 0]);
    const header = new Uint8Array(32);
    const size = header.length + image.length;
    header.set([0x4d, 0x5a, size % 512, 0, Math.ceil(size / 512), 0, 0, 0, 2, 0]);
    return Uint8Array.from([...header, ...image]);
  }

  it("gives each type its place in the table the start-up code writes into the records", () => {
    expect([...readToonsBinKinds(program())].sort()).toEqual([
      [0, 1],
      [1, 2],
      [2, 0],
    ]);
  });

  it("is empty for a program without the code", () => {
    expect(readToonsBinKinds(new Uint8Array(64)).size).toBe(0);
  });
});
