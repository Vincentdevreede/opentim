/** Describes the complete four-sector angle classifier with one ordinary scalar expression. */
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Expression } from "./behaviour.ts";

const pattern = `push bp
mov bp,sp
mov dx,16:ss[bp+6]
cmp dx,#8192
jne @second
xor ax,ax
jmp @done
second: cmp dx,#40960
jne @general
mov ax,#2
jmp @done
general: add dx,#8192
mov cl,#14
sar dx,cl
and dx,#3
mov ax,dx
done: pop bp
retf`;
const sharedReturn = pattern
  .replace("jmp @done", "bridge: jmp @done")
  .replace("mov ax,#2\njmp @done", "mov ax,#2\njmp @bridge")
  .replace("mov ax,dx\ndone:", "mov ax,dx\njmp @bridge\ndone:");
const constant = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const binary = (operator: string, left: Expression, right: Expression): Expression => ({
  kind: "binary",
  operator,
  left,
  right,
  width: 16,
});

/** Matching the complete graph checks the two exceptional boundaries and all other returns. */
export function discoverAngleClassifier(code: RoutineCode): EngineSummary | undefined {
  if (code.status !== "complete") return;
  const patterns = [pattern, sharedReturn];
  const farMatch = patterns.some((candidate) => matchHeapRoutine(code, candidate, new Map()));
  if (
    !farMatch &&
    !patterns.some((candidate) =>
      matchHeapRoutine(code, candidate.replace("bp+6", "bp+4").replace("retf", "ret"), new Map()),
    )
  )
    return;
  const argumentOffset = farMatch ? 6 : 4;
  const input: Expression = { kind: "field", object: "argument", offset: argumentOffset, width: 16 };
  // SAR followed by AND 3 selects the same two bits as an unsigned shift. Subtracting one at the two
  // exceptional boundaries selects the preceding sector before those bits are extracted.
  const boundary = binary("==", binary("&", input, constant(0x7fff)), constant(0x2000));
  const value = binary(">>>", binary("-", binary("+", input, constant(0x2000)), boundary), constant(14));
  const finding = {
    confidence: "inferred" as const,
    evidence: code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })),
    assumptions: [
      "The scalar argument is a 16-bit word in a valid private C stack frame, separate from part and program data.",
      "Arithmetic wraps to 16 bits. The two explicit boundary returns select the preceding sector; all other inputs use bits 14 and 15 of the argument plus 0x2000. The expression combines these exact cases without choosing a game input.",
    ],
  };
  return {
    ...finding,
    address: code.address,
    kind: "angle-sector",
    purpose: "Classifies a 16-bit angle into one of four sectors, with two explicit boundary exceptions.",
    argumentOffset,
    argumentKind: "scalar",
    writes: [],
    returns: [{ ...finding, register: "ax", value, condition: { kind: "true" } }],
    calls: [],
    returnConvention: { kind: farMatch ? "far" : "near", stackBytes: 0 },
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: true,
      preservesPartState: true,
      unknownEffects: [],
    },
  };
}
