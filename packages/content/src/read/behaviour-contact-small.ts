/** Complete instruction contracts for small endpoint, side-flag and typed contact-list helpers. */
import type { Expression, Finding, Predicate } from "./behaviour.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import { discoverContactScalar } from "./behaviour-contact-scalars.ts";
import type { EngineSummary, EngineWrite } from "./behaviour-helpers.ts";
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";

export type ContactSmallRelation =
  | {
      kind: "endpoint-extension";
      argument: 6;
      axes: { start: number; end: number }[];
      difference: "wrapped-signed-16";
      returnRegisters: ["ax", "dx"];
      returnBeforeWrites: Expression;
    }
  | {
      kind: "direction-side-flags";
      endpointArgument: 6;
      coordinateArgument: 8;
      outputArgument: 10;
      rangeRoutine: number;
      flagOffsets: [2, 3];
      writtenValue: 1;
      insideSetsBoth: true;
      cases: { condition: Predicate; flags: number[]; returnBeforeWrites: Expression }[];
    }
  | {
      kind: "typed-list-membership";
      ownerArgument: 6;
      valueArgument: 8;
      typeField: number;
      requiredType: number;
      headField: number;
      nextField: number;
      normalReturnValues: [0, 1];
      relation: "oneIfValueOccursInNonNullChainOtherwiseZero";
    };
export interface ContactSmallSummary extends EngineSummary {
  contactSmall: ContactSmallRelation;
}
const constant = (value: number, width = 16): Expression => ({ kind: "constant", value, width });
const field = (offset: number, width = 16): Expression => ({ kind: "field", object: "part", offset, width });
const argument = (offset: number): Expression => ({ kind: "field", object: "argument", offset, width: 16 });
const binary = (operator: string, left: Expression, right: Expression): Expression => ({
  kind: "binary",
  operator,
  left,
  right,
  width: 16,
});
const compare = (operator: string, left: Expression, right: Expression, signed = false): Predicate => ({
  kind: "compare",
  operator,
  left,
  right,
  signed,
});
const and = (...terms: Predicate[]): Predicate => ({ kind: "and", terms });

const extension = `push bp
mov bp,sp
push si
mov si,16:ss[bp+6]
mov ax,16:ds[si+4]
sub ax,16:ds[si+0]
mov dx,ax
or dx,dx
jle @xnegative
inc 16:ds[si+4]
jmp @y
xnegative: or dx,dx
jge @y
dec 16:ds[si+4]
y: mov ax,16:ds[si+6]
sub ax,16:ds[si+2]
mov dx,ax
or dx,dx
jle @ynegative
inc 16:ds[si+6]
jmp @done
ynegative: or dx,dx
jge @done
dec 16:ds[si+6]
done: pop si
pop bp
retf`;
const membership = `push bp
mov bp,sp
push si
push di
mov di,16:ss[bp+6]
cmp 16:ds[di+{type}],#{required}
jne @zero
mov si,16:ds[di+{link}]
jmp @header
body: cmp si,16:ss[bp+8]
jne @next
mov ax,#1
jmp @done
next: mov si,16:ds[si+{link}]
header: or si,si
jne @body
zero: xor ax,ax
done: pop di
pop si
pop bp
retf`;
const membershipBridge = membership
  .replace("mov ax,#1\njmp @done", "mov ax,#1\nbridge: jmp @done")
  .replace("zero: xor ax,ax\ndone:", "zero: xor ax,ax\njmp @bridge\ndone:");
