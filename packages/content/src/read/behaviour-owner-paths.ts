/**
 * The conditions under which a small helper's stores to its part happen. A helper like the mouse motor's start
 * (`0x1c074` in Even More, English floppy) tests its part's fields and picks what to store: the step is -1 when the part
 * is mirrored and 1 otherwise, and the counter is 100 on every path. The reader walks every path of such a helper's
 * instruction graph and gives each store the tests that lead to it, as a condition on the part's own fields.
 */
import type { Expression, Predicate } from "./behaviour.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { Instruction, Operand } from "./x86.ts";

/** More paths than this and the helper keeps its stores without conditions. */
const MAX_PATHS = 64;

const OPERATORS: Record<string, { operator: string; signed: boolean }> = {
  je: { operator: "==", signed: false },
  jne: { operator: "!=", signed: false },
  jb: { operator: "<", signed: false },
  jae: { operator: ">=", signed: false },
  jbe: { operator: "<=", signed: false },
  ja: { operator: ">", signed: false },
  jl: { operator: "<", signed: true },
  jge: { operator: ">=", signed: true },
  jle: { operator: "<=", signed: true },
  jg: { operator: ">", signed: true },
};
const OPPOSITE: Record<string, string> = { "==": "!=", "!=": "==", "<": ">=", ">=": "<", "<=": ">", ">": "<=" };

type Memory = Extract<Operand, { kind: "memory" }>;
const ownerField = (o: Operand | undefined, owner: string): o is Memory =>
  o?.kind === "memory" &&
  o.segment === "ds" &&
  o.base.length === 1 &&
  o.base[0] === owner &&
  !o.direct &&
  (o.width === 8 || o.width === 16);
const overlaps = (a: { offset: number; width: number }, b: { offset: number; width: number }) =>
  a.offset < b.offset + b.width / 8 && b.offset < a.offset + a.width / 8;

/** The test a conditional jump makes, when the instruction right before it compares a part field with a number. */
function branchTest(
  test: Instruction | undefined,
  branch: Instruction,
  owner: string,
): { predicate: Extract<Predicate, { kind: "compare" }>; field: Memory } | undefined {
  const kind = OPERATORS[branch.mnemonic];
  if (!kind || !test || test.address + test.size !== branch.address) return undefined;
  const [left, right] = test.operands;
  if (!ownerField(left, owner) || right?.kind !== "immediate") return undefined;
  const width = left.width as 8 | 16;
  const value: Expression = { kind: "field", object: "part", offset: left.displacement, width };
  const number = right.value & (2 ** width - 1);
  if (test.mnemonic === "cmp")
    return {
      predicate: {
        kind: "compare",
        operator: kind.operator,
        left: value,
        right: { kind: "constant", value: number, width },
        signed: kind.signed,
      },
      field: left,
    };
  if (test.mnemonic === "test" && ["je", "jne"].includes(branch.mnemonic))
    return {
      predicate: {
        kind: "compare",
        operator: kind.operator,
        left: { kind: "binary", operator: "&", left: value, right: { kind: "constant", value: number, width }, width },
        right: { kind: "constant", value: 0, width },
        signed: false,
      },
      field: left,
    };
  return undefined;
}

/**
 * For each store to the part (by the store's address): the tests on the way to it, when they decide it. A store gets a
 * condition only when every path through it passes those tests, it is the last store to its field on each of them,
 * and every path that passes them goes through it. The tests read the part's fields as the helper got them: no store
 * or call that may change the tested field comes before a test. `callKeepsOwner` says whether a call leaves the part
 * alone.
 */
