/** Certifies ordered reflection and two-part exchange rules without choosing a runtime contact. */
import { responsePairPatterns, centreAnglePatterns } from "./behaviour-response-pair-patterns.ts";
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import { discoverContactArithmetic } from "./behaviour-contact-arithmetic.ts";
import {
  discoverContactRotation,
  discoverRotationShift,
  discoverRotationLeftShift,
  type ContactRotation,
} from "./behaviour-contact-rotation.ts";
import type { ContactMotionAngle } from "./behaviour-contact-motion-angle.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary, EngineWrite } from "./behaviour-helpers.ts";
import type { Finding } from "./behaviour.ts";
import { routineEvidence } from "./behaviour-terms.ts";

/** Named values below are acyclic mathematical definitions, not independently assignable object fields. */
export type PairResponseFormula =
  | { kind: "constant"; value: number; width: 16 | 32 }
  | { kind: "stage"; name: string; width: 16 | 32 }
  | { kind: "binary"; operator: string; left: PairResponseFormula; right: PairResponseFormula; width: 16 | 32 }
  | {
      kind: "select";
      condition: PairResponseFormula;
      whenTrue: PairResponseFormula;
      whenFalse: PairResponseFormula;
      width: 16 | 32;
    }
  | { kind: "sign-extend"; value: PairResponseFormula; width: 32 }
  | { kind: "low-word"; value: PairResponseFormula; width: 16 }
  | { kind: "high-word"; value: PairResponseFormula; width: 16 };
export type PairResponseOperation =
  | { kind: "resource-request"; object: "owner"; routine: number }
  | {
      kind: "capture";
      name: string;
      object: "owner" | "partner";
      source: "field" | "record";
      offset: number;
      width: 8 | 16;
    }
  | { kind: "bind"; name: string; value: PairResponseFormula }
  | {
      kind: "rotate";
      routine: number;
      x: PairResponseFormula;
      y: PairResponseFormula;
      angle: PairResponseFormula;
      outputX: string;
      outputY: string;
    }
  | { kind: "centre-angle"; routine: number; output: string }
  | { kind: "normal-return-requires"; value: PairResponseFormula; relation: "nonzero" }
  | {
      kind: "write";
      object: "owner" | "partner";
      offset: number;
      width: 16;
      value: PairResponseFormula;
      condition?: PairResponseFormula;
    }
  | { kind: "limit"; object: "owner" | "partner"; routine: number };
export interface PairCentreAngle extends Finding {
  routine: number;
  arguments: { owner: 6; partner: 8 };
  fields: { x: 30; y: 32; width: 68; height: 70 };
  differences: { x: "ownerCentreMinusPartnerCentre"; y: "partnerCentreMinusOwnerCentre" };
  arithmetic: "signedWordHalfSizesThenWrappedCentresAndDifferences";
  backend: ContactMotionAngle;
}
export interface ContactResponsePair extends Finding {
  kind: "single-part-reflection" | "two-part-exchange";
  ownerArgument: 6;
  partnerPath: [132];
  table: { segment: number; offset: number; stride: 58; typeCount: number; reads: "runtime" };
  rotation: ContactRotation;
  centreAngle?: PairCentreAngle;
  operations: PairResponseOperation[];
  dependencies: {
    resource: number;
    rotation: number;
    product: number;
    rightShift?: number;
    quotient?: number;
    limiter: number;
    leftShift: number;
  };
  differences: {
    recordSixControlsDamping: boolean;
    coefficientTypeException?: { type: 59; minimum: 128 };
    separationSpeed?: 512 | 1024;
    horizontalDominanceSuppressesSeparation?: boolean;
    unusedMinimumRecordFourRead?: boolean;
  };
  arithmetic: "everyWordAndLongResultWrapsBeforeTheNextOperation";
  operationOrder: "capturesObserveEarlierWritesIncludingAliasedParticipants";
  participantStorage: "completeObjectsEqualOrDisjoint";
  zeroMassSum?: "noNormalReturn";
  genericApplication: "fieldFootprintOnly" | "metadataOnlyUntilNormalReturnGateCanBeComposed";
}
const c = (value: number, width: 16 | 32 = 16): PairResponseFormula => ({ kind: "constant", value, width });
const s = (name: string, width: 16 | 32 = 16): PairResponseFormula => ({ kind: "stage", name, width });
const b = (
  operator: string,
  left: PairResponseFormula,
  right: PairResponseFormula,
  width: 16 | 32 = 16,
): PairResponseFormula => ({ kind: "binary", operator, left, right, width });
const choose = (
  condition: PairResponseFormula,
  whenTrue: PairResponseFormula,
  whenFalse: PairResponseFormula,
  width: 16 | 32 = 16,
): PairResponseFormula => ({ kind: "select", condition, whenTrue, whenFalse, width });
const low = (value: PairResponseFormula): PairResponseFormula => ({ kind: "low-word", value, width: 16 });
const high = (value: PairResponseFormula): PairResponseFormula => ({ kind: "high-word", value, width: 16 });
const sx = (value: PairResponseFormula): PairResponseFormula => ({ kind: "sign-extend", value, width: 32 });
const neg = (value: PairResponseFormula) => b("-", c(0), value);
const abs = (value: PairResponseFormula) => choose(b("signed<", value, c(0)), neg(value), value);
const product = (left: PairResponseFormula, right: PairResponseFormula) => b("signed-word-product", left, right, 32);

