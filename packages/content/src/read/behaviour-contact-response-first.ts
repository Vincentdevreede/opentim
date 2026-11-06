/** Certifies the first selected contact response as an ordered graph of integer expressions. */
import { firstResponsePatterns } from "./behaviour-response-first-patterns.ts";
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import { discoverContactArithmetic } from "./behaviour-contact-arithmetic.ts";
import {
  discoverRotationScalar,
  discoverRotationShift,
  discoverRotationLeftShift,
  type RotationScalar,
} from "./behaviour-contact-rotation.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Evidence, Finding } from "./behaviour.ts";

/** Named stages are computed values, rather than independently assignable part fields. */
export type FirstResponseFormula =
  | { kind: "constant"; value: number; width: 16 | 32 }
  | { kind: "input" | "stage"; name: string; width: 16 | 32 }
  | { kind: "binary"; operator: string; left: FirstResponseFormula; right: FirstResponseFormula; width: 16 | 32 }
  | {
      kind: "select";
      condition: FirstResponseFormula;
      whenTrue: FirstResponseFormula;
      whenFalse: FirstResponseFormula;
      width: 16 | 32;
    }
  | { kind: "sign-extend"; value: FirstResponseFormula; width: 32 }
  | { kind: "low-word" | "high-word"; value: FirstResponseFormula; width: 16 }
  | { kind: "lookup"; scalar: "first" | "second"; angle: FirstResponseFormula; width: 16 };
export interface ContactResponseFirst extends Finding {
  kind: "sliding-contact-response";
  ownerArgument: 6;
  fields: {
    type: 4;
    flags: 6;
    contactPart: 132;
    sideFirst: 134;
    sideSecond: 135;
    contactAngle: 136;
    velocityX: 54;
    velocityY: 56;
    positionY: 32;
    fixedYLow: 26;
    fixedYHigh: 28;
  };
  table: { segment: number; offset: number; stride: 58; typeCount: number; reads: "runtime" };
  inputs: (Finding & {
    name: string;
    source: "partField" | "contactPartField" | "partRecord" | "contactPartRecord";
    offset: number;
    width: 8 | 16;
  })[];
  scalars: { first: RotationScalar; second: RotationScalar };
  dependencies: {
    firstScalar: number;
    secondScalar: number;
    product: number;
    rightShift: number;
    limiter: number;
    leftShift: number;
  };
  stages: (Finding & { name: string; description: string; value: FirstResponseFormula })[];
  stores: (Finding & {
    offset: number;
    width: 16;
    value: FirstResponseFormula;
    condition: FirstResponseFormula;
    phase: "beforeLimit" | "limit" | "position";
  })[];
  arithmetic: "wordAndLongResultsWrapBeforeLaterComparisons";
  preservesState: true;
  inputSnapshots: "entryEquivalentUnderStorageAssumptions";
  unrelatedFieldsPreserved: true;
  returns: "unspecifiedVolatileRegisters";
}
const constant = (value: number, width: 16 | 32 = 16): FirstResponseFormula => ({ kind: "constant", value, width });
const input = (name: string): FirstResponseFormula => ({ kind: "input", name, width: 16 });
const ref = (name: string, width: 16 | 32 = 16): FirstResponseFormula => ({ kind: "stage", name, width });
const binary = (
  operator: string,
  left: FirstResponseFormula,
  right: FirstResponseFormula,
  width: 16 | 32 = 16,
): FirstResponseFormula => ({ kind: "binary", operator, left, right, width });
const select = (
  condition: FirstResponseFormula,
  whenTrue: FirstResponseFormula,
  whenFalse: FirstResponseFormula,
  width: 16 | 32 = 16,
): FirstResponseFormula => ({ kind: "select", condition, whenTrue, whenFalse, width });
const low = (value: FirstResponseFormula): FirstResponseFormula => ({ kind: "low-word", value, width: 16 });
const extend = (value: FirstResponseFormula): FirstResponseFormula => ({ kind: "sign-extend", value, width: 32 });
const negative = (value: FirstResponseFormula): FirstResponseFormula => binary("-", constant(0), value);
const absolute = (value: FirstResponseFormula): FirstResponseFormula =>
  select(binary("signed<", value, constant(0)), negative(value), value);
