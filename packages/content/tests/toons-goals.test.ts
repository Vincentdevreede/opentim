import { describe, expect, it } from "vitest";
import { describeGoal, type GoalNames } from "../src/read/describe-goals.ts";
import { FAR_WORDS, readGoalRoutines, type GoalRoutine, type GoalStatement } from "../src/read/puzzle-goals.ts";
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
