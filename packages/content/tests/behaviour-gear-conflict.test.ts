import { describe, expect, it } from "vitest";
import { analyseRoutine, type Expression, type Predicate, type PartBehaviour } from "../src/read/behaviour.ts";
import { describeGear } from "../src/read/describe-gear.ts";
import { gearFixture, gearFields } from "./fixtures/gear.ts";

function analyse() {
  const f = gearFixture();
  return {
    f,
    report: analyseRoutine(f.image, f.code, {
      code: f.code,
      codes: f.codes,
      layout: f.layout,
      stateOffset: gearFields.state,
      engineSummaries: f.summaries,
    }),
  };
}

/** Checks the report's ordinary expression algebra, never a graph, instruction or callback interpreter. */
function expression(e: Expression, values: Map<string, number>): number {
  if (e.kind === "constant") return e.value & (2 ** e.width - 1);
  if (e.kind === "field") {
    const value = values.get(`${e.object}:${e.offset}`);
    if (value === undefined) throw new Error(`No mathematical input for ${e.object}:${e.offset}`);
    return value;
  }
  if (e.kind !== "binary") throw new Error("The exact owner relation must not contain an unknown value");
  const a = expression(e.left, values),
    b = expression(e.right, values);
  let value: number;
  switch (e.operator) {
    case "+":
      value = a + b;
      break;
    case "-":
      value = a - b;
      break;
    case "&":
      value = a & b;
      break;
    case "|":
      value = a | b;
      break;
    case "^":
      value = a ^ b;
      break;
    case "==":
      value = Number(a === b);
      break;
    case "!=":
      value = Number(a !== b);
      break;
    case "<=":
      value = Number(a <= b);
      break;
    case ">=":
      value = Number(a >= b);
      break;
    case "<":
      value = Number(a < b);
      break;
    case ">":
      value = Number(a > b);
      break;
    default:
      throw new Error(`Unexpected report operator ${e.operator}`);
  }
  return ((value % 2 ** e.width) + 2 ** e.width) % 2 ** e.width;
}
function predicate(p: Predicate, values: Map<string, number>): boolean {
  if (p.kind === "true") return true;
  if (p.kind === "and") return p.terms.every((term) => predicate(term, values));
  if (p.kind !== "compare") throw new Error("The owner condition must be resolved");
  const signed = (n: number, width: number) => (p.signed && n >= 2 ** (width - 1) ? n - 2 ** width : n);
  const a = signed(expression(p.left, values), p.left.width),
    b = signed(expression(p.right, values), p.right.width);
  if (p.operator === "==") return a === b;
  if (p.operator === "!=") return a !== b;
  if (p.operator === "<=") return a <= b;
  if (p.operator === ">=") return a >= b;
  if (p.operator === "<") return a < b;
  if (p.operator === ">") return a > b;
  throw new Error("Unexpected predicate");
}
function inputs(state: number, movement: number, conflict: number, empty = false) {
  const values = new Map<string, number>([
    [`part:${gearFields.state}`, state],
    [`part:${gearFields.delta}`, movement],
    [`part:${gearFields.flags}`, 0x2010],
    ...Array.from({ length: 4 }, (_, n): [string, number] => [`part:${gearFields.links + n * 2}`, empty ? 0 : 0x200]),
  ]);
  return { values, conflict };
}