const product = (left: FirstResponseFormula, right: FirstResponseFormula): FirstResponseFormula =>
  binary("*", extend(left), extend(right), 32);
const scaled = (left: FirstResponseFormula, right: FirstResponseFormula, shift: number): FirstResponseFormula =>
  low(binary(">>", product(left, right), constant(shift, 32), 32));
const clamp = (value: FirstResponseFormula): FirstResponseFormula =>
  select(
    binary("signed>", value, input("limit")),
    input("limit"),
    select(binary("signed<", value, negative(input("limit"))), negative(input("limit")), value),
  );
const evidence = (code: RoutineCode): Evidence[] =>
  code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text }));

/** The pattern binds a complete graph. Only proved transitive dependencies grant a complete field footprint. */
export function discoverFirstContactResponse(
  code: RoutineCode,
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  image: Uint8Array,
  table: number | undefined,
  dataSegment: number,
  typeCount: number | undefined,
): (EngineSummary & { contactResponseFirst: ContactResponseFirst }) | undefined {
  if (table === undefined || typeCount === undefined || !Number.isInteger(typeCount) || typeCount <= 0) return;
  const bindings = firstResponsePatterns.map((pattern) => matchHeapRoutine(code, pattern, new Map())).find(Boolean);
  if (!bindings) return;
  const segment = bindings.get("tableSegment") ?? dataSegment,
    offset = bindings.get("tableOffset")!;
  if (
    offset < 0 ||
    segment * 16 + offset !== table ||
    offset + typeCount * 58 > 65536 ||
    table + typeCount * 58 > image.length
  )
    return;
  const target = (name: string) => codes.get(bindings.get(name)!);
  const firstCode = target("calleeA"),
    secondCode = target("calleeB"),
    productCode = target("calleeC");
  const first = firstCode && discoverRotationScalar(firstCode, image),
    second = secondCode && discoverRotationScalar(secondCode, image);
  const multiplication = productCode && discoverContactArithmetic(productCode);
  const rightCode = target("calleeD"),
    leftCode = target("calleeF");
  const right = rightCode && discoverRotationShift(rightCode),
    limiter = summaries.get(bindings.get("calleeE")!),
    left = leftCode && discoverRotationLeftShift(leftCode);
  if (
    !first ||
    first.phase !== 0 ||
    !second ||
    second.phase !== 49152 ||
    multiplication?.operation !== "signedWordProduct" ||
    right?.numeric?.operation !== "arithmeticRightShift32" ||
    left?.numeric?.operation !== "leftShift32" ||
    !right.footprint.preservesArgumentMemory ||
    !left.footprint.preservesArgumentMemory ||
    limiter?.contactResponse?.kind !== "velocity-limit" ||
    !limiter.footprint.complete ||
    !limiter.footprint.partMemoryComplete ||
    !limiter.footprint.preservesPartState ||
    limiter.contactResponse.table.segment !== segment ||
    limiter.contactResponse.table.offset !== offset ||
    limiter.contactResponse.table.typeCount !== typeCount
  )
    return;
  // Full patterns establish each stack cleanup and argument order. Return kinds must agree with each actual call.
  for (const call of code.calls) {
    const helper = call.target && summaries.get(call.target.address),
      callee = call.target && codes.get(call.target.address);
    const returns = callee?.instructions.filter((i) => i.flow === "return") ?? [];
    if (!callee || callee.status !== "complete" || !returns.length) return;
    const index = code.instructions.findIndex((i) => i.address === call.instruction),
      previous = code.instructions[index - 1];
    const bridge =
      previous?.mnemonic === "push" && previous.operands[0]?.kind === "register" && previous.operands[0].name === "cs";
    const far = call.far || bridge;
    const adapter =
      call.target!.address === right.address ? right : call.target!.address === left.address ? left : undefined;
    if (adapter) {
      if (adapter.returnConvention?.kind !== (far ? "far" : "near") || adapter.returnConvention.stackBytes) return;
    } else if (
      returns.some((i) => i.mnemonic !== (far ? "retf" : "ret") || i.operands.length) ||
      (helper?.returnConvention &&
        (helper.returnConvention.kind !== (far ? "far" : "near") || helper.returnConvention.stackBytes))
    )
      return;
  }
  const assumptions = [
    ...first.assumptions,
    ...second.assumptions,
    ...multiplication.assumptions,
    ...right.assumptions,
    ...left.assumptions,
    ...limiter.assumptions,
    "The far C argument is a complete nonwrapping part. Its recorded contact pointer is valid and both runtime types select records in the discovered table. The contact part may be the argument itself. Its type and control, and the contact angle and side inputs, are read before the velocity stores. Those stores change none of those inputs. The later limit and position reads are entry-equivalent because their storage remains unchanged under the separate-storage assumptions.",
    "Private stack, type records and scalar lookup storage are separate from the argument and contact part. Tables remain stable during this call. The data segment and C preserved registers retain their decoded calling-convention meanings; arithmetic runtime stack reads through DS require DS and SS to agree.",
    "Named stages are acyclic definitions evaluated from their listed inputs. Every word or long arithmetic result wraps to its declared width before later signed comparisons. Right shifts are arithmetic; word inputs are sign-extended before signed long products. No floating-point angle or unbounded absolute value replaces these operations.",
    "The limiter has the same runtime type table and applies its signed upper-priority rule to vertical and then horizontal velocity. Return-register values remain unspecified. The complete footprint establishes preservation of unrelated part fields, not that this response is reached by a runtime collision.",
  ];
  const proof = [
    ...evidence(code),
    ...first.evidence,
    ...second.evidence,
    ...multiplication.evidence,
    ...right.evidence,
    ...left.evidence,
    ...limiter.evidence,
  ];
  const finding: Finding = { confidence: "inferred", assumptions: [...new Set(assumptions)], evidence: proof };
  const stages = firstContactResponseFormulae().map((stage) => ({ ...finding, ...stage }));
  const inputs: ContactResponseFirst["inputs"] = [
    ["contactAngle", "partField", 136, 16],
    ["sideFirst", "partField", 134, 8],
    ["sideSecond", "partField", 135, 8],
    ["velocityX", "partField", 54, 16],
    ["flags", "partField", 6, 16],
    ["positionY", "partField", 32, 16],
    ["contactType", "contactPartField", 4, 16],
    ["contactControl", "contactPartField", 18, 16],
    ["ownCoefficient", "partRecord", 6, 16],
    ["contactCoefficient", "contactPartRecord", 6, 16],
    ["recordAcceleration", "partRecord", 8, 16],
    ["limit", "partRecord", 10, 16],
  ].map(([name, source, offset, width]) => ({
    ...finding,
    name: name as string,
    source: source as ContactResponseFirst["inputs"][number]["source"],
    offset: offset as number,
    width: width as 8 | 16,
  }));
  const stores: ContactResponseFirst["stores"] = [
    { condition: constant(1), offset: 54, value: ref("unlimitedVelocityX"), phase: "beforeLimit" },
    { condition: constant(1), offset: 56, value: ref("unlimitedVelocityY"), phase: "beforeLimit" },
    {
      condition: binary(
        "|",
        binary("signed>", ref("unlimitedVelocityY"), input("limit")),
        binary("signed<", ref("unlimitedVelocityY"), negative(input("limit"))),
      ),
      offset: 56,
      value: ref("limitedVelocityY"),
      phase: "limit",
    },
    {
      condition: binary(
        "|",
        binary("signed>", ref("unlimitedVelocityX"), input("limit")),
        binary("signed<", ref("unlimitedVelocityX"), negative(input("limit"))),
      ),
      offset: 54,
      value: ref("limitedVelocityX"),
      phase: "limit",
    },
    {
      condition: constant(1),
      offset: 28,
      value: { kind: "high-word", value: ref("fixedPositionY", 32), width: 16 },
      phase: "position",
    },
    { condition: constant(1), offset: 26, value: low(ref("fixedPositionY", 32)), phase: "position" },
  ].map((store) => ({ ...finding, ...store, width: 16 }) as ContactResponseFirst["stores"][number]);
  const relation: ContactResponseFirst = {
    ...finding,
    kind: "sliding-contact-response",
    ownerArgument: 6,
    fields: {
      type: 4,
      flags: 6,
      contactPart: 132,
      sideFirst: 134,
      sideSecond: 135,
      contactAngle: 136,
      velocityX: 54,
      velocityY: 56,
      positionY: 32,
      fixedYLow: 26,
      fixedYHigh: 28,
    },
    table: { segment, offset, stride: 58, typeCount, reads: "runtime" },
    inputs,
    scalars: { first, second },
    dependencies: {
      firstScalar: bindings.get("calleeA")!,
      secondScalar: bindings.get("calleeB")!,
      product: bindings.get("calleeC")!,
      rightShift: right.address,
      limiter: limiter.address,
      leftShift: left.address,
    },
    stages,
    stores,
    arithmetic: "wordAndLongResultsWrapBeforeLaterComparisons",
    preservesState: true,
    inputSnapshots: "entryEquivalentUnderStorageAssumptions",
    unrelatedFieldsPreserved: true,
    returns: "unspecifiedVolatileRegisters",
  };
  return {
    ...finding,
    address: code.address,
    kind: "contact-first-response",
    argumentOffset: 6,
    argumentKind: "object",
    purpose:
      "Uses the recorded contact angle, side bytes and type coefficients to change velocity, applies the type's velocity limit, and reconstructs fixed-point vertical position while preserving the state.",
    writes: [54, 56, 28, 26].map((offset) => ({
      ...finding,
      confidence: "unresolved",
      root: "argument",
      argumentOffset: 6,
      path: [],
      offset,
      width: 16,
      value: {
        kind: "unknown",
        reason:
          "The exact value is defined by contactResponseFirst's named-stage relation; the generic caller expression does not compose that relation yet.",
        width: 16,
      },
      condition: { kind: "true" },
    })),
    returns: [],
    calls: code.calls.flatMap((c) => (c.target ? [c.target.address] : [])),
    returnConvention: { kind: "far", stackBytes: 0 },
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: false,
      preservesPartState: true,
      unknownEffects: [],
      unknownPartEffects: [],
      unknownGlobalEffects: [],
    },
    contactResponseFirst: relation,
  };
}

