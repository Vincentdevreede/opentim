/** Describes reset-time gear contacts from the complete decoded callback, after its common prefix call. */
import type { Finding } from "./behaviour.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import { addGearSummaries } from "./behaviour-gear.ts";
import { discoverGearRun, type GearRunContract } from "./behaviour-gear-run.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";

export interface GearConnections extends Finding {
  address: number;
  run: number;
  argumentOffset: 6;
  snapshot: { kind: "afterCommonCall"; instruction: number; helper: number };
  coordinates: { x: number; y: number; width: 16 };
  source: { headOffset: number; nextField: number; typeField: number; type: 14; ignoreSelf: true };
  distance: 32;
  difference: "ownerMinusCandidate";
  slots: { offset: number; dx: number; dy: number }[];
  unmatched: 0;
  lastMatchWins: true;
  conditionalOnNormalReturn: true;
  meshOnlyCorollary?: Finding & {
    requiresRetainedCoordinateMap: true;
    requiresNoCheckedPeerEdges: true;
    requiresOnlyRootInitiallyMoving: true;
    requiresDistinctNegation: true;
    conflict: 0;
  };
  colouring: {
    kind: "coordinateBitParity";
    bit: 5;
    fields: [number, number];
    op: "xor";
    flipsEveryDirectConnection: true;
  };
}
const pattern = `push bp
mov bp,sp
sub sp,#6
push si
push di
mov si,16:ss[bp+6]
push si
{commonCall}
pop cx
mov 16:ss[bp+-6],#0
jmp @clearGuard
clearBody: mov bx,16:ss[bp+-6]
shl bx,#1
mov 16:ds[bx+si+{first}],#0
inc 16:ss[bp+-6]
clearGuard: cmp 16:ss[bp+-6],#4
jl @clearBody
mov di,16:ds[{head}]
jmp @memberGuard
memberBody: cmp di,si
je @next
cmp 16:ds[di+{type}],#14
jne @next
mov ax,16:ds[si+{x}]
sub ax,16:ds[di+{x}]
mov 16:ss[bp+-2],ax
mov ax,16:ds[si+{y}]
sub ax,16:ds[di+{y}]
mov 16:ss[bp+-4],ax
cmp 16:ss[bp+-4],#0
jne @vertical
cmp 16:ss[bp+-2],#32
jne @right
mov 16:ds[si+{first}],di
jmp @next
right: cmp 16:ss[bp+-2],#{negativeX}
jne @next
mov 16:ds[si+{second}],di
jmp @next
vertical: cmp 16:ss[bp+-2],#0
jne @next
cmp 16:ss[bp+-4],#32
jne @below
mov 16:ds[si+{third}],di
jmp @next
below: cmp 16:ss[bp+-4],#{negativeY}
jne @next
mov 16:ds[si+{fourth}],di
next: mov di,16:ds[di+{next}]
memberGuard: or di,di
jne @memberBody
pop di
pop si
mov sp,bp
pop bp
retf`;
const horizontalBridge = (p: string) =>
  p
    .replace("mov 16:ds[si+{first}],di\njmp @next", "mov 16:ds[si+{first}],di\njmp @horizontalDone")
    .replace(
      "right: cmp 16:ss[bp+-2],#{negativeX}\njne @next",
      "right: cmp 16:ss[bp+-2],#{negativeX}\njne @horizontalDone",
    )
    .replace("mov 16:ds[si+{second}],di\njmp @next", "mov 16:ds[si+{second}],di\nhorizontalDone: jmp @next");
const callForms = ["push cs\ncall $common", "nop\npush cs\ncall $common", "callf $common", "nop\ncallf $common"];
const overlaps = (a: number, b: number) => a < b + 2 && b < a + 2;

