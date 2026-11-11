/** Proves the table coefficients, signed arithmetic and ordered stores used by collision velocity rotation. */
import { rotationPatterns, scalarPatterns } from "./behaviour-rotation-patterns.ts";
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import { discoverContactArithmetic, type ContactArithmetic } from "./behaviour-contact-arithmetic.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Expression, Finding } from "./behaviour.ts";
import { binary, constant, routineEvidence } from "./behaviour-terms.ts";

export interface RotationScalar extends Finding {
  routine: number;
  argumentOffset: 6;
  phase: 0 | 49152;
  logicalRightShift: 4;
  fold: { mask: 2048; subtractFrom: 4096; indexRange: [0, 2048] };
  table: {
    segment: number;
    offset: number;
    entriesRequired: 2049;
    stride: 2;
    width: 16;
    initialImageWords: number[];
    initialImageBytes: number[];
    snapshot: "loadedImage";
  };
}
export interface ContactRotation extends Finding {
  routine: number;
  arguments: { xPointer: 6; yPointer: 8; angle: 10 };
  coefficients: { unshifted: RotationScalar; quarterShifted: RotationScalar };
  multiplication: ContactArithmetic & { routine: number };
  shift: { routine: number; count: 14; width: 32; convention: "near" | "far" };
  formulae: { x: Expression; y: Expression };
  formulaInputs: { x: string; y: string; unshifted: string; quarterShifted: string };
  inputs: "beforeAnyOutputStore";
  stores: [{ argument: 6; value: "x" }, { argument: 8; value: "y" }];
  aliasing: "laterStoreWinsOverlappingBytes";
  returnAx: "y";
}
const input = (object: string): Expression => ({ kind: "field", object, offset: 0, width: 16 });

/** The result remains a runtime table read; image words are separate conditional snapshot evidence. */
export function rotationScalarExpression(relation: RotationScalar, angle: Expression): Expression {
  const shifted = relation.phase ? binary("+", angle, constant(relation.phase)) : angle;
  const quantised = binary(">>>", shifted, constant(4));
  const upperHalf = binary(">>>", quantised, constant(11));
  const index = binary(
    "+",
    quantised,
    binary("*", upperHalf, binary("-", constant(4096), binary("*", quantised, constant(2)))),
  );
  return {
    kind: "table",
    segment: relation.table.segment,
    offset: relation.table.offset,
    index: binary("*", index, constant(2)),
    width: 16,
  };
}

export function discoverRotationScalar(code: RoutineCode, image: Uint8Array): RotationScalar | undefined {
  for (const pattern of scalarPatterns) {
    const binding = matchHeapRoutine(code, pattern, new Map());
    if (!binding) continue;
    const tableOffset = binding.get("table")!;
    const segment = code.segment,
      at = segment * 16 + tableOffset,
      length = 2049 * 2;
    if (tableOffset < 0 || tableOffset + length > 65536 || at < 0 || at + length > image.length) continue;
    const initialImageBytes = Array.from(image.subarray(at, at + length));
    const initialImageWords = Array.from(
      { length: 2049 },
      (_, n) => image[at + n * 2]! | (image[at + n * 2 + 1]! << 8),
    );
    return {
      routine: code.address,
      argumentOffset: 6,
      phase: pattern.includes("add ax,#49152") ? 49152 : 0,
      logicalRightShift: 4,
      fold: { mask: 2048, subtractFrom: 4096, indexRange: [0, 2048] },
      table: {
        segment,
        offset: tableOffset,
        entriesRequired: 2049,
        stride: 2,
        width: 16,
        initialImageWords,
        initialImageBytes,
        snapshot: "loadedImage",
      },
      confidence: "inferred",
      evidence: routineEvidence(code),
      assumptions: [
        "The far scalar call has a valid private stack with its word argument at SS:SP+4. The code segment and lookup storage are valid, separate from the caller's outputs, and stable during this call.",
        "The optional phase addition wraps to a word before four logical shifts. Their result is between zero and 4095; the upper half maps to 4096 minus that value. Thus every lookup index is between zero and 2048 inclusive, including the endpoint at 2048.",
        "The table is read at runtime. The recorded bytes and words describe only the loaded image and apply to later calls only if that storage remains unchanged. No host trigonometric function or ideal sine/cosine value replaces a table word.",
      ],
    };
  }
}

