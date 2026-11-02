/** Certifies recursive connection traversals from complete decoded instruction graphs. */
import { matchHeapRoutine as matchRoutinePattern } from "./behaviour-heap-release.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";
import type { Expression, Predicate } from "./behaviour.ts";

const propagate = `push bp
mov bp,sp
sub sp,#6
push si
push di
mov di,16:ss[bp+6]
mov si,16:ss[bp+8]
cmp 16:ds[si+{delta}],#0
je @A
cmp 16:ss[bp+10],#1
jne @B
mov ax,16:ds[si+{delta}]
cmp ax,16:ds[di+{delta}]
je @B
mov 16:ss[bp+12],#1
jmp @C
B: cmp 16:ss[bp+10],#2
jne @C
mov ax,16:ds[si+{delta}]
cmp ax,16:ds[di+{delta}]
jne @C
mov 16:ss[bp+12],#1
jmp @C
A: cmp 16:ss[bp+10],#1
jne @D
mov ax,16:ds[di+{delta}]
jmp @E
D: xor ax,ax
sub ax,16:ds[di+{delta}]
E: mov 16:ds[si+{delta}],ax
C: cmp 16:ds[si+{type}],#14
jne @F
test 16:ds[si+{flags}],#64
jne @F
or 16:ds[si+{flags}],#64
mov 16:ss[bp+-2],#0
jmp @G
K: cmp 16:ss[bp+-2],#4
jne @H
push si
callf $peer
pop cx
mov 16:ss[bp+-6],ax
mov 16:ss[bp+-4],#1
jmp @I
H: mov bx,16:ss[bp+-2]
shl bx,#1
mov ax,16:ds[bx+si+{links}]
mov 16:ss[bp+-6],ax
mov 16:ss[bp+-4],#2
I: cmp 16:ss[bp+-6],#0
je @J
mov bx,16:ss[bp+-6]
test 16:ds[bx+{flags}],#2048
jne @J
push 16:ss[bp+12]
push 16:ss[bp+-4]
push bx
push si
push cs
call $self
add sp,#8
mov 16:ss[bp+12],ax
J: inc 16:ss[bp+-2]
G: cmp 16:ss[bp+-2],#5
jl @K
F: mov ax,16:ss[bp+12]
pop di
pop si
mov sp,bp
pop bp
retf`;
const advance = `push bp
mov bp,sp
sub sp,#2
push si
push di
mov si,16:ss[bp+6]
mov ax,16:ds[si+{delta}]
add 16:ds[si+{state}],ax
cmp 16:ds[si+{state}],#-1
jne @A
mov 16:ds[si+{state}],#3
jmp @B
A: cmp 16:ds[si+{state}],#4
jne @B
mov 16:ds[si+{state}],#0
B: mov 16:ds[si+{delta}],#0
mov 16:ss[bp+-2],#0
jmp @C
H: cmp 16:ss[bp+-2],#4
jne @D
push si
callf $peer
pop cx
mov di,ax
jmp @E
D: mov bx,16:ss[bp+-2]
shl bx,#1
mov di,16:ds[bx+si+{links}]
E: or di,di
je @F
cmp 16:ds[di+{delta}],#0
je @F
test 16:ds[di+{flags}],#2048
jne @F
cmp 16:ss[bp+8],#0
je @G
mov 16:ds[di+{delta}],#0
G: cmp 16:ds[di+{type}],#14
jne @F
push 16:ss[bp+8]
push di
push cs
call $self
pop cx
pop cx
F: inc 16:ss[bp+-2]
C: cmp 16:ss[bp+-2],#5
jl @H
pop di
pop si
mov sp,bp
pop bp
retf`;
const peer = `push bp
mov bp,sp
push si
push di
mov di,16:ss[bp+6]
mov ax,16:ds[di+{connection}]
mov si,ax
or ax,ax
je @A
cmp 16:ds[si+{left}],di
jne @B
mov ax,16:ds[si+{right}]
jmp @C
B: mov ax,16:ds[si+{left}]
jmp @C
A: xor ax,ax
C: pop di
pop si
pop bp
retf`;

const peerSharedReturn = peer
  .replace("jmp @C\nB:", "D: jmp @C\nB:")
  .replace("B: mov ax,16:ds[si+{left}]\njmp @C", "B: mov ax,16:ds[si+{left}]\njmp @D")
  .replace("A: xor ax,ax\nC:", "A: xor ax,ax\njmp @D\nC:");
const propagateSharedReturn = propagate
  .replace("jmp @C\nB:", "jmp @M\nB:")
  .replaceAll("jne @C", "jne @M")
  .replace("jmp @C\nA:", "M: jmp @C\nA:")
  .replace("push bx\npush si", "push 16:ss[bp+-6]\npush si")
  .replace("F: mov ax,16:ss[bp+12]\npop di", "F: mov ax,16:ss[bp+12]\njmp @N\nN: pop di");

const constant = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const field = (offset: number): Expression => ({ kind: "field", object: "part", offset, width: 16 });
const compare = (operator: string, left: Expression, value: number): Predicate => ({
  kind: "compare",
  operator,
  left,
  right: constant(value),
  signed: false,
});

