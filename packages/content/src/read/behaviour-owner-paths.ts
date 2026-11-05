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
