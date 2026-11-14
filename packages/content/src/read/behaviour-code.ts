/** Discovers routine control flow without executing instructions or choosing a game state. */
import { decodeInstruction, operandText, type CodeAddress, type Instruction, type Operand } from "./x86.ts";

export interface CodeEvidence {
  address: number;
  bytes: number[];
  text: string;
}

/** The bounded search proved by a sparse switch pattern, available for a symbolic loop summary. */
export interface SwitchSearch {
  entry: number;
  compare: number;
  match: number;
  defaultTarget: number;
  count: number;
  tableBase: number;
  keyRegister: string;
  indexRegister: string;
}

export interface RoutineEdge {
  from: number;
  to: number | null;
  kind: "next" | "taken" | "not-taken" | "jump" | "jump-table" | "return" | "stop" | "unresolved";
  condition?: string;
  tableIndex?: number;
  indexRegister?: string;
  selector?: Operand;
  caseValue?: number;
  selectorScale?: number;
  search?: SwitchSearch;
  evidence?: CodeEvidence[];
}

export interface RoutineCall {
  instruction: number;
  target?: CodeAddress;
  operand: Operand | undefined;
  far: boolean;
  evidence: CodeEvidence[];
  confidence: "checked" | "unresolved";
  assumptions: string[];
}

export interface RoutineCode extends CodeAddress {
  instructions: Instruction[];
  edges: RoutineEdge[];
  calls: RoutineCall[];
  extent: { start: number; end: number }[];
  status: "complete" | "partial" | "error";
  uncertainties: string[];
}

const evidence = (instruction: Instruction): CodeEvidence => ({
  address: instruction.address,
  bytes: instruction.bytes,
  text: instruction.text,
});
const location = (address: number) => `0x${address.toString(16)}`;
const nextAddress = (instruction: Instruction): CodeAddress => {
  const offset = (instruction.offset + instruction.size) & 0xffff;
  return { segment: instruction.segment, offset, address: instruction.segment * 16 + offset };
};

interface JumpTable {
  destinations: { address: CodeAddress; index: number; value: number; table: CodeEvidence[] }[];
  register: string;
  selector: Operand;
  selectorScale: number;
  search?: SwitchSearch;
  evidence: CodeEvidence[];
}

/** Reads a word from a code segment, including a table entry that crosses its end. */
function codeWord(
  image: Uint8Array,
  segment: number,
  offset: number,
): { value: number; address: number; bytes: number[] } | undefined {
  const address = segment * 16 + (offset & 0xffff);
  const first = image[address];
  const second = image[segment * 16 + ((offset + 1) & 0xffff)];
  return first === undefined || second === undefined
    ? undefined
    : { value: first | (second << 8), address, bytes: [first, second] };
}