export function ownerStoreConditions(
  code: RoutineCode,
  owner: string,
  stores: Instruction[],
  callKeepsOwner: (call: Instruction) => boolean,
): Map<number, Predicate> {
  const result = new Map<number, Predicate>();
  const byAddress = new Map(code.instructions.map((i) => [i.address, i]));
  const next = new Map<number, { to: number; kind: string }[]>();
  for (const edge of code.edges) {
    if (edge.kind === "return") continue;
    if (edge.to === null || !["next", "taken", "not-taken", "jump"].includes(edge.kind)) return result;
    next.set(edge.from, [...(next.get(edge.from) ?? []), { to: edge.to, kind: edge.kind }]);
  }
  const storeSet = new Set(stores.map((i) => i.address));
  const paths: { tests: Extract<Predicate, { kind: "compare" }>[]; last: Map<string, number>; through: Set<number> }[] =
    [];
  let failed = false;
  const walk = (
    at: number,
    previous: Instruction | undefined,
    tests: Extract<Predicate, { kind: "compare" }>[],
    written: Memory[],
    calledUnknown: boolean,
    last: Map<string, number>,
    through: Set<number>,
    seen: Set<number>,
  ) => {
    if (failed) return;
    const i = byAddress.get(at);
    if (!i || seen.has(at) || paths.length >= MAX_PATHS) {
      failed = true;
      return;
    }
    seen = new Set(seen).add(at);
    if (i.flow === "return") {
      paths.push({ tests, last, through });
      return;
    }
    if (i.flow === "call" && !callKeepsOwner(i)) {
      // The call may change any field of the part: no store before it is known to be the last.
      calledUnknown = true;
      last = new Map();
    }
    if (storeSet.has(at)) {
      const memory = i.operands[0] as Memory;
      written = [...written, memory];
      last = new Map(last);
      for (const key of [...last.keys()]) {
        const [offset, width] = key.split(":").map(Number);
        if (overlaps({ offset: offset!, width: width! }, { offset: memory.displacement, width: memory.width }))
          last.delete(key);
      }
      last.set(`${memory.displacement}:${memory.width}`, at);
      through = new Set(through).add(at);
    }
    const out = next.get(at) ?? [];
    if (i.flow === "branch") {
      const test = branchTest(previous, i, owner);
      if (
        !test ||
        calledUnknown ||
        written.some((w) =>
          overlaps(
            { offset: w.displacement, width: w.width },
            { offset: test.field.displacement, width: test.field.width },
          ),
        )
      ) {
        failed = true;
        return;
      }
      for (const edge of out) {
        const predicate =
          edge.kind === "taken" ? test.predicate : { ...test.predicate, operator: OPPOSITE[test.predicate.operator]! };
        walk(edge.to, i, [...tests, predicate], written, calledUnknown, last, through, seen);
      }
      return;
    }
    if (out.length !== 1) {
      failed = true;
      return;
    }
    walk(out[0]!.to, i, tests, written, calledUnknown, last, through, seen);
  };
  walk(code.address, undefined, [], [], false, new Map(), new Set(), new Set());
  if (failed || !paths.length) return result;
  const key = (p: Predicate) => JSON.stringify(p);
  const contradicts = (a: Extract<Predicate, { kind: "compare" }>, b: Extract<Predicate, { kind: "compare" }>) =>
    key({ ...a, operator: OPPOSITE[a.operator]! }) === key(b);
  for (const store of stores) {
    // Only a plain store sets the field to its value; `or`, `inc` and the like change it.
    if (store.mnemonic !== "mov") continue;
    const memory = store.operands[0] as Memory;
    const field = `${memory.displacement}:${memory.width}`;
    const through = paths.filter((p) => p.through.has(store.address));
    if (!through.length || through.some((p) => p.last.get(field) !== store.address)) continue;
    const common = through[0]!.tests.filter((t) => through.every((p) => p.tests.some((u) => key(u) === key(t))));
    // Every path that the common tests don't rule out must end with this store.
    const decided = paths.every(
      (p) => p.last.get(field) === store.address || p.tests.some((t) => common.some((c) => contradicts(c, t))),
    );
    if (!decided) continue;
    result.set(
      store.address,
      common.length === 0 ? { kind: "true" } : common.length === 1 ? common[0]! : { kind: "and", terms: common },
    );
  }
  return result;
}

/** A field's value at the end of a helper's paths: what it holds and the tests of the paths that leave it so. */
export interface OwnerPathStore {
  offset: number;
  width: 8 | 16;
  /** Worked out from the part's fields and the helper's arguments as it got them. */
  value: Expression;
  condition: Predicate;
  /** The last store to the field on those paths, and the instructions of their tests. */
  store: Instruction;
  tests: Instruction[];
}

