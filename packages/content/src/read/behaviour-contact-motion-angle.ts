/** Records the integer ratio, loaded lookup and quadrant folds used for a part's movement angle. */
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import { discoverContactArithmetic, type ContactArithmetic } from "./behaviour-contact-arithmetic.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";
import type { Expression, Finding, Predicate } from "./behaviour.ts";

export interface ContactMotionAngle extends Finding {
  backend: number;
  arguments: { xLow: 6; xHigh: 8; yLow: 10; yHigh: 12 };
  genericBackend: {
    absoluteValue: "wrappingTwoWordNegation";
    comparison: "signedHighThenUnsignedLow";
    shiftedNumerator: "wrap32";
    quotientIndex: "lowWord";
    argumentCopiesMayChange: true;
    boundedLookupNotClaimed: true;
  };
  wrapperDomain: {
    differences: "signedWrappedWords";
    maximumMagnitude: 32768;
    shiftedNumeratorUpperBound: 16777216;
    ratioIndex: [0, 511];
    equalMagnitudes: { bothZero: 1024; otherwise: 512 };
    smallerX: "1024MinusLookupOfShiftedXOverY";
    smallerY: "lookupOfShiftedYOverX";
  };
  lookup: {
    routine: number;
    segment: number;
    offset: number;
    entryWidth: 16;
    stride: 2;
    entriesRequired: 512;
    initialImageWords?: number[];
    initialImageBytes?: number[];
    snapshot?: "loadedImage";
    initialImageIssue?: string;
  };
  shift: { routine: number; count: 9; width: 32 };
  quotient: ContactArithmetic & { routine: number };
  folds: { negativeX: "2048MinusAngle"; negativeY: "4096MinusAngle"; subtract: 1024; leftShift: 4; outputWidth: 16 };
  wrapper?: {
    routine: number;
    ownerArgument: 6;
    fields: { positionX: number; previousX: number; positionY: number; previousY: number };
    x: "previousMinusCurrent";
    y: "currentMinusPrevious";
    zeroMotion: { condition: Predicate; value: 0 };
  };
}

