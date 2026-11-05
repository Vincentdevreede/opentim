import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverDirectedVelocity } from "../src/read/behaviour-directed-velocity.ts";

const word = (n: number) => [n & 255, (n >>> 8) & 255];
const read = (image: Uint8Array, address: number) =>
  readRoutineCode(image, { address, segment: 0, offset: address }, 0);
/** The coefficient lookup, with the quarter turn added first when `phase` is set. */
function scalar(image: Uint8Array, address: number, phase: boolean) {
  const bytes = [0x8b, 0xdc, 0x36, 0x8b, 0x47, 4, ...(phase ? [0x05, 0, 0xc0] : [])];
  bytes.push(0xd1, 0xe8, 0xd1, 0xe8, 0xd1, 0xe8, 0xd1, 0xe8, 0xa9, 0, 8, 0x74, 5, 0xf7, 0xd8, 0x05, 0, 16);
  bytes.push(0x8b, 0xd8, 0xd1, 0xe3, 0x2e, 0x8b, 0x87, ...word(0x2000), 0xcb);
  image.set(bytes, address);
  return read(image, address);
}
/** The signed long shift right, entered by a near call. */
function shift(image: Uint8Array, address: number) {
  image.set(
    [
      0x5b, 0x0e, 0x53, 0x80, 0xf9, 16, 0x73, 16, 0x8b, 0xda, 0xd3, 0xe8, 0xd3, 0xfa, 0xf6, 0xd9, 0x80, 0xc1, 16, 0xd3,
      0xe3, 0x0b, 0xc3, 0xcb, 0x80, 0xe9, 16, 0x92, 0x99, 0xd3, 0xf8, 0xcb,
    ],
    address,
  );
  return read(image, address);
}
const SETTER = 0x100;
/** The speed setter as the games have it, with its callees at 0x600 to 0x900. */
function fixture(store = 0x36) {
  const image = new Uint8Array(0x4000);
  for (let n = 0; n < 2049; n++) image.set(word((n * 91 + 23) & 65535), 0x2000 + 2 * n);
  const vertical = scalar(image, 0x600, false),
    horizontal = scalar(image, 0x680, true);
  image.set([0x8b, 0xdc, 0x8b, 0x47, 4, 0xf7, 0x6f, 6, 0xcb], 0x800);
  const product = read(image, 0x800),
    shifted = shift(image, 0x900);
  const far = (target: number) => [0x9a, ...word(target), 0, 0];
  const near = (at: number) => [0xe8, ...word(0x900 - (SETTER + at + 3))];
  const bytes = [0x55, 0x8b, 0xec, 0x83, 0xec, 8, 0x56, 0x57, 0x8b, 0x76, 6, 0x8b, 0x7e, 8, 0x57, ...far(0x680)];
  bytes.push(0x59, 0x50, 0xff, 0x76, 10, ...far(0x800), 0x59, 0x59, 0x89, 0x56, 0xfe, 0x89, 0x46, 0xfc);
  bytes.push(0x57, ...far(0x600), 0x59, 0x50, 0xff, 0x76, 10, ...far(0x800), 0x59, 0x59, 0x89, 0x56, 0xfa);
  bytes.push(0x89, 0x46, 0xf8, 0x8b, 0x56, 0xfe, 0x8b, 0x46, 0xfc, 0xb1, 14);
  bytes.push(...near(bytes.length), 0x89, 0x44, store, 0x8b, 0x56, 0xfa, 0x8b, 0x46, 0xf8, 0xb1, 14);
  bytes.push(...near(bytes.length), 0x89, 0x44, 0x38, 0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
  image.set(bytes, SETTER);
  const code = read(image, SETTER);
  const codes = new Map([code, vertical, horizontal, product, shifted].map((c) => [c.address, c]));
  return { image, code, codes };
}

describe("the speed setter", () => {
  it("is proved from its whole graph and its four callees", () => {
    const f = fixture();
    expect(f.code.status).toBe("complete");
    const summary = discoverDirectedVelocity(f.code, f.codes, f.image)!;
    expect(summary.kind).toBe("owner-field-update");
    expect(summary.directedVelocity).toMatchObject({
      arguments: { part: 6, angle: 8, speed: 10 },
      stores: [
        { field: 0x36, coefficient: "horizontal" },
        { field: 0x38, coefficient: "vertical" },
      ],
      shift: { routine: 0x900, count: 14, convention: "near" },
      multiplication: { routine: 0x800, operation: "signedWordProduct" },
    });
    expect(summary.directedVelocity.coefficients.horizontal.phase).toBe(49152);
    expect(summary.directedVelocity.coefficients.vertical.phase).toBe(0);
    // Both fields are always written: straight-line code with no branch.
    expect(summary.writes.map((w) => [w.offset, w.condition.kind])).toEqual([
      [0x36, "true"],
      [0x38, "true"],
    ]);
    expect(summary.footprint).toMatchObject({ complete: true, preservesPartState: true });
  });

  it("is not proved when a store goes elsewhere or a callee differs", () => {
    const f = fixture(0x3a);
    expect(discoverDirectedVelocity(f.code, f.codes, f.image)).toBeUndefined();
    const g = fixture();
    g.codes.delete(0x800);
    expect(discoverDirectedVelocity(g.code, g.codes, g.image)).toBeUndefined();
  });

  it("lets a caller keep the speed it passed with the two velocity fields, until something else writes them", () => {
    const f = fixture();
    const summary = discoverDirectedVelocity(f.code, f.codes, f.image)!;
    // push bp; mov bp, sp; mov si, [bp+6]; mov ax, 4096; push ax; push [bp+8]; push si; call far setter; add sp, 6
    const caller = [0x55, 0x8b, 0xec, 0x8b, 0x76, 6, 0xb8, 0, 0x10, 0x50, 0xff, 0x76, 8, 0x56, 0x9a];
    caller.push(...word(SETTER), 0, 0, 0x83, 0xc4, 6);
    const run = (after: number[]) => {
      const image = new Uint8Array(f.image);
      image.set([...caller, ...after, 0x5d, 0xcb], 0x1000);
      const code = read(image, 0x1000);
      return analyseRoutine(image, code, {
        dataSegment: 0,
        stateOffset: 12,
        engineSummaries: new Map([[SETTER, summary]]),
      });
    };
    const fields = run([]).outcomes!.flatMap((o) => o.fields);
    const velocity = fields.filter((w) => w.object === "part" && (w.offset === 0x36 || w.offset === 0x38));
    expect(velocity.map((w) => [w.offset, w.value.kind, w.directedSpeed?.axis, w.directedSpeed?.speed])).toEqual([
      [0x36, "unknown", "horizontal", { kind: "constant", value: 4096, width: 16 }],
      [0x38, "unknown", "vertical", { kind: "constant", value: 4096, width: 16 }],
    ]);
    expect(velocity[0]!.directedSpeed).toMatchObject({ routine: SETTER, call: 0x1000 + 14 });
    // mov word [si+0x36], 7 replaces the horizontal one.
    const later = run([0xc7, 0x44, 0x36, 7, 0]).outcomes!.flatMap((o) => o.fields);
    expect(later.find((w) => w.object === "part" && w.offset === 0x36)).toMatchObject({
      value: { kind: "constant", value: 7 },
    });
    expect(later.find((w) => w.object === "part" && w.offset === 0x36)?.directedSpeed).toBeUndefined();
    expect(later.find((w) => w.object === "part" && w.offset === 0x38)?.directedSpeed?.speed).toMatchObject({
      value: 4096,
    });
  });
});
