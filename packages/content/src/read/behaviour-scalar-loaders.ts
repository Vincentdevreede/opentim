/**
 * Routines that load a resource by number, like TIM2.EXE's animation loader (CD build `0x36500`): the caller passes
 * one number, and the routine and everything it calls read files, allocate memory and fill the loaded data, keeping
 * track of it in globals. No part pointer reaches them through an argument, since the only argument is a number that is
 * only pushed on or compared. They are read with TIM.EXE's resource service assumption: what such a service writes is
 * its own data and allocations, never a live part.
 */
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import { evidenceOf } from "./behaviour-terms.ts";
import type { Evidence } from "./behaviour.ts";

/** The assumption TIM.EXE's resource service already states, word for word. */
export const SCALAR_SERVICE_ASSUMPTION =
  "The caller supplies a scalar resource identifier, not a pointer. Resource lists and driver-owned allocations are distinct from live part objects, and the service has no hidden access to any existing live part through another global.";

/**
 * TIM2.EXE's resource system calls handlers from a table it allocates and fills itself (CD build: the table's far
 * pointer at ds:0x66ac, filled by the routine at 0x137a4, whose four callers register handlers of the resource caches).
 */
export const HANDLER_TABLE_ASSUMPTION =
  "The handlers a resource service calls through a table it keeps in a global are the resource caches' own, and keep the parts as they are.";

/** How many routines a loader and its callees may have before the reader gives up on proving it. */
const MAX_ROUTINES = 400;
const FIRST_ARGUMENT = 6;

const readsArgument = (code: RoutineCode, offset: number) =>
  code.instructions.filter((i) =>
    i.operands.some(
      (o) => o.kind === "memory" && o.segment === "ss" && o.base.join() === "bp" && o.displacement === offset,
    ),
  );

/**
 * A far routine with the usual frame whose only argument (`[bp+6]`) is a number it pushes on or compares, and never
 * reads any other argument; and whose callees, all read completely, are none of the parts' callbacks.
 */
function isScalarLoader(
  code: RoutineCode,
  codes: Map<number, RoutineCode>,
  callbacks: Set<number>,
  programStart: number,
): { tree: number[]; handlers: Evidence[] } | undefined {
  const [push, move] = code.instructions;
  if (
    code.status !== "complete" ||
    push?.mnemonic !== "push" ||
    push.text !== "push bp" ||
    move?.text !== "mov bp, sp" ||
    !code.instructions.some((i) => i.mnemonic === "retf")
  )
    return undefined;
  const uses = readsArgument(code, FIRST_ARGUMENT);
  if (!uses.length || !uses.every((i) => ["push", "cmp"].includes(i.mnemonic))) return undefined;
  for (let offset = FIRST_ARGUMENT + 2; offset < FIRST_ARGUMENT + 32; offset += 2)
    if (readsArgument(code, offset).length) return undefined;
  const tree = new Set<number>([code.address]);
  const handlers: Evidence[] = [];
  const pending = [code];
  while (pending.length) {
    const routine = pending.pop()!;
    for (const call of routine.calls) {
      if (!call.target) {
        // A call through a table of handlers the resource system keeps in a global (`les bx, [table]` just before):
        // the handlers it registers there are its own, and stay unread.
        const at = routine.instructions.findIndex((i) => i.address === call.instruction);
        const table = routine.instructions
          .slice(Math.max(0, at - 3), at)
          .find(
            (i) =>
              i.mnemonic === "les" &&
              i.operands[1]?.kind === "memory" &&
              i.operands[1].direct &&
              i.operands[1].segment === "ds",
          );
        if (!table) return undefined;
        handlers.push(evidenceOf(table), evidenceOf(routine.instructions[at]!));
        continue;
      }
      const address = call.target.address;
      // A call to the program's start is one the reader doesn't follow; the loader isn't proved through it.
      if (address === programStart || callbacks.has(address)) return undefined;
      if (tree.has(address)) continue;
      const callee = codes.get(address);
      if (!callee || callee.status !== "complete") return undefined;
      tree.add(address);
      if (tree.size > MAX_ROUTINES) return undefined;
      pending.push(callee);
    }
  }
  return { tree: [...tree], handlers };
}

/**
 * Summaries for the scalar loaders among the routines read, for routines no other summary covers. Each keeps the parts
 * as they are and leaves its globals unresolved, as TIM.EXE's resource service does.
 */
export function discoverScalarLoaders(
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  callbacks: Set<number>,
  programStart: number,
): EngineSummary[] {
  const found: EngineSummary[] = [];
  for (const code of codes.values()) {
    if (summaries.has(code.address) || callbacks.has(code.address)) continue;
    const loader = isScalarLoader(code, codes, callbacks, programStart);
    if (!loader) continue;
    const services = loader.tree
      .flatMap((address) => codes.get(address)!.instructions)
      .filter((i) => i.mnemonic === "int")
      .map(evidenceOf);
    // Only a routine that reaches the system (files, memory) or the handler table needs the assumption; any other is
    // read in full on its own.
    if (!services.length && !loader.handlers.length) continue;
    found.push({
      address: code.address,
      kind: "scalar-resource-service",
      purpose:
        "Loads a resource by the number it is given: it and its callees read files, allocate memory and fill the loaded data, keeping track of it in globals.",
      argumentOffset: FIRST_ARGUMENT,
      argumentKind: "scalar",
      writes: [],
      returns: [],
      calls: code.calls.flatMap((c) => (c.target ? [c.target.address] : [])),
      confidence: "inferred",
      evidence: [...code.instructions.map(evidenceOf), ...services, ...loader.handlers],
      assumptions: [SCALAR_SERVICE_ASSUMPTION, ...(loader.handlers.length ? [HANDLER_TABLE_ASSUMPTION] : [])],
      footprint: {
        complete: false,
        partMemoryComplete: true,
        preservesArgumentMemory: true,
        preservesPartState: true,
        unknownEffects: [
          "The resource service can update resource nodes, global state and driver-owned memory; its full backend footprint is unresolved.",
        ],
      },
    });
  }
  return found;
}
