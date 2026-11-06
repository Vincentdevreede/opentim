import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import {
  discoverContactResponsePair,
  discoverPairCentreAngle,
  responseDampingFormula,
  responseFixedPositionFormula,
  reflectionOperations,
  exchangeOperations,
  type PairResponseFormula,
} from "../src/read/behaviour-contact-response-pair.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
import type { ContactMotionAngle } from "../src/read/behaviour-contact-motion-angle.ts";

const constants = (value: number): PairResponseFormula => ({ kind: "constant", value, width: 16 });
const named = (name: string): PairResponseFormula => ({ kind: "stage", name, width: 16 });
const dependencies = { resource: 1, rotation: 2, product: 3, limiter: 4, leftShift: 5, quotient: 6, rightShift: 7 };
const unsigned = (n: bigint, width: number) => BigInt.asUintN(width, n);
const signed = (n: bigint, width: number) => BigInt.asIntN(width, n);
/** This evaluates the public algebra only, never decoded instructions or a game object. */
function algebra(
  f: PairResponseFormula,
  variables: Record<string, bigint> = {},
  stages = new Map<string, PairResponseFormula>(),
): bigint {
  if (f.kind === "constant") return unsigned(BigInt(f.value), f.width);
  if (f.kind === "stage") {
    if (variables[f.name] !== undefined) return unsigned(variables[f.name]!, f.width);
    const formula = stages.get(f.name);
    if (!formula) throw Error("Missing mathematical definition: " + f.name);
    return unsigned(algebra(formula, variables, stages), f.width);
  }
  if (f.kind === "select")
    return unsigned(
      algebra(algebra(f.condition, variables, stages) !== 0n ? f.whenTrue : f.whenFalse, variables, stages),
      f.width,
    );
  if (f.kind === "sign-extend") return unsigned(signed(algebra(f.value, variables, stages), 16), 32);
  if (f.kind === "low-word") return unsigned(algebra(f.value, variables, stages), 16);
  if (f.kind === "high-word") return unsigned(algebra(f.value, variables, stages) >> 16n, 16);
  const left = algebra(f.left, variables, stages),
    right = algebra(f.right, variables, stages);
  let value: bigint;
  switch (f.operator) {
    case "+":
      value = left + right;
      break;
    case "-":
      value = left - right;
      break;
    case "&":
      value = left & right;
      break;
    case "|":
      value = left | right;
      break;
    case ">>":
      value = signed(left, f.width) >> right;
      break;
    case "<<":
      value = left << right;
      break;
    case "==":
      value = left === right ? 1n : 0n;
      break;
    case "!=":
      value = left !== right ? 1n : 0n;
      break;
    case "signed<":
      value = signed(left, f.left.width) < signed(right, f.right.width) ? 1n : 0n;
      break;
    case "signed>":
      value = signed(left, f.left.width) > signed(right, f.right.width) ? 1n : 0n;
      break;
    case "signed>=":
      value = signed(left, f.left.width) >= signed(right, f.right.width) ? 1n : 0n;
      break;
    case "signed-word-product":
      value = signed(left, 16) * signed(right, 16);
      break;
    case "signed-long-quotient":
      value = signed(left, 32) / signed(right, 32);
      break;
    default:
      throw Error("Unsupported public arithmetic: " + f.operator);
  }
  return unsigned(value, f.width);
}
function centreFixture(origin = 0x100, target = 0x900) {
  const bytes: number[] = [],
    emit = (...b: number[]) => bytes.push(...b);
  emit(0x55, 0x8b, 0xec, 0x83, 0xec, 18, 0x56, 0x57, 0x8b, 0x76, 6, 0x8b, 0x7e, 8);
  for (const [di, size, position, local] of [
    [false, 68, 30, -2],
    [false, 70, 32, -4],
    [true, 68, 30, -6],
    [true, 70, 32, -8],
  ] as const) {
    emit(
      0x8b,
      di ? 0x45 : 0x44,
      size,
      0xd1,
      0xf8,
      0x8b,
      di ? 0x55 : 0x54,
      position,
      0x03,
      0xd0,
      0x89,
      0x56,
      local & 255,
    );
  }
  emit(
    0x8b,
    0x46,
    0xfe,
    0x2b,
    0x46,
    0xfa,
    0x99,
    0x89,
    0x56,
    0xf4,
    0x89,
    0x46,
    0xf2,
    0x8b,
    0x46,
    0xf8,
    0x2b,
    0x46,
    0xfc,
    0x99,
    0x89,
    0x56,
    0xf0,
    0x89,
    0x46,
    0xee,
    0xff,
    0x76,
    0xf0,
    0x50,
    0xff,
    0x76,
    0xf4,
    0xff,
    0x76,
    0xf2,
    0x9a,
    target & 255,
    target >>> 8,
    0,
    0,
    0x83,
    0xc4,
    8,
    0x89,
    0x46,
    0xf6,
    0x5f,
    0x5e,
    0x8b,
    0xe5,
    0x5d,
    0xcb,
  );
  const image = new Uint8Array(0x2000);
  image.set(bytes, origin);
  const code = readRoutineCode(image, { address: origin, segment: 0, offset: origin }, 0);
  const finding = {
    confidence: "inferred" as const,
    evidence: [],
    assumptions: ["Certified bounded word differences."],
  };
  const backend: EngineSummary = {
    ...finding,
    address: target,
    kind: "contact-motion-angle",
    purpose: "Reads two bounded differences.",
    argumentOffset: 6,
    argumentKind: "unknown",
    writes: [],
    returns: [],
    calls: [],
    footprint: { complete: true, preservesArgumentMemory: true, preservesPartState: true, unknownEffects: [] },
    contactMotionAngle: { ...finding, backend: target } as unknown as ContactMotionAngle,
  };
  return { image, code, backend, summaries: new Map([[target, backend]]) };
}