/** Builds the public arithmetic definitions; only discovery above supplies an instruction certificate. */
export function firstContactResponseFormulae(): { name: string; description: string; value: FirstResponseFormula }[] {
  const stages: { name: string; description: string; value: FirstResponseFormula }[] = [];
  const stage = (name: string, value: FirstResponseFormula, description: string) =>
    stages.push({ name, value, description });
  const angle = input("contactAngle"),
    specialAngle = binary("|", binary("==", angle, constant(0)), binary("==", angle, constant(32768)));
  stage(
    "adjustedAngle",
    select(
      specialAngle,
      select(
        binary("==", input("sideFirst"), constant(0)),
        binary("+", angle, constant(4096)),
        select(binary("==", input("sideSecond"), constant(0)), binary("-", angle, constant(4096)), angle),
      ),
      angle,
    ),
    "For angle zero or half a turn, the first zero side byte adds 4096; otherwise the second zero side byte subtracts 4096.",
  );
  stage(
    "coefficient",
    select(
      binary("&", binary("==", input("contactType"), constant(5)), binary("!=", input("contactControl"), constant(0))),
      constant(256),
      select(
        binary("signed>", input("ownCoefficient"), input("contactCoefficient")),
        input("ownCoefficient"),
        input("contactCoefficient"),
      ),
    ),
    "Type five with a nonzero control uses 256; otherwise take the signed greater record coefficient, selecting the contact record on equality.",
  );
  stage(
    "firstFactor",
    { kind: "lookup", scalar: "first", angle: negative(ref("adjustedAngle")), width: 16 },
    "Read the first certified scalar table relation for the wrapped negative adjusted angle.",
  );
  stage(
    "secondFactor",
    { kind: "lookup", scalar: "second", angle: negative(ref("adjustedAngle")), width: 16 },
    "Read the second certified scalar table relation for the wrapped negative adjusted angle.",
  );
  stage(
    "absoluteAcceleration",
    absolute(input("recordAcceleration")),
    "Take the word absolute value; the negative boundary remains 0x8000.",
  );
  stage(
    "normalAcceleration",
    scaled(ref("absoluteAcceleration"), ref("firstFactor"), 14),
    "Keep the low word after a signed product and arithmetic long shift by fourteen.",
  );
  const sameSign = binary(
    "|",
    binary(
      "&",
      binary("signed>", input("velocityX"), constant(0)),
      binary("signed>", ref("adjustedAngle"), constant(0)),
    ),
    binary(
      "&",
      binary("signed<", input("velocityX"), constant(0)),
      binary("signed<", ref("adjustedAngle"), constant(0)),
    ),
  );
  stage(
    "directionalVelocity",
    select(sameSign, scaled(input("velocityX"), ref("secondFactor"), 14), constant(0)),
    "Include the projected horizontal velocity only when its nonzero signed direction agrees with the adjusted angle's signed direction.",
  );
  stage(
    "damping",
    scaled(
      binary("+", absolute(ref("normalAcceleration")), absolute(ref("directionalVelocity"))),
      ref("coefficient"),
      8,
    ),
    "Multiply the wrapped sum of word absolute components by the coefficient and shift right eight.",
  );
  stage(
    "projectedDamping",
    scaled(ref("damping"), ref("firstFactor"), 14),
    "Project the damping with the first table factor and shift right fourteen.",
  );
  stage(
    "dampingWithBias",
    binary(
      "+",
      absolute(ref("projectedDamping")),
      select(binary("!=", binary("&", input("flags"), constant(32)), constant(0)), constant(32), constant(2)),
    ),
    "Add 32 when flag mask 32 is set, otherwise two, after taking the word absolute value.",
  );
  stage(
    "alongAcceleration",
    scaled(ref("absoluteAcceleration"), ref("secondFactor"), 14),
    "Project the absolute acceleration with the second factor.",
  );
  stage(
    "horizontalAcceleration",
    scaled(ref("alongAcceleration"), absolute(ref("firstFactor")), 14),
    "Project that component with the absolute first factor.",
  );
  stage(
    "acceleratedVelocityX",
    binary("+", input("velocityX"), ref("horizontalAcceleration")),
    "Add the horizontal acceleration with word wrapping.",
  );
  stage(
    "negativeTrial",
    binary("+", ref("acceleratedVelocityX"), ref("dampingWithBias")),
    "The negative-velocity branch adds the damping word before testing the resulting sign.",
  );
  stage(
    "positiveTrial",
    binary("-", ref("acceleratedVelocityX"), ref("dampingWithBias")),
    "The nonnegative-velocity branch subtracts the damping word before testing the resulting sign.",
  );
  stage(
    "unlimitedVelocityX",
    select(
      binary("signed<", ref("acceleratedVelocityX"), constant(0)),
      select(binary("signed<", ref("negativeTrial"), constant(0)), ref("negativeTrial"), constant(0)),
      select(binary("signed>", ref("positiveTrial"), constant(0)), ref("positiveTrial"), constant(0)),
    ),
    "Retain only a negative result in the negative branch or a positive result in the nonnegative branch; otherwise set zero.",
  );
  stage(
    "orientedVelocityX",
    select(
      binary("!=", binary("&", binary("+", ref("adjustedAngle"), constant(16384)), constant(32768)), constant(0)),
      negative(ref("unlimitedVelocityX")),
      ref("unlimitedVelocityX"),
    ),
    "Negate the horizontal result when bit 0x8000 of angle plus a quarter turn is set.",
  );
  stage(
    "unlimitedVelocityY",
    scaled(ref("secondFactor"), ref("orientedVelocityX"), 14),
    "The second scalar factor is called again for the same negative angle, multiplied by the oriented horizontal word and shifted right fourteen.",
  );
  stage(
    "limitedVelocityY",
    clamp(ref("unlimitedVelocityY")),
    "Apply the runtime signed velocity limit, with the upper test first.",
  );
  stage(
    "limitedVelocityX",
    clamp(ref("unlimitedVelocityX")),
    "Apply the same signed velocity limit to the previously stored horizontal word.",
  );
  stage(
    "fixedPositionY",
    select(
      binary("signed>=", input("recordAcceleration"), constant(0)),
      binary(
        "-",
        binary("<<", binary("+", extend(input("positionY")), constant(1, 32), 32), constant(9, 32), 32),
        constant(1, 32),
        32,
      ),
      binary("<<", extend(input("positionY")), constant(9, 32), 32),
      32,
    ),
    "For a nonnegative record acceleration use ((signed position Y + 1) << 9) - 1; otherwise use signed position Y << 9, retaining long wrapping.",
  );
  return stages;
}