/** Recognizes the compiler's bounded search through keys followed by an equal-sized target table. */
function sparseJumpTable(image: Uint8Array, jump: Instruction, instructions: Instruction[]): JumpTable | undefined {
  const operand = jump.operands[0];
  if (operand?.kind !== "memory" || operand.segment !== "cs" || operand.width !== 16 || operand.base.length !== 1)
    return undefined;
  const indexRegister = operand.base[0]!;
  const preceding = instructions
    .filter(
      (instruction) =>
        instruction.segment === jump.segment &&
        instruction.address >= jump.address - 48 &&
        instruction.address < jump.address,
    )
    .sort((a, b) => a.address - b.address);
  for (let k = 0; k + 7 < preceding.length; k++) {
    const sequence = preceding.slice(k, k + 8);
    if (
      !sequence.every(
        (instruction, index) =>
          index === sequence.length - 1 || nextAddress(instruction).address === sequence[index + 1]!.address,
      )
    )
      continue;
    const [countLoad, baseLoad, keyLoad, compare, branch, advance, loop, fallback] = sequence as [
      Instruction,
      Instruction,
      Instruction,
      Instruction,
      Instruction,
      Instruction,
      Instruction,
      Instruction,
    ];
    if (
      nextAddress(fallback).address !== jump.address ||
      countLoad.mnemonic !== "mov" ||
      countLoad.operands[0]?.kind !== "register" ||
      countLoad.operands[0].name !== "cx" ||
      countLoad.operands[1]?.kind !== "immediate"
    )
      continue;
    const count = countLoad.operands[1].value;
    if (
      count <= 0 ||
      count > 256 ||
      operand.displacement !== count * 2 ||
      baseLoad.mnemonic !== "mov" ||
      baseLoad.operands[0]?.kind !== "register" ||
      baseLoad.operands[0].name !== indexRegister ||
      baseLoad.operands[1]?.kind !== "immediate"
    )
      continue;
    const keyMemory = keyLoad.operands[1];
    const keyRegister = keyLoad.operands[0];
    if (
      keyLoad.mnemonic !== "mov" ||
      keyRegister?.kind !== "register" ||
      keyMemory?.kind !== "memory" ||
      keyMemory.segment !== "cs" ||
      keyMemory.width !== 16 ||
      keyMemory.base.length !== 1 ||
      keyMemory.base[0] !== indexRegister ||
      keyMemory.displacement !== 0 ||
      compare.mnemonic !== "cmp" ||
      compare.operands[0]?.kind !== "register" ||
      compare.operands[0].name !== keyRegister.name ||
      !compare.operands[1]
    )
      continue;
    if (
      branch.mnemonic !== "je" ||
      branch.target?.address !== jump.address ||
      advance.mnemonic !== "add" ||
      advance.operands[0]?.kind !== "register" ||
      advance.operands[0].name !== indexRegister ||
      advance.operands[1]?.kind !== "immediate" ||
      advance.operands[1].value !== 2 ||
      loop.mnemonic !== "loop" ||
      loop.target?.address !== keyLoad.address ||
      fallback.flow !== "jump" ||
      !fallback.target ||
      fallback.target.address === jump.address
    )
      continue;
    const destinations: JumpTable["destinations"] = [];
    for (let index = 0; index < count; index++) {
      const key = codeWord(image, jump.segment, baseLoad.operands[1].value + 2 * index);
      const entry = codeWord(image, jump.segment, baseLoad.operands[1].value + operand.displacement + 2 * index);
      if (!key || !entry) return undefined;
      destinations.push({
        address: { segment: jump.segment, offset: entry.value, address: jump.segment * 16 + entry.value },
        index,
        value: key.value,
        table: [
          { address: key.address, bytes: key.bytes, text: `switch key ${index}: ${location(key.value)}` },
          {
            address: entry.address,
            bytes: entry.bytes,
            text: `switch entry ${index}: offset ${location(entry.value)}`,
          },
        ],
      });
    }
    return {
      destinations,
      register: indexRegister,
      selector: compare.operands[1],
      selectorScale: 1,
      search: {
        entry: countLoad.address,
        compare: compare.address,
        match: branch.address,
        defaultTarget: fallback.target.address,
        count,
        tableBase: baseLoad.operands[1].value,
        keyRegister: keyRegister.name,
        indexRegister,
      },
      evidence: [...sequence, jump].map(evidence),
    };
  }
  return undefined;
}

/**
 * Resolves a compiler switch only when its unsigned range check, scaling and table access agree. The bound must
 * guard the table path: the range check is the only way into the shift, and the shift the only way into the jump.
 * A plausible run of words in the image alone is never sufficient to create code targets.
 */
