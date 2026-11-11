/** Proves termination of the compiler's read-only bounded switch-key searches. */
import type { RoutineCode } from "./behaviour-code.ts";
import type { Evidence } from "./behaviour.ts";
import type { Instruction, Operand } from "./x86.ts";
import { evidenceOf } from "./behaviour-terms.ts";

export interface BoundedSearchLoop {
  entry: number;
  header: number;
  latch: number;
  count: number;
  body: number[];
  evidence: Evidence[];
}
const register = (o: Operand | undefined, name: string) => o?.kind === "register" && o.name === name;
const immediate = (o: Operand | undefined, value: number) => o?.kind === "immediate" && o.value === value;

/**
 * The existing jump-table proof supplies bounded keys and targets. This additional proof establishes that each
 * search entry reloads CX, that the loop has no stores or calls, and that no edge enters behind that reload.
 */
export function discoverBoundedSearchLoops(code: RoutineCode): BoundedSearchLoop[] {
  if (code.status !== "complete") return [];
  const instructions = new Map(code.instructions.map((i) => [i.address, i]));
  const next = (i: Instruction | undefined) => i && instructions.get(i.address + i.size);
  const results: BoundedSearchLoop[] = [];
  const entries = new Set<number>();
  for (const edge of code.edges) {
    const search = edge.search;
    if (!search || entries.has(search.entry) || search.count <= 0 || search.count > 256) continue;
    entries.add(search.entry);
    const loadCount = instructions.get(search.entry);
    const loadBase = next(loadCount),
      loadKey = next(loadBase),
      compare = next(loadKey),
      branch = next(compare);
    const advance = next(branch),
      latch = next(advance),
      fallback = next(latch),
      dispatch = next(fallback);
    if (!loadCount || !loadBase || !loadKey || !compare || !branch || !advance || !latch || !fallback || !dispatch)
      continue;
    const key = loadKey.operands[1],
      target = dispatch.operands[0];
    if (
      loadCount.mnemonic !== "mov" ||
      !register(loadCount.operands[0], "cx") ||
      !immediate(loadCount.operands[1], search.count) ||
      loadBase.mnemonic !== "mov" ||
      !register(loadBase.operands[0], search.indexRegister) ||
      !immediate(loadBase.operands[1], search.tableBase) ||
      loadKey.mnemonic !== "mov" ||
      !register(loadKey.operands[0], search.keyRegister) ||
      key?.kind !== "memory" ||
      key.segment !== "cs" ||
      key.base.join() !== search.indexRegister ||
      key.displacement !== 0 ||
      key.width !== 16 ||
      compare.address !== search.compare ||
      compare.mnemonic !== "cmp" ||
      !register(compare.operands[0], search.keyRegister) ||
      branch.address !== search.match ||
      branch.mnemonic !== "je" ||
      branch.target?.address !== dispatch.address ||
      advance.mnemonic !== "add" ||
      !register(advance.operands[0], search.indexRegister) ||
      !immediate(advance.operands[1], 2) ||
      latch.mnemonic !== "loop" ||
      latch.target?.address !== loadKey.address ||
      fallback.flow !== "jump" ||
      fallback.target?.address !== search.defaultTarget ||
      dispatch.address !== edge.from ||
      dispatch.flow !== "jump" ||
      target?.kind !== "memory" ||
      target.segment !== "cs" ||
      target.base.join() !== search.indexRegister ||
      target.displacement !== search.count * 2
    )
      continue;
    const sequence = [loadCount, loadBase, loadKey, compare, branch, advance, latch, fallback, dispatch];
    const body = new Set(sequence.map((i) => i.address));
    if (code.edges.some((e) => e.to !== null && e.to !== loadCount.address && body.has(e.to) && !body.has(e.from)))
      continue;
    // CX changes only at LOOP; BX advances by one checked key word. At most count comparisons can occur.
    results.push({
      entry: loadCount.address,
      header: loadKey.address,
      latch: latch.address,
      count: search.count,
      body: [...body],
      evidence: sequence.map(evidenceOf),
    });
  }
  return results;
}
