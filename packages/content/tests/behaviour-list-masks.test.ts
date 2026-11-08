import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
import { maskValue, pushedWord, searchedLists } from "../src/read/behaviour-list-masks.ts";
import type { Expression, Predicate } from "../src/read/behaviour.ts";

/** A routine at 0x100 from its bytes, with a far return at 0x200 for its calls to land on. */
function routine(bytes: number[]) {
  const image = new Uint8Array(0x400);
  image.set(bytes, 0x100);
  image[0x200] = 0xcb;
  return readRoutineCode(image, { address: 0x100, segment: 0, offset: 0x100 }, 0);
}
/** `push cs; call near 0x200` at `at`, the way the searches call the list routines. */
const call = (at: number) => {
  const rel = 0x200 - (at + 4);
  return [0x0e, 0xe8, rel & 0xff, (rel >> 8) & 0xff];
};

describe("the masks a search gives the list routines", () => {
  // push bp; mov bp, sp; push word [bp+8]; nop; call head; pop cx;
  // mov ax, [bp+8]; and ax, 0x1000; push ax; push si; nop; call next; pop cx; pop cx; pop bp; retf
  const search = routine([
    0x55,
    0x8b,
    0xec,
    0xff,
    0x76,
    0x08,
    0x90,
    ...call(0x107),
    0x59,
    0x8b,
    0x46,
    0x08,
    0x25,
    0x00,
    0x10,
    0x50,
    0x56,
    0x90,
    ...call(0x115),
    0x59,
    0x59,
    0x5d,
    0xcb,
  ]);

  it("reads an argument passed on, and one masked first", () => {
    expect(pushedWord(search, 0x108, 0)).toEqual({ argument: 8 });
    expect(pushedWord(search, 0x116, 1)).toEqual({ argument: 8, and: 0x1000 });
    // The part, in a register the routine never loads from an argument.
    expect(pushedWord(search, 0x116, 0)).toBeUndefined();
  });

  it("reads a constant", () => {
    // push bp; mov bp, sp; mov ax, 0x3000; push ax; nop; call; pop cx; pop bp; retf
    const own = routine([0x55, 0x8b, 0xec, 0xb8, 0x00, 0x30, 0x50, 0x90, ...call(0x108), 0x59, 0x5d, 0xcb]);
    expect(pushedWord(own, 0x109, 0)).toEqual({ constant: 0x3000 });
  });

  // The next routine's shape: push bp; mov bp, sp; push si; push di; mov si, [bp+6]; mov di, [bp+8];
  // cmp word [si], 0; je call; mov ax, [si]; jmp exit; call: push di; call head; pop cx; jmp back to the jmp;
  // exit: pop di; pop si; pop bp; retf
  const next = (rewrite: boolean) =>
    routine([
      0x55,
      0x8b,
      0xec,
      0x56,
      0x57,
      0x8b,
      0x76,
      0x06,
      0x8b,
      0x7e,
      0x08,
      0x83,
      0x3c,
      0x00,
      0x74,
      0x04,
      0x8b,
      0x04,
      0xeb,
      rewrite ? 0x0c : 0x08,
      ...(rewrite ? [0xbf, 0x00, 0x08, 0x90] : []),
      0x57,
      ...call(rewrite ? 0x119 : 0x115),
      0x59,
      0xeb,
      rewrite ? 0xf2 : 0xf6,
      0x5f,
      0x5e,
      0x5d,
      0xcb,
    ]);

  it("reads a register loaded once from an argument, past a jump back to a shared exit", () => {
    expect(pushedWord(next(false), 0x116, 0)).toEqual({ argument: 8 });
  });

  it("gives up when the register is written again on the way", () => {
    // mov di, 0x0800; nop before the push
    expect(pushedWord(next(true), 0x11a, 0)).toBeUndefined();
  });

  it("works out a mask's value at a call", () => {
    expect(maskValue({ argument: 8, and: 0x1000 }, () => 0x3000)).toBe(0x1000);
    expect(maskValue({ argument: 8 }, () => undefined)).toBeUndefined();
    expect(maskValue({ constant: 0x3000 }, () => undefined)).toBe(0x3000);
  });
});

