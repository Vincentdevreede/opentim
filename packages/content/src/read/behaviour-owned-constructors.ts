/** Combines constructor success scopes, null-allocation failure facts and exclusively owned cleanup. */
import { readRoutineCode, type RoutineCode } from "./behaviour-code.ts";
import { proveConstructorFailureOwnership, type ConstructorFailureOwnership } from "./behaviour-constructor-failure.ts";
import {
  matchHeapRoutine,
  proveClearedAllocation,
  proveOwnedHeapRelease,
  type OwnedHeapRelease,
} from "./behaviour-heap-release.ts";
import { specializeNullConstructor, type EngineSummary } from "./behaviour-helpers.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";
import type { Finding } from "./behaviour.ts";

const cleanupPattern = `push bp
mov bp,sp
push si
mov si,16:ss[bp+6]
or si,si
je @done
cmp 16:ds[si+{outline}],#0
je @first
push 16:ds[si+{outline}]
callf $free
pop cx
first: cmp 16:ds[si+{first}],#0
je @second
test 16:ds[si+{flags}],#1
jne @second
push 16:ds[si+{first}]
callf $free
pop cx
second: cmp 16:ds[si+{second}],#0
je @owner
cmp 16:ds[si+{type}],#{typeA}
je @release
cmp 16:ds[si+{type}],#{typeB}
jne @owner
release: push 16:ds[si+{second}]
callf $free
pop cx
owner: push si
callf $free
pop cx
done: pop si
pop bp
retf`;

export interface ConstructorCleanup extends Finding {
  address: number;
  releaseFields: number[];
  release: number;
}

/** The whole CFG is checked. Its only calls receive the three loaded fields or the original owner. */
export function discoverConstructorCleanup(code: RoutineCode, size: number): ConstructorCleanup | undefined {
  const binding = matchHeapRoutine(code, cleanupPattern, new Map());
  if (!binding) return;
  const fields = ["outline", "first", "second"].map((name) => binding.get(name)!);
  if (
    fields.some((offset) => offset < 0 || offset + 2 > size) ||
    fields.some((offset, n) => fields.some((other, m) => n !== m && Math.abs(offset - other) < 2))
  )
    return;
  return {
    address: code.address,
    release: binding.get("free")!,
    releaseFields: fields,
    confidence: "checked",
    assumptions: [],
    evidence: code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })),
  };
}

const overlap = (offset: number, width: number, field: number) => offset < field + 2 && field < offset + width / 8;

/** Ownership of failure cleanup does not by itself certify the successful constructor's memory scope. */
export function ownedConstructorContract(
  failure: ConstructorFailureOwnership,
  scope: Finding,
  cleanup: ConstructorCleanup,
  release: OwnedHeapRelease,
): Finding | undefined {
  if (
    [failure, scope, cleanup, release].some((f) => f.confidence === "unresolved") ||
    cleanup.release !== release.address ||
    cleanup.releaseFields.some((f) => !failure.zeroFields.includes(f))
  )
    return;
  return {
    confidence: "inferred",
    evidence: [failure, scope, cleanup, release].flatMap((f) => f.evidence),
    assumptions: [...new Set([failure, scope, cleanup, release].flatMap((f) => f.assumptions))].concat(
      "On constructor failure every cleanup-owned field is zero, so the checked zero guards omit all secondary releases. Only the factory's fresh owner is released. Successful construction retains its separately proved fresh-owner and outline scope.",
    ),
  };
}

