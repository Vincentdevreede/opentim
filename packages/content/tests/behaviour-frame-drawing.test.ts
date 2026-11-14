import { describe, expect, it } from "vitest";
import { analyseRoutine, binary, type Expression } from "../src/read/behaviour.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverEngineSummaries, type EngineSummary } from "../src/read/behaviour-helpers.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";
import { frameDrawingForType, proveFrameDrawing } from "../src/read/behaviour-frame-drawing.ts";

const DATA = 0x40;
const TYPES = 0x30;
const POSITION = 0x100;
const SIZE = 0x200;
const CALLER = 0x300;
const fields = { drawX: 0x2a, drawY: 0x2c, frameWidth: 0x44, frameHeight: 0x46 };
const layout: BehaviourLayout = {
  callbacks: [],
  objectArgument: { offset: 6, confidence: "inferred", evidence: [], assumptions: [] },
  diagnostics: [],
  fields: [
    ["state", 0x0c],
    ["type", 4],
    ["frameWidth", 0x44],
    ["frameHeight", 0x46],
    ["drawX", 0x2a],
    ["drawY", 0x2c],
  ].map(([name, offset]) => ({
    name: name as string,
    offset: offset as number,
    confidence: "checked" as const,
    evidence: [],
    assumptions: [],
  })),
};

/** The drawing position helper as Even More has it: a far pointer to the type record kept on the stack. */
const position = (sizeCall: number[]) => [
  ...[0x55, 0x8b, 0xec, 0x83, 0xec, 0x0a, 0x56, 0x57, 0x8b, 0x76, 0x06], // enter, si = part
  ...[0x8b, 0x44, 0x04, 0x89, 0x46, 0xfe, 0x8b, 0x46, 0xfe, 0xba, 0x3a, 0x00, 0xf7, 0xea, 0x05, 0x00, 0x00], // type * 58
  ...[0xc7, 0x46, 0xf8, TYPES, 0x00, 0x89, 0x46, 0xf6], // far pointer to the record
  ...[0x8b, 0x44, 0x1e, 0x89, 0x44, 0x2a, 0x8b, 0x44, 0x20, 0x89, 0x44, 0x2c], // drawX, drawY = position
  ...[0x8b, 0x44, 0x0c, 0x89, 0x46, 0xfc, 0x8b, 0x44, 0x08, 0x89, 0x46, 0xfa], // keep state and flags
  ...[0x56, 0x90, 0x0e, ...sizeCall, 0x59], // the size helper
  ...[0xc4, 0x5e, 0xf6, 0x26, 0x8b, 0x47, 0x18, 0x8b, 0xf8, 0x0b, 0xc0, 0x74, 0x43], // offsets of the frames
  ...[0x8b, 0x46, 0xfc, 0xd1, 0xe0, 0x03, 0xf8, 0xf7, 0x46, 0xfa, 0x10, 0x00, 0x74, 0x10],
  ...[0x8a, 0x05, 0x98, 0x8b, 0x54, 0x40, 0x2b, 0xd0, 0x2b, 0x54, 0x44, 0x01, 0x54, 0x2a, 0xeb, 0x06], // mirrored
  ...[0x8a, 0x05, 0x98, 0x01, 0x44, 0x2a],
  ...[0xf7, 0x46, 0xfa, 0x20, 0x00, 0x74, 0x11],
  ...[0x8a, 0x45, 0x01, 0x98, 0x8b, 0x54, 0x42, 0x2b, 0xd0, 0x2b, 0x54, 0x46, 0x01, 0x54, 0x2c, 0xeb, 0x07], // upside down
  ...[0x8a, 0x45, 0x01, 0x98, 0x01, 0x44, 0x2c],
  ...[0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb],
];
/** The frame size helper as Even More has it. `base` is the instruction that reads the stored width. */
const size = (base = [0x8b, 0x45, 0x50]) => [
  ...[0x55, 0x8b, 0xec, 0x83, 0xec, 0x06, 0x56, 0x57, 0x8b, 0x7e, 0x06], // enter, di = part
  ...[0x83, 0x7d, 0x04, 0x08, 0x74, 0x06, 0x83, 0x7d, 0x04, 0x0a, 0x75, 0x0b], // type 8 or 10
  ...[0x33, 0xc0, 0x89, 0x45, 0x46, 0x89, 0x45, 0x44, 0xe9, 0x9a, 0x00],
  ...[0xf7, 0x45, 0x06, 0x40, 0x00, 0x74, 0x0f], // stored size
  ...[...base, 0x89, 0x45, 0x44, 0x8b, 0x45, 0x52, 0x89, 0x45, 0x46, 0xe9, 0x84, 0x00],
  ...[0x8b, 0x45, 0x04, 0x89, 0x46, 0xfe, 0x8b, 0x46, 0xfe, 0xba, 0x3a, 0x00, 0xf7, 0xea, 0x05, 0x00, 0x00],
  ...[0xc7, 0x46, 0xfc, TYPES, 0x00, 0x89, 0x46, 0xfa],
  ...[0xc4, 0x5e, 0xfa, 0x26, 0x83, 0x7f, 0x1a, 0x00, 0x74, 0x2d], // sizes of the frames
  ...[0xc4, 0x5e, 0xfa, 0x26, 0x8b, 0x5f, 0x1a, 0x8b, 0x45, 0x0c, 0xd1, 0xe0, 0xd1, 0xe0, 0x03, 0xd8],
  ...[0x8b, 0x07, 0x89, 0x45, 0x44],
  ...[0xc4, 0x5e, 0xfa, 0x26, 0x8b, 0x5f, 0x1a, 0x8b, 0x45, 0x0c, 0xd1, 0xe0, 0xd1, 0xe0, 0x03, 0xd8],
  ...[0x8b, 0x47, 0x02, 0x89, 0x45, 0x46, 0xeb, 0x34],
  ...[0xc4, 0x5e, 0xfa, 0x26, 0x83, 0x7f, 0x14, 0x00, 0x74, 0x22], // the frame list
  ...[0xc4, 0x5e, 0xfa, 0x26, 0x8b, 0x5f, 0x14, 0x8b, 0x45, 0x0c, 0xd1, 0xe0, 0x03, 0xd8],
  ...[0x8b, 0x0f, 0x8b, 0xd9, 0x8b, 0x47, 0x06, 0x89, 0x45, 0x44, 0x8b, 0xd9, 0x8b, 0x47, 0x08, 0x89, 0x45, 0x46],
  ...[0xeb, 0x08, 0x33, 0xc0, 0x89, 0x45, 0x46, 0x89, 0x45, 0x44],
  ...[0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb],
];
const near = (from: number, to: number) => {
  const relative = (to - (from + 3)) & 0xffff;
  return [0xe8, relative & 255, relative >> 8];
};

