/** Names object storage by the data flow it participates in, retaining separate meanings in each part's code. */
import type { FieldContext, LayoutField } from "./behaviour-layout.ts";
import { readRoutineCode, type RoutineCode } from "./behaviour-code.ts";
import { findDataSegment, RECORD_SIZE } from "./type-table.ts";
import type { Instruction, Operand } from "./x86.ts";
import { implicitRegisterWrites, isRegister, memoryOperand, wholeRegister } from "./behaviour-terms.ts";

interface RoutineContext {
  code: RoutineCode;
  uses: { partType: number; role: string }[];
}
const registers = ["ax", "bx", "cx", "dx", "si", "di", "bp", "sp"];
const bit = (name: string) => 1 << registers.indexOf(name);
const evidence = (instructions: Instruction[]) =>
  instructions.map(({ address, bytes, text }) => ({ address, bytes, text }));
const immediate = (operand: Operand | undefined, value?: number) =>
  operand?.kind === "immediate" && (value === undefined || operand.value === value);
const contiguous = (instructions: Instruction[]) =>
  instructions.every(
    (instruction, index) =>
      index === 0 || instructions[index - 1]!.address + instructions[index - 1]!.size === instruction.address,
  );
const sameMemory = (a: Operand | undefined, b: Operand | undefined) =>
  a?.kind === "memory" &&
  b?.kind === "memory" &&
  a.segment === b.segment &&
  a.width === b.width &&
  a.displacement === b.displacement &&
  a.base.join() === b.base.join();
const objectMemory = (operand: Operand | undefined, base?: string) => {
  const value = memoryOperand(operand);
  return value?.segment === "ds" && value.base.length === 1 && (base === undefined || value.base[0] === base)
    ? value
    : undefined;
};

/** A register is accepted only when every decoded incoming path preserves the same first-argument identity. */
function objectRegisters(code: RoutineCode): Map<number, number> {
  const states = new Map<number, number>([[code.address, 0]]);
  const pending = [code.address];
  const instructions = new Map(code.instructions.map((instruction) => [instruction.address, instruction]));
  const outgoing = new Map<number, number[]>();
  for (const edge of code.edges)
    if (edge.to !== null) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  let budget = code.instructions.length * 16;
  while (pending.length && budget-- > 0) {
    const at = pending.pop()!;
    const instruction = instructions.get(at);
    if (!instruction) continue;
    let state = states.get(at)!;
    const [destination, source] = instruction.operands;
    if (instruction.flow === "call") for (const name of ["ax", "bx", "cx", "dx"]) state &= ~bit(name);
    else if (destination?.kind === "register" && !["cmp", "test", "push"].includes(instruction.mnemonic)) {
      const name = wholeRegister(destination.name);
      if (registers.includes(name)) {
        const isArgument =
          instruction.mnemonic === "mov" &&
          source?.kind === "memory" &&
          source.segment === "ss" &&
          source.base.join() === "bp" &&
          source.displacement === 6;
        const isCopy =
          instruction.mnemonic === "mov" &&
          source?.kind === "register" &&
          registers.includes(source.name) &&
          (state & bit(source.name)) !== 0;
        state = destination.width === 16 && (isArgument || isCopy) ? state | bit(name) : state & ~bit(name);
      } else if (destination.name === "ds") state = 0;
    }
    for (const name of implicitRegisterWrites(instruction)) state &= ~bit(name);
    for (const next of outgoing.get(at) ?? []) {
      const previous = states.get(next);
      const merged = previous === undefined ? state : previous & state;
      if (previous !== merged) {
        states.set(next, merged);
        pending.push(next);
      }
    }
  }
  return states;
}

/**
 * Discovers additional fields through the actual callback records and reachable helpers. Offsets are operands of
 * matched instructions; the requested names are never selected by an offset from a particular executable build.
 */
