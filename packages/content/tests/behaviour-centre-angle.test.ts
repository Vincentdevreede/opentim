import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { addCentreAngleSummaries, directionError } from "../src/read/behaviour-centre-angle.ts";
import type { ContactMotionAngle } from "../src/read/behaviour-contact-motion-angle.ts";
import type { DirectedVelocity } from "../src/read/behaviour-directed-velocity.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";

const BACKEND = 0x800;
/** The centre angle as Even More, TIM 1 or the Even More demo has it, calling the angle helper at 0x800. */
function centreAngle(form: "evenmore" | "tim1" | "demo" = "evenmore", width = 0x44) {
  const tim1 = form === "tim1";
  const bytes = [0x55, 0x8b, 0xec, 0x83, 0xec, 0x12, 0x56, 0x57, 0x8b, 0x76, 6, 0x8b, 0x7e, 8];
  for (const [base, local] of [
    [0x44, 0xfe],
    [0x45, 0xfa],
  ] as const) {
    bytes.push(0x8b, base, width, 0xd1, 0xf8, 0x8b, base + 0x10, 0x1e, 0x03, 0xd0, 0x89, 0x56, local);
    bytes.push(0x8b, base, 0x46, 0xd1, 0xf8, 0x8b, base + 0x10, 0x20, 0x03, 0xd0, 0x89, 0x56, local - 2);
  }
  bytes.push(0x8b, 0x46, 0xfe, 0x2b, 0x46, 0xfa, 0x99, 0x89, 0x56, 0xf4, 0x89, 0x46, 0xf2);
  bytes.push(0x8b, 0x46, 0xf8, 0x2b, 0x46, 0xfc, 0x99, 0x89, 0x56, 0xf0, 0x89, 0x46, 0xee);
  bytes.push(...(form === "demo" ? [0x52] : [0xff, 0x76, 0xf0]), ...(tim1 ? [0xff, 0x76, 0xee] : [0x50]));
  bytes.push(0xff, 0x76, 0xf4, 0xff, 0x76, 0xf2);
  bytes.push(0x9a, BACKEND & 255, BACKEND >> 8, 0, 0, 0x83, 0xc4, 8, 0x89, 0x46, 0xf6);
  if (tim1) bytes.push(0x8b, 0x46, 0xf6, 0xeb, 0);
  bytes.push(0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
  const image = new Uint8Array(0x1000);
  image.set(bytes, 0x100);
  image[BACKEND] = 0xcb;
  return readRoutineCode(image, { address: 0x100, segment: 0, offset: 0x100 }, 0);
}
const finding = { confidence: "inferred" as const, assumptions: ["The helper's own assumption."], evidence: [] };
/** The movement angle helper with a lookup of rounded arctangents, a sixteenth of a turn being 512. */
const backend = (lookup = Array.from({ length: 512 }, (_, t) => Math.round((Math.atan(t / 512) * 2048) / Math.PI))) =>
  ({
    ...finding,
    backend: BACKEND,
    lookup: { initialImageWords: lookup },
  }) as unknown as ContactMotionAngle;
const layout = {
  fields: [
    { name: "positionX", offset: 0x1e },
    { name: "positionY", offset: 0x20 },
    { name: "frameWidth", offset: 0x44 },
    { name: "frameHeight", offset: 0x46 },
  ],
} as unknown as BehaviourLayout;
const summaries = (code: ReturnType<typeof centreAngle>) =>
  new Map<number, EngineSummary>([
    [BACKEND, { ...finding, address: BACKEND, contactMotionAngle: backend() } as unknown as EngineSummary],
    [
      code.address,
      { ...finding, address: code.address, kind: "call-wrapper", purpose: "?" } as unknown as EngineSummary,
    ],
  ]);
/** The speed setter's coefficient table: rounded cosines over half a turn. */
const velocity = (sign = 1) =>
  ({
    coefficients: {
      vertical: {
        table: {
          initialImageWords: Array.from(
            { length: 2049 },
            (_, n) => Math.round(sign * 16384 * Math.cos((Math.PI * n) / 2048)) & 0xffff,
          ),
        },
      },
    },
  }) as unknown as DirectedVelocity;

describe("the centre angle", () => {
  it.each(["evenmore", "tim1", "demo"] as const)("is proved from its whole graph and the angle helper (%s)", (form) => {
    const code = centreAngle(form);
    expect(code.status).toBe("complete");
    const map = summaries(code);
    addCentreAngleSummaries(new Map([[code.address, code]]), map, layout);
    expect(map.get(code.address)!.centreAngle).toMatchObject({
      arguments: { from: 6, to: 8 },
      fields: { positionX: 0x1e, positionY: 0x20, frameWidth: 0x44, frameHeight: 0x46 },
      x: "fromMinusTo",
      y: "toMinusFrom",
      backend: { backend: BACKEND },
    });
    expect(map.get(code.address)!.kind).toBe("call-wrapper");
  });

  it("is not proved when a centre reads another field", () => {
    const code = centreAngle("evenmore", 0x42);
    const map = summaries(code);
    addCentreAngleSummaries(new Map([[code.address, code]]), map, layout);
    expect(map.get(code.address)!.centreAngle).toBeUndefined();
  });

  it("gives a velocity from the first centre to the second, within a bound over every answer", () => {
    for (const speed of [2048, 4096, 7168]) expect(directionError(backend(), velocity(), speed)).toBeLessThan(0.3);
    // A table that points the other way is caught, and so is a missing lookup.
    expect(directionError(backend(), velocity(-1), 4096)).toBeGreaterThan(179);
    expect(directionError(backend([]), velocity(), 4096)).toBeUndefined();
  });
});