describe("defined gear connection conflict results", () => {
  it("binds a binary result to the complete pre-scan graph relation and evidence", () => {
    const { f, report } = analyse();
    expect(report.uncertainties).toEqual([]);
    expect(report.derivedValues).toHaveLength(1);
    const value = report.derivedValues![0]!;
    expect(value).toMatchObject({
      routine: f.code.address,
      snapshot: "beforeRootConnectionScan",
      values: [0, 1],
      ownerMarkedBeforeScan: true,
      initialAccumulator: 0,
      rootMode: 2,
      rootSkipsBlocked: false,
      relation: { nonzeroSource: { labelOrder: "depthFirstFirstEncounter" } },
    });
    expect(value.evidence.some((e) => e.address === f.propAddress)).toBe(true);
    expect(value.evidence.some((e) => e.address === f.advanceAddress)).toBe(true);
    expect(report.transitions.every((transition) => transition.confidence !== "unresolved")).toBe(true);
    expect(report.analysisWork!.pendingPaths).toBe(0);
  });

  it("retains the exact conditional owner state and clears pending movement", () => {
    const { report } = analyse();
    const result = report.derivedValues![0]!.value;
    for (const state of [0, 1, 2, 3, 4, 7, 65535])
      for (const movement of [0, 1, 2, 32768, 65535])
        for (const conflict of [0, 1]) {
          const { values } = inputs(state, movement, conflict);
          values.set(`${result.object}:${result.offset}`, conflict);
          const matching = report.outcomes!.filter((outcome) => predicate(outcome.condition, values));
          expect(matching).toHaveLength(1);
          const writes = matching[0]!.fields.filter((field) => field.object === "part");
          const next = writes.find((field) => field.offset === gearFields.state);
          const sum = (state + (conflict ? 0 : movement)) & 65535;
          const expected = movement === 0 ? state : sum === 65535 ? 3 : sum === 4 ? 0 : sum;
          expect(next ? expression(next.value, values) : state).toBe(expected);
          const pending = writes.find((field) => field.offset === gearFields.delta);
          expect(pending ? expression(pending.value, values) : movement).toBe(0);
          const flags = writes.find((field) => field.offset === gearFields.flags);
          expect(flags ? expression(flags.value, values) : 0x2010).toBe(movement ? 0x2050 : 0x2010);
        }
  });

  it("keeps the empty-root case independent of a peer or any conflict placeholder", () => {
    const { report } = analyse();
    const result = report.derivedValues![0]!.value;
    const { values } = inputs(3, 1, 1, true);
    values.set(`${result.object}:${result.offset}`, 1);
    const matching = report.outcomes!.filter((outcome) => predicate(outcome.condition, values));
    expect(matching).toHaveLength(1);
    expect(
      expression(
        matching[0]!.fields.find((field) => field.object === "part" && field.offset === gearFields.state)!.value,
        values,
      ),
    ).toBe(0);
  });

  it("does not admit an arbitrary numeric conflict result", () => {
    const { report } = analyse();
    const result = report.derivedValues![0]!.value;
    const { values } = inputs(1, 1, 2);
    values.set(`${result.object}:${result.offset}`, 2);
    expect(report.outcomes!.filter((outcome) => predicate(outcome.condition, values))).toHaveLength(0);
  });

  it("retains related state, movement and mark effects instead of treating the traversal as owner-only", () => {
    const { report } = analyse();
    const related = report.writes.filter((write) => write.object === "a connected part");
    expect(related.some((write) => write.offset === gearFields.state)).toBe(true);
    expect(related.some((write) => write.offset === gearFields.delta)).toBe(true);
    expect(related.some((write) => write.offset === gearFields.flags)).toBe(true);
  });

  it("rejects a changed recursive graph rather than assigning a default result", () => {
    const f = gearFixture();
    const mode = f.codes
      .get(f.propAddress)!
      .instructions.find(
        (i) =>
          i.mnemonic === "cmp" &&
          i.operands[0]?.kind === "memory" &&
          i.operands[0].segment === "ss" &&
          i.operands[0].displacement === 10,
      )!;
    if (mode.operands[1]?.kind === "immediate") mode.operands[1].value = 3;
    const report = analyseRoutine(f.image, f.code, {
      code: f.code,
      codes: f.codes,
      layout: f.layout,
      stateOffset: gearFields.state,
      engineSummaries: f.summaries,
    });
    expect(report.gearRun).toBeUndefined();
    expect(report.derivedValues).toBeUndefined();
    expect(report.transitions.some((transition) => transition.confidence === "unresolved")).toBe(true);
  });

  it("describes conditional graph behavior without promising repeated movement or a known graph", () => {
    const { report } = analyse();
    const part: PartBehaviour = {
      id: "gear",
      type: 14,
      routines: [],
      stateWrites: [],
      transitions: report.transitions,
      counters: [],
      reset: [],
      visibleEffects: [],
      triggers: [],
      uncertainties: [],
      gearRun: report.gearRun,
      derivedValues: report.derivedValues,
    };
    const description = describeGear(part)!;
    expect(description.confidence).toBe("inferred");
    expect(description.conflict).toContain("its movement equals the source movement");
    expect(description.withConflict).toContain("Raw state -1 still becomes 3");
    expect(description.limits.join(" ")).toContain("not an independently settable trigger");
    expect(description.limits.join(" ")).toContain("movement supplied again");
    expect(description.evidence).toEqual(report.gearRun!.evidence);
  });
  it("takes conditional movement sources from matching linked endpoint writes", () => {
    const { report } = analyse();
    const run = report.gearRun!;
    const peer = run.propagationRelation.expansion.peer;
    const part: PartBehaviour = {
      id: "gear",
      type: 14,
      routines: [],
      stateWrites: [],
      transitions: [],
      counters: [],
      reset: [],
      visibleEffects: [],
      triggers: [],
      uncertainties: [],
      gearRun: run,
    };
    const write = {
      object: `referenced-by(referenced-by(part+0x${peer.connectionField.toString(16)})+0x${peer.endpointFields[0]!.toString(16)})`,
      offset: run.deltaField,
      width: 16,
      value: { kind: "constant" as const, value: 1, width: 16 },
      condition: { kind: "true" as const },
      routine: 0x900,
      confidence: "inferred" as const,
      evidence: [{ address: 0x900, bytes: [0x89], text: "Synthetic source write." }],
      assumptions: [],
    };
    const source = {
      sourcePart: "synthetic-driver",
      sourceType: 27,
      write,
      confidence: "inferred" as const,
      evidence: write.evidence,
      assumptions: [],
    };
    const description = describeGear(
      part,
      [],
      [source, { ...source, targetType: 99 }, { ...source, write: { ...write, object: "referenced-by(part+0x70)" } }],
    )!;
    expect(description.drivers).toHaveLength(1);
    expect(description.drivers[0]!.sourcePart).toBe("synthetic-driver");
    expect(description.drivers[0]!.target).toBe("gearIsSelectedLinkedEndpoint");
    expect(description.drivers[0]!.description).toContain("If this gear is the linked endpoint");
    expect(description.drivers[0]!.description).toContain("sets the pending step to 1");
    expect(description.drivers[0]!.write).toEqual(write);
  });
  it("keeps equality conflicts distinct from exact-negation requirements for arbitrary words", () => {
    const { report } = analyse();
    const relation = report.gearRun!.propagationRelation;
    for (const [source, target, mode, bad] of [
      [1, 2, 2, false],
      [1, 1, 2, true],
      [1, 65535, 2, false],
      [32768, 0, 2, false],
      [32768, 32768, 2, true],
      [1, 1, 1, false],
      [1, 2, 1, true],
      [1, 1, 3, false],
    ] as const) {
      const values = new Map([
        [`source:${relation.fields.movement}`, source],
        [`target:${relation.fields.movement}`, target],
        ["argument:10", mode],
      ]);
      expect(relation.localConflicts.some((condition) => predicate(condition, values))).toBe(bad);
    }
    const values = new Map([
      [`source:${relation.fields.movement}`, 32768],
      [`target:${relation.fields.movement}`, 0],
      ["argument:10", 2],
    ]);
    const assignments = relation.zeroTargetAssignments.filter((item) => predicate(item.condition, values));
    expect(assignments).toHaveLength(1);
    expect(expression(assignments[0]!.value, values)).toBe(32768);
    expect(relation.result).toMatchObject({
      quantifier: "anyCheckedInvocation",
      conflict: 1,
      otherwise: "incomingAccumulator",
    });
  });
});