function fixture(base?: number[]) {
  const image = new Uint8Array(0x1000);
  image.set(position(near(POSITION + 0x3f, SIZE)), POSITION);
  image.set(size(base), SIZE);
  // A caller that shows frame 3: state = 3, then the drawing position helper.
  image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 0x06, 0xc7, 0x44, 0x0c, 3, 0, 0x56, 0x0e], CALLER);
  image.set([...near(CALLER + 14, POSITION), 0x59, 0x5e, 0x5d, 0xcb], CALLER + 14);
  const read = (address: number) => readRoutineCode(image, { address, segment: 0, offset: address }, DATA);
  const codes = new Map([POSITION, SIZE, CALLER].map((address) => [address, read(address)]));
  const summaries = new Map<number, EngineSummary>(
    discoverEngineSummaries(image, codes, layout, undefined, DATA).map((s) => [s.address, s]),
  );
  const analyse = (address: number, tableReads = false) =>
    analyseRoutine(
      image,
      { address, segment: 0, offset: address },
      {
        dataSegment: DATA,
        stateOffset: 0x0c,
        argumentOffset: 6,
        summaries: new Map(),
        code: codes.get(address),
        engineSummaries: summaries,
        codes,
        layout,
        tableReads,
      },
    );
  proveFrameDrawing(
    summaries,
    fields,
    (summary) => analyse(summary.address, true),
    (operator, left, right, width) => binary(operator, left, right, width, Infinity),
  );
  return { summaries, analyse, image };
}

/** A game state: the part's fields and memory, with a few words picked so every path is taken. */
function world(seed: number) {
  let n = seed;
  const next = () => ((n = (n * 1103515245 + 12345) & 0x7fffffff) >>> 8) & 0xffff;
  const part = new Map<number, number>();
  for (const offset of [0x06, 0x08, 0x0a, 0x0c, 0x1e, 0x20, 0x2a, 0x2c, 0x40, 0x42, 0x44, 0x46, 0x50, 0x52])
    part.set(offset, next());
  part.set(0x04, [8, 10, 3, 3, 3, 3][next() % 6]!);
  part.set(0x0c, next() % 20);
  const memory = new Map<number, number>();
  const record = TYPES * 16 + part.get(0x04)! * 58;
  for (const word of [0x14, 0x18, 0x1a]) {
    const value = next() % 3 ? (next() & 0x7ff) + 0x100 : 0;
    memory.set(record + word, value & 255).set(record + word + 1, value >> 8);
  }
  const byte = (address: number) => memory.get(address) ?? (address * 2654435761) >>> 24;
  const word = (address: number) => byte(address) | (byte(address + 1) << 8);
  return { part, byte, word };
}
type World = ReturnType<typeof world>;

