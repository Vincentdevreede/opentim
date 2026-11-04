/** Proves the no-dispatch cases of the bounded rope-connection query. */
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";
import type { Expression, Finding, Predicate } from "./behaviour.ts";

export interface ConnectionBypass extends Finding {
  ownerArgument: 8;
  argumentOffset: 6;
  cases: { condition: Predicate; value: Expression }[];
  remaining: Predicate;
}

const query = `push bp
mov bp,sp
sub sp,#16
push si
push di
mov di,16:ss[bp+8]
test 16:ds[di+{flags}],#{mask}
je @scan
mov ax,#1
jmp @done
scan: mov 16:ss[bp+-4],#0
mov 16:ss[bp+-2],#0
jmp @header
body: mov bx,16:ss[bp+-2]
shl bx,#1
mov ax,16:ds[bx+di+{links}]
mov si,ax
or ax,ax
jne @nonnull
jmp @update
nonnull: push si
push di
callf $peer
pop cx
pop cx
mov 16:ss[bp+-16],ax
cmp ax,16:ss[bp+6]
jne @classify
jmp @update
classify: cmp 16:ds[si+2],di
jne @second
mov 16:ss[bp+-6],#0
mov al,8:ds[si+10]
mov ah,#0
mov 16:ss[bp+-8],ax
mov al,8:ds[si+11]
jmp @index
second: mov 16:ss[bp+-6],#1
mov al,8:ds[si+11]
mov ah,#0
mov 16:ss[bp+-8],ax
mov al,8:ds[si+10]
index: mov ah,#0
mov 16:ss[bp+-10],ax
cmp 16:ds[di+{delta}],#0
jle @negative
cmp 16:ss[bp+-8],#0
jne @one
jmp @zero
one: mov 16:ss[bp+-14],#1
jmp @direction
negative: cmp 16:ss[bp+-8],#0
jne @zero
jmp @one
zero: mov 16:ss[bp+-14],#0
direction: push 16:ss[bp+-14]
push 16:ss[bp+-6]
push si
callf $classifier
add sp,#6
mov 16:ss[bp+-12],ax
mov ax,16:ss[bp+10]
or 16:ss[bp+-12],ax
push 16:ss[bp+16]
push 16:ss[bp+14]
push 16:ss[bp+12]
push 16:ss[bp+-12]
push 16:ss[bp+-10]
push 16:ss[bp+-16]
push di
mov bx,16:ss[bp+-16]
mov ax,16:ds[bx+{type}]
mov dx,#58
imul dx
mov dx,#{tableSegment}
mov bx,ax
mov es,dx
callf $dispatch
add sp,#14
mov 16:ss[bp+-4],ax
update: inc 16:ss[bp+-2]
header: cmp 16:ss[bp+-2],#2
jge @finish
cmp 16:ss[bp+-4],#0
jne @finish
jmp @body
finish: mov ax,16:ss[bp+-4]
done: pop di
pop si
mov sp,bp
pop bp
retf`;

const sharedReturn = query
  .replace("mov ax,#1\njmp @done", "mov ax,#1\nbridge: jmp @done")
  .replace("mov 16:ss[bp+-16],ax\ncmp ax", "mov 16:ss[bp+-16],ax\nmov ax,16:ss[bp+-16]\ncmp ax")
  .replace(
    "jne @one\njmp @zero\none: mov 16:ss[bp+-14],#1\njmp @direction\nnegative: cmp 16:ss[bp+-8],#0\njne @zero\njmp @one",
    "jne @one\nmov 16:ss[bp+-14],#0\njmp @directionBridge\none: mov 16:ss[bp+-14],#1\ndirectionBridge: jmp @direction\nnegative: cmp 16:ss[bp+-8],#0\njne @zero\nmov 16:ss[bp+-14],#1\njmp @direction",
  )
  .replace("finish: mov ax,16:ss[bp+-4]\ndone:", "finish: mov ax,16:ss[bp+-4]\njmp @bridge\ndone:");
const dataTable = (pattern: string) => pattern.replace("mov dx,#{tableSegment}\nmov bx,ax\nmov es,dx", "mov bx,ax");
const constant = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const field = (offset: number): Expression => ({ kind: "field", object: "part", offset, width: 16 });
const compare = (operator: string, left: Expression): Predicate => ({
  kind: "compare",
  operator,
  left,
  right: constant(0),
  signed: false,
});