const BINARY: Record<string, string> = { add: "+", sub: "-", and: "&", or: "|", xor: "^" };
const fold = (operator: string, left: Expression, right: Expression, width: number): Expression => {
  if (left.kind === "constant" && right.kind === "constant") {
    const a = left.value,
      b = right.value;
    const value = { "+": a + b, "-": a - b, "&": a & b, "|": a | b, "^": a ^ b }[operator];
    if (value !== undefined) return { kind: "constant", value: value & (2 ** width - 1), width };
  }
  return { kind: "binary", operator, left, right, width };
};

/**
 * Every path of a small helper, read exactly: the registers and the part's fields hold values worked out from the
 * part's fields and the helper's arguments as it got them, and each test compares two such values. So a helper like the
 * gear's push (`0x1afdc` in Even More, English floppy), `velocityX -= s; if (velocityX < s) velocityX = -s`, gives
 * velocityX - s when velocityX - s is at least s, and -s otherwise. Undefined when an instruction or a value isn't one
 * the reader knows exactly, or a path writes memory other than the part's fields.
 *
 * A call is followed only when `callKeepsOwner` says the callee leaves the part alone, like the vacuum cleaner's pull
 * (`0x1e8bb`), which asks for a redraw and a sound before it marks the part. The call keeps the part's fields, the
 * owner register and the frame (the C calling convention keeps SI, DI and BP) and the helper's locals, which the callee
 * can't reach; it forgets AX, BX, CX, DX and ES, which it may change.
 *
 * For each field, paths that leave the same value are joined when the tests they share rule out every other path, as
 * `ownerStoreConditions` does; else each path gives its own value with its own tests. A path that doesn't write a field
 * leaves it as it was, so the values cover every path that changes it.
 */
