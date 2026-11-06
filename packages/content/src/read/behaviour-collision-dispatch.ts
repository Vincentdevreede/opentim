/** Certifies contact callback selection and response routing without supplying a collision or invoking a callback. */
import { collisionPatterns } from "./behaviour-collision-patterns.ts";
import { matchHeapRoutine, matchInstructionRegion } from "./behaviour-heap-release.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { ContactResponsePair } from "./behaviour-contact-response-pair.ts";
import type { ContactResponseFirst } from "./behaviour-contact-response-first.ts";
import type { ContactResponse } from "./behaviour-contact-response.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";
import type { ProgramParts } from "./parts.ts";
import type { Evidence, Expression, Finding, PartBehaviour, Predicate } from "./behaviour.ts";
import type { CodeAddress, Instruction } from "./x86.ts";

export interface CollisionTarget extends CodeAddress {
  type: number;
  part?: string;
  shared: boolean;
  pointer: { address: number; bytes: number[] };
  constantReturn?: number;
  returnEvidence?: Evidence[];
}
export interface CollisionResponseDescription extends Finding {
  routine: number;
  status: "described" | "unresolved";
  description: string;
  partFootprintComplete: boolean;
  preservesState: boolean;
  writes: { path: number[]; offset: number; width: number }[];
  relation?: ContactResponseFirst | ContactResponsePair;
}

export interface CollisionDispatch extends Finding {
  routine: number;
  entry: number;
  exit: number;
  list: { globalHead: number; nextField: number };
  fields: { flags: number; drawingFlags: number; contactPart: number; type: number };
  eligibility: Predicate;
  selection: {
    owner: "recordedContactPartner";
    ownerPath: number[];
    argument: "collider";
    argumentOffset: 6;
    table: number;
    stride: 58;
    callbackField: number;
    targets: CollisionTarget[];
    snapshot: "loadedImage";
  };
  specialSelfCall?: {
    type: number;
    instruction: number;
    target: CodeAddress;
    condition: Predicate;
    returnIgnored: true;
    laterGatesReadAfterCall: true;
  };
  passes: {
    instruction: number;
    condition: Predicate;
    priority: "first" | "onlyWhenFirstMaskClear";
    callbackZero: "advanceWithoutResponse";
    callbackNonzero: { condition: Predicate; routine: number; argument: "collider" }[];
    responseConditionsReadAfterCallback: true;
  }[];
  responses?: CollisionResponseDescription[];
  responseSupport?: (Finding & { response: number; helper: number; description: string; relation: ContactResponse })[];
  advance: "readCurrentNextAfterCallbacks";
  description: string;
}
const fact = (i: Instruction): Evidence => ({ address: i.address, bytes: i.bytes, text: i.text });
const constant = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const field = (offset: number): Expression => ({ kind: "field", object: "collider", offset, width: 16 });
const compare = (operator: string, left: Expression, right = constant(0)): Predicate => ({
  kind: "compare",
  operator,
  left,
  right,
  signed: false,
});
const masked = (offset: number, mask: number): Expression => ({
  kind: "binary",
  operator: "&",
  left: field(offset),
  right: constant(mask),
  width: 16,
});
const and = (...terms: Predicate[]): Predicate => ({ kind: "and", terms });
const word = (image: Uint8Array, at: number) => image[at]! | (image[at + 1]! << 8);

/** Only complete return-only bodies receive a constant return; no callback is evaluated on an object. */
function constantReturn(code: RoutineCode | undefined): number | undefined {
  if (!code) return;
  for (const [prefix, suffix] of [
    ["", ""],
    ["push bp\nmov bp,sp\n", "pop bp\n"],
    ["push bp\nmov bp,sp\n", "jmp @done\ndone: pop bp\n"],
  ]) {
    if (matchHeapRoutine(code, `${prefix}xor ax,ax\n${suffix}retf`, new Map())) return 0;
    const matched = matchHeapRoutine(code, `${prefix}mov ax,#{value}\n${suffix}retf`, new Map());
    if (matched) return matched.get("value");
  }
}