function jumpTable(
  image: Uint8Array,
  jump: Instruction,
  instructions: Instruction[],
  edges: RoutineEdge[],
  entry: number,
): JumpTable | undefined {
  const operand = jump.operands[0];
  if (operand?.kind !== "memory" || operand.segment !== "cs" || operand.width !== 16 || operand.base.length !== 1)
    return undefined;
  const indexRegister = operand.base[0]!;
  const preceding = instructions
    .filter(
      (instruction) =>
        instruction.segment === jump.segment &&
        instruction.address < jump.address &&
        instruction.address >= jump.address - 32,
    )
    .sort((a, b) => a.address - b.address);
  const shift = preceding.at(-1);
  // The index is doubled by `shl reg, 1`, or by `add reg, reg` as TIM2.EXE's code does.
  const doubled =
    shift?.operands[0]?.kind === "register" &&
    shift.operands[0].name === indexRegister &&
    ((shift.mnemonic === "shl" && shift.operands[1]?.kind === "immediate" && shift.operands[1].value === 1) ||
      (shift.mnemonic === "add" && shift.operands[1]?.kind === "register" && shift.operands[1].name === indexRegister));
  if (!shift || nextAddress(shift).address !== jump.address || !doubled) return undefined;
  for (let k = preceding.length - 2; k >= 0; k--) {
    const compare = preceding[k]!;
    const branch = preceding[k + 1];
    if (
      compare.mnemonic !== "cmp" ||
      compare.operands[0]?.kind !== "register" ||
      compare.operands[0].name !== indexRegister ||
      compare.operands[1]?.kind !== "immediate" ||
      !branch ||
      nextAddress(compare).address !== branch.address
    )
      continue;
    const bound = compare.operands[1].value;
    let count: number;
    let guarded: boolean;
    let fallbackEvidence: Instruction | undefined;
    if ((branch.mnemonic === "ja" || branch.mnemonic === "jae") && nextAddress(branch).address === shift.address) {
      count = bound + (branch.mnemonic === "ja" ? 1 : 0);
      guarded = branch.target?.address !== shift.address && branch.target?.address !== jump.address;
    } else if ((branch.mnemonic === "jbe" || branch.mnemonic === "jb") && branch.target?.address === shift.address) {
      count = bound + (branch.mnemonic === "jbe" ? 1 : 0);
      const fallback = preceding[k + 2];
      fallbackEvidence = fallback;
      guarded =
        fallback?.flow === "jump" &&
        nextAddress(branch).address === fallback.address &&
        fallback.target !== undefined &&
        fallback.target.address !== shift.address &&
        fallback.target.address !== jump.address;
    } else continue;
    // The routine's entry is a way in too, though no edge leads to it.
    const onlyWayIn = (to: number, from: number) =>
      to !== entry && edges.every((edge) => edge.to !== to || edge.from === from);
    // The range check holds only when every way to the shift goes through the comparison and then the branch.
    if (
      !onlyWayIn(branch.address, compare.address) ||
      !onlyWayIn(shift.address, branch.address) ||
      !onlyWayIn(jump.address, shift.address)
    )
      return undefined;
    if (!guarded || count <= 0 || count > 256) return undefined;
    const destinations: JumpTable["destinations"] = [];
    for (let index = 0; index < count; index++) {
      const tableOffset = (operand.displacement + index * 2) & 0xffff;
      const at = jump.segment * 16 + tableOffset;
      const first = image[at];
      const second = image[jump.segment * 16 + ((tableOffset + 1) & 0xffff)];
      if (first === undefined || second === undefined) return undefined;
      const offset = first | (second << 8);
      destinations.push({
        address: { segment: jump.segment, offset, address: jump.segment * 16 + offset },
        index,
        value: index,
        table: [{ address: at, bytes: [first, second], text: `switch entry ${index}: offset ${location(offset)}` }],
      });
    }
    return {
      destinations,
      register: indexRegister,
      selector: compare.operands[0],
      selectorScale: 2,
      evidence: [compare, branch, ...(fallbackEvidence ? [fallbackEvidence] : []), shift, jump].map(evidence),
    };
  }
  return undefined;
}

/**
 * Follows each branch and direct jump until a return. Calls are recorded separately and their fallthrough is
 * followed. Unknown instructions stop this routine immediately; unresolved indirect jumps make its extent partial.
 */