/** The damping adds or subtracts a word constant before its second signed test. */
export function responseDampingFormula(value: PairResponseFormula): PairResponseFormula {
  const positive = b("-", value, c(64)),
    negative = b("+", value, c(64));
  return choose(
    b("signed<", value, c(0)),
    choose(b("signed<", negative, c(0)), negative, c(0)),
    choose(b("signed>", positive, c(0)), positive, c(0)),
  );
}
export function responseFixedPositionFormula(
  position: PairResponseFormula,
  sign: PairResponseFormula,
): PairResponseFormula {
  return choose(
    b("signed<", sign, c(0)),
    b("<<", sx(position), c(9, 32), 32),
    b("-", b("<<", b("+", sx(position), c(1, 32), 32), c(9, 32), 32), c(1, 32), 32),
    32,
  );
}

export function discoverPairCentreAngle(
  code: RoutineCode,
  summaries: Map<number, EngineSummary>,
): PairCentreAngle | undefined {
  const binding = centreAnglePatterns.map((p) => matchHeapRoutine(code, p, new Map())).find(Boolean);
  if (!binding) return;
  const backend = summaries.get(binding.get("angle")!);
  if (
    !backend?.contactMotionAngle ||
    backend.contactMotionAngle.backend !== backend.address ||
    !backend.footprint.preservesArgumentMemory ||
    backend.writes.length
  )
    return;
  return {
    confidence: "inferred",
    evidence: [...routineEvidence(code), ...backend.contactMotionAngle.evidence],
    assumptions: [
      ...backend.contactMotionAngle.assumptions,
      "The two complete part objects and private stack are valid and separate from code and lookup storage. Centres use signed arithmetic shifts of current frame dimensions; sums and differences wrap to words before sign extension. The backend is called with those sign-extended word differences, inside its certified bounded domain.",
    ],
    routine: code.address,
    arguments: { owner: 6, partner: 8 },
    fields: { x: 30, y: 32, width: 68, height: 70 },
    differences: { x: "ownerCentreMinusPartnerCentre", y: "partnerCentreMinusOwnerCentre" },
    arithmetic: "signedWordHalfSizesThenWrappedCentresAndDifferences",
    backend: backend.contactMotionAngle,
  };
}