/** What the two helpers do, read off their instructions. */
function reference({ part, byte, word }: World) {
  const f = (offset: number) => part.get(offset)!;
  const data = (offset: number) => DATA * 16 + (offset & 0xffff);
  const record = TYPES * 16 + ((f(0x04) * 58) & 0xffff);
  const state = f(0x0c);
  let width = 0,
    height = 0;
  if (f(0x04) === 8 || f(0x04) === 10) width = height = 0;
  else if (f(0x06) & 0x40) [width, height] = [f(0x50), f(0x52)];
  else if (word(record + 0x1a)) {
    width = word(data(word(record + 0x1a) + state * 4));
    height = word(data(word(record + 0x1a) + state * 4 + 2));
  } else if (word(record + 0x14)) {
    const frame = word(data(word(record + 0x14) + state * 2));
    [width, height] = [word(data(frame + 6)), word(data(frame + 8))];
  }
  let x = f(0x1e),
    y = f(0x20);
  const offsets = word(record + 0x18);
  if (offsets) {
    const dx = (byte(data(offsets + state * 2)) << 24) >> 24;
    const dy = (byte(data(offsets + state * 2 + 1)) << 24) >> 24;
    x += f(0x08) & 0x10 ? f(0x40) - dx - width : dx;
    y += f(0x08) & 0x20 ? f(0x42) - dy - height : dy;
  }
  return new Map([
    [0x2a, x & 0xffff],
    [0x2c, y & 0xffff],
    [0x44, width],
    [0x46, height],
  ]);
}

/** Evaluates an expression of the part's fields and memory. */
function evaluate(e: Expression, w: World): number {
  if (e.kind === "constant") return e.value & 0xffff;
  if (e.kind === "field") {
    if (e.object !== "part" || e.unresolved) throw new Error(`Unexpected field ${e.object}`);
    return w.part.get(e.offset)!;
  }
  if (e.kind === "table") {
    const at = e.segment * 16 + ((e.offset + evaluate(e.index, w)) & 0xffff);
    return e.width === 8 ? w.byte(at) : w.word(at);
  }
  if (e.kind !== "binary") throw new Error(`Unexpected ${e.kind}`);
  const a = evaluate(e.left, w),
    b = evaluate(e.right, w);
  const signed = (v: number) => (v << 16) >> 16;
  const result: Record<string, () => number> = {
    "+": () => a + b,
    "-": () => a - b,
    "*": () => a * b,
    "&": () => a & b,
    "|": () => a | b,
    "<<": () => a << b,
    ">>": () => signed(a) >> b,
    "==": () => Number(a === b),
    "!=": () => Number(a !== b),
  };
  if (!result[e.operator]) throw new Error(`Unexpected operator ${e.operator}`);
  return result[e.operator]!() & 0xffff;
}

