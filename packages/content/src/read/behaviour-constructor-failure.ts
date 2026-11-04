/** Certifies a constructor's allocation-failure path without granting its success helper a memory contract. */
import type { Evidence, Finding } from "./behaviour.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Instruction, Operand } from "./x86.ts";

export interface InitialZeroFields extends Finding {
  fields: { offset: number; width: 16; value: 0 }[];
}
export interface ConstructorFailureOwnership extends Finding {
  address: number;
  allocation: number;
  allocationInstruction: number;
  allocatedField: number;
  countField: number;
  elementSize: number;
  failureValue: 1;
  zeroFields: number[];
  requiredInitialZeroFields: number[];
  successEntry: number;
  successHelper: number;
}
const reg = (o: Operand | undefined, name?: string): o is Extract<Operand, { kind: "register" }> =>
  o?.kind === "register" && (name === undefined || o.name === name);
const mem = (o: Operand | undefined): o is Extract<Operand, { kind: "memory" }> => o?.kind === "memory";
const immediate = (o: Operand | undefined, value?: number): o is Extract<Operand, { kind: "immediate" }> =>
  o?.kind === "immediate" && (value === undefined || o.value === value);
const evidence = ({ address, bytes, text }: Instruction): Evidence => ({ address, bytes, text });
const ownerWord = (o: Operand | undefined, owner: string) =>
  mem(o) && o.segment === "ds" && o.base.join() === owner && o.width === 16;
const overlaps = (offset: number, width: number, field: number) => offset < field + 2 && field < offset + width / 8;

/**
 * The entry zero facts must come from the factory's cleared-allocation and prefix proofs. This certificate proves
 * only what cleanup can read when the constructor returns one. Its nonnull success helper remains a separate scope.
 */