/** Complete routine and dependency matches precede the high-level integer relations below. */
export function discoverContactResponsePair(
  code: RoutineCode,
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  table: number | undefined,
  dataSegment: number,
  typeCount: number | undefined,
  image: Uint8Array,
): (EngineSummary & { contactResponsePair: ContactResponsePair }) | undefined {
  if (table === undefined || typeCount === undefined || !Number.isInteger(typeCount) || typeCount <= 0) return;
  let bindings: Map<string, number> | undefined, selected: (typeof responsePairPatterns)[number] | undefined;
  for (const p of responsePairPatterns) {
    if (p.pattern.split("\n").length !== code.instructions.length) continue;
    bindings = matchHeapRoutine(code, p.pattern, new Map());
    if (bindings) {
      selected = p;
      break;
    }
  }
  if (!bindings || !selected) return;
  const exchange = selected.kind === "exchange",
    segment = bindings.get("tableSegment") ?? dataSegment,
    offset = bindings.get("tableOffset")!;
  if (
    offset < 0 ||
    segment * 16 + offset !== table ||
    offset + typeCount * 58 > 65536 ||
    table + typeCount * 58 > image.length ||
    (exchange && bindings.has("tableSegment") && offset !== 0) ||
    (exchange && !bindings.has("tableSegment") && bindings.get("tableVertical") !== offset + 8)
  )
    return;
  const address = (role: string) => bindings!.get(role)!;
  const target = (role: string) => codes.get(address(role));
  const resource = summaries.get(address("callA")),
    rotationCode = target(exchange ? "callC" : "callB");
  const rotation = rotationCode && discoverContactRotation(rotationCode, codes, summaries, image);
  const productCode = target(exchange ? "callD" : "callC"),
    multiplication = productCode && discoverContactArithmetic(productCode);
  const limiter = summaries.get(address(exchange ? "callF" : "callE"));
  const leftCode = target(exchange ? "callG" : "callF"),
    left = leftCode && discoverRotationLeftShift(leftCode);
  const rightCode = !exchange ? target("callD") : undefined,
    right = rightCode && discoverRotationShift(rightCode);
  const quotientCode = exchange ? target("callE") : undefined,
    quotient = quotientCode && discoverContactArithmetic(quotientCode);
  const centreCode = exchange ? target("callB") : undefined,
    centres = centreCode && discoverPairCentreAngle(centreCode, summaries);
  if (
    resource?.contactResponse?.kind !== "contact-resource-request" ||
    !resource.footprint.partMemoryComplete ||
    !resource.footprint.preservesArgumentMemory ||
    !resource.footprint.preservesPartState ||
    !rotation?.contactRotation ||
    multiplication?.operation !== "signedWordProduct" ||
    limiter?.contactResponse?.kind !== "velocity-limit" ||
    !limiter.footprint.complete ||
    !limiter.footprint.preservesPartState ||
    limiter.contactResponse.table.segment !== segment ||
    limiter.contactResponse.table.offset !== offset ||
    limiter.contactResponse.table.typeCount !== typeCount ||
    left?.numeric?.operation !== "leftShift32" ||
    (!exchange && right?.numeric?.operation !== "arithmeticRightShift32") ||
    (exchange && (quotient?.operation !== "signedLongQuotient" || !centres))
  )
    return;
  // Every matched call has a fixed return frame. Some quotient entries convert their near frame before RETF 8.
  for (const call of code.calls) {
    const callee = call.target && codes.get(call.target.address),
      returns = callee?.instructions.filter((i) => i.flow === "return") ?? [];
    const index = code.instructions.findIndex((i) => i.address === call.instruction),
      previous = code.instructions[index - 1];
    const far =
      call.far ||
      (previous?.mnemonic === "push" &&
        previous.operands[0]?.kind === "register" &&
        previous.operands[0].name === "cs");
    const adapter =
      call.target?.address === left.address ? left : call.target?.address === right?.address ? right : undefined;
    if (!callee || callee.status !== "complete" || !returns.length) return;
    if (call.target?.address === quotientCode?.address) {
      const prefix = callee.instructions.slice(0, 3);
      const nearBridge =
        prefix[0]?.mnemonic === "pop" &&
        prefix[0].operands[0]?.kind === "register" &&
        prefix[0].operands[0].name === "cx" &&
        prefix[1]?.mnemonic === "push" &&
        prefix[1].operands[0]?.kind === "register" &&
        prefix[1].operands[0].name === "cs" &&
        prefix[2]?.mnemonic === "push" &&
        prefix[2].operands[0]?.kind === "register" &&
        prefix[2].operands[0].name === "cx";
      if (
        far === nearBridge ||
        returns.some((i) => i.mnemonic !== "retf" || i.operands[0]?.kind !== "immediate" || i.operands[0].value !== 8)
      )
        return;
    } else if (adapter) {
      if (adapter.returnConvention?.kind !== (far ? "far" : "near") || adapter.returnConvention.stackBytes) return;
    } else if (
      returns.some(
        (i) =>
          i.mnemonic !== (far ? "retf" : "ret") ||
          (i.operands[0]?.kind === "immediate" ? i.operands[0].value : 0) !==
            (call.target?.address === quotientCode?.address ? 8 : 0),
      )
    )
      return;
  }
  const gated = !exchange && selected.pattern.includes("cmp 16:es[bx+6],#0"),
    special = !exchange && selected.pattern.includes("cmp 16:ds[si+4],#59");
  const dominant = exchange && selected.pattern.includes("cmp dx,ax"),
    speed = exchange ? (selected.pattern.includes("mov 16:ss[bp+-24],#1024") ? 1024 : 512) : undefined;
  const assumptions = [
    ...resource.assumptions,
    ...rotation.assumptions,
    ...multiplication.assumptions,
    ...limiter.assumptions,
    ...left.assumptions,
    ...(right?.assumptions ?? []),
    ...(quotient?.assumptions ?? []),
    ...(centres?.assumptions ?? []),
    "The argument and recorded contact pointer name complete valid part objects. Their storage is either identical or disjoint, never partially overlapping. Private stack, program tables and resource storage are separate. Runtime types index the discovered records, and table storage remains stable during the call.",
    "Operations are an ordered mathematical relation. Captures read the current storage after earlier writes; named stages are computed values. If both participant pointers are equal, the later store wins, both limiter calls still occur in order, and separation gates observe the aliased stored velocities. No distinct-part assumption or fixed runtime contact is supplied.",
    "Word and long results wrap to their declared width before later comparisons; signed products and quotients are integer operations, not host floating-point multiplication of unsigned long bit patterns. Right shifts are arithmetic. The exact resource-wrapper condition and unresolved backend globals remain part of this normal-return contract.",
    ...(exchange
      ? [
          "The two signed masses are summed as a long. A zero sum reaches division by zero and establishes no normal return. The generic analyser does not yet compose this gate, so the exchange relation remains metadata-only and supplies no caller state-preservation shortcut.",
        ]
      : [
          "Only the argument's velocity and fixed-point position words are written. The partner can equal the argument: earlier captures retain the values read before those writes. The generic caller uses only the complete non-state footprint; it does not evaluate the numerical relation.",
        ]),
  ];
  const finding: Finding = {
    confidence: "inferred",
    assumptions: [...new Set(assumptions)],
    evidence: [
      ...routineEvidence(code),
      ...resource.evidence,
      ...rotation.evidence,
      ...multiplication.evidence,
      ...limiter.evidence,
      ...left.evidence,
      ...(right?.evidence ?? []),
      ...(quotient?.evidence ?? []),
      ...(centres?.evidence ?? []),
    ],
  };
  const dependencies: ContactResponsePair["dependencies"] = {
    resource: resource.address,
    rotation: rotation.address,
    product: productCode!.address,
    limiter: limiter.address,
    leftShift: left.address,
    ...(right ? { rightShift: right.address } : {}),
    ...(quotientCode ? { quotient: quotientCode.address } : {}),
  };
  const operations = exchange
    ? exchangeOperations(dependencies, centres!.routine, speed!, dominant, !bindings.has("tableSegment"))
    : reflectionOperations(dependencies, gated, special);
  const relation: ContactResponsePair = {
    ...finding,
    kind: exchange ? "two-part-exchange" : "single-part-reflection",
    ownerArgument: 6,
    partnerPath: [132],
    table: { segment, offset, stride: 58, typeCount, reads: "runtime" },
    rotation: rotation.contactRotation,
    ...(centres ? { centreAngle: centres } : {}),
    operations,
    dependencies,
    differences: {
      recordSixControlsDamping: gated,
      ...(special ? { coefficientTypeException: { type: 59, minimum: 128 } as const } : {}),
      ...(exchange
        ? {
            separationSpeed: speed,
            horizontalDominanceSuppressesSeparation: dominant,
            unusedMinimumRecordFourRead: !bindings.has("tableSegment"),
          }
        : {}),
    },
    arithmetic: "everyWordAndLongResultWrapsBeforeTheNextOperation",
    operationOrder: "capturesObserveEarlierWritesIncludingAliasedParticipants",
    participantStorage: "completeObjectsEqualOrDisjoint",
    ...(exchange ? { zeroMassSum: "noNormalReturn" as const } : {}),
    genericApplication: exchange ? "metadataOnlyUntilNormalReturnGateCanBeComposed" : "fieldFootprintOnly",
  };
  const offsets = exchange ? [6, 54, 56, 24, 22, 28, 26] : [54, 56, 24, 22, 28, 26];
  const writes: EngineWrite[] = (exchange ? [[], [132]] : [[]]).flatMap((path) =>
    offsets.map((offset) => ({
      ...finding,
      confidence: "unresolved",
      root: "argument",
      argumentOffset: 6,
      path,
      offset,
      width: 16,
      value: {
        kind: "unknown",
        reason:
          "The value is defined by the ordered contactResponsePair relation; its numerical stages are not composed by the generic caller.",
        width: 16,
      },
      condition: { kind: "true" },
    })),
  );
  return {
    ...finding,
    address: code.address,
    kind: exchange ? "contact-pair-exchange" : "contact-reflection",
    argumentOffset: 6,
    argumentKind: "object",
    purpose: exchange
      ? "Rotates two participants' velocities into their centre line, exchanges weighted movement, separates them conditionally and reconstructs fixed-point positions on normal return."
      : "Reflects velocity about the recorded contact angle with the encoded coefficient and damping rules, limits it and reconstructs fixed-point position while preserving the state.",
    writes,
    returns: [],
    calls: code.calls.flatMap((c) => (c.target ? [c.target.address] : [])),
    returnConvention: { kind: "far", stackBytes: 0 },
    footprint: {
      complete: false,
      partMemoryComplete: !exchange,
      preservesArgumentMemory: false,
      preservesPartState: !exchange,
      unknownEffects: exchange
        ? [
            "The generic caller has not established the nonzero mass-sum normal-return gate.",
            ...resource.footprint.unknownEffects,
          ]
        : [...resource.footprint.unknownEffects],
      unknownPartEffects: exchange ? ["The ordered relation is not yet composed in the generic caller."] : [],
      unknownGlobalEffects: [...(resource.footprint.unknownGlobalEffects ?? [])],
    },
    contactResponsePair: relation,
  };
}