export function discoverRotationScalarSummary(
  code: RoutineCode,
  image: Uint8Array,
): (EngineSummary & { rotationScalar: RotationScalar }) | undefined {
  const relation = discoverRotationScalar(code, image);
  if (!relation) return;
  return {
    ...relation,
    address: code.address,
    kind: "rotation-table-coefficient",
    purpose:
      "Folds the quantised word angle into a checked code-segment coefficient table and returns the runtime word.",
    argumentOffset: 6,
    argumentKind: "scalar",
    writes: [],
    calls: [],
    returns: [
      {
        ...relation,
        register: "ax",
        condition: { kind: "true" },
        value: rotationScalarExpression(relation, { kind: "field", object: "argument", offset: 6, width: 16 }),
      },
    ],
    returnConvention: { kind: "far", stackBytes: 0 },
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: true,
      preservesPartState: true,
      unknownEffects: [],
      unknownPartEffects: [],
      unknownGlobalEffects: [],
    },
    rotationScalar: relation,
  };
}

const rightShift = `cmp cl,#16
jae @large
mov bx,dx
shr ax,cl
sar dx,cl
neg cl
add cl,#16
shl bx,cl
or ax,bx
retf
large: sub cl,#16
xchg ax,dx
cwd
sar ax,cl
retf`;

const leftShift = `cmp cl,#16
jae @large
mov bx,ax
shl ax,cl
shl dx,cl
neg cl
add cl,#16
shr bx,cl
or dx,bx
retf
large: sub cl,#16
xchg ax,dx
xor ax,ax
shl dx,cl
retf`;

/** The prefix converts an actual near return address into a far frame; the arithmetic core is the same. */
function discoverShift(
  code: RoutineCode,
  operation: "leftShift32" | "arithmeticRightShift32",
): EngineSummary | undefined {
  const pattern = operation === "leftShift32" ? leftShift : rightShift;
  const near = !!matchHeapRoutine(code, `pop bx\npush cs\npush bx\n${pattern}`, new Map());
  if (!near && !matchHeapRoutine(code, pattern, new Map())) return;
  return {
    address: code.address,
    kind: "wide-integer-shift",
    purpose:
      operation === "leftShift32"
        ? "Shifts the 32-bit pair DX:AX left by CL, combining cross-word bits and discarding overflow."
        : "Shifts the signed 32-bit pair DX:AX right by CL, preserving cross-word bits and the sign.",
    confidence: "inferred",
    evidence: routineEvidence(code),
    assumptions: [
      "CL is between zero and 31. Below 16, the two shifted words combine with the cross-word bits; at least 16, the word exchange and remaining shift give the same long operation. Arithmetic shifts extend the sign; left shifts discard bits beyond the long width.",
      near
        ? "The actual near CALL supplies a valid near return address; POP BX, PUSH CS, PUSH BX forms the RETF frame. Private stack storage is separate from inputs and outputs."
        : "The actual far CALL supplies a valid far return frame, separate from inputs and outputs.",
    ],
    argumentOffset: near ? 4 : 6,
    argumentKind: "unknown",
    writes: [],
    returns: [],
    calls: [],
    returnConvention: { kind: near ? "near" : "far", stackBytes: 0 },
    numeric: { operation, width: 32, low: "ax", high: "dx", count: "cl", minimumCount: 0, maximumCount: 31 },
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: true,
      preservesPartState: true,
      unknownEffects: [],
      unknownPartEffects: [],
      unknownGlobalEffects: [],
    },
  };
}

export function discoverRotationShift(code: RoutineCode): EngineSummary | undefined {
  return discoverShift(code, "arithmeticRightShift32");
}
export function discoverRotationLeftShift(code: RoutineCode): EngineSummary | undefined {
  return discoverShift(code, "leftShift32");
}

/** Pure algebra over named snapshots keeps a caller's expression sizes bounded without hiding arithmetic widths. */
/**
 * The signed long product of two signed words, as unsigned patterns. Each product fits exactly in a JavaScript number
 * before word/long wrapping. Multiplying two unsigned sign-extended long patterns could exceed 2^53 and lose low bits in
 * ordinary expression consumers.
 */
export const signedProduct = (left: Expression, right: Expression): Expression =>
  binary(
    "-",
    binary(
      "-",
      binary("*", left, right, 32),
      binary("*", binary(">>>", left, constant(15)), binary("<<", right, constant(16), 32), 32),
      32,
    ),
    binary("*", binary(">>>", right, constant(15)), binary("<<", left, constant(16), 32), 32),
    32,
  );
/** The low word of a signed long shifted right by 14. */
export const shiftedLowWord = (value: Expression): Expression =>
  binary("&", binary(">>", value, constant(14), 32), constant(65535));

export function rotationFormulae(
  x: Expression,
  y: Expression,
  unshifted: Expression,
  quarterShifted: Expression,
): { x: Expression; y: Expression } {
  const product = signedProduct;
  const output = (operator: string, first: Expression, second: Expression) =>
    shiftedLowWord(binary(operator, first, second, 32));
  return {
    x: output("-", product(x, unshifted), product(y, quarterShifted)),
    y: output("+", product(x, quarterShifted), product(y, unshifted)),
  };
}

