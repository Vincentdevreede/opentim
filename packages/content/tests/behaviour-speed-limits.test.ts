import { describe, expect, it } from "vitest";
import { findSpeedLimitSetup, limitForAir } from "../src/read/behaviour-speed-limits.ts";

const DATA_SEGMENT = 0x100;
const TABLE_OFFSET = 0x200;
const COUNT = 58;

/**
 * A speed limit routine in the form TIM 1 has: a loop over the type numbers in the local at [bp-2], the record's place
 * in di, the number 0x3000 for types 20 and 43, and 0x2600 minus the air value at [bp-8] for the rest. A far call to it
 * comes first in the image.
 */
function program(
  options: { fallThrough?: boolean; writeCounter?: boolean; far?: boolean; writePointer?: number } = {},
) {
  const origin = 0x10;
  const bytes: number[] = [];
  const labels = new Map<string, number>();
  const patches: { at: number; name: string; width: 1 | 2 }[] = [];
  const emit = (...values: number[]) => bytes.push(...values);
  const label = (name: string) => labels.set(name, origin + bytes.length);
  const jump = (opcode: number, name: string) => {
    emit(opcode);
    const width = opcode === 0xe9 ? 2 : 1;
    patches.push({ at: bytes.length, name, width });
    emit(...Array<number>(width).fill(0));
  };
  emit(0x55, 0x8b, 0xec, 0x83, 0xec, 0x0e, 0x56, 0x57);
  emit(0xa1, 0x34, 0x12, 0x89, 0x46, 0xf8); // mov ax,[air]; mov [bp-8],ax
  emit(0x83, 0x7e, 0xf8, 70); // cmp word [bp-8],70
  jump(0x7d, "high");
  emit(0xd1, 0x7e, 0xf8); // sar word [bp-8],1
  jump(0xeb, "scaled");
  label("high");
  emit(0xb1, 0x04, 0xd3, 0x66, 0xf8); // mov cl,4; shl word [bp-8],cl
  label("scaled");
  emit(0xc7, 0x46, 0xfe, 0, 0); // mov word [bp-2],0
  jump(0xe9, "condition");
  label("head");
  emit(0x8b, 0x46, 0xfe, 0xba, 58, 0, 0xf7, 0xea, 0x05, TABLE_OFFSET & 0xff, TABLE_OFFSET >> 8);
  if (options.far) emit(0xc7, 0x46, 0xf4, DATA_SEGMENT & 0xff, DATA_SEGMENT >> 8, 0x89, 0x46, 0xf2);
  else emit(0x8b, 0xf8); // mov di,ax
  if (options.writeCounter) emit(0x89, 0x46, 0xfe); // mov [bp-2],ax
  if (options.writePointer !== undefined) emit(0x89, 0x46, options.writePointer); // mov [bp+d],ax
  emit(0x83, 0x7e, 0xfe, 20);
  jump(0x74, "fixed");
  emit(0x83, 0x7e, 0xfe, 43);
  jump(0x75, "other");
  label("fixed");
  if (options.far) emit(0xc4, 0x5e, 0xf2, 0x26, 0xc7, 0x47, 0x0a, 0x00, 0x30);
  else emit(0xc7, 0x45, 0x0a, 0x00, 0x30);
  if (!options.fallThrough) jump(0xeb, "step");
  label("other");
  if (options.far) emit(0xc4, 0x5e, 0xf2);
  emit(0xb8, 0x00, 0x26, 0x2b, 0x46, 0xf8); // mov ax,0x2600; sub ax,[bp-8]
  if (options.far) emit(0x26, 0x89, 0x47, 0x0a);
  else emit(0x89, 0x45, 0x0a);
  label("step");
  emit(0xff, 0x46, 0xfe); // inc word [bp-2]
  label("condition");
  emit(0x83, 0x7e, 0xfe, COUNT);
  jump(0x7d, "exit");
  jump(0xe9, "head");
  label("exit");
  emit(0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
  for (const patch of patches) {
    const next = origin + patch.at + patch.width;
    const displacement = labels.get(patch.name)! - next;
    bytes[patch.at] = displacement & 0xff;
    if (patch.width === 2) bytes[patch.at + 1] = (displacement >> 8) & 0xff;
  }
  const image = new Uint8Array(0x2000 + COUNT * 58);
  image.set([0x9a, origin, 0, 0, 0], 0); // call far 0000:origin
  image.set(bytes, origin);
  return image;
}

const table = { address: DATA_SEGMENT * 16 + TABLE_OFFSET, stride: 58, count: COUNT };

describe("the speed limit routine", () => {
  it("gives the types whose limit is the same number in every level", () => {
    const setup = findSpeedLimitSetup(program(), table, DATA_SEGMENT);
    expect(setup?.routine).toBe(0x10);
    expect(setup?.callers).toEqual([0]);
    expect(setup?.fixed).toEqual([
      { type: 20, limit: 0x3000 },
      { type: 43, limit: 0x3000 },
    ]);
    expect(setup?.base).toBe(0x2600);
    expect(setup?.assumptions[0]).toContain("0x10");
  });

  it("reads how the air pressure becomes the value taken from the base", () => {
    const setup = findSpeedLimitSetup(program(), table, DATA_SEGMENT)!;
    expect(setup.air).toEqual({ address: 0x1234, split: 70, below: 1, above: 4 });
    // Half the air pressure below 70, else 16 times it.
    expect([0, 67, 69, 70, 128].map((air) => limitForAir(setup, air))).toEqual([9728, 9695, 9694, 8608, 7680]);
  });

  it("reads a record pointer kept in two locals and read back through es", () => {
    const setup = findSpeedLimitSetup(program({ far: true }), table, DATA_SEGMENT);
    expect(setup?.fixed.map((f) => f.type)).toEqual([20, 43]);
  });

  it("takes the last store on a way, so a number the next store replaces isn't the limit", () => {
    const setup = findSpeedLimitSetup(program({ fallThrough: true }), table, DATA_SEGMENT);
    expect(setup?.fixed).toEqual([]);
    expect(setup?.base).toBe(0x2600);
  });

  it("reads nothing when the loop's body changes the type number", () => {
    expect(findSpeedLimitSetup(program({ writeCounter: true }), table, DATA_SEGMENT)).toBeUndefined();
  });

  it("reads nothing when the loop's body stores a word over either half of the record pointer", () => {
    // The pointer is the far local at [bp-14]: its offset word at [bp-14], its segment word at [bp-12].
    for (const half of [0xf2, 0xf4])
      expect(findSpeedLimitSetup(program({ far: true, writePointer: half }), table, DATA_SEGMENT)).toBeUndefined();
  });

  it("reads nothing from a table at another place", () => {
    expect(findSpeedLimitSetup(program(), { ...table, address: table.address + 58 }, DATA_SEGMENT)).toBeUndefined();
  });
});