function plan(dependencies: ContactResponsePair["dependencies"]) {
  const operations: PairResponseOperation[] = [
    { kind: "resource-request", object: "owner", routine: dependencies.resource },
  ];
  return {
    operations,
    capture(name: string, object: "owner" | "partner", source: "field" | "record", offset: number, width: 8 | 16 = 16) {
      operations.push({ kind: "capture", name, object, source, offset, width });
      return s(name);
    },
    bind(name: string, value: PairResponseFormula) {
      operations.push({ kind: "bind", name, value });
      return s(name, value.width);
    },
    write(object: "owner" | "partner", offset: number, value: PairResponseFormula, condition?: PairResponseFormula) {
      operations.push({ kind: "write", object, offset, width: 16, value, ...(condition ? { condition } : {}) });
    },
    rotate(x: PairResponseFormula, y: PairResponseFormula, angle: PairResponseFormula, prefix: string) {
      const outputX = prefix + "X",
        outputY = prefix + "Y";
      operations.push({ kind: "rotate", routine: dependencies.rotation, x, y, angle, outputX, outputY });
      return { x: s(outputX), y: s(outputY) };
    },
  };
}
/** Constructs the ordered relation for one reflected velocity. Discovery supplies its instruction certificate. */
export function reflectionOperations(
  dependencies: ContactResponsePair["dependencies"],
  frictionGate: boolean,
  typeException: boolean,
): PairResponseOperation[] {
  const p = plan(dependencies);
  const angle = p.capture("recordedContactAngle", "owner", "field", 136),
    firstSide = p.capture("firstSide", "owner", "field", 134, 8),
    secondSide = p.capture("secondSide", "owner", "field", 135, 8);
  const adjusted = p.bind(
    "adjustedContactAngle",
    choose(
      b("|", b("==", angle, c(0)), b("==", angle, c(32768))),
      choose(
        b("==", firstSide, c(0)),
        b("+", angle, c(4096)),
        choose(b("==", secondSide, c(0)), b("-", angle, c(4096)), angle),
      ),
      angle,
    ),
  );
  const x = p.capture("incomingVelocityX", "owner", "field", 54),
    y = p.capture("incomingVelocityY", "owner", "field", 56);
  const line = p.rotate(x, y, adjusted, "contactLine");
  const ownCoefficient = p.capture("ownerCoefficient", "owner", "record", 4),
    partnerCoefficient = p.capture("partnerCoefficient", "partner", "record", 4);
  let coefficient = p.bind(
    "minimumCoefficient",
    choose(b("signed<", ownCoefficient, partnerCoefficient), ownCoefficient, partnerCoefficient),
  );
  if (typeException) {
    const type = p.capture("ownerType", "owner", "field", 4);
    coefficient = p.bind(
      "selectedCoefficient",
      choose(b("&", b("==", type, c(59)), b("signed>=", coefficient, c(128))), ownCoefficient, coefficient),
    );
  }
  const scaled = low(b(">>", product(line.y, coefficient), c(8, 32), 32));
  const damped = responseDampingFormula(neg(scaled));
  const friction = frictionGate ? p.capture("ownerRecordSix", "owner", "record", 6) : undefined;
  const normal = p.bind("reflectedNormal", friction ? choose(b("==", friction, c(0)), neg(line.y), damped) : damped);
  const world = p.rotate(line.x, normal, neg(adjusted), "reflectedWorld");
  p.write("owner", 54, world.x);
  p.write("owner", 56, world.y);
  p.operations.push({ kind: "limit", object: "owner", routine: dependencies.limiter });
  const positionX = p.capture("integerPositionX", "owner", "field", 30);
  const fixedX = p.bind("fixedPositionX", responseFixedPositionFormula(positionX, world.x));
  p.write("owner", 24, high(fixedX));
  p.write("owner", 22, low(fixedX));
  const positionY = p.capture("integerPositionY", "owner", "field", 32),
    acceleration = p.capture("recordVerticalSign", "owner", "record", 8);
  const fixedY = p.bind("fixedPositionY", responseFixedPositionFormula(positionY, acceleration));
  p.write("owner", 28, high(fixedY));
  p.write("owner", 26, low(fixedY));
  return p.operations;
}