/** Cases preserve non-stack memory; the complementary case retains the unresolved callback effects. */
export function discoverConnectionBypass(code: RoutineCode, layout?: BehaviourLayout): ConnectionBypass | undefined {
  if (code.status !== "complete") return;
  const indirect = code.instructions.filter((i) => i.flow === "call" && !i.target);
  if (indirect.length !== 1) return;
  const dispatch = indirect[0]!,
    operand = dispatch.operands[0],
    call = code.calls.find((c) => c.instruction === dispatch.address);
  if (
    dispatch.mnemonic !== "call" ||
    dispatch.operands.length !== 1 ||
    !dispatch.far ||
    !call?.far ||
    call.target ||
    operand?.kind !== "memory" ||
    operand.width !== 32 ||
    operand.base.join() !== "bx" ||
    operand.direct ||
    !["ds", "es"].includes(operand.segment) ||
    operand.displacement < 0 ||
    operand.displacement + 4 > 65536
  )
    return;
  const rope = layout?.callbacks.find((c) => c.role === "rope");
  if (rope && !rope.sites.includes(dispatch.address)) return;
  if (operand.segment === "es" && operand.displacement !== (rope?.field ?? 54)) return;
  // The matcher accepts only resolved calls. Normalize this independently verified indirect instruction for
  // matching its surrounding graph; this target is a matching token and is never a claimed call destination.
  const token = { address: code.address, segment: code.segment, offset: code.offset };
  const normalized: RoutineCode = {
    ...code,
    instructions: code.instructions.map((i) =>
      i === dispatch ? { ...i, target: token, operands: [{ kind: "address", ...token }] } : i,
    ),
    calls: code.calls.map((c) =>
      c === call ? { ...c, target: token, operand: { kind: "address", ...token }, confidence: "checked" } : c,
    ),
  };
  const bindings = new Map<string, number>();
  for (const [name, role] of [
    ["flags", "drawingFlags"],
    ["delta", "stateDelta"],
    ["type", "type"],
  ]) {
    const fact = layout?.fields.find((f) => f.name === role);
    if (fact) bindings.set(name!, fact.offset);
  }
  const patterns = operand.segment === "ds" ? [dataTable(query), dataTable(sharedReturn)] : [query, sharedReturn];
  const matched = patterns.map((pattern) => matchHeapRoutine(normalized, pattern, bindings)).find(Boolean);
  if (!matched) return;
  const flags = matched.get("flags")!,
    links = matched.get("links")!,
    mask = matched.get("mask")!;
  if (
    flags < 0 ||
    flags + 2 > 65536 ||
    links < 0 ||
    links + 4 > 65536 ||
    (flags < links + 4 && links < flags + 2) ||
    mask <= 0 ||
    mask > 65535 ||
    (mask & (mask - 1)) !== 0
  )
    return;
  const tested: Expression = { kind: "binary", operator: "&", left: field(flags), right: constant(mask), width: 16 };
  const connections: Expression = {
    kind: "binary",
    operator: "|",
    left: field(links),
    right: field(links + 2),
    width: 16,
  };
  const clear = compare("==", tested);
  return {
    ownerArgument: 8,
    argumentOffset: 6,
    cases: [
      { condition: compare("!=", tested), value: constant(1) },
      { condition: { kind: "and", terms: [clear, compare("==", connections)] }, value: constant(0) },
    ],
    remaining: { kind: "and", terms: [clear, compare("!=", connections)] },
    confidence: "inferred",
    evidence: code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })),
    assumptions: [
      "The second far-call argument is a complete part base. Its drawing flags and two connection words are valid nonwrapping fields, separate from a valid private stack frame.",
      "The complete decoded graph matches a two-slot short-circuit scan. A set entry flag returns one before the scan; with the flag clear and both connection words zero, each iteration skips every call and reaches the sole counter increment, returning the unchanged zero result after two increments.",
      "Only these selected cases preserve non-stack memory. The complementary case may invoke an unresolved type callback; its effects and return remain unresolved. The normalized matching token is not a resolved indirect call target.",
    ],
  };
}
