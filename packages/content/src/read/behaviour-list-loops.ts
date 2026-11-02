/** Proves owner-state preservation while a callback scans a discovered part list. */
import type { Evidence, Finding, Predicate } from "./behaviour.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { LoopField } from "./behaviour-loops.ts";
import type { Instruction, Operand } from "./x86.ts";
import { privateStackOutputs } from "./behaviour-buffer-effects.ts";
import { discoverBoundedSearchLoops } from "./behaviour-search-loops.ts";

export interface ListLoopSummary extends Finding {
  condition?: Predicate;
  header: number;
  bodyEntry: number;
  body: number[];
  exit: number;
  nodeRegister: string;
  nextField: number;
  source?: "overlap-query" | "global-list" | "external-list";
  headField?: number;
  globalHead?: number;
  ownerRegister: string;
  query?: number;
  queries: number[];
  possibleFields: LoopField[];
  writtenRegisters: string[];
  unknownGlobals: boolean;
  exitOnNullOnly: boolean;
}
const register = (op: Operand | undefined, name?: string): op is Extract<Operand, { kind: "register" }> =>
  op?.kind === "register" && (name === undefined || op.name === name);
const memory = (op: Operand | undefined): op is Extract<Operand, { kind: "memory" }> => op?.kind === "memory";
const immediate = (op: Operand | undefined, value?: number): op is Extract<Operand, { kind: "immediate" }> =>
  op?.kind === "immediate" && (value === undefined || op.value === value);
const local = (op: Operand | undefined) =>
  memory(op) && op.segment === "ss" && op.base.join() === "bp" && op.displacement < 0;
const writesFirst = (i: Instruction) =>
  i.flow === "next" &&
  !["cmp", "test", "push", "mul", "imul", "div", "idiv", "cwd", "cbw", "nop", "cld", "std"].includes(i.mnemonic);
const volatile = ["ax", "bx", "cx", "dx", "es"];
const whole = (name: string) =>
  ({ al: "ax", ah: "ax", bl: "bx", bh: "bx", cl: "cx", ch: "cx", dl: "dx", dh: "dx" })[name] ?? name;
const evidence = ({ address, bytes, text }: Instruction): Evidence => ({ address, bytes, text });
const overlaps = (offset: number, width: number, field: number) => offset < field + 2 && field < offset + width / 8;

/**
 * An overlap query must exclude its owner. Global lists may include the owner, so their bodies cannot write
 * through member pointers. List well-formedness is explicit. The body is inspected as a CFG, never unrolled.
 */