/** The exchange retains post-store captures so equal participant pointers keep the encoded ordering. */
export function exchangeOperations(
  dependencies: ContactResponsePair["dependencies"],
  centreRoutine: number,
  separationSpeed: 512 | 1024,
  dominanceGate: boolean,
  unusedCoefficientRead: boolean,
): PairResponseOperation[] {
  const p = plan(dependencies);
  const flags = p.capture("ownerFlagsBeforeMark", "owner", "field", 6);
  p.write("owner", 6, b("|", flags, c(8)));
  const peerFlags = p.capture("partnerFlagsBeforeMark", "partner", "field", 6);
  p.write("partner", 6, b("|", peerFlags, c(8)));
  if (unusedCoefficientRead) {
    const a = p.capture("unusedOwnerCoefficient", "owner", "record", 4),
      z = p.capture("unusedPartnerCoefficient", "partner", "record", 4);
    p.bind("unusedMinimumCoefficient", choose(b("signed<", a, z), a, z));
  }
  const ownMass = p.capture("ownerMass", "owner", "record", 2),
    peerMass = p.capture("partnerMass", "partner", "record", 2);
  const ownX = p.capture("ownerIncomingX", "owner", "field", 54),
    ownY = p.capture("ownerIncomingY", "owner", "field", 56),
    peerX = p.capture("partnerIncomingX", "partner", "field", 54),
    peerY = p.capture("partnerIncomingY", "partner", "field", 56);
  p.operations.push({ kind: "centre-angle", routine: centreRoutine, output: "centreAngle" });
  const angle = p.bind("exchangeAngle", b("-", s("centreAngle"), c(16384)));
  const ownLine = p.rotate(ownX, ownY, angle, "ownerLine"),
    peerLine = p.rotate(peerX, peerY, angle, "partnerLine");
  const denominator = p.bind("massSum", b("+", sx(ownMass), sx(peerMass), 32));
  const a = p.bind("ownerMassProduct", product(ownLine.x, ownMass)),
    z = p.bind("partnerMassProduct", product(peerLine.x, peerMass));
  const crossOwn = p.bind("ownerCrossMassProduct", product(ownLine.x, peerMass)),
    crossPeer = p.bind("partnerCrossMassProduct", product(peerLine.x, ownMass));
  const ownNumerator = p.bind("ownerExchangeNumerator", b("-", b("+", b("+", a, z, 32), z, 32), crossOwn, 32));
  p.operations.push({ kind: "normal-return-requires", value: denominator, relation: "nonzero" });
  const ownNormal = p.bind("ownerExchangedNormal", low(b("signed-long-quotient", ownNumerator, denominator, 32)));
  const peerNumerator = p.bind("partnerExchangeNumerator", b("-", b("+", b("+", a, a, 32), z, 32), crossPeer, 32));
  const peerNormal = p.bind("partnerExchangedNormal", low(b("signed-long-quotient", peerNumerator, denominator, 32)));
  const ownWorld = p.rotate(ownNormal, ownLine.y, neg(angle), "ownerExchangedWorld"),
    peerWorld = p.rotate(peerNormal, peerLine.y, neg(angle), "partnerExchangedWorld");
  p.write("owner", 54, b(">>", ownWorld.x, c(1)));
  p.write("owner", 56, b(">>", ownWorld.y, c(1)));
  p.write("partner", 54, b(">>", peerWorld.x, c(1)));
  p.write("partner", 56, b(">>", peerWorld.y, c(1)));
  const postX = p.capture("ownerPostExchangeX", "owner", "field", 54),
    postPeerX = p.capture("partnerPostExchangeX", "partner", "field", 54);
  let gate = p.bind(
    "separationCandidate",
    b("&", b("signed<", abs(postX), c(256)), b("signed<", abs(postPeerX), c(256))),
  );
  const postFlags = p.capture("ownerPostExchangeFlags", "owner", "field", 6);
  gate = p.bind("separationAfterOwnerFlag", b("|", gate, b("!=", b("&", postFlags, c(1)), c(0))));
  if (dominanceGate) {
    const postY = p.capture("ownerPostExchangeY", "owner", "field", 56);
    gate = p.bind("separationAfterDominance", choose(b("signed>", abs(postX), abs(postY)), c(0), gate));
  }
  const control = p.capture("ownerSeparationControl", "owner", "field", 10);
  gate = p.bind("separationEnabled", b("|", gate, b("!=", b("&", control, c(16)), c(0))));
  const ownPosition = p.capture("ownerSeparationPosition", "owner", "field", 30),
    ownWidth = p.capture("ownerSeparationWidth", "owner", "field", 68),
    peerPosition = p.capture("partnerSeparationPosition", "partner", "field", 30),
    peerWidth = p.capture("partnerSeparationWidth", "partner", "field", 68);
  const left = p.bind(
    "ownerCentreIsLeft",
    b("signed<", b("+", ownPosition, b(">>", ownWidth, c(1))), b("+", peerPosition, b(">>", peerWidth, c(1)))),
  );
  const minimum = c(separationSpeed),
    maximumNegative = c(-separationSpeed & 65535);
  const currentOwn = p.capture("ownerBeforeSeparationWrite", "owner", "field", 54);
  const separatedOwn = choose(left, maximumNegative, minimum);
  const ownNeedsChange = choose(left, b("signed>", currentOwn, maximumNegative), b("signed<", currentOwn, minimum));
  p.write("owner", 54, separatedOwn, b("&", gate, ownNeedsChange));
  const currentPeer = p.capture("partnerBeforeSeparationWrite", "partner", "field", 54);
  const separatedPeer = choose(left, minimum, maximumNegative);
  const peerNeedsChange = choose(left, b("signed<", currentPeer, minimum), b("signed>", currentPeer, maximumNegative));
  p.write("partner", 54, separatedPeer, b("&", b("&", gate, b("==", b("&", control, c(16)), c(0))), peerNeedsChange));
  p.operations.push(
    { kind: "limit", object: "owner", routine: dependencies.limiter },
    { kind: "limit", object: "partner", routine: dependencies.limiter },
  );
  for (const object of ["owner", "partner"] as const) {
    const prefix = object === "owner" ? "owner" : "partner";
    const x = p.capture(prefix + "IntegerPositionX", object, "field", 30),
      velocity = p.capture(prefix + "LimitedVelocityX", object, "field", 54);
    const fixedX = p.bind(prefix + "FixedPositionX", responseFixedPositionFormula(x, velocity));
    p.write(object, 24, high(fixedX));
    p.write(object, 22, low(fixedX));
    const y = p.capture(prefix + "IntegerPositionY", object, "field", 32),
      vertical = p.capture(prefix + "RecordVerticalSign", object, "record", 8);
    const fixedY = p.bind(prefix + "FixedPositionY", responseFixedPositionFormula(y, vertical));
    p.write(object, 28, high(fixedY));
    p.write(object, 26, low(fixedY));
  }
  return p.operations;
}