export function discoverObjectFieldRoles(
  image: Uint8Array,
  table: number,
  typeCount: number,
  callbacks: { field: number; role: string; objectSource?: { path: number[]; evidence: LayoutField["evidence"] } }[],
  known: LayoutField[],
  {
    records,
    recordSize = RECORD_SIZE,
    routine: follow = (segment, offset) => ({ segment, offset, address: segment * 16 + offset }),
  }: {
    records?: number[];
    recordSize?: number;
    routine?: (segment: number, offset: number) => { segment: number; offset: number; address: number };
  } = {},
): LayoutField[] {
  if (!Number.isInteger(typeCount) || typeCount < 0 || table < 0 || table + recordSize * typeCount > image.length)
    throw new Error("Object field discovery needs an in-image type table and its checked record count");
  const ds = findDataSegment(image);
  const word = (at: number) => image[at]! | (image[at + 1]! << 8);
  const routines = new Map<number, RoutineContext>();
  const pending: { address: number; segment: number; offset: number }[] = [];
  for (let partType = 0; partType < typeCount; partType++)
    for (const callback of callbacks) {
      const at = (records?.[partType] ?? table + partType * recordSize) + callback.field;
      if (!word(at) && !word(at + 2)) continue;
      const { segment, offset, address } = follow(word(at + 2), word(at));
      if (address >= image.length) continue;
      let routine = routines.get(address);
      if (!routine) {
        routine = { code: readRoutineCode(image, { address, segment, offset }, ds), uses: [] };
        routines.set(address, routine);
        pending.push(...routine.code.calls.flatMap((call) => (call.target ? [call.target] : [])));
      }
      routine.uses.push({ partType, role: callback.role });
    }
  while (pending.length && routines.size < 1800) {
    const entry = pending.pop()!;
    if (entry.address >= image.length || routines.has(entry.address)) continue;
    const routine = { code: readRoutineCode(image, entry, ds), uses: [] };
    routines.set(entry.address, routine);
    pending.push(...routine.code.calls.flatMap((call) => (call.target ? [call.target] : [])));
  }
  const fields = new Map<number, LayoutField>();
  const add = (
    offset: number,
    name: string,
    description: string,
    instructions: Instruction[],
    assumptions: string[],
    context?: { routine: number; partType?: number; name?: string; description?: string },
  ) => {
    if (known.some((field) => field.offset === offset)) return;
    let field = fields.get(offset);
    if (!field) {
      field = { offset, name, description, confidence: "inferred", evidence: [], assumptions, contexts: [] };
      fields.set(offset, field);
    }
    for (const item of evidence(instructions))
      if (!field.evidence.some((previous) => previous.address === item.address)) field.evidence.push(item);
    if (context) {
      const finding: FieldContext = {
        routine: context.routine,
        ...(context.partType === undefined ? {} : { partType: context.partType }),
        name: context.name ?? name,
        description: context.description ?? description,
        confidence: "inferred",
        assumptions,
        evidence: evidence(instructions),
      };
      if (
        !field.contexts!.some(
          (previous) =>
            previous.routine === finding.routine &&
            previous.partType === finding.partType &&
            previous.name === finding.name,
        )
      )
        field.contexts!.push(finding);
    }
  };
  const coordinate = new Map<string, number | undefined>();
  for (const { code } of routines.values()) {
    const instructions = code.instructions;
    for (let k = 0; k + 1 < instructions.length; k++) {
      const pair = instructions.slice(k, k + 2);
      const [load, store] = pair as [Instruction, Instruction];
      const source = objectMemory(load.operands[1]);
      const destination = objectMemory(store.operands[0]);
      if (
        !contiguous(pair) ||
        load.mnemonic !== "mov" ||
        store.mnemonic !== "mov" ||
        !source ||
        !destination ||
        source.base.join() !== destination.base.join() ||
        !isRegister(load.operands[0]) ||
        !isRegister(store.operands[1], load.operands[0]?.kind === "register" ? load.operands[0].name : "")
      )
        continue;
      for (const [draw, name] of [
        ["drawX", "positionX"],
        ["drawY", "positionY"],
      ] as const) {
        if (
          known.find((field) => field.name === draw)?.offset !== destination.displacement ||
          source.displacement === destination.displacement
        )
          continue;
        coordinate.set(
          name,
          !coordinate.has(name) || coordinate.get(name) === source.displacement ? source.displacement : undefined,
        );
        add(
          source.displacement,
          name,
          `The object's ${name === "positionX" ? "horizontal" : "vertical"} position is copied into the renderer's drawing origin.`,
          pair,
          ["The copied coordinate is the object position before frame placement adjusts the drawing origin."],
          { routine: code.address },
        );
      }
    }
  }
  // Displacement differences scaled into a field identify motion along the corresponding discovered coordinate.
  for (const { code } of routines.values())
    for (let k = 0; k + 5 < code.instructions.length; k++) {
      const sequence = code.instructions.slice(k, k + 6);
      if (!contiguous(sequence)) continue;
      const [load, subtract, store, count, adjust, shift] = sequence as [
        Instruction,
        Instruction,
        Instruction,
        Instruction,
        Instruction,
        Instruction,
      ];
      const position = objectMemory(load.operands[1]);
      const previous = objectMemory(subtract.operands[1], position?.base[0]);
      const velocity = objectMemory(store.operands[0], position?.base[0]);
      if (
        load.mnemonic !== "mov" ||
        !isRegister(load.operands[0], "ax") ||
        !position ||
        subtract.mnemonic !== "sub" ||
        !isRegister(subtract.operands[0], "ax") ||
        !previous ||
        store.mnemonic !== "mov" ||
        !isRegister(store.operands[1], "ax") ||
        !velocity ||
        count.mnemonic !== "mov" ||
        !isRegister(count.operands[0], "cl") ||
        !immediate(count.operands[1]) ||
        adjust.mnemonic !== "sub" ||
        !isRegister(adjust.operands[0], "cl") ||
        adjust.operands[1]?.kind !== "memory" ||
        shift.mnemonic !== "shl" ||
        !sameMemory(shift.operands[0], velocity) ||
        !isRegister(shift.operands[1], "cl")
      )
        continue;
      for (const [axis, name] of [
        ["positionX", "velocityX"],
        ["positionY", "velocityY"],
      ] as const)
        if (coordinate.get(axis) === position.displacement) {
          add(
            velocity.displacement,
            name,
            `A scaled change in ${axis} supplies the ${axis === "positionX" ? "horizontal" : "vertical"} motion component.`,
            sequence,
            [
              "Position difference and variable left scaling establish a velocity-like fixed-point component; its units need the caller's time argument.",
            ],
            { routine: code.address },
          );
          add(
            previous.displacement,
            axis === "positionX" ? "previousX" : "previousY",
            `The previous ${axis === "positionX" ? "horizontal" : "vertical"} position is subtracted from the current position to obtain motion.`,
            sequence,
            [
              "The subtracted position is the reference position for this motion calculation; its complete refresh lifecycle is not established.",
            ],
            { routine: code.address },
          );
        }
    }
  const counterContexts = new Map<
    number,
    { routine: RoutineContext; access: Instruction[]; name: string; description: string }[]
  >();
  for (const routine of routines.values()) {
    if (!routine.uses.some((use) => use.role === "run")) continue;
    const identities = objectRegisters(routine.code);
    const partMemory = (instruction: Instruction, operand: Operand | undefined) => {
      const field = objectMemory(operand);
      return field && ((identities.get(instruction.address) ?? 0) & bit(field.base[0]!)) !== 0 ? field : undefined;
    };
    const updates = routine.code.instructions.filter(
      (instruction) =>
        ["inc", "dec"].includes(instruction.mnemonic) && partMemory(instruction, instruction.operands[0]),
    );
    for (const update of updates) {
      const field = partMemory(update, update.operands[0])!;
      if (known.some((knownField) => knownField.offset === field.displacement)) continue;
      const comparisons = routine.code.instructions.filter(
        (instruction) =>
          instruction.mnemonic === "cmp" &&
          partMemory(instruction, instruction.operands[0])?.displacement === field.displacement &&
          immediate(instruction.operands[1]),
      );
      if (!comparisons.length) continue;
      const limits = [
        ...new Set(
          comparisons.flatMap((instruction) =>
            instruction.operands[1]?.kind === "immediate" ? [instruction.operands[1].value] : [],
          ),
        ),
      ].sort((a, b) => a - b);
      const name = update.mnemonic === "inc" ? "tickCounter" : "countdown";
      const description = `${update.mnemonic === "inc" ? "Increases" : "Decreases"} on a run path and is compared with ${limits.join(", ")}; path conditions decide whether an invocation changes it.`;
      counterContexts.set(field.displacement, [
        ...(counterContexts.get(field.displacement) ?? []),
        { routine, access: [update, ...comparisons], name, description },
      ]);
    }
  }
  for (const [offset, contexts] of counterContexts) {
    for (const context of contexts)
      for (const use of context.routine.uses.filter((use) => use.role === "run"))
        add(
          offset,
          "contextCounter",
          "A reused object slot acts as a run counter or a control gate, with its meaning retained separately for each part.",
          context.access,
          [
            "The arithmetic and comparison establish counter use in these routines, not one global physical quantity or a constant tick rate.",
          ],
          {
            routine: context.routine.code.address,
            partType: use.partType,
            name: context.name,
            description: context.description,
          },
        );
    for (const routine of routines.values()) {
      if (!routine.uses.some((use) => use.role === "run") || contexts.some((context) => context.routine === routine))
        continue;
      const identities = objectRegisters(routine.code);
      const gates = routine.code.instructions.filter(
        (instruction) =>
          instruction.mnemonic === "cmp" &&
          immediate(instruction.operands[1], 0) &&
          objectMemory(instruction.operands[0])?.displacement === offset &&
          ((identities.get(instruction.address) ?? 0) & bit(objectMemory(instruction.operands[0])!.base[0]!)) !== 0,
      );
      if (!gates.length) continue;
      for (const use of routine.uses.filter((use) => use.role === "run"))
        add(
          offset,
          "contextCounter",
          "A reused object slot acts as a run counter or a control gate, with its meaning retained separately for each part.",
          gates,
          ["A zero test establishes a gate here; a counter interpretation is not assumed in this part."],
          {
            routine: routine.code.address,
            partType: use.partType,
            name: "controlGate",
            description:
              "A run path tests this slot against zero without a matched increment or decrement in this routine.",
          },
        );
    }
  }
  // Stored dimensions are restored together by a flip callback; this does not prove that they are rest dimensions.
  for (const { code, uses } of routines.values()) {
    if (!uses.some((use) => use.role === "flip" || use.role === "resize")) continue;
    for (let k = 0; k + 3 < code.instructions.length; k++) {
      const sequence = code.instructions.slice(k, k + 4);
      if (!contiguous(sequence)) continue;
      const copies: { source: number; destination: number }[] = [];
      for (let n = 0; n < 4; n++) {
        const load = sequence[n]!;
        const source = objectMemory(load.operands[1]);
        if (load.mnemonic !== "mov" || !source || !isRegister(load.operands[0])) continue;
        for (let m = n + 1; m < 4; m++) {
          const store = sequence[m]!;
          const destination = objectMemory(store.operands[0], source.base[0]);
          if (
            store.mnemonic === "mov" &&
            destination &&
            isRegister(store.operands[1], load.operands[0]?.kind === "register" ? load.operands[0].name : "")
          )
            copies.push({ source: source.displacement, destination: destination.displacement });
          if (
            store.operands[0]?.kind === "register" &&
            load.operands[0]?.kind === "register" &&
            store.operands[0].name === load.operands[0].name
          )
            break;
        }
      }
      for (const [dimension, name] of [
        ["frameWidth", "baseWidth"],
        ["frameHeight", "baseHeight"],
      ] as const) {
        const source = copies.find(
          (copy) => copy.destination === known.find((field) => field.name === dimension)?.offset,
        );
        const other = copies.find(
          (copy) =>
            copy.destination ===
            known.find((field) => field.name === (dimension === "frameWidth" ? "frameHeight" : "frameWidth"))?.offset,
        );
        if (!source || !other || source.source === source.destination) continue;
        for (const use of uses)
          add(
            source.source,
            name,
            `A stored ${dimension === "frameWidth" ? "width" : "height"} is copied into the current frame dimensions during flip or resize restoration.`,
            sequence,
            [
              "The code proves a source dimension, not whether it originated in the level, initial placement or a rest state.",
            ],
            { routine: code.address, partType: use.partType },
          );
      }
    }
  }
  // The contact producer stores the other object, a half-turn adjusted angle, and a zero-based boundary-loop index.
  for (const { code } of routines.values())
    for (let k = 0; k + 5 < code.instructions.length; k++) {
      let sequence = code.instructions.slice(k, k + 6);
      const possibleReload = sequence[5]!;
      if (
        possibleReload.mnemonic === "mov" &&
        isRegister(possibleReload.operands[0], "bx") &&
        sameMemory(possibleReload.operands[1], sequence[0]!.operands[1])
      )
        sequence = code.instructions.slice(k, k + 7);
      if (!contiguous(sequence)) continue;
      const [base, other, link, angle, turn] = sequence as [
        Instruction,
        Instruction,
        Instruction,
        Instruction,
        Instruction,
        ...Instruction[],
      ];
      const angleStore = sequence.at(-1)!;
      if (
        base.mnemonic !== "mov" ||
        !isRegister(base.operands[0], "bx") ||
        memoryOperand(base.operands[1])?.direct !== true ||
        other.mnemonic !== "mov" ||
        !isRegister(other.operands[0], "ax") ||
        memoryOperand(other.operands[1])?.direct !== true ||
        link.mnemonic !== "mov" ||
        !isRegister(link.operands[1], "ax") ||
        !objectMemory(link.operands[0], "bx") ||
        angle.mnemonic !== "mov" ||
        !isRegister(angle.operands[0], "ax") ||
        memoryOperand(angle.operands[1])?.segment !== "ss" ||
        turn.mnemonic !== "add" ||
        !isRegister(turn.operands[0], "ax") ||
        !immediate(turn.operands[1], 0x8000) ||
        angleStore.mnemonic !== "mov" ||
        !isRegister(angleStore.operands[1], "ax") ||
        !objectMemory(angleStore.operands[0], "bx")
      )
        continue;
      let edgeSequence: Instruction[] | undefined;
      for (let n = k + sequence.length; n < Math.min(code.instructions.length - 4, k + 40); n++) {
        const candidate = code.instructions.slice(n, n + 5);
        const [load, decrement, reload, store, after] = candidate as [
          Instruction,
          Instruction,
          Instruction,
          Instruction,
          Instruction,
        ];
        if (
          contiguous(candidate) &&
          load.mnemonic === "mov" &&
          isRegister(load.operands[0], "ax") &&
          memoryOperand(load.operands[1])?.segment === "ss" &&
          decrement.mnemonic === "dec" &&
          isRegister(decrement.operands[0], "ax") &&
          reload.mnemonic === "mov" &&
          isRegister(reload.operands[0], "bx") &&
          sameMemory(reload.operands[1], base.operands[1]) &&
          store.mnemonic === "mov" &&
          isRegister(store.operands[1], "ax") &&
          objectMemory(store.operands[0], "bx") &&
          after.mnemonic === "mov"
        ) {
          edgeSequence = candidate.slice(0, 4);
          break;
        }
      }
      if (!edgeSequence) continue;
      const ownerSource = callbacks.find((callback) => callback.role === "bounce")?.objectSource;
      if (
        ownerSource &&
        (ownerSource.path.length !== 1 || ownerSource.path[0] !== objectMemory(link.operands[0])!.displacement)
      )
        continue;
      const loopIndex = edgeSequence[0]!.operands[1];
      const increments = code.instructions.filter(
        (instruction) => instruction.mnemonic === "inc" && sameMemory(instruction.operands[0], loopIndex),
      );
      const compares = code.instructions.filter(
        (instruction) => instruction.mnemonic === "cmp" && sameMemory(instruction.operands[1], loopIndex),
      );
      if (!increments.length || !compares.length) continue;
      const proof = [...sequence, ...edgeSequence, ...increments, ...compares];
      const assumptions = [
        "The same contact producer links another object, reverses a boundary orientation by half a turn and records a zero-based boundary-loop index.",
        "The exact contact geometry and which side owns the boundary remain inferred from this producer and callback uses.",
      ];
      add(
        objectMemory(link.operands[0])!.displacement,
        "contactPart",
        "A contact producer stores the other object pointer for interaction callbacks.",
        proof,
        assumptions,
        { routine: code.address },
      );
      add(
        objectMemory(angleStore.operands[0])!.displacement,
        "contactAngle",
        "A contact producer stores a boundary orientation reversed by half a 16-bit turn.",
        proof,
        assumptions,
        { routine: code.address },
      );
      add(
        objectMemory(edgeSequence[3]!.operands[0])!.displacement,
        "contactEdge",
        "A contact producer stores the zero-based index from its bounded boundary traversal.",
        proof,
        assumptions,
        { routine: code.address },
      );
      if (ownerSource)
        for (const offset of [
          objectMemory(link.operands[0])!.displacement,
          objectMemory(angleStore.operands[0])!.displacement,
          objectMemory(edgeSequence[3]!.operands[0])!.displacement,
        ]) {
          const field = fields.get(offset);
          if (field)
            for (const item of ownerSource.evidence)
              if (!field.evidence.some((previous) => previous.address === item.address)) field.evidence.push(item);
        }
    }
  // Adjacent coordinate bytes and a word at +2 establish a four-byte outline record, not a linked part.
  for (const { code } of routines.values()) {
    const identities = objectRegisters(code);
    for (const load of code.instructions) {
      const source = objectMemory(load.operands[1]);
      if (
        load.mnemonic !== "mov" ||
        !isRegister(load.operands[0]) ||
        !source ||
        source.width !== 16 ||
        ((identities.get(load.address) ?? 0) & bit(source.base[0]!)) === 0
      )
        continue;
      const point = load.operands[0].name;
      const reads = code.instructions.filter(
        (instruction) =>
          instruction.mnemonic === "mov" &&
          objectMemory(instruction.operands[1], point)?.width === 8 &&
          [0, 1, 4, 5].includes(objectMemory(instruction.operands[1], point)!.displacement),
      );
      const offsets = new Set(reads.map((instruction) => objectMemory(instruction.operands[1], point)!.displacement));
      const advance = code.instructions.find(
        (instruction) =>
          instruction.mnemonic === "add" &&
          isRegister(instruction.operands[0], point) &&
          immediate(instruction.operands[1], 4),
      );
      const orientation = code.instructions.find(
        (instruction) =>
          instruction.mnemonic === "mov" &&
          objectMemory(instruction.operands[0], point)?.width === 16 &&
          objectMemory(instruction.operands[0], point)?.displacement === 2,
      );
      if (!advance || !orientation || ![0, 1, 4, 5].every((offset) => offsets.has(offset))) continue;
      const countLoads = code.instructions.filter(
        (instruction) =>
          instruction.mnemonic === "mov" &&
          isRegister(instruction.operands[0], "ax") &&
          objectMemory(instruction.operands[1], source.base[0])?.width === 16 &&
          ((identities.get(instruction.address) ?? 0) & bit(source.base[0]!)) !== 0,
      );
      const bound = countLoads.find((instruction) => {
        const next = code.instructions.find(
          (candidate) => candidate.address === instruction.address + instruction.size,
        );
        return (
          next?.mnemonic === "cmp" &&
          isRegister(next.operands[0], "ax") &&
          memoryOperand(next.operands[1])?.segment === "ss" &&
          code.instructions.some(
            (candidate) =>
              candidate.address === next.address + next.size &&
              candidate.flow === "branch" &&
              candidate.target &&
              candidate.target.address < load.address + 16,
          )
        );
      });
      if (!bound) continue;
      const proof = [load, ...reads, advance, orientation, bound];
      const assumptions = [
        "The adjacent byte coordinates, four-byte stride and edge-word update identify separate outline storage; allocation size and full numeric orientation semantics remain separate evidence.",
      ];
      add(
        source.displacement,
        "outlinePoints",
        "A pointer to four-byte outline records: two coordinate bytes followed by a derived edge word.",
        proof,
        assumptions,
        { routine: code.address },
      );
      add(
        objectMemory(bound.operands[1])!.displacement,
        "outlinePointCount",
        "The number bounding traversal of the outline records.",
        proof,
        assumptions,
        { routine: code.address },
      );
    }
  }
  for (const field of fields.values()) {
    const alternatives = [...fields.values()].filter(
      (other) => other.name === field.name && other.offset !== field.offset,
    );
    if (field.name !== "contextCounter" && alternatives.length) {
      field.confidence = "unresolved";
      field.assumptions.push(
        "More than one object offset matches this role; the candidates remain separate rather than choosing one.",
      );
    }
  }
  if (pending.length)
    for (const field of fields.values())
      field.assumptions.push(
        "The helper discovery budget was reached; unvisited contexts may use this slot differently.",
      );
  return [...fields.values()].sort((a, b) => a.offset - b.offset);
}
