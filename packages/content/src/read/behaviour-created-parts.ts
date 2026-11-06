/**
 * The parts a routine makes with the part factory, and their type. The factory takes the new part's type as its only
 * argument and stores it as the new part's type word (`mov [si+0x04], di` at `0x15dd2` in Even More, English floppy)
 * before it calls the type's constructor. A routine that pushes a number right before its call passes that number:
 * the gun pushes `0x14` before its call at `0x1b3a1`, so it makes a bullet.
 */
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Evidence, Finding, RoutineAnalysis } from "./behaviour.ts";
import type { Instruction } from "./x86.ts";

export interface CreatedPart extends Finding {
  /** The routine that makes the part and the address of its call to the factory. */
  routine: number;
  call: number;
  /** The type it passes, which the factory stores as the new part's type. */
  type: number;
}

const evidenceOf = (i: Instruction): Evidence => ({ address: i.address, bytes: i.bytes, text: i.text });

/**
 * Each call to the part factory whose type argument is a number pushed right before it: `push` of the number, or
 * `mov` of the number into a register and `push` of that register.
 */
export function findCreatedParts(
  routines: RoutineAnalysis[],
  helpers: EngineSummary[],
  typeOffset: number,
): CreatedPart[] {
  const factories = new Map(
    helpers
      .filter(
        (helper) =>
          helper.kind === "part-factory" &&
          helper.factory?.typeArgument === 6 &&
          helper.returnConvention?.kind === "far" &&
          // The factory's own store of its argument as the new part's type.
          helper.writes.some(
            (write) =>
              write.offset === typeOffset &&
              write.width === 16 &&
              write.value.kind === "field" &&
              write.value.object === "argument" &&
              write.value.offset === helper.factory!.typeArgument,
          ),
      )
      .map((helper) => [helper.address, helper]),
  );
  const found = new Map<string, CreatedPart>();
  for (const routine of routines) {
    const at = new Map(routine.instructions.map((instruction, index) => [instruction.address, index]));
    for (const call of routine.calls) {
      const factory = call.target && factories.get(call.target.address);
      const index = at.get(call.instruction);
      if (!factory || index === undefined || index < 1) continue;
      const site = routine.instructions[index]!;
      if (site.flow !== "call" || !site.far || site.target?.address !== factory.address) continue;
      const push = routine.instructions[index - 1]!;
      if (push.mnemonic !== "push" || push.address + push.size !== site.address) continue;
      const pushed = push.operands[0];
      let type: number | undefined;
      const proof = [push, site];
      if (pushed?.kind === "immediate") type = pushed.value;
      else if (pushed?.kind === "register" && index >= 2) {
        const move = routine.instructions[index - 2]!;
        const [target, source] = move.operands;
        if (
          move.mnemonic === "mov" &&
          move.address + move.size === push.address &&
          target?.kind === "register" &&
          target.name === pushed.name &&
          source?.kind === "immediate"
        ) {
          type = source.value;
          proof.unshift(move);
        }
      }
      if (type === undefined) continue;
      // Only the instruction before the push and the call may lead to them, so every way to the call passes the number.
      const only = (address: number, from: number) =>
        routine.address !== address &&
        routine.edges.filter((edge) => edge.to === address).every((edge) => edge.kind === "next" && edge.from === from);
      if (!only(site.address, push.address) || (proof.length === 3 && !only(push.address, proof[0]!.address))) continue;
      const created: CreatedPart = {
        routine: routine.address,
        call: site.address,
        type: type & 0xffff,
        confidence: "inferred",
        assumptions: [
          "The part factory's type argument is the word pushed last before its far call. The factory stores it as the new part's type and calls that type's constructor.",
        ],
        evidence: [
          ...proof.map(evidenceOf),
          ...factory.evidence.filter((item) => item.text.includes(`+0x${typeOffset.toString(16).padStart(2, "0")}], `)),
        ],
      };
      found.set(`${routine.address}:${site.address}`, created);
    }
  }
  return [...found.values()].sort((a, b) => a.routine - b.routine || a.call - b.call);
}