export function ownerPathStores(
  code: RoutineCode,
  owner: string,
  firstArgument: number,
  callKeepsOwner?: (call: Instruction) => boolean,
): OwnerPathStore[] | undefined {
  if (code.status !== "complete" || (code.calls.length && !callKeepsOwner)) return undefined;
  // A call through a pointer, or one the reader can't place, may change anything.
  if (code.calls.some((call) => call.confidence !== "checked" || !call.target)) return undefined;
  const byAddress = new Map(code.instructions.map((i) => [i.address, i]));
  const next = new Map<number, { to: number; kind: string }[]>();
  for (const edge of code.edges) {
    if (edge.kind === "return") continue;
    if (edge.to === null || !["next", "taken", "not-taken", "jump"].includes(edge.kind)) return undefined;
    next.set(edge.from, [...(next.get(edge.from) ?? []), { to: edge.to, kind: edge.kind }]);
  }
  interface Path {
    tests: Extract<Predicate, { kind: "compare" }>[];
    testInstructions: Instruction[];
    stores: Map<number, { width: 8 | 16; value: Expression; store: Instruction }>;
  }
  const paths: Path[] = [];
  let failed = false;
  type Value = Expression | "owner" | "frame";
  const walk = (
    at: number,
    registers: Map<string, Value>,
    locals: Map<number, Expression>,
    fields: Map<number, { width: 8 | 16; value: Expression; store: Instruction }>,
    compared: { left: Expression; right: Expression; test: boolean; at: Instruction } | undefined,
    path: Pick<Path, "tests" | "testInstructions">,
    seen: Set<number>,
  ) => {
    if (failed) return;
    const i = byAddress.get(at);
    if (!i || seen.has(at) || paths.length >= MAX_PATHS || i.prefixes.length || i.segmentOverride) {
      failed = true;
      return;
    }
    seen = new Set(seen).add(at);
    registers = new Map(registers);
    const fail = () => {
      failed = true;
    };
    /** A word or byte the instruction reads, or undefined when it can't be known. */
    const valueOf = (o: Operand | undefined, width: number): Expression | undefined => {
      if (!o) return undefined;
      if (o.kind === "immediate") return { kind: "constant", value: o.value & (2 ** width - 1), width };
      if (o.kind === "register") {
        const v = o.width === 16 ? registers.get(o.name) : undefined;
        return v && typeof v !== "string" ? v : undefined;
      }
      if (o.kind !== "memory" || o.base.length !== 1 || o.direct || o.width !== width) return undefined;
      if (o.segment === "ss" && o.base[0] === "bp" && registers.get("bp") === "frame") {
        if (o.displacement >= firstArgument && o.width === 16)
          return { kind: "field", object: "argument", offset: o.displacement, width: 16 };
        return o.displacement < 0 ? locals.get(o.displacement) : undefined;
      }
      if (!ownerField(o, owner) || registers.get(owner) !== "owner") return undefined;
      const known = fields.get(o.displacement);
      if (known) return known.width === o.width ? known.value : undefined;
      if ([...fields].some(([offset, f]) => overlaps({ offset, width: f.width }, { offset: o.displacement, width })))
        return undefined;
      return { kind: "field", object: "part", offset: o.displacement, width: o.width };
    };
    /** Puts a value where the instruction writes it; false when that place isn't a known register, local or field. */
    const put = (o: Operand | undefined, value: Expression): boolean => {
      if (o?.kind === "register") {
        if (o.width !== 16 || ["sp", "bp"].includes(o.name)) return false;
        registers.set(o.name, value);
        return true;
      }
      if (o?.kind !== "memory" || o.base.length !== 1 || o.direct) return false;
      if (o.segment === "ss" && o.base[0] === "bp" && registers.get("bp") === "frame") {
        if (o.displacement >= 0 || o.width !== 16) return false;
        locals.set(o.displacement, value);
        return true;
      }
      if (!ownerField(o, owner) || registers.get(owner) !== "owner") return false;
      const width = o.width as 8 | 16;
      for (const [offset, f] of fields)
        if (
          (offset !== o.displacement || f.width !== width) &&
          overlaps({ offset, width: f.width }, { offset: o.displacement, width })
        )
          return false;
      fields.set(o.displacement, { width, value, store: i });
      return true;
    };
    const [dest, source] = i.operands;
    let flags: typeof compared = undefined;
    locals = new Map(locals);
    fields = new Map(fields);
    if (i.mnemonic === "nop" || (i.mnemonic === "push" && (dest?.kind === "register" || dest?.kind === "immediate"))) {
      // A pushed word is only read back by a pop, and a pop only restores a register: neither changes a field.
    } else if (i.mnemonic === "pop" && dest?.kind === "register") {
      // The frame and the saved registers come back; nothing after the pop may read them.
      registers.delete(dest.name);
    } else if (i.mnemonic === "mov" && dest?.kind === "register" && dest.name === "bp" && source?.kind === "register") {
      if (source.name !== "sp" || registers.has("bp")) return fail();
      registers.set("bp", "frame");
    } else if (
      i.mnemonic === "mov" &&
      dest?.kind === "register" &&
      dest.name === owner &&
      source?.kind === "memory" &&
      source.segment === "ss" &&
      source.base.length === 1 &&
      source.base[0] === "bp" &&
      source.displacement === firstArgument &&
      registers.get("bp") === "frame"
    ) {
      registers.set(owner, "owner");
    } else if (i.mnemonic === "mov") {
      const width = dest?.kind === "memory" || dest?.kind === "register" ? dest.width : 0;
      const value = valueOf(source, width);
      if (!value || !put(dest, value)) return fail();
    } else if (BINARY[i.mnemonic] || i.mnemonic === "cmp") {
      const width = dest?.kind === "memory" || dest?.kind === "register" ? dest.width : 0;
      // `xor ax, ax` and `sub ax, ax` clear the register, whatever it held.
      const same = dest?.kind === "register" && source?.kind === "register" && dest.name === source.name;
      const left = same && ["xor", "sub"].includes(i.mnemonic) ? undefined : valueOf(dest, width);
      const right = valueOf(source, width);
      if (i.mnemonic === "cmp") {
        if (!left || !right) return fail();
        flags = { left, right, test: false, at: i };
      } else {
        const value =
          same && ["xor", "sub"].includes(i.mnemonic)
            ? ({ kind: "constant", value: 0, width } as Expression)
            : left && right && fold(BINARY[i.mnemonic]!, left, right, width);
        if (!value || !put(dest, value)) return fail();
      }
    } else if (i.mnemonic === "test") {
      const width = dest?.kind === "memory" || dest?.kind === "register" ? dest.width : 0;
      const left = valueOf(dest, width),
        right = valueOf(source, width);
      if (!left || !right) return fail();
      flags = { left, right, test: true, at: i };
    } else if (i.mnemonic === "neg" || i.mnemonic === "inc" || i.mnemonic === "dec") {
      const width = dest?.kind === "memory" || dest?.kind === "register" ? dest.width : 0;
      const value = valueOf(dest, width);
      const one: Expression = { kind: "constant", value: i.mnemonic === "neg" ? 0 : 1, width };
      const result =
        value &&
        (i.mnemonic === "neg"
          ? fold("-", one, value, width)
          : fold(i.mnemonic === "inc" ? "+" : "-", value, one, width));
      if (!result || !put(dest, result)) return fail();
    } else if (i.flow === "call") {
      if (!callKeepsOwner?.(i)) return fail();
      // The callee may change the scratch registers, but not the part, the frame or the owner register.
      for (const name of ["ax", "bx", "cx", "dx", "es"]) registers.delete(name);
    } else if (i.flow !== "branch" && i.flow !== "jump" && i.flow !== "return") return fail();
    if (i.flow === "return") {
      if (i.operands.length) return fail();
      paths.push({ ...path, stores: fields });
      return;
    }
    const out = next.get(at) ?? [];
    if (i.flow === "branch") {
      const kind = OPERATORS[i.mnemonic];
      // The test must come right before the branch, so the flags are its own.
      if (!kind || !compared || compared.at.address + compared.at.size !== i.address) return fail();
      if (compared.test && !["je", "jne"].includes(i.mnemonic)) return fail();
      const width = compared.left.width;
      const predicate: Extract<Predicate, { kind: "compare" }> = compared.test
        ? {
            kind: "compare",
            operator: kind.operator,
            left:
              JSON.stringify(compared.left) === JSON.stringify(compared.right)
                ? compared.left
                : fold("&", compared.left, compared.right, width),
            right: { kind: "constant", value: 0, width },
            signed: false,
          }
        : { kind: "compare", operator: kind.operator, left: compared.left, right: compared.right, signed: kind.signed };
      for (const edge of out) {
        const test = edge.kind === "taken" ? predicate : { ...predicate, operator: OPPOSITE[predicate.operator]! };
        walk(
          edge.to,
          registers,
          locals,
          fields,
          undefined,
          { tests: [...path.tests, test], testInstructions: [...path.testInstructions, compared.at, i] },
          seen,
        );
      }
      return;
    }
    if (out.length !== 1) return fail();
    walk(out[0]!.to, registers, locals, fields, flags, path, seen);
  };
  walk(code.address, new Map(), new Map(), new Map(), undefined, { tests: [], testInstructions: [] }, new Set());
  if (failed || !paths.length) return undefined;
  const key = (value: unknown) => JSON.stringify(value);
  const contradicts = (a: Extract<Predicate, { kind: "compare" }>, b: Extract<Predicate, { kind: "compare" }>) =>
    key({ ...a, operator: OPPOSITE[a.operator]! }) === key(b);
  const result: OwnerPathStore[] = [];
  const offsets = [...new Set(paths.flatMap((p) => [...p.stores.keys()]))].sort((a, b) => a - b);
  for (const offset of offsets) {
    const ending = (p: Path) => {
      const s = p.stores.get(offset);
      return s ? key([s.width, s.value]) : "kept";
    };
    const groups = new Map<string, Path[]>();
    for (const p of paths) if (p.stores.has(offset)) groups.set(ending(p), [...(groups.get(ending(p)) ?? []), p]);
    for (const [end, group] of groups) {
      const common = group[0]!.tests.filter((t) => group.every((p) => p.tests.some((u) => key(u) === key(t))));
      // Joined only when every path the shared tests don't rule out leaves the same value.
      const joined = paths.every(
        (p) => ending(p) === end || p.tests.some((t) => common.some((c) => contradicts(c, t))),
      );
      for (const [tests, members] of joined ? [[common, group] as const] : group.map((p) => [p.tests, [p]] as const)) {
        const store = members[0]!.stores.get(offset)!;
        const unique = tests.filter((t, n) => tests.findIndex((u) => key(u) === key(t)) === n);
        result.push({
          offset,
          width: store.width,
          value: store.value,
          condition:
            unique.length === 0 ? { kind: "true" } : unique.length === 1 ? unique[0]! : { kind: "and", terms: unique },
          store: store.store,
          tests: [...new Map(members.flatMap((p) => p.testInstructions).map((t) => [t.address, t])).values()].sort(
            (a, b) => a.address - b.address,
          ),
        });
      }
    }
  }
  return result;
}