export function readRoutineCode(image: Uint8Array, entry: CodeAddress, dataSegment: number): RoutineCode {
  const result: RoutineCode = {
    ...entry,
    instructions: [],
    edges: [],
    calls: [],
    extent: [],
    status: "complete",
    uncertainties: [],
  };
  const pending = [entry];
  const seen = new Set<string>();
  const occupied = new Map<number, number>();
  const unresolvedJumps = new Map<number, Instruction>();
  const guardedJumps: Instruction[] = [];
  const add = (from: Instruction, to: CodeAddress, kind: RoutineEdge["kind"], condition?: string) => {
    result.edges.push({ from: from.address, to: to.address, kind, ...(condition ? { condition } : {}) });
    pending.push(to);
  };
  const uncertain = (message: string) => {
    if (result.status !== "error") result.status = "partial";
    if (!result.uncertainties.includes(message)) result.uncertainties.push(message);
  };
  while (pending.length || unresolvedJumps.size) {
    if (!pending.length) {
      let resolved = false;
      for (const [address, instruction] of unresolvedJumps) {
        const guarded = jumpTable(image, instruction, result.instructions, result.edges, entry.address);
        const table = guarded ?? sparseJumpTable(image, instruction, result.instructions);
        if (!table) continue;
        if (guarded) guardedJumps.push(instruction);
        resolved = true;
        unresolvedJumps.delete(address);
        for (const destination of table.destinations) {
          result.edges.push({
            from: address,
            to: destination.address.address,
            kind: "jump-table",
            tableIndex: destination.index,
            indexRegister: table.register,
            selector: table.selector,
            caseValue: destination.value,
            selectorScale: table.selectorScale,
            ...(table.search ? { search: table.search } : {}),
            condition: `${operandText(table.selector)} == ${location(destination.value)}`,
            evidence: [...table.evidence, ...destination.table],
          });
          pending.push(destination.address);
        }
      }
      if (!resolved) break;
    }
    const at = pending.pop();
    if (!at) continue;
    const key = `${at.segment}:${at.offset}`;
    if (seen.has(key)) continue;
    if (result.instructions.length >= 12000) {
      uncertain(`Routine at ${location(entry.address)} exceeds the 12000-instruction analysis limit`);
      break;
    }
    const previous = occupied.get(at.address);
    if (previous !== undefined && previous !== at.address) {
      result.status = "error";
      result.uncertainties.push(`Branch at ${location(at.address)} enters the instruction at ${location(previous)}`);
      break;
    }
    let instruction: Instruction;
    try {
      instruction = decodeInstruction(image, at.address, at.segment);
    } catch (error) {
      result.status = "error";
      result.uncertainties.push(error instanceof Error ? error.message : String(error));
      break;
    }
    for (let k = 0; k < instruction.size; k++) {
      const byteAddress = at.segment * 16 + ((at.offset + k) & 0xffff);
      const owner = occupied.get(byteAddress);
      if (owner !== undefined && owner !== instruction.address) {
        result.status = "error";
        result.uncertainties.push(
          `Instruction at ${location(instruction.address)} overlaps the instruction at ${location(owner)}`,
        );
        break;
      }
      occupied.set(byteAddress, instruction.address);
    }
    if (result.status === "error") break;
    seen.add(key);
    result.instructions.push(instruction);
    if (instruction.flow === "call") {
      let target = instruction.target;
      const operand = instruction.operands[0];
      const callEvidence = [evidence(instruction)];
      if (!target && operand?.kind === "memory" && operand.direct && !operand.base.length) {
        const segment = operand.segment === "ds" ? dataSegment : operand.segment === "cs" ? at.segment : undefined;
        if (segment !== undefined) {
          const tableAddress = segment * 16 + operand.displacement;
          const bytes = Array.from(image.subarray(tableAddress, tableAddress + (instruction.far ? 4 : 2)));
          if (bytes.length === (instruction.far ? 4 : 2)) {
            const offset = bytes[0]! | (bytes[1]! << 8);
            const destinationSegment = instruction.far ? bytes[2]! | (bytes[3]! << 8) : at.segment;
            target = { segment: destinationSegment, offset, address: destinationSegment * 16 + offset };
            callEvidence.push({ address: tableAddress, bytes, text: `initial code pointer ${operandText(operand)}` });
          }
        }
      }
      const preceding = result.instructions.find(
        (candidate) =>
          nextAddress(candidate).address === instruction.address &&
          candidate.segment === instruction.segment &&
          candidate.address !== instruction.address,
      );
      const suppliedCodeSegment =
        !instruction.far &&
        preceding?.mnemonic === "push" &&
        preceding.operands[0]?.kind === "register" &&
        preceding.operands[0].name === "cs";
      if (suppliedCodeSegment) callEvidence.unshift(evidence(preceding));
      result.calls.push({
        instruction: instruction.address,
        ...(target ? { target } : {}),
        operand,
        far: instruction.far ?? false,
        evidence: callEvidence,
        confidence: instruction.target ? "checked" : "unresolved",
        assumptions: instruction.target
          ? suppliedCodeSegment
            ? ["The preceding push cs supplies a segment word for a far-return calling convention."]
            : []
          : target
            ? ["The indirect call target is the initial image value; a runtime write may replace it."]
            : ["The indirect call target is not statically resolved."],
      });
      add(instruction, nextAddress(instruction), "next");
    } else if (instruction.flow === "branch") {
      if (instruction.target) add(instruction, instruction.target, "taken", instruction.mnemonic);
      add(instruction, nextAddress(instruction), "not-taken", `not ${instruction.mnemonic}`);
    } else if (instruction.flow === "jump") {
      if (instruction.target) add(instruction, instruction.target, "jump");
      else unresolvedJumps.set(instruction.address, instruction);
    } else if (instruction.flow === "return" || instruction.flow === "stop") {
      result.edges.push({ from: instruction.address, to: null, kind: instruction.flow });
      if (instruction.flow === "stop") uncertain(`Path stops at ${location(instruction.address)} without a return`);
    } else add(instruction, nextAddress(instruction), "next");
  }
  for (const [address] of unresolvedJumps) {
    result.edges.push({ from: address, to: null, kind: "unresolved" });
    uncertain(`Indirect jump at ${location(address)} has no structurally established table bound`);
  }
  // Code read after a table was accepted may have found another way into its shift or jump.
  for (const jump of guardedJumps)
    if (!jumpTable(image, jump, result.instructions, result.edges, entry.address))
      uncertain(`The range check before the jump table at ${location(jump.address)} can be bypassed`);
  result.instructions.sort((a, b) => a.address - b.address);
  const addresses = [...occupied.keys()].sort((a, b) => a - b);
  for (const address of addresses) {
    const last = result.extent.at(-1);
    if (last?.end === address) last.end++;
    else result.extent.push({ start: address, end: address + 1 });
  }
  return result;
}