describe("ordered collision reflection and exchange relations", () => {
  it.each([0x100, 0x300])("certifies a relocated centre-angle wrapper at %i", (origin) => {
    const f = centreFixture(origin, 0xa00),
      relation = discoverPairCentreAngle(f.code, f.summaries)!;
    expect(relation).toBeDefined();
    expect(relation.fields).toEqual({ x: 30, y: 32, width: 68, height: 70 });
    expect(relation.backend.backend).toBe(0xa00);
    expect(relation.evidence).toHaveLength(f.code.instructions.length);
  });
  it("declines altered geometry fields, writes, missing edges and an unproved backend", () => {
    const f = centreFixture();
    expect(discoverPairCentreAngle(f.code, new Map())).toBeUndefined();
    expect(discoverPairCentreAngle({ ...f.code, edges: f.code.edges.slice(1) }, f.summaries)).toBeUndefined();
    const altered = f.image.slice(),
      positionLoad = f.code.instructions.find(
        (i) => i.mnemonic === "mov" && i.operands[1]?.kind === "memory" && i.operands[1].displacement === 30,
      )!;
    altered[positionLoad.address + 2] = 42;
    expect(discoverPairCentreAngle(readRoutineCode(altered, f.code, 0), f.summaries)).toBeUndefined();
    const writeImage = f.image.slice();
    writeImage[positionLoad.address] = 0x89;
    expect(discoverPairCentreAngle(readRoutineCode(writeImage, f.code, 0), f.summaries)).toBeUndefined();
    f.backend.footprint.preservesArgumentMemory = false;
    expect(discoverPairCentreAngle(f.code, f.summaries)).toBeUndefined();
  });
  it("does not grant a complete response to a matching prefix followed by an unknown effect", () => {
    const image = Uint8Array.from([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0xc7, 0x44, 12, 1, 0, 0x5e, 0x5d, 0xcb]);
    const code = readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0);
    expect(discoverContactResponsePair(code, new Map([[0, code]]), new Map(), 0, 0, 1, image)).toBeUndefined();
  });
  it("retains the signed word damping boundary on either side of zero", () => {
    const formula = responseDampingFormula(named("normal"));
    for (const [input, expected] of [
      [-32768, -32704],
      [-65, -1],
      [-64, 0],
      [-1, 0],
      [0, 0],
      [64, 0],
      [65, 1],
      [32767, 32703],
    ])
      expect(signed(algebra(formula, { normal: BigInt(input!) }), 16)).toBe(BigInt(expected!));
  });
  it("reconstructs signed fixed position with the encoded inclusive edge", () => {
    for (const position of [-32768, -1, 0, 1, 32767])
      for (const sign of [-1, 0, 1]) {
        const result = signed(algebra(responseFixedPositionFormula(constants(position), constants(sign))), 32);
        expect(result).toBe(BigInt(position * 512 + (sign < 0 ? 0 : 511)));
      }
  });
  it("keeps reflection's position sign from the snapshot before the limiter", () => {
    const operations = reflectionOperations(dependencies, true, true);
    const limit = operations.findIndex((o) => o.kind === "limit"),
      fixed = operations.find((o) => o.kind === "bind" && o.name === "fixedPositionX");
    expect(limit).toBeGreaterThan(0);
    expect(fixed?.kind === "bind" && JSON.stringify(fixed.value)).toContain("reflectedWorldX");
    expect(operations.some((o) => o.kind === "capture" && o.name.includes("LimitedVelocity"))).toBe(false);
    expect(operations.filter((o) => o.kind === "rotate")).toHaveLength(2);
  });
  it("retains coefficient and friction-gate differences without inventing them in the older form", () => {
    const older = reflectionOperations(dependencies, false, false),
      newer = reflectionOperations(dependencies, true, true);
    expect(older.some((o) => o.kind === "capture" && o.offset === 6 && o.source === "record")).toBe(false);
    expect(older.some((o) => o.kind === "bind" && o.name === "selectedCoefficient")).toBe(false);
    expect(newer.some((o) => o.kind === "bind" && o.name === "selectedCoefficient")).toBe(true);
    expect(newer.some((o) => o.kind === "capture" && o.name === "ownerRecordSix")).toBe(true);
  });
  it("preserves quotient numerators, wrapping and the zero-sum normal-return requirement", () => {
    const operations = exchangeOperations(dependencies, 8, 1024, true, false);
    const stages = new Map(operations.flatMap((o) => (o.kind === "bind" ? [[o.name, o.value] as const] : [])));
    const inputs = { ownerMass: 32767n, partnerMass: -32768n, ownerLineX: -32768n, partnerLineX: 32767n };
    const a = -32768n * 32767n,
      z = 32767n * -32768n,
      x = -32768n * -32768n;
    expect(algebra({ kind: "stage", name: "massSum", width: 32 }, inputs, stages)).toBe(0xffffffffn);
    expect(algebra({ kind: "stage", name: "ownerExchangeNumerator", width: 32 }, inputs, stages)).toBe(
      unsigned(a + z + z - x, 32),
    );
    expect(operations.find((o) => o.kind === "normal-return-requires")).toEqual({
      kind: "normal-return-requires",
      value: { kind: "stage", name: "massSum", width: 32 },
      relation: "nonzero",
    });
  });
  it("captures the peer after the owner's conditional separation store and keeps both limiter calls", () => {
    const operations = exchangeOperations(dependencies, 8, 1024, true, false);
    const ownerWrite = operations.findIndex(
      (o) => o.kind === "write" && o.object === "owner" && o.offset === 54 && !!o.condition,
    );
    const peerRead = operations.findIndex((o) => o.kind === "capture" && o.name === "partnerBeforeSeparationWrite");
    const peerWrite = operations.findIndex(
      (o) => o.kind === "write" && o.object === "partner" && o.offset === 54 && !!o.condition,
    );
    expect(ownerWrite).toBeLessThan(peerRead);
    expect(peerRead).toBeLessThan(peerWrite);
    expect(operations.filter((o) => o.kind === "limit").map((o) => o.object)).toEqual(["owner", "partner"]);
    const positionRead = operations.findIndex((o) => o.kind === "capture" && o.name === "ownerLimitedVelocityX");
    expect(positionRead).toBeGreaterThan(operations.findLastIndex((o) => o.kind === "limit"));
  });
  it("retains the older separation threshold and the newer dominance gate independently", () => {
    const older = exchangeOperations(dependencies, 8, 512, false, true),
      newer = exchangeOperations(dependencies, 8, 1024, true, false);
    expect(older.some((o) => o.kind === "bind" && o.name === "unusedMinimumCoefficient")).toBe(true);
    expect(older.some((o) => o.kind === "bind" && o.name === "separationAfterDominance")).toBe(false);
    expect(newer.some((o) => o.kind === "bind" && o.name === "separationAfterDominance")).toBe(true);
    const olderStore = older.find(
      (o) => o.kind === "write" && o.object === "owner" && o.offset === 54 && !!o.condition,
    );
    expect(olderStore && JSON.stringify(olderStore)).toContain('"value":512');
  });
});