const sides = `push bp
mov bp,sp
push si
push di
mov si,16:ss[bp+6]
mov di,16:ss[bp+10]
push 16:ds[si+4]
push 16:ds[si+0]
push 16:ss[bp+8]
{rangeCall}
add sp,#6
or ax,ax
je @outside
mov 8:ds[di+2],#1
jmp @three
outside: mov ax,16:ds[si+0]
cmp ax,16:ds[si+4]
jge @reverse
cmp ax,16:ss[bp+8]
jle @two
jmp @three
two: mov 8:ds[di+2],#1
jmp @done
reverse: mov ax,16:ds[si+4]
cmp ax,16:ss[bp+8]
jle @three
jmp @two
three: mov 8:ds[di+3],#1
done: pop di
pop si
pop bp
retf`;
const sidesDuplicated = `push bp
mov bp,sp
push si
push di
mov si,16:ss[bp+6]
mov di,16:ss[bp+10]
push 16:ds[si+4]
push 16:ds[si+0]
push 16:ss[bp+8]
{rangeCall}
add sp,#6
or ax,ax
je @outside
mov 8:ds[di+2],#1
mov 8:ds[di+3],#1
jmp @done
outside: mov ax,16:ds[si+0]
cmp ax,16:ds[si+4]
jge @reverse
mov ax,16:ds[si+0]
cmp ax,16:ss[bp+8]
jle @two
mov 8:ds[di+3],#1
jmp @bridge
two: mov 8:ds[di+2],#1
bridge: jmp @done
reverse: mov ax,16:ds[si+4]
cmp ax,16:ss[bp+8]
jle @three
mov 8:ds[di+2],#1
jmp @done
three: mov 8:ds[di+3],#1
done: pop di
pop si
pop bp
retf`;
const bridges = ["nop\npush cs\ncall $range", "push cs\ncall $range", "callf $range", "nop\ncallf $range"];