/** Both traversals permit self-links and cycles. Their different pre-write invariants are kept separate. */
export function addGearSummaries(
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  layout?: BehaviourLayout,
) {
  const state = layout?.fields.find((f) => f.name === "state"),
    deltaField = layout?.fields.find((f) => f.name === "stateDelta"),
    flags = layout?.fields.find((f) => f.name === "drawingFlags"),
    type = layout?.fields.find((f) => f.name === "type");
  if (!state || !flags || !type) return;
  const initial = new Map([
    ["state", state.offset],
    ["flags", flags.offset],
    ["type", type.offset],
  ]);
  if (deltaField) initial.set("delta", deltaField.offset);
  for (const code of codes.values()) {
    const advancing = matchRoutinePattern(code, advance, new Map([...initial, ["self", code.address]]));
    const propagating =
      !advancing &&
      (matchRoutinePattern(code, propagate, new Map([...initial, ["self", code.address]])) ||
        matchRoutinePattern(code, propagateSharedReturn, new Map([...initial, ["self", code.address]])));
    const binding = advancing || propagating;
    if (!binding) continue;
    const query = codes.get(binding.get("peer")!);
    const peerBinding =
      query && (matchRoutinePattern(query, peer, binding) || matchRoutinePattern(query, peerSharedReturn, binding));
    if (!query || !peerBinding) continue;
    const delta = deltaField ?? { offset: binding.get("delta")! };
    const links = binding.get("links")!;
    const offsets = [state.offset, delta.offset, flags.offset, type.offset];
    if (
      links < 0 ||
      links + 8 > 65536 ||
      offsets.some((a, n) => a < 0 || a + 2 > 65536 || offsets.some((b, m) => n !== m && Math.abs(a - b) < 2)) ||
      offsets.some((offset) => offset < links + 8 && links < offset + 2) ||
      [state.offset, delta.offset, flags.offset].some((offset) => Math.abs(offset - peerBinding.get("connection")!) < 2)
    )
      continue;
    const evidence = [code, query].flatMap((c) =>
      c.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })),
    );
    const assumptions = [
      "The object arguments are complete part bases. Distinct parts occupy disjoint storage; equal references may alias. The four connection slots and peer endpoints are null or complete part bases. Connection objects occupy separate valid storage and the graph remains unchanged throughout traversal.",
      "The graph is finite, may contain self-links or cycles, and has valid nonwrapping fields. Private stack storage is separate from every part and has capacity for the traversal. The decoded far C convention preserves SI, DI, BP and DS.",
      advancing
        ? "Every visited source clears its movement before scanning neighbours. A recursive call requires a nonzero neighbour movement, so a cycle cannot update the original owner twice. With conflict suppression, a neighbour is cleared before its call; it still cannot be revisited through a nonzero gate."
        : "Every expanded gear is marked before recursion. Expansion stops at an already marked gear; the complete finite graph therefore terminates. Assignments to zero movement copy or negate the source movement, and never replace a nonzero target movement.",
      "The footprint includes all connected parts that may alias either argument. Exact destinations and the conflict accumulator return remain unresolved; no numeric return value is supplied.",
    ];
    const finding = { confidence: "inferred" as const, evidence, assumptions };
    const fields = advancing
      ? [
          { offset: state.offset, width: 16 },
          { offset: delta.offset, width: 16 },
        ]
      : [
          { offset: delta.offset, width: 16 },
          { offset: flags.offset, width: 16 },
        ];
    const sum: Expression = {
      kind: "binary",
      operator: "+",
      left: field(state.offset),
      right: field(delta.offset),
      width: 16,
    };
    const summary: EngineSummary = {
      ...finding,
      address: code.address,
      argumentOffset: 6,
      argumentKind: "object",
      kind: advancing ? "connected-gear-advance" : "connected-gear-propagation",
      purpose: advancing
        ? "Advances each connected moving gear once, wraps states at the recorded boundaries and clears its pending movement."
        : "Propagates pending movement through gear connections, marks visited gears and records movement conflicts.",
      calls: code.calls.map((c) => c.target!.address),
      returns: advancing
        ? []
        : [
            {
              ...finding,
              register: "ax",
              condition: { kind: "true" },
              value: {
                kind: "unknown",
                reason: "The accumulated movement-conflict result depends on the complete connected graph.",
                width: 16,
              },
            },
          ],
      returnConvention: { kind: "far", stackBytes: 0 },
      writes: [
        ...fields.map(({ offset, width }) => ({
          ...finding,
          root: "unknown" as const,
          path: [],
          offset,
          width,
          value: {
            kind: "unknown" as const,
            reason: "A connected part may be updated; its identity and final value are unresolved.",
            width,
          },
          condition: { kind: "true" as const },
        })),
        ...(advancing
          ? [
              {
                ...finding,
                root: "argument" as const,
                argumentOffset: 6,
                path: [],
                offset: delta.offset,
                width: 16,
                value: constant(0),
                condition: { kind: "true" as const },
              },
            ]
          : []),
      ],
      partGraph: {
        ...finding,
        fields,
        objectArguments: advancing ? [6] : [6, 8],
        recursiveCalls: [code.address],
        links: [links, links + 2, links + 4, links + 6],
        peer: {
          routine: query.address,
          connectionField: peerBinding.get("connection")!,
          endpointFields: [peerBinding.get("left")!, peerBinding.get("right")!],
        },
        ...(advancing
          ? {
              stateCases: [
                { condition: compare("==", sum, 65535), value: constant(3) },
                { condition: compare("==", sum, 4), value: constant(0) },
                {
                  condition: { kind: "and" as const, terms: [compare("!=", sum, 65535), compare("!=", sum, 4)] },
                  value: sum,
                },
              ],
            }
          : { preservesNonzeroOwnerField: delta.offset }),
      },
      footprint: {
        complete: true,
        partMemoryComplete: true,
        preservesPartState: !advancing,
        preservesArgumentMemory: false,
        unknownEffects: [],
        unknownPartEffects: [],
        unknownGlobalEffects: [],
      },
    };
    summaries.set(code.address, summary);
  }
}
