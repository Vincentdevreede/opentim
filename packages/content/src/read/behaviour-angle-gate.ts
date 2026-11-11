/** Describes the enabled saved-angle gate as a closed scalar relation instead of enumerating its paths. */
import { discoverAngleClassifier } from "./behaviour-angle.ts";
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Expression } from "./behaviour.ts";
import { binary, constant } from "./behaviour-terms.ts";

const pattern = `push bp
mov bp,sp
sub sp,#4
push si
push di
cmp 16:ds[{enabled}],#0
jne @enabled
jmp @zero
enabled: push 16:ss[bp+6]
nop
push cs
call $classifier
pop cx
mov 16:ss[bp+-2],ax
cmp ax,16:ds[{savedClass}]
je @prepare
jmp @zero
prepare: mov 16:ss[bp+-4],#0
mov ax,16:ss[bp+6]
add ax,#8192
mov si,ax
mov ax,16:ds[{savedAngle}]
add ax,#8192
mov di,ax
or si,si
jl @second
cmp si,#16384
jg @second
or di,di
jl @second
cmp di,#16384
jg @second
jmp @accept
second: mov ax,16:ss[bp+6]
add ax,#40960
mov si,ax
mov ax,16:ds[{savedAngle}]
add ax,#40960
mov di,ax
or si,si
jl @check
cmp si,#16384
jg @check
or di,di
jl @check
cmp di,#16384
jg @check
accept: mov 16:ss[bp+-4],#1
check: cmp 16:ss[bp+-4],#0
je @zero
mov ax,16:ss[bp+6]
cmp ax,16:ds[{savedAngle}]
jne @pivot
true: mov ax,#1
jmp @done
pivot: cmp si,#8192
je @both
cmp di,#8192
jne @sides
both: jmp @true
sides: cmp si,#8192
jge @above
cmp di,#8192
jge @above
jmp @true
above: cmp si,#8192
jle @zero
cmp di,#8192
jle @zero
jmp @true
zero: xor ax,ax
done: pop di
pop si
mov sp,bp
pop bp
retf`;

const sharedReturn = pattern
  .replace("jne @enabled\njmp @zero", "jne @enabled\nzeroEntry: xor ax,ax\nbridge: jmp @done")
  .replace("mov 16:ss[bp+-2],ax\ncmp ax", "mov 16:ss[bp+-2],ax\nmov ax,16:ss[bp+-2]\ncmp ax")
  .replace("je @prepare\njmp @zero", "je @prepare\njmp @zeroEntry")
  .replace("jmp @accept\nsecond:", "mov 16:ss[bp+-4],#1\njmp @check\nsecond:")
  .replace("jne @pivot\ntrue: mov ax,#1\njmp @done", "jne @pivot\njmp @true")
  .replace("jmp @true\nzero: xor ax,ax\ndone:", "true: mov ax,#1\njmp @bridge\nzero: jmp @zeroEntry\ndone:");
const global = (offset: number): Expression => ({ kind: "field", object: "data", offset, width: 16 });

/** Every accepted angle window lies entirely inside one of the separately verified classifier sectors. */
export function discoverAngleGate(code: RoutineCode, codes: Map<number, RoutineCode>): EngineSummary | undefined {
  if (code.status !== "complete" || code.calls.length !== 1) return;
  const call = code.calls[0]!;
  const classifierCode = call.target && codes.get(call.target.address);
  const classifier = classifierCode && discoverAngleClassifier(classifierCode);
  if (!classifier || call.confidence !== "checked") return;
  const convention = classifier.returnConvention;
  if (!convention || convention.stackBytes || (call.far && convention.kind !== "far")) return;
  const adapt = (text: string) =>
    convention.kind === "near"
      ? text.replace("push cs\ncall $classifier", "call $classifier")
      : call.far
        ? text.replace("push cs\ncall $classifier", "callf $classifier")
        : text;
  const bound = new Map([["classifier", classifier.address]]);
  const binding = matchHeapRoutine(code, adapt(pattern), bound) ?? matchHeapRoutine(code, adapt(sharedReturn), bound);
  if (!binding) return;
  const enabled = binding.get("enabled")!,
    savedClass = binding.get("savedClass")!,
    savedAngle = binding.get("savedAngle")!;
  const globals = [enabled, savedClass, savedAngle];
  if (globals.some((a, n) => a < 0 || a + 2 > 65536 || globals.some((b, m) => n !== m && Math.abs(a - b) < 2))) return;
  const input: Expression = { kind: "field", object: "argument", offset: 6, width: 16 };
  const window = (offset: number, sector: number): Expression => {
    const a = binary("+", input, constant(offset)),
      b = binary("+", global(savedAngle), constant(offset));
    const valid = binary("*", binary("<=", a, constant(0x4000)), binary("<=", b, constant(0x4000)));
    const below = binary("*", binary("<=", a, constant(0x2000)), binary("<=", b, constant(0x2000)));
    const above = binary("*", binary(">=", a, constant(0x2000)), binary(">=", b, constant(0x2000)));
    return binary(
      "*",
      binary("==", global(savedClass), constant(sector)),
      binary("*", valid, binary("|", below, above)),
    );
  };
  const value = binary(
    "*",
    binary("!=", global(enabled), constant(0)),
    binary("|", window(0x2000, 0), window(0xa000, 2)),
  );
  const finding = {
    confidence: "inferred" as const,
    evidence: [code, classifierCode!].flatMap((c) =>
      c.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })),
    ),
    assumptions: [
      ...classifier.assumptions,
      "The three bound global words are valid, nonwrapping and stable throughout the call; private stack storage is separate from those words and from every part. The verified C frames preserve SI, DI, BP and DS.",
      "Word addition wraps to 16 bits. A signed value between zero and 0x4000 is exactly an unsigned value at most 0x4000. The two accepted shifted windows are disjoint. In each window, the final comparisons accept both values on the same inclusive side of 0x2000; equal input angles are already covered.",
      "The first shifted window is exactly sector zero of the checked classifier, and the second is exactly sector two, including its explicit boundary exceptions. The saved sector word is still compared as read; no consistency between it and the saved angle is assumed.",
    ],
  };
  return {
    ...finding,
    address: code.address,
    kind: "saved-angle-gate",
    purpose: "Checks a requested scalar angle against enabled saved-angle and saved-sector words.",
    argumentOffset: 6,
    argumentKind: "scalar",
    writes: [],
    returns: [{ ...finding, register: "ax", condition: { kind: "true" }, value }],
    calls: [classifier.address],
    returnConvention: { kind: "far", stackBytes: 0 },
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: true,
      preservesPartState: true,
      unknownEffects: [],
    },
  };
}