/** No partial return alternatives are installed: mutating helpers' exact returns describe their pre-write inputs. */
export function discoverContactSmall(
  code: RoutineCode,
  codes: Map<number, RoutineCode>,
  layout?: BehaviourLayout,
): ContactSmallSummary | undefined {
  const proof = code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text }));
  const finding: Finding = {
    confidence: "inferred",
    evidence: proof,
    assumptions: [
      "The far C call has a valid private stack frame, separate from the argument buffers, with nonwrapping complete buffers and preserved SI, DI, BP and DS.",
    ],
  };
  const base = {
    ...finding,
    address: code.address,
    argumentOffset: 6,
    argumentKind: "unknown" as const,
    writes: [] as EngineWrite[],
    returns: [],
    calls: code.calls.flatMap((c) => (c.target ? [c.target.address] : [])),
    returnConvention: { kind: "far" as const, stackBytes: 0 },
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: false,
      preservesPartState: false,
      unknownEffects: [],
      unknownPartEffects: [],
      unknownGlobalEffects: [],
    },
  };
  if (matchHeapRoutine(code, extension, new Map())) {
    const writes: EngineWrite[] = [];
    for (const [start, end] of [
      [0, 4],
      [2, 6],
    ] as const) {
      const difference = binary("-", field(end), field(start));
      for (const [mnemonic, operator, delta] of [
        ["inc", ">", 1],
        ["dec", "<", -1],
      ] as const) {
        const store = code.instructions.find(
          (i) => i.mnemonic === mnemonic && i.operands[0]?.kind === "memory" && i.operands[0].displacement === end,
        )!;
        writes.push({
          ...finding,
          evidence: [{ address: store.address, bytes: store.bytes, text: store.text }],
          root: "argument",
          argumentOffset: 6,
          path: [],
          offset: end,
          width: 16,
          value: binary("+", field(end), constant(delta)),
          condition: compare(operator, difference, constant(0), true),
        });
      }
    }
    return {
      ...base,
      kind: "argument-buffer-update",
      purpose: "Extends each end coordinate by the sign of its wrapped signed difference from the start coordinate.",
      writes,
      contactSmall: {
        kind: "endpoint-extension",
        argument: 6,
        axes: [
          { start: 0, end: 4 },
          { start: 2, end: 6 },
        ],
        difference: "wrapped-signed-16",
        returnRegisters: ["ax", "dx"],
        returnBeforeWrites: binary("-", field(6), field(2)),
      },
    };
  }
  const initial = new Map<string, number>();
  const type = layout?.fields.find((f) => f.name === "type");
  if (type) initial.set("type", type.offset);
  const list = [membership, membershipBridge].map((p) => matchHeapRoutine(code, p, initial)).find(Boolean);
  if (list) {
    const typeField = list.get("type")!,
      link = list.get("link")!;
    if (
      typeField < 0 ||
      typeField + 2 > 65536 ||
      link < 0 ||
      link + 2 > 65536 ||
      (typeField < link + 2 && link < typeField + 2)
    )
      return;
    return {
      ...base,
      kind: "contact-typed-list-membership",
      argumentKind: "object",
      purpose: "Checks whether a pointer occurs in the selected type's contact list, without writing any field.",
      assumptions: [
        ...finding.assumptions,
        "The read-only chain consists of complete nodes and is finite if a zero return is required. A hit returns one; no hit or the wrong owner type returns zero. A cyclic chain without a hit need not return.",
      ],
      footprint: { ...base.footprint, preservesArgumentMemory: true, preservesPartState: true },
      contactSmall: {
        kind: "typed-list-membership",
        ownerArgument: 6,
        valueArgument: 8,
        typeField,
        requiredType: list.get("required")!,
        headField: link,
        nextField: link,
        normalReturnValues: [0, 1],
        relation: "oneIfValueOccursInNonNullChainOtherwiseZero",
      },
    };
  }
  let binding: Map<string, number> | undefined;
  for (const pattern of [sides, sidesDuplicated])
    for (const call of bridges) binding ??= matchHeapRoutine(code, pattern.replace("{rangeCall}", call), new Map());
  if (!binding) return;
  const rangeCode = codes.get(binding.get("range")!);
  const range = rangeCode && discoverContactScalar(rangeCode);
  if (range?.kind !== "contact-coordinate-range" || !range.returns[0]) return;
  const a = field(0),
    b = field(4),
    coordinate = argument(8);
  const ordered = binary("<=", binary("^", a, constant(0x8000)), binary("^", b, constant(0x8000)));
  const inside = binary(
    "|",
    binary("*", ordered, binary("<=", binary("-", coordinate, a), binary("-", b, a))),
    binary("*", binary("==", ordered, constant(0)), binary("<=", binary("-", coordinate, b), binary("-", a, b))),
  );
  const cases = [
    { condition: compare("!=", inside, constant(0)), flags: [2, 3], returnBeforeWrites: constant(1) },
    {
      condition: and(compare("==", inside, constant(0)), compare("<", a, b, true), compare("<=", a, coordinate, true)),
      flags: [2],
      returnBeforeWrites: a,
    },
    {
      condition: and(compare("==", inside, constant(0)), compare("<", a, b, true), compare(">", a, coordinate, true)),
      flags: [3],
      returnBeforeWrites: a,
    },
    {
      condition: and(compare("==", inside, constant(0)), compare(">=", a, b, true), compare(">", b, coordinate, true)),
      flags: [2],
      returnBeforeWrites: b,
    },
    {
      condition: and(compare("==", inside, constant(0)), compare(">=", a, b, true), compare("<=", b, coordinate, true)),
      flags: [3],
      returnBeforeWrites: b,
    },
  ];
  const combined = {
    ...finding,
    evidence: [...proof, ...range.evidence],
    assumptions: [
      ...finding.assumptions,
      ...range.assumptions,
      "Output flags are sticky assignments of the byte value one. No output byte is cleared; coordinates inside the inclusive span set both flags. Conditions and return descriptors refer to the inputs before any writes, even if buffers alias.",
    ],
  };
  const writes: EngineWrite[] = cases.flatMap((c) =>
    c.flags.map((offset) => ({
      ...combined,
      root: "argument" as const,
      argumentOffset: 10,
      path: [],
      offset,
      width: 8,
      value: constant(1, 8),
      condition: c.condition,
    })),
  );
  return {
    ...base,
    ...combined,
    kind: "argument-buffer-update",
    purpose:
      "Sets one or both direction-side bytes according to a coordinate's position relative to directed endpoints, leaving other bytes unchanged.",
    writes,
    contactSmall: {
      kind: "direction-side-flags",
      endpointArgument: 6,
      coordinateArgument: 8,
      outputArgument: 10,
      rangeRoutine: range.address,
      flagOffsets: [2, 3],
      writtenValue: 1,
      insideSetsBoth: true,
      cases,
    },
  };
}