describe("the frame drawing helpers", () => {
  it("are proved from every path, and give what the instructions do", () => {
    const { summaries } = fixture();
    const sizeHelper = summaries.get(SIZE)!,
      positionHelper = summaries.get(POSITION)!;
    expect(sizeHelper.frameDrawing).toMatchObject({ fields: [0x44, 0x46], paths: 6 });
    expect(positionHelper.frameDrawing).toMatchObject({ paths: 5 });
    expect(positionHelper.writes.map((w) => w.offset).sort()).toEqual([0x2a, 0x2c, 0x44, 0x46]);
    for (let seed = 1; seed <= 400; seed++) {
      const w = world(seed);
      const expected = reference(w);
      for (const write of positionHelper.writes) {
        expect(write.condition).toEqual({ kind: "true" });
        expect(evaluate(write.value, w)).toBe(expected.get(write.offset));
      }
    }
  });

  it("give a caller the exact values instead of unknown writes", () => {
    const { analyse } = fixture();
    const caller = analyse(CALLER);
    const outcome = caller.outcomes![0]!;
    for (let seed = 1; seed <= 100; seed++) {
      const w = world(seed);
      const expected = reference({ ...w, part: new Map(w.part).set(0x0c, 3) });
      for (const offset of [0x2a, 0x2c, 0x44, 0x46])
        expect(evaluate(outcome.fields.find((f) => f.offset === offset)!.value, w)).toBe(expected.get(offset));
    }
  });

  it("keep both values when only one of two paths redraws the part", () => {
    const { analyse, image } = fixture();
    // When bit 1 of 0x0a is set, the part is redrawn; either way it keeps its frame.
    const at = 0x400;
    image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 0x06, 0xf7, 0x44, 0x0a, 1, 0, 0x74, 7, 0x56, 0x0e], at);
    image.set([...near(at + 16, POSITION), 0x59, 0x90, 0x5e, 0x5d, 0xcb], at + 16);
    const routine = analyse(at);
    expect(routine.transitions).toHaveLength(1);
    const writes = routine.transitions[0]!.updates!;
    for (let seed = 1; seed <= 100; seed++) {
      const w = world(seed);
      const redrawn = w.part.get(0x0a)! & 1;
      const expected = redrawn ? reference(w) : w.part;
      for (const offset of [0x2a, 0x2c, 0x44, 0x46])
        expect(evaluate(writes.find((f) => f.offset === offset)!.value, w)).toBe(expected.get(offset));
    }
  });

  it("keep their general summaries when a path reads something else", () => {
    const { summaries, analyse } = fixture([0xa1, 0x34, 0x12]);
    expect(summaries.get(SIZE)!.frameDrawing).toBeUndefined();
    expect(summaries.get(POSITION)!.frameDrawing).toBeUndefined();
    const drawX = analyse(CALLER).outcomes![0]!.fields.find((f) => f.offset === 0x2a)!;
    expect(drawX.value.kind).toBe("unknown");
  });

  it("are worked out for a type with the record's frame offsets and sizes, but not its frame list", () => {
    const { summaries } = fixture();
    const write = (offset: number) => summaries.get(POSITION)!.writes.find((w) => w.offset === offset)!.value;
    const words = Array.from({ length: 12 }, () => Array.from({ length: 29 }, () => 0));
    words[3]![0x18 / 2] = 0x500;
    words[3]![0x1a / 2] = 0x600;
    words[11]![0x18 / 2] = 0x500;
    const table = { address: TYPES * 16, stride: 58, words };
    const build = (operator: string, left: Expression, right: Expression, width?: number) =>
      binary(operator, left, right, width, Infinity);
    const used = { table: false };
    const forType = (e: Expression, type: number) => frameDrawingForType(e, type, 4, table, build, used);
    expect(forType(write(0x44), 8)).toEqual({ kind: "constant", value: 0, width: 16 });
    const sized = JSON.stringify(forType(write(0x44), 3));
    expect(used.table).toBe(true);
    expect(sized).not.toContain('"offset":4,');
    expect(sized).toContain(`"segment":${DATA},"offset":${0x600}`);
    // Type 11 has no frame sizes: its width comes from the frame list, which the program sets while a level runs.
    expect(JSON.stringify(forType(write(0x44), 11))).toContain(`"segment":${TYPES},"offset":${11 * 58 + 0x14}`);
    for (let seed = 1; seed <= 200; seed++) {
      const w = world(seed);
      const type = w.part.get(0x04)!;
      if (type !== 3) continue;
      const record = TYPES * 16 + type * 58;
      const memory = (address: number) =>
        address === record + 0x18 ? 0x00 : address === record + 0x19 ? 0x05 : address === record + 0x1a ? 0 : -1;
      const byte = (address: number) =>
        address === record + 0x1b ? 0x06 : memory(address) >= 0 ? memory(address) : w.byte(address);
      const fixed = { ...w, byte, word: (address: number) => byte(address) | (byte(address + 1) << 8) };
      const expected = reference(fixed);
      for (const offset of [0x2a, 0x2c, 0x44, 0x46])
        expect(evaluate(forType(write(offset), type), fixed)).toBe(expected.get(offset));
    }
  });

  it("keep the record's words unread without a table of records one after another", () => {
    const { summaries } = fixture();
    const width = summaries.get(POSITION)!.writes.find((w) => w.offset === 0x44)!.value;
    const build = (operator: string, left: Expression, right: Expression, size?: number) =>
      binary(operator, left, right, size, Infinity);
    const used = { table: false };
    const sized = JSON.stringify(frameDrawingForType(width, 3, 4, undefined, build, used));
    expect(used.table).toBe(false);
    expect(sized).toContain(`"segment":${TYPES},"offset":${3 * 58 + 0x1a}`);
  });
});