const backendPattern = `push bp
mov bp,sp
dec sp
dec sp
push si
cmp 16:ss[bp+8],#0
jg @xPositive
jl @xNegative
cmp 16:ss[bp+6],#0
jae @xPositive
xNegative: mov ax,#1
jmp @xFlag
xPositive: xor ax,ax
xFlag: mov 8:ss[bp+-1],al
or al,al
je @ySign
mov ax,16:ss[bp+8]
mov dx,16:ss[bp+6]
neg ax
neg dx
sbb ax,#0
mov 16:ss[bp+6],dx
mov 16:ss[bp+8],ax
ySign: cmp 16:ss[bp+12],#0
jg @yPositive
jl @yNegative
cmp 16:ss[bp+10],#0
jae @yPositive
yNegative: mov ax,#1
jmp @yFlag
yPositive: xor ax,ax
yFlag: mov 8:ss[bp+-2],al
or al,al
je @compare
mov ax,16:ss[bp+12]
mov dx,16:ss[bp+10]
neg ax
neg dx
sbb ax,#0
mov 16:ss[bp+10],dx
mov 16:ss[bp+12],ax
compare: mov ax,16:ss[bp+8]
mov dx,16:ss[bp+6]
cmp ax,16:ss[bp+12]
jg @greater
jl @smallX
cmp dx,16:ss[bp+10]
jae @greater
smallX: push 16:ss[bp+12]
push 16:ss[bp+10]
mov dx,16:ss[bp+8]
mov ax,16:ss[bp+6]
mov cl,#9
callf $shift
push dx
push ax
callf $quotient
push ax
callf $lookup
pop cx
mov dx,#1024
sub dx,ax
mov si,dx
jmp @foldX
greater: mov ax,16:ss[bp+8]
mov dx,16:ss[bp+6]
cmp ax,16:ss[bp+12]
jl @equal
jg @smallY
cmp dx,16:ss[bp+10]
jbe @equal
smallY: push 16:ss[bp+8]
push 16:ss[bp+6]
mov dx,16:ss[bp+12]
mov ax,16:ss[bp+10]
mov cl,#9
callf $shift
push dx
push ax
callf $quotient
push ax
callf $lookup
pop cx
mov si,ax
jmp @foldX
equal: mov ax,16:ss[bp+6]
or ax,16:ss[bp+8]
jne @notZeroX
mov si,#1024
jmp @foldX
notZeroX: mov ax,16:ss[bp+10]
or ax,16:ss[bp+12]
jne @diagonal
xor si,si
jmp @foldX
diagonal: mov si,#512
foldX: cmp 8:ss[bp+-1],#0
je @foldY
mov ax,#2048
sub ax,si
mov si,ax
foldY: cmp 8:ss[bp+-2],#0
je @output
mov ax,#4096
sub ax,si
mov si,ax
output: mov ax,si
add ax,#64512
mov si,ax
mov ax,si
mov cl,#4
shl ax,cl
jmp @done
done: pop si
mov sp,bp
pop bp
retf`;
const shiftPattern = `cmp cl,#16
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
const lookupPattern = `push bp
mov bp,sp
mov bx,16:ss[bp+6]
shl bx,#1
mov ax,16:cs[bx+{table}]
pop bp
retf`;
const wrapperPattern = `push bp
mov bp,sp
push si
mov si,16:ss[bp+6]
mov ax,16:ds[si+{positionY}]
sub ax,16:ds[si+{previousY}]
cwd
push dx
push ax
mov ax,16:ds[si+{previousX}]
sub ax,16:ds[si+{positionX}]
cwd
push dx
push ax
callf $backend
add sp,#8
pop si
pop bp
retf`;
const wrapperBridge = wrapperPattern.replace("add sp,#8\npop si", "add sp,#8\njmp @done\ndone: pop si");
const constant = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const field = (offset: number): Expression => ({ kind: "field", object: "part", offset, width: 16 });
const binary = (operator: string, left: Expression, right: Expression): Expression => ({
  kind: "binary",
  operator,
  left,
  right,
  width: 16,
});
const compare = (operator: string, left: Expression, right: Expression): Predicate => ({
  kind: "compare",
  operator,
  left,
  right,
  signed: false,
});
type MotionSummary = EngineSummary & { contactMotionAngle: ContactMotionAngle };

/** Only the wrapper's word-difference domain receives a bounded numerical interpretation of the backend. */
export function addContactMotionAngleSummaries(
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  layout?: BehaviourLayout,
  _dataSegment?: number,
  image?: Uint8Array,
) {
  const backends = new Map<number, ContactMotionAngle>();
  for (const code of codes.values()) {
    const binding = matchHeapRoutine(code, backendPattern, new Map());
    if (!binding) continue;
    const shift = codes.get(binding.get("shift")!),
      division = codes.get(binding.get("quotient")!),
      lookup = codes.get(binding.get("lookup")!);
    if (!shift || !division || !lookup || !matchHeapRoutine(shift, shiftPattern, new Map())) continue;
    const quotient = discoverContactArithmetic(division),
      table = matchHeapRoutine(lookup, lookupPattern, new Map())?.get("table");
    if (quotient?.operation !== "signedLongQuotient" || table === undefined || table < 0 || table + 1024 > 65536)
      continue;
    const finding: Finding = {
      confidence: "inferred",
      evidence: [code, shift, division, lookup].flatMap((c) =>
        c.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })),
      ),
      assumptions: [
        ...quotient.assumptions,
        "The code-segment lookup provides 512 stable readable words at the bound reference. This is a reference to loaded program data, not a replacement with a host arctangent function or a guessed table.",
        "The bounded angle relation applies to two sign-extended wrapped word differences only: absolute values are at most 32768, shifted numerators stay nonnegative below 2^24, and the strictly larger positive magnitude is the divisor. Truncation is floor in this nonnegative domain and gives an index from zero through 511. Equal magnitudes bypass all ratio and lookup calls.",
        "For arbitrary signed long arguments, two-word absolute value can retain INT_MIN, signed-high comparison need not order unsigned magnitudes, and the shifted numerator can wrap or become negative. The backend takes only the quotient's low word before the lookup's wrapped index doubling. No 512-entry index bound or ideal angle claim is made outside the wrapper domain. Backend argument copies can be modified in its private call stack.",
      ],
    };
    const tableAddress = lookup.segment * 16 + table;
    const tableBytes =
      image && tableAddress + 1024 <= image.length
        ? Array.from(image.subarray(tableAddress, tableAddress + 1024))
        : undefined;
    const snapshot = tableBytes
      ? {
          initialImageWords: Array.from({ length: 512 }, (_, n) => tableBytes[n * 2]! | (tableBytes[n * 2 + 1]! << 8)),
          initialImageBytes: tableBytes,
          snapshot: "loadedImage" as const,
        }
      : image
        ? { initialImageIssue: "The loaded image does not contain all 512 referenced lookup words." }
        : {};
    const relation: ContactMotionAngle = {
      ...finding,
      backend: code.address,
      arguments: { xLow: 6, xHigh: 8, yLow: 10, yHigh: 12 },
      genericBackend: {
        absoluteValue: "wrappingTwoWordNegation",
        comparison: "signedHighThenUnsignedLow",
        shiftedNumerator: "wrap32",
        quotientIndex: "lowWord",
        argumentCopiesMayChange: true,
        boundedLookupNotClaimed: true,
      },
      wrapperDomain: {
        differences: "signedWrappedWords",
        maximumMagnitude: 32768,
        shiftedNumeratorUpperBound: 16777216,
        ratioIndex: [0, 511],
        equalMagnitudes: { bothZero: 1024, otherwise: 512 },
        smallerX: "1024MinusLookupOfShiftedXOverY",
        smallerY: "lookupOfShiftedYOverX",
      },
      lookup: {
        routine: lookup.address,
        segment: lookup.segment,
        offset: table,
        entryWidth: 16,
        stride: 2,
        entriesRequired: 512,
        ...snapshot,
      },
      shift: { routine: shift.address, count: 9, width: 32 },
      quotient: { ...quotient, routine: division.address },
      folds: {
        negativeX: "2048MinusAngle",
        negativeY: "4096MinusAngle",
        subtract: 1024,
        leftShift: 4,
        outputWidth: 16,
      },
    };
    backends.set(code.address, relation);
    const prior = summaries.get(code.address);
    if (prior) {
      const enriched: MotionSummary = { ...prior, contactMotionAngle: relation };
      summaries.set(code.address, enriched);
    }
  }
  for (const code of codes.values()) {
    const initial = new Map<string, number>();
    for (const name of ["positionX", "previousX", "positionY", "previousY"]) {
      const definition = layout?.fields.find((f) => f.name === name);
      if (definition) initial.set(name, definition.offset);
    }
    const bindings = matchHeapRoutine(code, wrapperPattern, initial) ?? matchHeapRoutine(code, wrapperBridge, initial);
    const backend = bindings && backends.get(bindings.get("backend")!);
    if (!bindings || !backend) continue;
    const fields = {
      positionX: bindings.get("positionX")!,
      previousX: bindings.get("previousX")!,
      positionY: bindings.get("positionY")!,
      previousY: bindings.get("previousY")!,
    };
    const offsets = Object.values(fields);
    if (offsets.some((a, n) => a < 0 || a + 2 > 65536 || offsets.some((b, m) => n !== m && Math.abs(a - b) < 2)))
      continue;
    const zero: Predicate = {
      kind: "and",
      terms: [
        compare("==", field(fields.positionX), field(fields.previousX)),
        compare("==", field(fields.positionY), field(fields.previousY)),
      ],
    };
    const changed = compare(
      "!=",
      binary(
        "|",
        binary("-", field(fields.previousX), field(fields.positionX)),
        binary("-", field(fields.positionY), field(fields.previousY)),
      ),
      constant(0),
    );
    const finding: Finding = {
      confidence: "inferred",
      evidence: [
        ...code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })),
        ...backend.evidence,
      ],
      assumptions: [
        ...backend.assumptions,
        "The wrapper's first argument is a complete part base with stable valid nonwrapping position and previous-position words. Each subtraction wraps to a word before CWD sign-extends it. The backend's mutable numerical argument copies are discarded by the wrapper's eight-byte cleanup. Zero differences take the equal-zero branch, avoiding all shift, divide and lookup calls and returning zero independently of table contents.",
      ],
    };
    const relation: ContactMotionAngle = {
      ...backend,
      ...finding,
      wrapper: {
        routine: code.address,
        ownerArgument: 6,
        fields,
        x: "previousMinusCurrent",
        y: "currentMinusPrevious",
        zeroMotion: { condition: zero, value: 0 },
      },
    };
    const summary: MotionSummary = {
      ...finding,
      address: code.address,
      kind: "contact-motion-angle",
      purpose:
        "Computes the loaded quantized movement-angle relation from wrapped position differences; zero movement returns zero.",
      argumentOffset: 6,
      argumentKind: "object",
      calls: [backend.backend],
      writes: [],
      returns: [
        { ...finding, register: "ax", condition: zero, value: constant(0) },
        {
          ...finding,
          confidence: "unresolved",
          register: "ax",
          condition: changed,
          value: {
            kind: "unknown",
            width: 16,
            reason:
              "The exact ratio and loaded-table angle relation is recorded; its general numerical value is not substituted here.",
          },
        },
      ],
      returnConvention: { kind: "far", stackBytes: 0 },
      footprint: {
        complete: true,
        partMemoryComplete: true,
        preservesArgumentMemory: true,
        preservesPartState: true,
        unknownEffects: [],
      },
      contactMotionAngle: relation,
    };
    summaries.set(code.address, summary);
  }
}
