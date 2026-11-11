/**
 * The speed setter: it gives a part a new velocity of a given speed in the direction of a word angle. The explosion's
 * run calls it for every loose part it hits, and the pinball bumper's bounce for the ball. Checked against its
 * complete instruction graph and the contracts of the four routines it calls.
 */
import { discoverContactArithmetic, type ContactArithmetic } from "./behaviour-contact-arithmetic.ts";
import {
  discoverRotationScalar,
  discoverRotationShift,
  rotationScalarExpression,
  shiftedLowWord,
  signedProduct,
  type RotationScalar,
} from "./behaviour-contact-rotation.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Finding } from "./behaviour.ts";
import { argumentField, routineEvidence } from "./behaviour-terms.ts";

/** What the speed setter does with its three arguments, the part, the angle and the speed. */
export interface DirectedVelocity extends Finding {
  routine: number;
  arguments: { part: 6; angle: 8; speed: 10 };
  /** The horizontal speed uses the coefficient a quarter turn on (a sine), the vertical one the plain one (a cosine). */
  coefficients: { horizontal: RotationScalar; vertical: RotationScalar };
  multiplication: ContactArithmetic & { routine: number };
  shift: { routine: number; count: 14; width: 32; convention: "near" | "far" };
  /** Both are always written, horizontal first. */
  stores: [{ field: 0x36; coefficient: "horizontal" }, { field: 0x38; coefficient: "vertical" }];
}

const nearShift = `push bp
mov bp,sp
sub sp,#8
push si
push di
mov si,16:ss[bp+6]
mov di,16:ss[bp+8]
push di
callf $horizontal
pop cx
push ax
push 16:ss[bp+10]
callf $product
pop cx
pop cx
mov 16:ss[bp+-2],dx
mov 16:ss[bp+-4],ax
push di
callf $vertical
pop cx
push ax
push 16:ss[bp+10]
callf $product
pop cx
pop cx
mov 16:ss[bp+-6],dx
mov 16:ss[bp+-8],ax
mov dx,16:ss[bp+-2]
mov ax,16:ss[bp+-4]
mov cl,#14
call $shift
mov 16:ds[si+54],ax
mov dx,16:ss[bp+-6]
mov ax,16:ss[bp+-8]
mov cl,#14
call $shift
mov 16:ds[si+56],ax
pop di
pop si
mov sp,bp
pop bp
retf`;
/** The compiler forms of the speed setter in the supplied builds: the English CD calls the shift far. */
const directedVelocityPatterns = [nearShift, nearShift.replaceAll("call $shift", "callf $shift")];

/** The speed setter's summary, where the routine's graph and its four callees match. */
export function discoverDirectedVelocity(
  code: RoutineCode,
  codes: Map<number, RoutineCode>,
  image: Uint8Array,
  patterns: string[] = directedVelocityPatterns,
): (EngineSummary & { directedVelocity: DirectedVelocity }) | undefined {
  for (const pattern of patterns) {
    const binding = matchHeapRoutine(code, pattern, new Map());
    if (!binding) continue;
    const horizontalCode = codes.get(binding.get("horizontal")!),
      verticalCode = codes.get(binding.get("vertical")!),
      productCode = codes.get(binding.get("product")!),
      shiftCode = codes.get(binding.get("shift")!);
    if (!horizontalCode || !verticalCode || !productCode || !shiftCode) continue;
    const horizontal = discoverRotationScalar(horizontalCode, image),
      vertical = discoverRotationScalar(verticalCode, image),
      multiplication = discoverContactArithmetic(productCode),
      shift = discoverRotationShift(shiftCode);
    if (
      horizontal?.phase !== 49152 ||
      vertical?.phase !== 0 ||
      horizontal.table.segment !== vertical.table.segment ||
      horizontal.table.offset !== vertical.table.offset ||
      multiplication?.operation !== "signedWordProduct" ||
      shift?.returnConvention?.kind !== (pattern.includes("callf $shift") ? "far" : "near")
    )
      continue;
    const finding: Finding = {
      confidence: "inferred",
      evidence: [
        ...routineEvidence(code),
        ...horizontal.evidence,
        ...vertical.evidence,
        ...multiplication.evidence,
        ...shift.evidence,
      ],
      assumptions: [
        ...new Set([
          ...horizontal.assumptions,
          ...vertical.assumptions,
          ...multiplication.assumptions,
          ...shift.assumptions,
          "The first argument is a part. Each velocity word is the full signed product of the speed and a coefficient, shifted right by 14 as a signed long, and its low word is stored: first the horizontal one at 0x36 with the coefficient a quarter turn on, then the vertical one at 0x38. Both are always written, and the old velocity is replaced, not added to.",
        ]),
      ],
    };
    const directedVelocity: DirectedVelocity = {
      ...finding,
      routine: code.address,
      arguments: { part: 6, angle: 8, speed: 10 },
      coefficients: { horizontal, vertical },
      multiplication: { ...multiplication, routine: productCode.address },
      shift: { routine: shiftCode.address, count: 14, width: 32, convention: shift.returnConvention.kind },
      stores: [
        { field: 0x36, coefficient: "horizontal" },
        { field: 0x38, coefficient: "vertical" },
      ],
    };
    return {
      ...finding,
      address: code.address,
      kind: "owner-field-update",
      purpose:
        "Sets the part's velocity to the speed it is given, in the direction of the angle it is given, replacing the old velocity.",
      argumentOffset: 6,
      argumentKind: "object",
      calls: [...new Set(code.calls.flatMap((c) => (c.target ? [c.target.address] : [])))],
      writes: directedVelocity.stores.map(({ field }) => ({
        ...finding,
        root: "argument" as const,
        argumentOffset: 6,
        path: [],
        offset: field,
        width: 16,
        condition: { kind: "true" as const },
        // The speed times the coefficient of the angle, as a signed long shifted right by 14: its low word.
        value: shiftedLowWord(
          signedProduct(
            argumentField(directedVelocity.arguments.speed),
            rotationScalarExpression(
              field === 0x36 ? horizontal : vertical,
              argumentField(directedVelocity.arguments.angle),
            ),
          ),
        ),
      })),
      returns: [],
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
      directedVelocity,
    };
  }
}