export function proveConstructorFailureOwnership(
  code: RoutineCode,
  factory: EngineSummary,
  summaries: Map<number, EngineSummary>,
  releaseFields: number[],
  initiallyZero: InitialZeroFields,
): ConstructorFailureOwnership | undefined {
  const metadata = factory.factory,
    size = factory.allocationSize;
  if (
    code.status !== "complete" ||
    !metadata?.noConstructor.freshFieldsOnly ||
    !size ||
    initiallyZero.confidence === "unresolved" ||
    metadata.noConstructor.confidence === "unresolved" ||
    !releaseFields.length ||
    new Set(releaseFields).size !== releaseFields.length ||
    releaseFields.some((offset) => !Number.isInteger(offset) || offset < 0 || offset + 2 > size) ||
    releaseFields.some((offset, n) => releaseFields.some((other, m) => n !== m && overlaps(offset, 16, other)))
  )
    return;
  const logical = code.instructions.filter((i) => i.mnemonic !== "nop");
  const [pushFrame, frame] = logical;
  if (
    pushFrame?.mnemonic !== "push" ||
    !reg(pushFrame.operands[0], "bp") ||
    frame?.mnemonic !== "mov" ||
    !reg(frame.operands[0], "bp") ||
    !reg(frame.operands[1], "sp")
  )
    return;
  const ownerIndex = logical.findIndex(
    (i) =>
      i.mnemonic === "mov" &&
      reg(i.operands[0]) &&
      ["si", "di"].includes(i.operands[0].name) &&
      mem(i.operands[1]) &&
      i.operands[1].segment === "ss" &&
      i.operands[1].base.join() === "bp" &&
      i.operands[1].width === 16 &&
      i.operands[1].displacement === 6,
  );
  if (ownerIndex < 3) return;
  const owner = (logical[ownerIndex]!.operands[0] as Extract<Operand, { kind: "register" }>).name;
  const saved = logical.slice(2, ownerIndex);
  if (saved.some((i) => i.mnemonic !== "push" || !reg(i.operands[0]) || !["si", "di"].includes(i.operands[0].name)))
    return;
  const saves = saved.map((i) => (i.operands[0] as Extract<Operand, { kind: "register" }>).name);
  if (new Set(saves).size !== saves.length || !saves.includes(owner)) return;
  const epilogueLength = saves.length + 2,
    firstEpilogue = logical.length - epilogueLength;
  const body = logical.slice(ownerIndex + 1, firstEpilogue);
  if (body.length !== 15 && body.length !== 16) return;
  const [
    sizeLoad,
    pushSize,
    pushCount,
    allocate,
    popCount,
    popSize,
    store,
    test,
    branch,
    failure,
    failureJump,
    pushOwner,
    successCall,
    popOwner,
    success,
    successJump,
  ] = body;
  if (
    !sizeLoad ||
    sizeLoad.mnemonic !== "mov" ||
    !reg(sizeLoad.operands[0], "ax") ||
    !immediate(sizeLoad.operands[1]) ||
    sizeLoad.operands[1].value <= 0 ||
    pushSize?.mnemonic !== "push" ||
    !reg(pushSize.operands[0], "ax") ||
    pushCount?.mnemonic !== "push" ||
    !ownerWord(pushCount.operands[0], owner) ||
    popCount?.mnemonic !== "pop" ||
    !reg(popCount.operands[0], "cx") ||
    popSize?.mnemonic !== "pop" ||
    !reg(popSize.operands[0], "cx") ||
    store?.mnemonic !== "mov" ||
    !ownerWord(store.operands[0], owner) ||
    !reg(store.operands[1], "ax") ||
    test?.mnemonic !== "or" ||
    !reg(test.operands[0], "ax") ||
    !reg(test.operands[1], "ax") ||
    branch?.mnemonic !== "jne" ||
    branch.target?.address !== pushOwner?.address ||
    failure?.mnemonic !== "mov" ||
    !reg(failure.operands[0], "ax") ||
    !immediate(failure.operands[1], 1) ||
    failureJump?.flow !== "jump" ||
    failureJump.target?.address !== logical[firstEpilogue]?.address ||
    pushOwner?.mnemonic !== "push" ||
    !reg(pushOwner.operands[0], owner) ||
    popOwner?.mnemonic !== "pop" ||
    !reg(popOwner.operands[0], "cx") ||
    (successJump !== undefined &&
      (successJump.mnemonic !== "jmp" ||
        successJump.flow !== "jump" ||
        ![failureJump?.address, logical[firstEpilogue]?.address].includes(successJump.target?.address))) ||
    success?.mnemonic !== "xor" ||
    !reg(success.operands[0], "ax") ||
    !reg(success.operands[1], "ax")
  )
    return;
  const allocationCall = code.calls.find((c) => c.instruction === allocate?.address),
    helperCall = code.calls.find((c) => c.instruction === successCall?.address);
  const allocator = allocationCall?.target && summaries.get(allocationCall.target.address);
  if (
    code.calls.length !== 2 ||
    allocationCall?.confidence !== "checked" ||
    !allocationCall.far ||
    !allocator ||
    allocator.kind !== "nullable-allocation" ||
    allocator.returnPointerClass !== "nullable-fresh" ||
    allocator.returnConvention?.kind !== "far" ||
    allocator.returnConvention.stackBytes !== 0 ||
    !metadata.noConstructor.evidence.some((e) => e.address === allocator.address) ||
    helperCall?.confidence !== "checked" ||
    !helperCall.far ||
    !helperCall.target ||
    !allocator.returns.some((r) => r.register === "ax" && r.pointer?.kind === "constant" && r.pointer.value === 0) ||
    !allocator.returns.some((r) => r.register === "ax" && r.pointer?.kind === "fresh")
  )
    return;
  const restored = [...saves].reverse().concat("bp");
  if (
    restored.some(
      (name, n) =>
        logical[firstEpilogue + n]?.mnemonic !== "pop" || !reg(logical[firstEpilogue + n]!.operands[0], name),
    ) ||
    logical.at(-1)?.mnemonic !== "retf" ||
    logical.at(-1)!.operands.length
  )
    return;
  const field = (store.operands[0] as Extract<Operand, { kind: "memory" }>).displacement,
    countField = (pushCount.operands[0] as Extract<Operand, { kind: "memory" }>).displacement;
  if (!releaseFields.includes(field) || countField < 0 || countField + 2 > size) return;
  const requiredInitialZeroFields = releaseFields.filter((offset) => offset !== field);
  if (
    requiredInitialZeroFields.some(
      (offset) =>
        !initiallyZero.fields.some((f) => f.offset === offset && f.width === 16 && f.value === 0) ||
        metadata.noConstructor.writes.some((write) => overlaps(write.offset, write.width, offset)),
    )
  )
    return;

  // Match the complete CFG, including each NOP continuation. A branch cannot bypass the zero-result store or test.
  const byAddress = new Map(code.instructions.map((i) => [i.address, i])),
    edges = new Map<number, (number | null)[]>();
  for (const edge of code.edges) edges.set(edge.from, [...(edges.get(edge.from) ?? []), edge.to]);
  const skipNops = (address: number | null): number | null | undefined => {
    let at = address;
    const seen = new Set<number>();
    while (at !== null && byAddress.get(at)?.mnemonic === "nop") {
      if (seen.has(at)) return;
      seen.add(at);
      const i = byAddress.get(at)!,
        next = edges.get(at) ?? [];
      if (next.length !== 1 || next[0] !== i.address + i.size) return;
      at = next[0]!;
    }
    return at;
  };
  if (skipNops(code.address) !== logical[0]!.address) return;
  for (let n = 0; n < logical.length; n++) {
    const i = logical[n]!,
      next = logical[n + 1]?.address ?? null;
    const expected =
      i === branch
        ? [failure.address, pushOwner.address]
        : i === failureJump
          ? [logical[firstEpilogue]!.address]
          : i === successJump
            ? [successJump.target!.address]
            : [next];
    const actual = [...new Set((edges.get(i.address) ?? []).map(skipNops))];
    if (i.mnemonic === "retf") {
      if (actual.length && !(actual.length === 1 && actual[0] === null)) return;
    } else if (actual.length !== expected.length || expected.some((target) => !actual.includes(target))) return;
  }
  return {
    address: code.address,
    allocation: allocator.address,
    allocationInstruction: allocate!.address,
    allocatedField: field,
    countField,
    elementSize: sizeLoad.operands[1].value,
    failureValue: 1,
    zeroFields: [...releaseFields],
    requiredInitialZeroFields,
    successEntry: pushOwner.address,
    successHelper: helperCall.target.address,
    confidence: "inferred",
    evidence: [
      ...initiallyZero.evidence,
      ...metadata.noConstructor.evidence,
      ...allocator.evidence,
      ...code.instructions.map(evidence),
    ],
    assumptions: [
      ...new Set([
        ...initiallyZero.assumptions,
        ...metadata.noConstructor.assumptions,
        ...allocator.assumptions,
        "The supplied zero-field facts come from the factory's cleared fresh allocation and unchanged prefix, not from a level or an invented constructor input.",
        "On a normal return of one, the allocation result was zero and the recorded owner field was assigned that result before its test. Every other cleanup-owned field retains its proved entry zero.",
        "The nonnull branch invokes its success helper and explicitly returns zero; that helper's memory scope and constructor-success effects remain separate obligations.",
        "The decoded far C convention preserves the owner register, frame and data segment across the calls, and stack storage is separate from the fresh part.",
      ]),
    ],
  };
}
