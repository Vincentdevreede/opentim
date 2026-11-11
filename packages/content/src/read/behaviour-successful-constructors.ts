/** Extends a proved factory skeleton only when its constructor cannot reach the failure result. */
import { analyseRoutine, type Finding } from "./behaviour.ts";
import { readRoutineCode, type RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";
import type { Instruction, Operand } from "./x86.ts";
import { evidenceOf, isMemory, isRegister, storesToMemory } from "./behaviour-terms.ts";

const writesRegister = (i: Instruction, name: string) =>
  isRegister(i.operands[0], name) && i.flow === "next" && !["push", "cmp", "test"].includes(i.mnemonic);

/** The routine is analysed symbolically, never invoked on a constructed game object. */
export function successfulOwnerConstructor(
  image: Uint8Array,
  code: RoutineCode,
  size: number,
  layout: BehaviourLayout,
  dataSegment: number,
): Finding | undefined {
  if (code.status !== "complete" || code.calls.length || code.instructions.length > 128) return;
  const pure = new Set([
    "push",
    "pop",
    "mov",
    "lea",
    "and",
    "or",
    "xor",
    "add",
    "sub",
    "inc",
    "dec",
    "cmp",
    "test",
    "not",
    "neg",
    "shl",
    "shr",
    "sar",
    "rol",
    "ror",
    "rcl",
    "rcr",
    "cbw",
    "cwd",
    "mul",
    "imul",
    "div",
    "idiv",
    "nop",
    "retf",
    "clc",
    "stc",
    "cmc",
  ]);
  if (code.instructions.some((i) => !pure.has(i.mnemonic) && i.flow !== "branch" && i.flow !== "jump")) return;
  const [push, move] = code.instructions;
  if (
    push?.mnemonic !== "push" ||
    !isRegister(push.operands[0], "bp") ||
    move?.mnemonic !== "mov" ||
    !isRegister(move.operands[0], "bp") ||
    !isRegister(move.operands[1], "sp")
  )
    return;
  const returns = code.instructions.filter((i) => i.flow === "return");
  if (returns.length !== 1 || returns.some((i) => i.mnemonic !== "retf" || i.operands.length)) return;
  const ownerLoad = code.instructions.find(
    (i) =>
      i.mnemonic === "mov" &&
      isRegister(i.operands[0]) &&
      ["si", "di"].includes(i.operands[0].name) &&
      isMemory(i.operands[1]) &&
      i.operands[1].segment === "ss" &&
      i.operands[1].base.join() === "bp" &&
      i.operands[1].displacement === 6,
  );
  if (!ownerLoad || !isRegister(ownerLoad.operands[0])) return;
  const owner = ownerLoad.operands[0].name;
  const loadIndex = code.instructions.indexOf(ownerLoad);
  const saves = code.instructions.slice(2, loadIndex);
  if (
    saves.some((i) => i.mnemonic !== "push" || !isRegister(i.operands[0]) || !["si", "di"].includes(i.operands[0].name))
  )
    return;
  const saved = saves.map((i) => (i.operands[0] as Extract<Operand, { kind: "register" }>).name);
  if (new Set(saved).size !== saved.length || !saved.includes(owner)) return;
  const popNames = [...saved].reverse().concat("bp");
  const epilogue = code.instructions.slice(-popNames.length - 1, -1);
  if (!epilogue.every((i, n) => i.mnemonic === "pop" && isRegister(i.operands[0], popNames[n]))) return;
  const firstPop = epilogue[0]!.address;
  if (
    code.instructions.some(
      (i) =>
        i.address >= ownerLoad.address &&
        i.address < firstPop &&
        (["push", "pop"].includes(i.mnemonic) ||
          ["si", "di"].some((name) => writesRegister(i, name) && !saved.includes(name))),
    )
  )
    return;
  const protectedFields = layout.fields.filter((f) => ["type", "state"].includes(f.name));
  if (protectedFields.length !== 2) return;
  if (code.instructions.some((i) => i.address > ownerLoad.address && i.address < firstPop && writesRegister(i, owner)))
    return;
  if (
    code.instructions.some(
      (i) =>
        /^(movs|stos|lods|scas|cmps|ins|outs|int|into|iret|enter|leave|pusha|popa|pushf|popf|esc|xchg|lds|les)/.test(
          i.mnemonic,
        ) ||
        ["ss", "ds", "sp"].some((name) => writesRegister(i, name)) ||
        (writesRegister(i, "bp") &&
          i !== move &&
          !(i.mnemonic === "pop" && returns.some((r) => r.address === i.address + i.size))),
    )
  )
    return;
  const outgoing = new Map<number, number[]>(),
    byAddress = new Map(code.instructions.map((i) => [i.address, i]));
  for (const edge of code.edges)
    if (edge.to !== null) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  for (const store of code.instructions.filter(storesToMemory)) {
    const pending = [code.address],
      seen = new Set<number>();
    while (pending.length) {
      const at = pending.pop()!;
      if (at === ownerLoad.address || seen.has(at)) continue;
      if (at === store.address) return;
      seen.add(at);
      pending.push(...(outgoing.get(at) ?? []));
    }
  }
  const stackAt = new Map([[code.address, 0]]),
    pending = [code.address];
  while (pending.length) {
    const at = pending.pop()!,
      i = byAddress.get(at)!;
    let delta = stackAt.get(at)!;
    if (i.mnemonic === "push") delta -= 2;
    if (i.mnemonic === "pop") delta += 2;
    if (
      delta < -0x7fff ||
      (delta > -2 &&
        !(
          i.mnemonic === "pop" &&
          isRegister(i.operands[0], "bp") &&
          returns.some((r) => r.address === i.address + i.size)
        ) &&
        i.flow !== "return") ||
      (i.flow === "return" && delta !== 0)
    )
      return;
    for (const next of outgoing.get(at) ?? []) {
      const previous = stackAt.get(next);
      if (previous !== undefined && previous !== delta) return;
      if (previous === undefined) {
        stackAt.set(next, delta);
        pending.push(next);
      }
    }
  }
  for (const i of code.instructions.filter(storesToMemory)) {
    const dest = i.operands[0];
    if (
      !isMemory(dest) ||
      dest.segment !== "ds" ||
      dest.base.join() !== owner ||
      dest.displacement < 0 ||
      dest.displacement + dest.width / 8 > size ||
      protectedFields.some((f) => dest.displacement < f.offset + 2 && f.offset < dest.displacement + dest.width / 8)
    )
      return;
  }
  const result = analyseRoutine(image, code, {
    code,
    dataSegment,
    argumentOffset: 6,
    stateOffset: protectedFields.find((field) => field.name === "state")!.offset,
    maxVisits: 800,
  });
  if (
    result.uncertainEffects ||
    !result.returnPathsComplete ||
    !result.outcomes?.length ||
    result.outcomes.some((o) => !o.effectsComplete || o.returnValue.kind !== "constant" || o.returnValue.value !== 0)
  )
    return;
  if (
    result.writes.some(
      (w) =>
        w.object !== "part" ||
        w.offset < 0 ||
        w.offset + w.width / 8 > size ||
        protectedFields.some((f) => w.offset < f.offset + 2 && f.offset < w.offset + w.width / 8),
    )
  )
    return;
  return {
    confidence: "inferred",
    evidence: code.instructions.map(evidenceOf),
    assumptions: [
      "All constructor stores stay inside the fresh owner. The type and current state are unchanged, no callees or implicit memory effects occur, and every symbolic return is zero.",
      "The decoded C convention preserves the entry frame and nonvolatile registers; the constructor is conditional on valid fresh-part and stack storage.",
    ],
  };
}

/** The null-constructor proof already covers allocation failure and the shared prefix/suffix. */
export function addSuccessfulConstructors(
  image: Uint8Array,
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  layout: BehaviourLayout | undefined,
  dataSegment: number,
) {
  if (!layout) return;
  for (const engine of summaries.values()) {
    const factory = engine.factory,
      code = codes.get(engine.address);
    if (!factory || !code || !engine.allocationSize) continue;
    const table = factory.constructorTable;
    const calls = code.calls.filter(
      (c) => c.far && isMemory(c.operand) && c.operand.segment === "ds" && c.operand.displacement === table.offset,
    );
    if (calls.length !== 1) continue;
    const call = calls[0]!,
      index = code.instructions.findIndex((i) => i.address === call.instruction);
    const [pop, compare, branch] = code.instructions.slice(index + 1, index + 4);
    if (
      pop?.mnemonic !== "pop" ||
      !isRegister(pop.operands[0], "cx") ||
      compare?.mnemonic !== "cmp" ||
      !isRegister(compare.operands[0], "ax") ||
      compare.operands[1]?.kind !== "immediate" ||
      compare.operands[1].value !== 1 ||
      branch?.mnemonic !== "jne" ||
      !branch.target
    )
      continue;
    const guard = code.instructions.find(
      (i) =>
        i.address < call.instruction &&
        i.mnemonic === "je" &&
        i.target?.address === branch.target!.address &&
        factory.noConstructor.evidence.some((e) => e.address === i.address),
    );
    if (!guard) continue;
    const allocation = code.calls.find(
      (c) => c.target && summaries.get(c.target.address)?.kind === "nullable-allocation",
    );
    const capture =
      allocation &&
      code.instructions.find(
        (i) =>
          i.address > allocation.instruction &&
          i.address < allocation.instruction + 16 &&
          i.mnemonic === "mov" &&
          isRegister(i.operands[0]) &&
          isRegister(i.operands[1], "ax"),
      );
    if (!capture || !isRegister(capture.operands[0])) continue;
    const capturedOwner = capture.operands[0].name;
    const pushIndex = code.instructions.slice(0, index).findLastIndex((i) => i.mnemonic === "push");
    const pushed = code.instructions[pushIndex];
    if (!pushed || !isRegister(pushed.operands[0], capture.operands[0].name)) continue;
    const bridge = code.instructions.slice(pushIndex, index + 4);
    if (
      !bridge.every(
        (i, n) =>
          n === 0 ||
          (code.edges.filter((e) => e.to === i.address).length === 1 &&
            code.edges.some((e) => e.to === i.address && e.from === bridge[n - 1]!.address)),
      )
    )
      continue;
    if (
      bridge
        .slice(1, index - pushIndex)
        .some(
          (i) =>
            i.flow !== "next" ||
            isMemory(i.operands[0]) ||
            [capturedOwner, "sp", "bp", "ds", "ss"].some((name) => writesRegister(i, name)),
        )
    )
      continue;
    const findings: NonNullable<typeof factory.alwaysSuccessfulConstructors> = [];
    for (let type = 0; type < table.typeCount; type++) {
      const at = table.segment * 16 + table.offset + type * table.stride;
      if (at < 0 || at + 4 > image.length) continue;
      const offset = image[at]! | (image[at + 1]! << 8),
        segment = image[at + 2]! | (image[at + 3]! << 8);
      if (!offset && !segment) continue;
      const address = segment * 16 + offset;
      const ctor = readRoutineCode(image, { address, segment, offset }, dataSegment);
      const proof = successfulOwnerConstructor(image, ctor, engine.allocationSize, layout, dataSegment);
      if (proof)
        findings.push({
          ...proof,
          type,
          address,
          evidence: [
            ...factory.noConstructor.evidence,
            ...bridge.map(evidenceOf),
            evidenceOf(guard),
            ...proof.evidence,
            {
              address: at,
              bytes: [...image.slice(at, at + 4)],
              text: `Initial constructor pointer for type ${type}: ${segment.toString(16)}:${offset.toString(16)}`,
            },
          ],
          assumptions: [
            ...factory.noConstructor.assumptions,
            ...proof.assumptions,
            "This constructor always returns zero, so the checked comparison with one always takes the shared success continuation. Constructor-failure cleanup is unreachable; allocation failure retains the existing null-cleanup proof.",
          ],
        });
    }
    factory.alwaysSuccessfulConstructors = findings;
  }
}