/** This is a post-prefix topology fact, not a claim about any state or geometry changes made by the prefix helper. */
export function discoverGearConnections(
  code: RoutineCode,
  codes: Map<number, RoutineCode>,
  run: GearRunContract,
  layout: BehaviourLayout,
): GearConnections | undefined {
  const x = layout.fields.find((f) => f.name === "savedPositionX"),
    y = layout.fields.find((f) => f.name === "savedPositionY"),
    type = layout.fields.find((f) => f.name === "type");
  if (
    code.status !== "complete" ||
    code.calls.length !== 1 ||
    !x ||
    !y ||
    !type ||
    x.confidence === "unresolved" ||
    y.confidence === "unresolved" ||
    type.confidence === "unresolved" ||
    run.links.length !== 4
  )
    return;
  // The supplied root must really use these slots; no invented connection layout can qualify the reset callback.
  const root = codes.get(run.address),
    summaries = new Map<number, EngineSummary>();
  const dependencies = [run.propagation, run.advance, run.propagationRelation.expansion.peer.routine].map((a) =>
    codes.get(a),
  );
  if (!root || dependencies.some((c) => !c)) return;
  addGearSummaries(new Map(dependencies.map((c) => [c!.address, c!])), summaries, layout);
  const checkedRun = discoverGearRun(root, codes, summaries, layout);
  if (!checkedRun || JSON.stringify(checkedRun.links) !== JSON.stringify(run.links)) return;
  const inputFields = [x.offset, y.offset, type.offset];
  if (
    inputFields.some((a) => !Number.isInteger(a) || a < 0 || a + 2 > 0x10000) ||
    overlaps(x.offset, y.offset) ||
    inputFields.some((a) => checkedRun.links.some((b) => overlaps(a, b)))
  )
    return;
  const initial = new Map<string, number>([
    ["x", x.offset],
    ["y", y.offset],
    ["type", type.offset],
    ...checkedRun.links.map(
      (offset, index) => [["first", "second", "third", "fourth"][index]!, offset] as [string, number],
    ),
  ]);
  let match: Map<string, number> | undefined;
  for (const body of [pattern, horizontalBridge(pattern)])
    for (const call of callForms)
      for (const negativeX of [-32, 65504])
        for (const negativeY of [-32, 65504]) {
          match ??= matchHeapRoutine(
            code,
            body.replace("{commonCall}", call),
            new Map([...initial, ["negativeX", negativeX], ["negativeY", negativeY]]),
          );
        }
  if (!match) return;
  const head = match.get("head")!,
    next = match.get("next")!;
  if (
    [head, next].some((a) => !Number.isInteger(a) || a < 0 || a + 2 > 0x10000) ||
    checkedRun.links.some((a) => overlaps(a, next))
  )
    return;
  const common = code.calls[0]!;
  if (!common.target) return;
  const proof = [
    ...new Map(
      [
        ...code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })),
        ...checkedRun.evidence,
        ...x.evidence,
        ...y.evidence,
        ...type.evidence,
      ].map((e) => [JSON.stringify(e), e]),
    ).values(),
  ];
  return {
    address: code.address,
    run: checkedRun.address,
    argumentOffset: 6,
    snapshot: { kind: "afterCommonCall", instruction: common.instruction, helper: common.target.address },
    coordinates: { x: x.offset, y: y.offset, width: 16 },
    source: { headOffset: head, nextField: next, typeField: type.offset, type: 14, ignoreSelf: true },
    distance: 32,
    difference: "ownerMinusCandidate",
    slots: checkedRun.links.map((offset, index) => ({
      offset,
      dx: index === 0 ? 32 : index === 1 ? -32 : 0,
      dy: index === 2 ? 32 : index === 3 ? -32 : 0,
    })),
    unmatched: 0,
    lastMatchWins: true,
    conditionalOnNormalReturn: true,
    colouring: {
      kind: "coordinateBitParity",
      bit: 5,
      fields: [x.offset, y.offset],
      op: "xor",
      flipsEveryDirectConnection: true,
    },
    confidence: "inferred",
    evidence: proof,
    meshOnlyCorollary: {
      requiresRetainedCoordinateMap: true,
      requiresNoCheckedPeerEdges: true,
      requiresOnlyRootInitiallyMoving: true,
      requiresDistinctNegation: true,
      conflict: 0,
      confidence: "inferred",
      evidence: proof,
      assumptions: [
        ...checkedRun.propagationRelation.assumptions,
        "Every checked direct slot must retain a reset-built edge from one common unchanged saved-coordinate map. No peer edge is checked during this propagation pass.",
        "At the pre-scan movement snapshot only the root is nonzero among all checked nodes. Its word a is neither zero nor 0x8000, so a and its modular negation are distinct.",
        "The coordinate colouring flips on each checked mode-two edge. First assignments label each zero target by the root word or its negation according to that colour; a later checked edge therefore cannot see equal nonzero source and target labels. Blocked or visited pruning cannot create a local conflict. This is a conditional theorem, not a claim that an arbitrary level meets its premises.",
      ],
    },
    assumptions: [
      ...x.assumptions,
      ...y.assumptions,
      ...type.assumptions,
      "DS denotes the program's valid data segment throughout the post-prefix scan.",
      "The component describes the contact-building region after the common C helper normally returns with a valid owner base, frame and data segment. It does not assert that the helper preserves state, geometry or saved coordinates.",
      "Source head storage and valid private stack storage are separate from complete nonwrapping part objects. Distinct part bases have disjoint storage. Source next words, type words and saved coordinates stay unchanged during this call-free scan; no external writer intervenes.",
      "This is a normal-return postcondition, not a termination claim. Every body path advances once through an unchanged deterministic next word; a repeated node could not reach the sole null exit. A returning scan visits each candidate once, and the last accepted candidate in traversal order overwrites the corresponding initially null slot.",
      "Coordinate subtraction is modulo 65536. Every accepted direct contact differs by exactly plus or minus 32 in one saved coordinate and zero in the other, so bit five of exactly one coordinate flips, including at word wrap.",
      "A graph-wide bipartite colouring requires every retained direct link to have been built from one common saved-coordinate map that remains unchanged. The prefix helper and later writes may change coordinates; this component does not establish that temporal invariant, reciprocal links, or inclusion of every gear in the selected source list.",
    ],
  };
}