export function discoverContactRotation(
  code: RoutineCode,
  codes: Map<number, RoutineCode>,
  _summaries: Map<number, EngineSummary>,
  image: Uint8Array,
): (EngineSummary & { contactRotation: ContactRotation }) | undefined {
  for (const pattern of rotationPatterns) {
    const binding = matchHeapRoutine(code, pattern, new Map());
    if (!binding) continue;
    const first = codes.get(binding.get("calleeA")!),
      second = codes.get(binding.get("calleeB")!),
      multiplyCode = codes.get(binding.get("calleeC")!),
      shiftCode = codes.get(binding.get("calleeD")!);
    if (!first || !second || !multiplyCode || !shiftCode) continue;
    const unshifted = discoverRotationScalar(first, image),
      quarterShifted = discoverRotationScalar(second, image),
      multiplication = discoverContactArithmetic(multiplyCode),
      shift = discoverRotationShift(shiftCode);
    if (
      !unshifted ||
      unshifted.phase !== 0 ||
      !quarterShifted ||
      quarterShifted.phase !== 49152 ||
      unshifted.table.segment !== quarterShifted.table.segment ||
      unshifted.table.offset !== quarterShifted.table.offset ||
      multiplication?.operation !== "signedWordProduct" ||
      !shift?.numeric ||
      shift.returnConvention?.kind !== (pattern.includes("callf $calleeD") ? "far" : "near")
    )
      continue;
    const formulaInputs = {
      x: "rotation input x",
      y: "rotation input y",
      unshifted: "unshifted coefficient",
      quarterShifted: "quarter-shifted coefficient",
    };
    const formulae = rotationFormulae(
      input(formulaInputs.x),
      input(formulaInputs.y),
      input(formulaInputs.unshifted),
      input(formulaInputs.quarterShifted),
    );
    const finding: Finding = {
      confidence: "inferred",
      evidence: [
        ...routineEvidence(code),
        ...unshifted.evidence,
        ...quarterShifted.evidence,
        ...multiplication.evidence,
        ...shift.evidence,
      ],
      assumptions: [
        ...unshifted.assumptions,
        ...quarterShifted.assumptions,
        ...multiplication.assumptions,
        ...shift.assumptions,
        "The two output pointers name valid nonwrapping words in DS, separate from the callee's private frame, saved-register/call stack and coefficient table. Caller-private local words may be the outputs. They may alias each other, including a one-byte overlap. Angle and coefficient storage are stable throughout the call.",
        "All four coordinate reads and both full signed products for each output occur before the first output store. Two-word ADD/ADC or SUB/SBB wraps to 32 bits, followed by a signed arithmetic shift by 14 and a low-word store. This rounds a negative nonintegral scaled value downwards.",
        "The first word is stored through argument six, followed by the second through argument eight. Later stores replace overlapping bytes of the first. AX retains the second output word on normal return; other volatile return registers remain unspecified by the engine summary.",
      ],
    };
    const contactRotation: ContactRotation = {
      ...finding,
      routine: code.address,
      arguments: { xPointer: 6, yPointer: 8, angle: 10 },
      coefficients: { unshifted, quarterShifted },
      multiplication: { ...multiplication, routine: multiplyCode.address },
      shift: { routine: shiftCode.address, count: 14, width: 32, convention: shift.returnConvention.kind },
      formulae,
      formulaInputs,
      inputs: "beforeAnyOutputStore",
      stores: [
        { argument: 6, value: "x" },
        { argument: 8, value: "y" },
      ],
      aliasing: "laterStoreWinsOverlappingBytes",
      returnAx: "y",
    };
    return {
      ...finding,
      address: code.address,
      kind: "argument-buffer-update",
      purpose:
        "Rotates two word velocities through runtime angle-table coefficients, using full signed products and a signed long shift, then stores the two results in order.",
      argumentOffset: 6,
      argumentKind: "unknown",
      calls: [...new Set(code.calls.flatMap((c) => (c.target ? [c.target.address] : [])))],
      writes: [6, 8].map((argumentOffset) => ({
        ...finding,
        root: "argument" as const,
        argumentOffset,
        path: [],
        offset: 0,
        width: 16,
        condition: { kind: "true" as const },
        value: {
          kind: "unknown" as const,
          reason:
            "The exact ordered two-input result is retained in contactRotation; arbitrary output pointers are not substituted as one owner.",
          width: 16,
        },
      })),
      returns: [],
      returnConvention: { kind: "far", stackBytes: 0 },
      footprint: {
        complete: true,
        partMemoryComplete: true,
        preservesArgumentMemory: false,
        preservesPartState: false,
        unknownEffects: [],
        unknownPartEffects: [],
        unknownGlobalEffects: [],
      },
      contactRotation,
    };
  }
}