export function discoverListLoops(
  code: RoutineCode,
  helpers: Map<number, EngineSummary>,
  stateOffset: number,
  stateIsNonzero = false,
  externalEntry?: { headInstruction: number },
): ListLoopSummary[] {
  if (code.status !== "complete") return [];
  const instructions = new Map(code.instructions.map((i) => [i.address, i]));
  const outgoing = new Map<number, number[]>(),
    incoming = new Map<number, number[]>();
  const boundedSearches = discoverBoundedSearchLoops(code);
  const searchBackEdges = new Set(boundedSearches.map((s) => `${s.latch}:${s.header}`));
  const before = new Map<number, Instruction>();
  for (const i of code.instructions) before.set(i.address + i.size, i);
  for (const edge of code.edges)
    if (edge.to !== null) {
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
      incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
    }
  const dominates = (definition: number, target: number, start = code.address) => {
    const pending = [start],
      seen = new Set<number>();
    while (pending.length) {
      const at = pending.pop()!;
      if (at === definition || seen.has(at)) continue;
      if (at === target) return false;
      seen.add(at);
      pending.push(...(outgoing.get(at) ?? []));
    }
    return true;
  };
  const argumentOffset = code.instructions.some((i) => i.mnemonic === "retf") ? 6 : 4;
  const result: ListLoopSummary[] = [];
  const globalHeads = new Map<number, EngineSummary>();
  const globalLinks = new Map<number, EngineSummary>();
  for (const helper of helpers.values())
    for (const returned of helper.returns) {
      const pointer = returned.pointer;
      if (helper.kind === "list-head" && pointer?.kind === "global" && !pointer.path.length)
        globalHeads.set(pointer.offset, helper);
      if (
        helper.kind === "list-next" &&
        pointer?.kind === "argument" &&
        pointer.argument === helper.argumentOffset &&
        pointer.path.length === 1 &&
        !pointer.displacement
      )
        globalLinks.set(pointer.path[0]!, helper);
    }
  const originalOutgoing = outgoing;
  for (const guard of code.instructions) {
    const outgoing = new Map(originalOutgoing);
    const stateProof: Evidence[] = [];
    const node = guard.operands[0];
    if (!register(node)) continue;
    if (!(
      (["or", "test"].includes(guard.mnemonic) && register(guard.operands[1], node.name)) ||
      (guard.mnemonic === "cmp" && immediate(guard.operands[1], 0))
    ))
      continue;
    const branch = instructions.get(guard.address + guard.size);
    if (!branch?.target || !["je", "jne"].includes(branch.mnemonic)) continue;
    const fallthrough = branch.address + branch.size;
    let bodyEntry: number, exit: number, gateway: number | undefined;
    if (branch.mnemonic === "jne" && branch.target.address < guard.address) {
      bodyEntry = branch.target.address;
      exit = fallthrough;
    } else if (branch.mnemonic === "je" && branch.target.address > guard.address) {
      const jump = instructions.get(fallthrough);
      if (jump?.flow !== "jump" || !jump.target || jump.target.address >= guard.address) continue;
      bodyEntry = jump.target.address;
      exit = branch.target.address;
      gateway = jump.address;
    } else continue;
    const header = guard.address;
    const body = new Set<number>(),
      pending = [bodyEntry];
    let invalid = false;
    while (pending.length) {
      const at = pending.pop()!;
      if (at === header || at === exit || body.has(at)) continue;
      const i = instructions.get(at);
      if (!i || at < bodyEntry || at >= header || ["return", "stop"].includes(i.flow)) {
        invalid = true;
        break;
      }
      body.add(at);
      const next = outgoing.get(at) ?? [];
      if (!next.length) {
        invalid = true;
        break;
      }
      pending.push(...next);
    }
    if (
      invalid ||
      !body.size ||
      [...body].some((at) =>
        (incoming.get(at) ?? []).some((from) => !body.has(from) && from !== branch.address && from !== gateway),
      )
    )
      continue;
    const active = new Set<number>(),
      finished = new Set<number>();
    const acyclic = (at: number): boolean => {
      if (at === header || at === exit || finished.has(at)) return true;
      if (active.has(at)) return false;
      active.add(at);
      for (const next of outgoing.get(at) ?? [])
        if (!searchBackEdges.has(`${at}:${next}`) && !acyclic(next)) return false;
      active.delete(at);
      finished.add(at);
      return true;
    };
    if (!acyclic(bodyEntry)) continue;
    let sequence = [...body].map((at) => instructions.get(at)!).sort((a, b) => a.address - b.address);
    const advances = sequence.filter(
      (i) =>
        i.mnemonic === "mov" &&
        register(i.operands[0], node.name) &&
        memory(i.operands[1]) &&
        i.operands[1].segment === "ds" &&
        i.operands[1].base.join() === node.name &&
        i.operands[1].width === 16,
    );
    if (advances.length !== 1) continue;
    const nextField = (advances[0]!.operands[1] as Extract<Operand, { kind: "memory" }>).displacement;
    const zeroes = sequence.filter(
      (i) =>
        register(i.operands[0], node.name) &&
        ((["xor", "sub"].includes(i.mnemonic) && register(i.operands[1], node.name)) ||
          (i.mnemonic === "mov" && immediate(i.operands[1], 0))),
    );
    const progress = new Set([advances[0]!.address, ...zeroes.map((i) => i.address)]);
    if (
      sequence.some(
        (i) =>
          writesFirst(i) &&
          register(i.operands[0]) &&
          whole(i.operands[0].name) === node.name &&
          !progress.has(i.address),
      )
    )
      continue;
    const avoidsProgress = [bodyEntry],
      visited = new Set<number>();
    while (avoidsProgress.length) {
      const at = avoidsProgress.pop()!;
      if (progress.has(at) || at === exit || visited.has(at)) continue;
      if (at === header) {
        invalid = true;
        break;
      }
      visited.add(at);
      avoidsProgress.push(...(outgoing.get(at) ?? []));
    }
    if (invalid) continue;
    const head = code.instructions
      .filter(
        (i) =>
          i.address < bodyEntry &&
          i.mnemonic === "mov" &&
          register(i.operands[0], node.name) &&
          memory(i.operands[1]) &&
          i.operands[1].segment === "ds" &&
          (i.operands[1].base.length === 1 || (i.operands[1].direct && globalHeads.has(i.operands[1].displacement))) &&
          i.operands[1].width === 16 &&
          dominates(i.address, header),
      )
      .at(-1);
    if (!head || !memory(head.operands[1])) continue;
    const globalSource = head.operands[1].direct;
    if (globalSource && !globalLinks.has(nextField)) continue;
    const ownerCandidate = head.operands[1].base[0];
    const ownerDefinition = code.instructions
      .filter(
        (i) =>
          i.address < head.address &&
          i.mnemonic === "mov" &&
          register(i.operands[0], ownerCandidate) &&
          (!globalSource || (!volatile.includes(i.operands[0].name) && i.operands[0].name !== node.name)) &&
          memory(i.operands[1]) &&
          i.operands[1].segment === "ss" &&
          i.operands[1].base.join() === "bp" &&
          i.operands[1].displacement === argumentOffset &&
          dominates(i.address, head.address),
      )
      .at(-1);
    if (!ownerDefinition || !register(ownerDefinition.operands[0])) continue;
    const owner = ownerDefinition.operands[0].name;
    const headField = globalSource ? undefined : head.operands[1].displacement;
    if (owner === node.name) continue;
    if (
      code.instructions.some(
        (i) =>
          i.address > ownerDefinition.address &&
          i.address < head.address &&
          writesFirst(i) &&
          register(i.operands[0], owner),
      )
    )
      continue;
    if (
      !volatile.includes(owner) &&
      code.instructions.some((i) => body.has(i.address) && writesFirst(i) && register(i.operands[0], owner))
    )
      continue;
    if (stateIsNonzero) {
      if (volatile.includes(owner)) continue;
      for (const compare of sequence) {
        const tested = compare.operands[0],
          branch = instructions.get(compare.address + compare.size);
        if (
          compare.mnemonic !== "cmp" ||
          !memory(tested) ||
          tested.segment !== "ds" ||
          tested.base.join() !== owner ||
          tested.displacement !== stateOffset ||
          tested.width !== 16 ||
          !immediate(compare.operands[1], 0) ||
          !branch?.target ||
          !["je", "jne"].includes(branch.mnemonic)
        )
          continue;
        const chosen = branch.mnemonic === "jne" ? branch.target.address : branch.address + branch.size;
        if (!(outgoing.get(branch.address) ?? []).includes(chosen)) continue;
        outgoing.set(branch.address, [chosen]);
        stateProof.push(evidence(compare), evidence(branch));
      }
      if (!stateProof.length) continue;
      const reachable = new Set<number>(),
        pending = [bodyEntry];
      while (pending.length) {
        const at = pending.pop()!;
        if (at === header || at === exit || reachable.has(at) || !body.has(at)) continue;
        reachable.add(at);
        pending.push(...(outgoing.get(at) ?? []));
      }
      for (const at of body) if (!reachable.has(at)) body.delete(at);
      sequence = sequence.filter((i) => body.has(i.address));
    }
    // The selected node and owner identities must survive the path to the first guard or body entry.
    const entryPaths = [...(outgoing.get(head.address) ?? [])],
      entrySeen = new Set<number>();
    while (entryPaths.length) {
      const at = entryPaths.pop()!;
      if (at === header || at === bodyEntry || entrySeen.has(at)) continue;
      entrySeen.add(at);
      const instruction = instructions.get(at);
      if (
        !instruction ||
        (writesFirst(instruction) &&
          register(instruction.operands[0]) &&
          [owner, node.name].includes(whole(instruction.operands[0].name))) ||
        instruction.mnemonic === "xchg" ||
        (instruction.flow === "call" && [owner, node.name].some((name) => volatile.includes(name)))
      ) {
        invalid = true;
        break;
      }
      entryPaths.push(...(outgoing.get(at) ?? []));
    }
    if (invalid) continue;
    const queries = code.calls
      .filter(
        (call) =>
          call.instruction < head.address &&
          call.target &&
          helpers.get(call.target.address)?.list?.excludesArgument &&
          helpers.get(call.target.address)?.list?.headField === headField &&
          helpers.get(call.target.address)?.list?.nextField === nextField,
      )
      .filter((call) => {
        let push = before.get(call.instruction);
        while (push?.mnemonic === "nop") push = before.get(push.address);
        if (push?.mnemonic === "push" && register(push.operands[0], "cs")) push = before.get(push.address);
        while (push?.mnemonic === "nop") push = before.get(push.address);
        if (push?.mnemonic !== "push") return false;
        const argument = push.operands[0];
        const stackOwner =
          memory(argument) &&
          argument.segment === "ss" &&
          argument.base.join() === "bp" &&
          argument.displacement === argumentOffset;
        return stackOwner || (!volatile.includes(owner) && register(argument, owner));
      });
    const externalSource = !globalSource && !queries.length && externalEntry?.headInstruction === head.address;
    if (!globalSource && !externalSource && !queries.length) continue;
    const querySites = new Set(queries.map((call) => call.instruction));
    const uncovered = globalSource || externalSource ? [] : [code.address],
      uncoveredSeen = new Set<number>();
    while (uncovered.length) {
      const at = uncovered.pop()!;
      if (querySites.has(at) || uncoveredSeen.has(at)) continue;
      if (at === head.address) {
        invalid = true;
        break;
      }
      uncoveredSeen.add(at);
      uncovered.push(...(outgoing.get(at) ?? []));
    }
    if (invalid) continue;
    // Each alternative query refreshes the same list. Every path to the head must cross one of them.
    const reachesHead = new Set([head.address]),
      reverse = [head.address];
    while (reverse.length)
      for (const previous of incoming.get(reverse.pop()!) ?? []) {
        if (querySites.has(previous) || reachesHead.has(previous)) continue;
        reachesHead.add(previous);
        reverse.push(previous);
      }
    const between = queries.flatMap((call) => outgoing.get(call.instruction) ?? []),
      betweenSeen = new Set<number>();
    while (between.length) {
      const at = between.pop()!;
      if (at === head.address || querySites.has(at) || !reachesHead.has(at) || betweenSeen.has(at)) continue;
      betweenSeen.add(at);
      const i = instructions.get(at)!;
      if (i.flow === "call") {
        const call = code.calls.find((call) => call.instruction === at),
          callee = call?.target && helpers.get(call.target.address);
        if (!callee?.footprint.preservesArgumentMemory) {
          invalid = true;
          break;
        }
      }
      if (writesFirst(i) && memory(i.operands[0]) && i.operands[0].segment !== "ss") {
        invalid = true;
        break;
      }
      between.push(...(outgoing.get(at) ?? []));
    }
    if (invalid) continue;
    const query = queries[0];
    const globalHead = globalSource ? head.operands[1].displacement : undefined;
    const globalProofs = globalSource ? [globalHeads.get(globalHead!)!, globalLinks.get(nextField)!] : [];
    const fields: LoopField[] = [],
      changed = new Set([node.name]);
    let unknownGlobals = false;
    const assumptions = new Set([
      ...queries.flatMap((call) => helpers.get(call.target!.address)!.list!.assumptions),
      ...(externalSource
        ? [
            "This is a conditional external-list contract. Its caller must establish a finite acyclic list of complete distinct part bases, excluding the argument owner, with unchanged next links.",
          ]
        : []),
      ...globalProofs.flatMap((helper) => helper.assumptions),
      ...(stateIsNonzero
        ? [
            "The owner state at the loop header is nonzero. Every reachable body write and helper preserves that state; zero-state-only paths are excluded by their decoded comparisons.",
          ]
        : []),
      globalSource
        ? "The discovered global part list is finite and acyclic, with complete part objects and unchanged next links. It may contain the owner; the body writes only owner fields outside both state and next-link storage."
        : "The overlap query's finite list is acyclic, its nodes are complete distinct part objects, and no body operation changes the traversed next links.",
      ...(globalSource
        ? []
        : [
            "The query excludes the owner. Writes to a listed object's state therefore do not change the owner's state.",
          ]),
      "Private stack and global storage are separate from part objects. The C calling convention preserves SI, DI, BP and DS.",
    ]);
    const proof = [
      ...boundedSearches.filter((s) => s.body.every((at) => body.has(at))).flatMap((s) => s.evidence),
      ...stateProof,
      evidence(head),
      evidence(ownerDefinition),
      ...globalProofs.flatMap((helper) => helper.evidence),
      ...queries.flatMap((call) => [...call.evidence, ...helpers.get(call.target!.address)!.list!.evidence]),
    ];
    if (boundedSearches.some((s) => s.body.every((at) => body.has(at))))
      assumptions.add(
        "Nested switch-key searches reload a positive bounded CX and perform no memory writes; their LOOP back edges terminate without changing the owner or list links.",
      );
    const rootsAt = new Map<number, Map<string, "part" | "other" | "unknown">>([
      [
        bodyEntry,
        new Map([
          [owner, "part"],
          [node.name, "other"],
        ]),
      ],
    ]);
    const work = [bodyEntry];
    const stackDeltas = new Map<number, number>([[bodyEntry, 0]]);
    let budget = body.size * 16;
    while (work.length && !invalid && budget-- > 0) {
      const at = work.pop()!;
      if (at === header || at === exit) {
        if (stackDeltas.get(at) !== 0) invalid = true;
        continue;
      }
      const i = instructions.get(at)!,
        roots = new Map(rootsAt.get(at)!);
      const [dest, source] = i.operands;
      let delta = stackDeltas.get(at)!;
      const rootOf = (op: Operand | undefined) => (register(op) ? roots.get(op.name) : undefined);
      if (
        i.mnemonic === "xchg" ||
        /^(movs|stos|lods|scas|cmps|ins|outs|int|iret|enter|leave|pusha|popa|esc)/.test(i.mnemonic)
      ) {
        invalid = true;
        break;
      }
      if (i.mnemonic === "push") delta -= 2;
      if (i.mnemonic === "pop") delta += 2;
      if (["add", "sub"].includes(i.mnemonic) && register(dest, "sp") && immediate(source))
        delta += source.value * (i.mnemonic === "add" ? 1 : -1);
      if (i.flow === "call") {
        const call = code.calls.find((call) => call.instruction === at),
          callee = call?.target && helpers.get(call.target.address);
        if (
          !callee ||
          (!callee.footprint.complete &&
            !callee.footprint.partMemoryComplete &&
            !callee.footprint.preservesArgumentMemory) ||
          callee.list ||
          callee.partGraph ||
          callee.footprint.unknownPartEffects?.length ||
          (!callee.returnConvention &&
            callee.evidence.some(
              (item) => (item.bytes[0] === 0xca || item.bytes[0] === 0xc2) && item.bytes.length === 3,
            ))
        ) {
          invalid = true;
          break;
        }
        let argument = before.get(at);
        while (argument?.mnemonic === "nop") argument = before.get(argument.address);
        const pushedSegment = argument?.mnemonic === "push" && register(argument.operands[0], "cs");
        if (callee.returnConvention) {
          if (
            (call!.far && callee.returnConvention.kind !== "far") ||
            (!call!.far && callee.returnConvention.kind === "far" && !pushedSegment)
          ) {
            invalid = true;
            break;
          }
          delta += callee.returnConvention.stackBytes;
        }
        if (pushedSegment) {
          if (!call!.far && (callee.returnConvention?.kind === "far" || callee.argumentOffset === 6)) delta += 2;
          argument = before.get(argument!.address);
        }
        while (argument?.mnemonic === "nop") argument = before.get(argument.address);
        const argumentRoot = argument?.mnemonic === "push" ? rootOf(argument.operands[0]) : undefined;
        const privateOutput =
          callee.kind === "argument-buffer-update" ? privateStackOutputs(code, call!, callee) : undefined;
        if (privateOutput) {
          for (const output of privateOutput.outputs)
            fields.push({
              root: "stack",
              object: "stack",
              ...output,
              operand: {
                kind: "memory",
                segment: "ss",
                base: ["bp"],
                displacement: output.offset,
                direct: false,
                width: output.width === 8 ? 8 : 16,
              },
            });
          proof.push(...privateOutput.evidence);
          for (const assumption of privateOutput.assumptions) assumptions.add(assumption);
        }
        for (const write of privateOutput ? [] : callee.writes) {
          if (write.root === "global") {
            unknownGlobals = true;
            continue;
          }
          if (write.argumentOffset !== undefined && write.argumentOffset !== callee.argumentOffset) {
            invalid = true;
            break;
          }
          if (write.path.length && !write.separateStorage && overlaps(write.offset, write.width, nextField)) {
            invalid = true;
            break;
          }
          if (write.root !== "argument" || !argumentRoot || argumentRoot === "unknown") {
            invalid = true;
            break;
          }
          // An indirect write can reach the owner, so retain a possible owner-field modification.
          const root = write.separateStorage === "outline" ? "buffer" : write.path.length ? "part" : argumentRoot;
          if (
            (globalSource && root === "other") ||
            ((root === "other" || (globalSource && root === "part")) && overlaps(write.offset, write.width, nextField))
          ) {
            invalid = true;
            break;
          }
          if (root === "part" && overlaps(write.offset, write.width, stateOffset)) {
            invalid = true;
            break;
          }
          fields.push({ object: root, root, offset: write.offset, width: write.width });
        }
        if (invalid) break;
        unknownGlobals ||= !!callee.footprint.unknownGlobalEffects?.length;
        for (const assumption of callee.assumptions) assumptions.add(assumption);
        proof.push(...callee.evidence);
        for (const name of volatile) {
          roots.set(name, "unknown");
          changed.add(name);
        }
      }
      if (writesFirst(i) && memory(dest)) {
        if (local(dest))
          fields.push({
            root: "stack",
            object: "stack",
            offset: dest.displacement,
            width: dest.width,
            operand: dest,
            ...(i.mnemonic === "mov" && dest.width === 16 && (rootOf(source) === "other" || immediate(source, 0))
              ? { nullableMember: true }
              : {}),
          });
        else if (dest.segment === "ds" && dest.direct) {
          fields.push({ root: "global", object: "data", offset: dest.displacement, width: dest.width });
          unknownGlobals = true;
        } else if (dest.segment === "ds" && dest.base.length === 1) {
          const root = roots.get(dest.base[0]!);
          if (
            !root ||
            root === "unknown" ||
            (root === "part" && overlaps(dest.displacement, dest.width, stateOffset)) ||
            (globalSource && root === "other") ||
            ((root === "other" || (globalSource && root === "part")) &&
              overlaps(dest.displacement, dest.width, nextField))
          ) {
            invalid = true;
            break;
          }
          fields.push({ object: root, root, offset: dest.displacement, width: dest.width, operand: dest });
        } else {
          invalid = true;
          break;
        }
      }
      if (writesFirst(i) && register(dest)) {
        if (
          ["ds", "ss", "bp"].includes(dest.name) ||
          (dest.name === "sp" && !(["add", "sub"].includes(i.mnemonic) && immediate(source)))
        ) {
          invalid = true;
          break;
        }
        changed.add(whole(dest.name));
        const reloadsOwner =
          memory(source) &&
          source.segment === "ss" &&
          source.base.join() === "bp" &&
          source.displacement === argumentOffset;
        roots.set(
          whole(dest.name),
          i.mnemonic === "mov"
            ? reloadsOwner
              ? "part"
              : (rootOf(source) ?? (progress.has(at) ? "other" : "unknown"))
            : "unknown",
        );
      }
      if (["mul", "imul", "div", "idiv", "cwd", "cbw"].includes(i.mnemonic))
        for (const name of ["ax", "dx"]) {
          roots.set(name, "unknown");
          changed.add(name);
        }
      for (const next of outgoing.get(at) ?? []) {
        const oldDelta = stackDeltas.get(next);
        if (oldDelta !== undefined && oldDelta !== delta) {
          invalid = true;
          break;
        }
        stackDeltas.set(next, delta);
        const old = rootsAt.get(next);
        const joined = old
          ? new Map(
              [...new Set([...old.keys(), ...roots.keys()])].map((name) => [
                name,
                old.get(name) === roots.get(name) ? old.get(name)! : ("unknown" as const),
              ]),
            )
          : roots;
        if (!old || [...joined].some(([name, root]) => old.get(name) !== root)) {
          rootsAt.set(next, joined);
          work.push(next);
        }
      }
    }
    if (invalid || work.length) continue;
    changed.delete("sp");
    result.push({
      ...(stateIsNonzero
        ? {
            condition: {
              kind: "compare" as const,
              operator: "!=",
              left: { kind: "field" as const, object: "part", offset: stateOffset, width: 16 },
              right: { kind: "constant" as const, value: 0, width: 16 },
              signed: false,
            },
          }
        : {}),
      header,
      bodyEntry,
      body: [...body].sort((a, b) => a - b),
      exit,
      nodeRegister: node.name,
      nextField,
      source: globalSource ? "global-list" : externalSource ? "external-list" : "overlap-query",
      ...(globalSource ? { globalHead } : { headField }),
      ownerRegister: owner,
      ...(query ? { query: query.instruction } : {}),
      queries: queries.map((call) => call.instruction),
      possibleFields: [...new Map(fields.map((field) => [JSON.stringify(field), field])).values()],
      writtenRegisters: [...changed],
      unknownGlobals,
      exitOnNullOnly: ![...body].some((at) => (outgoing.get(at) ?? []).includes(exit)),
      confidence: "inferred",
      assumptions: [...assumptions],
      evidence: [
        ...new Map(
          [...proof, ...sequence.map(evidence), evidence(guard), evidence(branch)].map((item) => [item.address, item]),
        ).values(),
      ],
    });
  }
  return result;
}