export function discoverCollisionDispatch(
  image: Uint8Array,
  codes: Map<number, RoutineCode>,
  layout: BehaviourLayout,
  program: Pick<ProgramParts, "table" | "records" | "dataSegment" | "list">,
  summaries?: Map<number, EngineSummary>,
): CollisionDispatch[] {
  const bounce = layout.callbacks.find((c) => c.role === "bounce"),
    result: CollisionDispatch[] = [];
  if (
    !bounce ||
    bounce.sites.length !== 2 ||
    bounce.field < 0 ||
    bounce.field + 4 > 58 ||
    program.records.some((r, n) => r.type !== n)
  )
    return result;
  for (const code of codes.values()) {
    if (code.status !== "complete" || !bounce.sites.every((site) => code.instructions.some((i) => i.address === site)))
      continue;
    const instructions = code.instructions;
    const first = instructions.findIndex((i) => i.address === Math.min(...bounce.sites));
    const last = instructions.findIndex((i) => i.address === Math.max(...bounce.sites));
    let start = -1;
    for (let n = 0; n < first; n++) {
      const i = instructions[n]!;
      if (
        i.mnemonic === "mov" &&
        i.operands[0]?.kind === "register" &&
        i.operands[0].name === "si" &&
        i.operands[1]?.kind === "memory" &&
        i.operands[1].direct
      )
        start = n;
    }
    const header = instructions.findIndex(
      (i, n) =>
        n > last &&
        i.mnemonic === "or" &&
        i.operands.length === 2 &&
        i.operands.every((o) => o.kind === "register" && o.name === "si"),
    );
    if (start < 0 || header < 0 || instructions[header + 1]?.flow !== "branch") continue;
    const end = header + (instructions[header + 2]?.flow === "jump" ? 3 : 2),
      sequence = instructions.slice(start, end);
    const exit = instructions[end]?.address;
    if (exit === undefined) continue;
    const indirect = sequence.filter((i) => i.flow === "call" && !i.target);
    if (![2, 3].includes(indirect.length)) continue;
    const special = indirect.length === 3 ? indirect[0] : undefined;
    const selected = special ? indirect.slice(1) : indirect;
    if (selected.some((i, n) => i.address !== bounce.sites.slice().sort((a, b) => a - b)[n])) continue;
    // Bind only the syntax of the indirect calls. The original operands and table identity are checked below.
    // This token is never exposed as a resolved game target or substituted into the original routine.
    const token = { address: 0, segment: 0, offset: 0 };
    const sites = new Set(indirect.map((i) => i.address));
    const normalized: RoutineCode = {
      ...code,
      instructions: instructions.map((i) => (sites.has(i.address) ? { ...i, prefixes: [], target: token } : i)),
      calls: code.calls.map((c) => (sites.has(c.instruction) ? { ...c, target: token, confidence: "checked" } : c)),
    };
    const normalizedSequence = normalized.instructions.slice(start, end);
    let binding: Map<string, number> | undefined;
    for (const pattern of collisionPatterns) {
      binding = matchInstructionRegion(normalized, normalizedSequence, exit, pattern, new Map());
      if (binding) break;
    }
    if (
      !binding ||
      binding.get("globalA") === undefined ||
      binding.get("globalA")! < 0 ||
      binding.get("globalA")! > 65534
    )
      continue;
    const tableSegment = binding.get("tableSegment");
    const tableOffset = program.table - (tableSegment ?? program.dataSegment) * 16;
    if (tableOffset < 0 || tableOffset + program.records.length * 58 > 65536) continue;
    const pointerAddress = (i: Instruction, indexed: boolean): number | undefined => {
      const operand = i.operands[0],
        call = code.calls.find((c) => c.instruction === i.address);
      if (
        i.mnemonic !== "call" ||
        !i.far ||
        i.operands.length !== 1 ||
        !call?.far ||
        call.target ||
        operand?.kind !== "memory" ||
        operand.width !== 32 ||
        operand.direct === indexed ||
        operand.base.join() !== (indexed ? "bx" : "") ||
        i.prefixes.some((p) => p !== "es") ||
        (operand.segment === "ds" && i.prefixes.length !== 0) ||
        !["es", "ds"].includes(operand.segment)
      )
        return;
      if (operand.segment === "es") {
        if (tableSegment === undefined || (indexed && operand.displacement !== bounce.field)) return;
        return tableSegment * 16 + operand.displacement;
      }
      if (tableSegment !== undefined) return;
      return program.dataSegment * 16 + operand.displacement;
    };
    if (selected.some((i) => pointerAddress(i, true) !== program.table + bounce.field)) continue;
    const specialType = 54;
    if (special && pointerAddress(special, false) !== program.table + specialType * 58 + bounce.field) continue;
    const targets: CollisionTarget[] = [];
    for (const record of program.records) {
      const at = program.table + record.type * 58 + bounce.field;
      if (
        record.at !== program.table + record.type * 58 ||
        at < 0 ||
        at + 4 > image.length ||
        !record.bytes.every((byte, n) => image[record.at + n] === byte)
      )
        break;
      const offset = word(image, at),
        segment = word(image, at + 2),
        address = segment * 16 + offset;
      if (address >= image.length) break;
      const value = constantReturn(codes.get(address));
      targets.push({
        type: record.type,
        part: program.list.parts.find((p) => p.type === record.type)?.id,
        address,
        segment,
        offset,
        shared: false,
        pointer: { address: at, bytes: Array.from(image.subarray(at, at + 4)) },
        ...(value !== undefined
          ? { constantReturn: value, returnEvidence: codes.get(address)!.instructions.map(fact) }
          : {}),
      });
    }
    if (
      !targets.length ||
      targets.length !== program.records.length ||
      (special && !targets.some((t) => t.type === specialType))
    )
      continue;
    for (const target of targets)
      target.shared = targets.some((other) => other.type !== target.type && other.address === target.address);
    const useFirst = compare("!=", masked(6, 2));
    const firstResponse = special
      ? and(compare("!=", masked(6, 1)), compare("!=", field(4), constant(specialType)))
      : compare("!=", masked(6, 1));
    const secondResponse = compare("==", masked(6, 1));
    // A type-specific exception joins the second route. Keep that disjunction explicit as a predicate-valued expression.
    const routeSecond: Predicate = special
      ? compare(
          "==",
          {
            kind: "binary",
            operator: "&",
            width: 16,
            left: { kind: "binary", operator: "!=", width: 16, left: masked(6, 1), right: constant(0) },
            right: { kind: "binary", operator: "!=", width: 16, left: field(4), right: constant(specialType) },
          },
          constant(0),
        )
      : secondResponse;
    const pre = and(compare("==", masked(6, 8)), compare("==", masked(8, 8192)));
    result.push({
      routine: code.address,
      entry: sequence[0]!.address,
      exit,
      list: { globalHead: binding.get("globalA")!, nextField: 0 },
      fields: { flags: 6, drawingFlags: 8, contactPart: 132, type: 4 },
      eligibility: pre,
      selection: {
        owner: "recordedContactPartner",
        ownerPath: [132],
        argument: "collider",
        argumentOffset: 6,
        table: program.table,
        stride: 58,
        callbackField: bounce.field,
        targets,
        snapshot: "loadedImage",
      },
      ...(special
        ? {
            specialSelfCall: {
              type: specialType,
              instruction: special.address,
              target: ((t) => ({ address: t.address, segment: t.segment, offset: t.offset }))(
                targets.find((t) => t.type === specialType)!,
              ),
              condition: and(pre, compare("!=", masked(6, 6)), compare("==", field(4), constant(specialType))),
              returnIgnored: true as const,
              laterGatesReadAfterCall: true as const,
            },
          }
        : {}),
      passes: [
        {
          instruction: selected[0]!.address,
          condition: useFirst,
          priority: "first",
          callbackZero: "advanceWithoutResponse",
          callbackNonzero: [
            { condition: firstResponse, routine: binding.get("helperA")!, argument: "collider" },
            { condition: routeSecond, routine: binding.get("helperB")!, argument: "collider" },
          ],
          responseConditionsReadAfterCallback: true,
        },
        {
          instruction: selected[1]!.address,
          condition: and(compare("==", masked(6, 2)), compare("!=", masked(6, 4))),
          priority: "onlyWhenFirstMaskClear",
          callbackZero: "advanceWithoutResponse",
          callbackNonzero: [{ condition: { kind: "true" }, routine: binding.get("helperC")!, argument: "collider" }],
          responseConditionsReadAfterCallback: true,
        },
      ],
      responses: ["helperA", "helperB", "helperC"].map((name): CollisionResponseDescription => {
        const routine = binding!.get(name)!,
          helper = summaries?.get(routine);
        const relation = helper?.contactResponseFirst ?? helper?.contactResponsePair;
        const known = !!relation && !!helper;
        return {
          routine,
          status: known ? "described" : "unresolved",
          description: known ? helper.purpose : "The selected response has no complete checked numerical relation yet.",
          partFootprintComplete: known && helper.footprint.partMemoryComplete === true,
          preservesState: known && helper.footprint.preservesPartState,
          writes: known
            ? helper.writes
                .filter((w) => w.root === "argument")
                .map((w) => ({ path: w.path, offset: w.offset, width: w.width }))
            : [],
          ...(relation ? { relation } : {}),
          confidence: known ? helper.confidence : "unresolved",
          evidence: known ? helper.evidence : (codes.get(routine)?.instructions.map(fact) ?? []),
          assumptions: known
            ? [
                ...helper.assumptions,
                "The dispatcher passes the moving part when this response route is selected. Selection follows the callback and current response gates; a collision or nonzero callback return is not supplied by this description.",
              ]
            : [],
        };
      }),
      responseSupport: ["helperA", "helperB", "helperC"].flatMap((name) => {
        const response = binding!.get(name)!,
          visited = new Set<number>(),
          pending = [response];
        const support: NonNullable<CollisionDispatch["responseSupport"]> = [];
        while (pending.length) {
          const address = pending.pop()!;
          if (visited.has(address)) continue;
          visited.add(address);
          const helper = summaries?.get(address);
          if (helper?.contactResponse)
            support.push({
              response,
              helper: address,
              description: helper.purpose,
              relation: helper.contactResponse,
              confidence: helper.confidence,
              evidence: helper.evidence,
              assumptions: [
                ...helper.assumptions,
                "This helper is reachable in the response call graph. Reachability does not prove that its path is taken; its own predicates apply to the argument at that call.",
              ],
            });
          for (const call of codes.get(address)?.calls ?? []) if (call.target) pending.push(call.target.address);
        }
        return support;
      }),
      advance: "readCurrentNextAfterCallbacks",
      description:
        "For an eligible moving part, selects a contact callback from the recorded partner's type and passes the moving part. A zero return skips the response; a nonzero return chooses a response using flags read after the callback.",
      confidence: "inferred",
      evidence: sequence.map(fact),
      assumptions: [
        ...bounce.assumptions,
        "This is a complete per-node region, not a proof that a collision occurs or that every part is visited once per game step. The containing routine enters with the discovered data segment; callbacks preserve DS, SI and the C stack frame on normal return.",
        "Parts and the list have valid nonwrapping storage. The recorded contact pointer is valid whenever selected, and its type indexes a complete record. A finite traversal additionally needs a valid terminating list; callbacks may change the next pointer before it is read.",
        "Targets are the loaded-image table alternatives, conditional on that table remaining unchanged. The runtime partner type is not supplied, and the original indirect calls remain indirect. Table bytes are separate data evidence, not decoded instructions.",
        "Eligibility is tested before the optional self callback. Contact-mask gates are read after it; response flags and type are read after the selected partner callback. Earlier predicates are not silently reused as snapshots of those later reads.",
        "The response helper addresses and their call arguments are established. No unproved numerical response, state preservation or callback side effect is supplied by this routing contract.",
      ],
    });
  }
  return result;
}