describe("the lists a search walks", () => {
  const field = (object: string, offset: number): Expression => ({ kind: "field", object, offset, width: 16 });
  const bit = (object: string, offset: number, value: number, set = true): Predicate => ({
    kind: "compare",
    operator: set ? "!=" : "==",
    left: {
      kind: "binary",
      operator: "&",
      left: field(object, offset),
      right: { kind: "constant", value, width: 16 },
      width: 16,
    },
    right: { kind: "constant", value: 0, width: 16 },
    signed: false,
  });
  const list = (head: number, condition: Predicate[]) => ({
    confidence: "inferred" as const,
    evidence: [],
    assumptions: [],
    register: "ax",
    value: field("data", head),
    condition: { kind: "and" as const, terms: condition },
    pointer: { kind: "global" as const, segment: 0, offset: head, path: [] },
  });
  const summary = (address: number, kind: EngineSummary["kind"], extra: Partial<EngineSummary>) =>
    ({ address, kind, argumentOffset: 6, returns: [], ...extra }) as unknown as EngineSummary;
  // The head routine: the fixed list for 0x2000, else the moving list for 0x1000, else the third for 0x0800.
  const head = summary(0x682f, "list-head", {
    returns: [
      list(0x4e1f, [bit("argument", 6, 0x2000)]),
      list(0x4d7d, [bit("argument", 6, 0x2000, false), bit("argument", 6, 0x1000)]),
      list(0x4cdb, [bit("argument", 6, 0x1000, false), bit("argument", 6, 0x0800)]),
    ] as unknown as EngineSummary["returns"],
  });
  // The next routine: the third list after a moving part, for 0x0800, and the head routine with its own mask.
  const next = summary(0x686f, "list-next", {
    returns: [
      list(0x4cdb, [bit("part", 6, 0x1000), bit("argument", 8, 0x0800)]),
    ] as unknown as EngineSummary["returns"],
    listNext: { head: { argument: 8 }, address: 0x682f },
  });
  const search = summary(0x437d, "overlap-list", {
    list: {
      masks: { head: { argument: 8 }, next: { argument: 8, and: 0x1000 }, headRoutine: 0x682f, nextRoutine: 0x686f },
    } as unknown as EngineSummary["list"],
  });
  const helpers = [head, next, search];

  it("walks the lists the masks pick", () => {
    expect(searchedLists(helpers, search, { head: 0x1000, next: 0x1000 })).toEqual([0x4d7d]);
    expect(searchedLists(helpers, search, { head: 0x3000, next: 0x1000 })).toEqual([0x4d7d, 0x4e1f]);
    expect(searchedLists(helpers, search, { head: 0x2000, next: 0 })).toEqual([0x4e1f]);
    expect(searchedLists(helpers, search, { head: 0x0800, next: 0x0800 })).toEqual([0x4cdb]);
  });

  it("knows no lists when the next routine's mask isn't read", () => {
    const unread = { ...next, listNext: undefined } as EngineSummary;
    expect(searchedLists([head, unread, search], search, { head: 0x1000, next: 0x1000 })).toBeUndefined();
  });
});

describe("a search of the moving list only", () => {
  it("is one whose every call walks just the list the contact dispatch walks", async () => {
    const { searchesOnlyMovingList } = await import("../src/read/describe-hits.ts");
    const report = (head: number) =>
      ({
        collisionDispatch: [{ list: { globalHead: 0x4d7d, nextField: 0 } }],
        helpers: [
          {
            address: 0x682f,
            kind: "list-head",
            argumentOffset: 6,
            returns: [0x2000, 0x1000].map((bit, n) => ({
              register: "ax",
              value: { kind: "field", object: "data", offset: n ? 0x4d7d : 0x4e1f, width: 16 },
              condition: {
                kind: "compare",
                operator: "!=",
                left: {
                  kind: "binary",
                  operator: "&",
                  left: { kind: "field", object: "argument", offset: 6, width: 16 },
                  right: { kind: "constant", value: bit, width: 16 },
                  width: 16,
                },
                right: { kind: "constant", value: 0, width: 16 },
                signed: false,
              },
              pointer: { kind: "global", segment: 0, offset: n ? 0x4d7d : 0x4e1f, path: [] },
            })),
          },
          {
            address: 0x686f,
            kind: "list-next",
            argumentOffset: 6,
            returns: [],
            listNext: { head: { argument: 8 }, address: 0x682f },
          },
          {
            address: 0x437d,
            kind: "overlap-list",
            argumentOffset: 6,
            returns: [],
            list: {
              masks: {
                head: { argument: 8 },
                next: { argument: 8, and: 0x1000 },
                headRoutine: 0x682f,
                nextRoutine: 0x686f,
              },
            },
          },
        ],
        routines: [
          {
            address: 0x1d27a,
            listLoops: [{ header: 0x1d340, source: "overlap-query", queries: [0x1d32a] }],
            engineCalls: [{ instruction: 0x1d32a, summary: 0x437d, listMasks: { head, next: head & 0x1000 } }],
          },
        ],
      }) as unknown as Parameters<typeof searchesOnlyMovingList>[0];
    expect(searchesOnlyMovingList(report(0x1000), 0x1d27a, 0x1d340)).toBe(true);
    expect(searchesOnlyMovingList(report(0x3000), 0x1d27a, 0x1d340)).toBe(false);
    // Another loop of the routine isn't this search's.
    expect(searchesOnlyMovingList(report(0x1000), 0x1d27a, 0x1d400)).toBe(false);
  });
});