export function addOwnedConstructors(
  image: Uint8Array,
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  layout: BehaviourLayout | undefined,
  tableAddress: number | undefined,
  dataSegment: number,
) {
  for (const factory of summaries.values()) {
    const metadata = factory.factory,
      code = codes.get(factory.address),
      size = factory.allocationSize;
    if (!metadata || !code || !size || tableAddress === undefined) continue;
    const evidenceAddresses = new Set(metadata.noConstructor.evidence.map((e) => e.address));
    const cleanup = code.calls
      .map((call) => call.target && codes.get(call.target.address))
      .filter((c): c is RoutineCode => !!c && evidenceAddresses.has(c.address))
      .map((c) => discoverConstructorCleanup(c, size))
      .find((c) => c !== undefined);
    const releaseCode = cleanup && codes.get(cleanup.release);
    if (!cleanup || !releaseCode) continue;
    const release = proveOwnedHeapRelease(releaseCode, codes, summaries, evidenceAddresses);
    if (!release) continue;
    const allocate = code.calls
      .map((call) => call.target && summaries.get(call.target.address))
      .find((callee) => callee?.kind === "nullable-allocation");
    const allocateCode = allocate && codes.get(allocate.address);
    const cleared = allocateCode && proveClearedAllocation(allocateCode, codes, release);
    if (!cleared) continue;
    // Every shared prefix and suffix call has already been checked by the null-constructor proof. Check that none
    // of its explicit or transitive owner stores can overwrite a cleanup-owned word before or after construction.
    const directOverlap = metadata.noConstructor.writes.some((w) =>
      cleanup.releaseFields.some((f) => overlap(w.offset, w.width, f)),
    );
    if (directOverlap) continue;
    const dispatch = code.calls.find((call) => !call.target && call.operand?.kind === "memory");
    const index = code.instructions.findIndex((i) => i.address === dispatch?.instruction);
    const [pop, compare, branch] = code.instructions.slice(index + 1, index + 4);
    if (
      index < 0 ||
      pop?.mnemonic !== "pop" ||
      pop.operands[0]?.kind !== "register" ||
      pop.operands[0].name !== "cx" ||
      compare?.mnemonic !== "cmp" ||
      compare.operands[0]?.kind !== "register" ||
      compare.operands[0].name !== "ax" ||
      compare.operands[1]?.kind !== "immediate" ||
      compare.operands[1].value !== 1 ||
      branch?.mnemonic !== "jne"
    )
      continue;
    const prefix = code.instructions.slice(0, index),
      pushed = prefix.findLast((i) => i.mnemonic === "push");
    if (pushed?.operands[0]?.kind !== "register" || pushed.operands[0].name !== "si") continue;
    const bridge = prefix.slice(prefix.indexOf(pushed) + 1);
    if (
      bridge.some(
        (i) =>
          i.flow !== "next" ||
          !["mov", "shl", "nop"].includes(i.mnemonic) ||
          (i.operands[0]?.kind === "register" && ["si", "sp", "bp", "ss", "ds"].includes(i.operands[0].name)) ||
          i.operands[0]?.kind === "memory",
      ) ||
      code.instructions
        .slice(prefix.indexOf(pushed) + 1, index + 4)
        .some(
          (i, n) =>
            code.edges.filter((e) => e.to === i.address).length !== 1 ||
            !code.edges.some(
              (e) => e.to === i.address && e.from === code.instructions[prefix.indexOf(pushed) + n]!.address,
            ),
        )
    )
      continue;
    const otherCalls = code.calls.filter((call) => call !== dispatch && call.target?.address !== cleanup.address);
    if (
      otherCalls.some((call) => {
        const callee = call.target && summaries.get(call.target.address);
        return (
          !callee ||
          (callee.kind !== "nullable-allocation" &&
            !callee.footprint.preservesArgumentMemory &&
            (!callee.footprint.partMemoryComplete ||
              callee.writes.some(
                (w) =>
                  w.root !== "argument" ||
                  w.path.length ||
                  cleanup.releaseFields.some((f) => overlap(w.offset, w.width, f)),
              )))
        );
      })
    )
      continue;
    metadata.ownedConstructors = [];
    for (const scope of metadata.constructors ?? []) {
      const { constructorTable: table } = metadata;
      const at = table.segment * 16 + table.offset + scope.type * table.stride;
      const offset = image[at]! | (image[at + 1]! << 8),
        segment = image[at + 2]! | (image[at + 3]! << 8);
      const ctor = readRoutineCode(image, { address: segment * 16 + offset, segment, offset }, dataSegment);
      const initiallyZero = {
        ...cleared,
        evidence: [...cleared.evidence, ...metadata.noConstructor.evidence],
        assumptions: [...cleared.assumptions, ...metadata.noConstructor.assumptions],
        fields: cleanup.releaseFields.map((offset) => ({ offset, width: 16 as const, value: 0 as const })),
      };
      const failure = proveConstructorFailureOwnership(ctor, factory, summaries, cleanup.releaseFields, initiallyZero);
      const contract = failure && ownedConstructorContract(failure, scope, cleanup, release);
      if (!contract) continue;
      const verified = specializeNullConstructor(
        image,
        code,
        factory,
        codes,
        summaries,
        tableAddress,
        dataSegment,
        table.typeCount,
        layout?.fields.find((f) => f.name === "state")?.offset,
        { ...contract, cleanupAddress: cleanup.address, resultBranch: branch.address },
      );
      if (verified)
        metadata.ownedConstructors.push({
          confidence: verified.noConstructor.confidence,
          assumptions: verified.noConstructor.assumptions,
          type: scope.type,
          address: scope.address,
          evidence: [
            {
              address: at,
              bytes: [...image.subarray(at, at + 4)],
              text: `Owned constructor reference for type ${scope.type}`,
            },
            ...verified.noConstructor.evidence,
          ],
        });
    }
  }
}