export function describeCollisionDispatch(
  contracts: CollisionDispatch[] | undefined,
  part: Pick<PartBehaviour, "type" | "routines">,
):
  | (Finding & {
      description: string;
      routine: number;
      sites: number[];
      selfCall?: boolean;
      responseSupport?: CollisionDispatch["responseSupport"];
      responses?: CollisionResponseDescription[];
    })
  | undefined {
  const callback = part.routines.find((r) => r.slot === 0);
  const contract = contracts?.find((c) =>
    c.selection.targets.some((t) => t.type === part.type && t.address === callback?.address),
  );
  if (!contract || !callback) return;
  const target = contract.selection.targets.find((t) => t.type === part.type)!;
  const selfCall = contract.specialSelfCall?.type === part.type;
  const returned =
    target.constantReturn === undefined
      ? "Its return and effects follow its own extracted rules."
      : target.constantReturn === 0
        ? "This callback returns zero, so this dispatch skips the subsequent response helper."
        : "This callback returns nonzero, so this dispatch continues to a response helper.";
  return {
    confidence: contract.confidence,
    evidence: [...contract.evidence, ...(target.returnEvidence ?? [])],
    assumptions: contract.assumptions,
    routine: callback.address,
    sites: [...contract.passes.map((p) => p.instruction), ...(selfCall ? [contract.specialSelfCall!.instruction] : [])],
    selfCall,
    responseSupport: contract.responseSupport,
    responses:
      target.constantReturn === 0
        ? []
        : contract.responses?.map((response) => {
            const description = { ...response };
            delete description.relation;
            return description;
          }),
    description: `If an eligible moving part records this part as its contact partner and has a contact-response flag, the engine calls this part's contact callback with the moving part as the argument. ${returned}${selfCall ? " This type also receives an earlier self callback when either contact-response flag is set; that return value is ignored and the later gates read its updated fields." : ""}`,
  };
}
