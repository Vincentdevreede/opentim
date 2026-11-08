import { describe, expect, it } from "vitest";
import {
  choose,
  type BehaviourReport,
  type Expression,
  type FieldWrite,
  type Predicate,
} from "../src/read/behaviour.ts";
import { evaluateBehaviourCondition } from "../src/read/describe-behaviour.ts";
import { effectsFromOthers, FIXED_LIST_ASSUMPTION } from "../src/read/describe-effects.ts";
import { LIGHTABLE_ASSUMPTION } from "../src/read/describe-hits.ts";
import {
  BUDGET_VALUE,
  CONSUMER_UNREAD,
  CONTACT_SEARCH,
  HELPER_VALUE,
  LIMIT_RULE_FIELD,
  otherPartPairs,
  renderOtherPartPairs,
  SEARCH_UNREAD,
  SOURCE_VALUE,
  UNRESOLVED_PATH,
  UNKNOWN_VALUE,
} from "../src/read/other-part-pairs.ts";

const GLOVE = "overlap candidate at 0x19732";
const HOUSE = "overlap candidate at 0x1e29b";
const CANDLE = "overlap candidate at 0x19acd";
const finding = { confidence: "inferred" as const, assumptions: ["A stated assumption."], evidence: [] };
const c = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const f = (object: string, offset: number): Expression => ({ kind: "field", object, offset, width: 16 });
const bin = (operator: string, left: Expression, right: Expression): Expression => ({
  kind: "binary",
  operator,
  left,
  right,
  width: 16,
});
const compare = (left: Expression, operator: string, right: Expression): Predicate => ({
  kind: "compare",
  operator,
  left,
  right,
  signed: false,
});
const and = (...terms: Predicate[]): Predicate => ({ kind: "and", terms });
const write = (object: string, offset: number, value: Expression): FieldWrite => ({
  ...finding,
  object,
  offset,
  width: 16,
  value,
  condition: { kind: "true" },
  routine: 0x100,
});
/** The mass word of the member's type record, at +0x02 of a 58-byte record at 0x2ef10. */
const mass = (member: string): Expression => ({
  kind: "table",
  segment: 0x2ef1,
  offset: 2,
  index: bin("*", f(member, 4), c(58)),
  width: 16,
});
const member = (object: string, header: number, condition: Predicate, fields: FieldWrite[]) => ({
  ...finding,
  scope: "one overlap-list member" as const,
  header,
  object,
  effectsComplete: true,
  condition,
  fields,
});
const callback = (slot: number, address: number) => ({
  slot,
  field: 0x26,
  address,
  segment: 0,
  offset: 0,
  shared: false,
  sharedDefault: false,
});
/** A loop over the list of the query called at `call`, so the search's flag tests are known. */
const loop = (header: number, call: number, helper: number) => ({
  listLoops: [{ header, source: "overlap-query", queries: [call] }],
  engineCalls: [{ ...finding, instruction: call, summary: helper, purpose: "search" }],
});
const search = (address: number, tests: { offset: number; mask: number; set: boolean }[]) => ({
  ...finding,
  address,
  kind: "overlap-list",
  purpose: "search",
  writes: [{ ...finding, root: "unknown", selection: "overlap-candidate", path: [], offset: 0x78, width: 16 }],
  list: { headField: 0x78, nextField: 0x78, memberTests: tests.map((t) => ({ ...finding, ...t })) },
});

function report(): BehaviourReport {
  const part = (id: string, type: number, slots: { slot: number; address: number }[] = [], reads: number[] = []) => ({
    id,
    type,
    routines: slots.map((s) => callback(s.slot, s.address)),
    transitions: reads.map((offset) => ({
      ...finding,
      from: null,
      to: f("part", 12),
      condition: compare(f("part", offset), "!=", c(0)),
      routine: 0x500,
    })),
  });
  const moving = compare(bin("&", f(GLOVE, 6), c(0x1000)), "!=", c(0));
  return {
    layout: {
      fields: [
        { offset: 4, name: "type" },
        { offset: 12, name: "state" },
        { offset: 0x36, name: "velocityX" },
        { offset: 8, name: "drawingFlags", masks: [{ name: "horizontalFlip", value: 16 }] },
      ],
    },
    parts: [
      part("brick-wall", 1),
      part("conveyor-belt", 5, [{ slot: 0, address: 0x400 }]),
      part("cat", 12, [], [0x36]),
      part("teeter-totter", 3, [{ slot: 1, address: 0x600 }]),
      part("boxing-glove", 35, [{ slot: 1, address: 0x19657 }]),
      part("candle", 45, [{ slot: 1, address: 0x19a67 }], [0x12]),
      part("mel-schlemming", 54),
      part("mels-house", 58, [{ slot: 1, address: 0x1e247 }]),
    ],
    helpers: [
      search(0x42da, [{ offset: 8, mask: 0x2000, set: false }]),
      search(0x448e, [
        { offset: 8, mask: 0x2000, set: false },
        { offset: 0x0a, mask: 0x0004, set: true },
      ]),
      {
        ...finding,
        address: 0x1d797,
        kind: "conditional-list-consumer",
        purpose: "consumer",
        writes: [],
        listConsumer: { fields: [{ root: "member", offset: 0x12, width: 16 }] },
      },
      {
        kind: "part-factory",
        factory: {
          startingWords: [
            {
              field: 6,
              values: Array(60)
                .fill(0x800)
                .map((v, t) => (t === 1 || t === 3 || t === 58 ? 0x4800 : v)),
            },
          ],
          constructorFlags: [{ ...finding, type: 45, field: 0x0a, mask: 0x0004 }],
        },
      },
    ],
    typeTable: {
      address: 0x2ef10,
      stride: 58,
      words: Array.from({ length: 60 }, (_, type) => [0, type === 12 ? 120 : 10, ...Array(27).fill(0)]),
    },
    routines: [
      {
        address: 0x19657,
        ...loop(0x19732, 0x196d1, 0x42da),
        // The punch: a goal mark and a speed the member's mass picks, 6656 less 512 from a mass of 100 on.
        iterationOutcomes: [
          member(GLOVE, 0x19732, moving, [
            write(GLOVE, 0x0a, bin("|", f(GLOVE, 0x0a), c(0x0400))),
            write(GLOVE, 0x38, bin("-", c(6656), bin("*", bin(">=", mass(GLOVE), c(100)), c(512)))),
          ]),
        ],
      },
      {
        address: 0x1e247,
        ...loop(0x1e29b, 0x1e264, 0x42da),
        iterationOutcomes: [
          member(HOUSE, 0x1e29b, and(compare(f(HOUSE, 4), "==", c(54)), compare(f(HOUSE, 12), "<", c(6))), [
            write(HOUSE, 8, bin("|", f(HOUSE, 8), c(0x2000))),
          ]),
        ],
      },
      {
        address: 0x19a67,
        ...loop(0x19acd, 0x19ab2, 0x448e),
        // Lights what isn't lit yet: only parts with the lightable mark are in the list.
        iterationOutcomes: [member(CANDLE, 0x19acd, compare(f(CANDLE, 0x12), "==", c(0)), [write(CANDLE, 0x12, c(1))])],
      },
      {
        address: 0x400,
        // A belt halves the toucher's velocityY, and a far side reads the belt's own position.
        outcomes: [
          {
            ...finding,
            effectsComplete: true,
            condition: { kind: "true" },
            fields: [write("collider", 0x38, bin(">>", f("collider", 0x38), c(1)))],
            returnValue: c(0),
          },
        ],
      },
      {
        address: 0x600,
        engineCalls: [{ ...finding, instruction: 0x650, summary: 0x1d797, purpose: "consumer" }],
        iterationOutcomes: [
          member("overlap candidate at 0x700", 0x700, compare(f("overlap candidate at 0x700", 4), "==", c(12)), [
            write("overlap candidate at 0x700", 0x36, f("part", 0x1e)),
          ]),
        ],
      },
    ],
  } as unknown as BehaviourReport;
}

describe("other parts' effects with values the type settles", () => {
  const lines = effectsFromOthers(report(), evaluateBehaviourCondition);

  it("works a speed out from the part's type record and names a goal mark it sets", () => {
    const [punch] = lines.get(12)!.effects.filter((e) => e.sourcePart === "boxing-glove");
    expect(punch!.description).toBe(
      "A boxing glove that reaches it sets its goal mark 0x0400 in field 0x0a and sets +0x38 to 6144. Only when it is on the moving list and its out-of-play flag 0x2000 is clear.",
    );
    const [mel] = lines.get(54)!.effects.filter((e) => e.sourcePart === "boxing-glove");
    expect(mel!.sets).toContainEqual({ kind: "field", offset: 0x38, width: 16, value: 6656 });
  });

  it("names the frame width a source just drew, even at the frame it stepped to", () => {
    const data = report();
    data.layout.fields.push(
      { offset: 0x1e, name: "positionX" } as (typeof data.layout.fields)[number],
      { offset: 0x44, name: "frameWidth" } as (typeof data.layout.fields)[number],
    );
    // The frame-position helper's frameWidth: a word of the frame list, picked by the part's state.
    const width = (state: Expression): Expression => ({
      kind: "table",
      segment: 0x2fe1,
      offset: 0,
      index: bin("<<", state, c(1)),
      width: 16,
    });
    data.helpers!.push({
      ...finding,
      address: 0x68aa,
      kind: "frame-position",
      purpose: "redraw",
      writes: [
        {
          ...finding,
          root: "argument",
          path: [],
          offset: 0x44,
          width: 16,
          value: bin("+", width(f("part", 12)), c(0)),
          condition: { kind: "true" },
        },
      ],
    } as unknown as NonNullable<BehaviourReport["helpers"]>[number]);
    const M = "overlap candidate at 0x700";
    const centre = (object: string, half: Expression) => bin("+", f(object, 0x1e), bin(">>", half, c(1)));
    // The source stepped to its next frame and drew it: the test reads that frame's width.
    const stepped = bin("+", width(bin("+", f("part", 12), c(1))), c(0));
    const right: Predicate = {
      kind: "compare",
      operator: ">=",
      left: centre(M, f(M, 0x44)),
      right: centre("part", stepped),
      signed: true,
    };
    data.routines.find((r) => r.address === 0x600)!.iterationOutcomes = [
      member(M, 0x700, and(compare(f(M, 4), "==", c(12)), right), [write(M, 0x38, c(0x400))]),
    ];
    const [line] = effectsFromOthers(data, evaluateBehaviourCondition).get(12)!.effects;
    expect(line!.description).toContain(
      "its centre X is at or right of the teeter-totter's centre X (positionX + frameWidth / 2)",
    );
    // A width the helper doesn't draw stays a formula.
    const other: Predicate = { ...right, right: centre("part", bin("*", f("part", 12), c(3))) };
    data.routines.find((r) => r.address === 0x600)!.iterationOutcomes = [
      member(M, 0x700, and(compare(f(M, 4), "==", c(12)), other), [write(M, 0x38, c(0x400))]),
    ];
    const [plain] = effectsFromOthers(data, evaluateBehaviourCondition).get(12)!.effects;
    expect(plain!.description).not.toContain("frameWidth / 2)");
  });

  it("keeps a test of the part's own fields when the source names its type", () => {
    const [house] = lines.get(54)!.effects.filter((e) => e.sourcePart === "mels-house");
    expect(house!.description).toBe(
      "Mel's house that reaches it sets its out-of-play flag 0x2000 in drawing flags. Only when its state is below 6 (unsigned).",
    );
    expect(house!.conditionWords).toEqual(["its state is below 6 (unsigned)"]);
  });

  it("gives no line from a search that keeps only parts with a flag the part never has", () => {
    expect(lines.get(54)!.effects.some((e) => e.sourcePart === "candle")).toBe(false);
  });
});

describe("the pairs of other parts", () => {
  const pairs = otherPartPairs(report(), evaluateBehaviourCondition);
  const pair = (source: string, target: string) =>
    pairs.pairs.find((p) => p.sourcePart === source && p.targetPart === target);

  it("finds each pair the code allows and where it is described", () => {
    expect(pair("boxing-glove", "cat")).toMatchObject({ status: "described", way: "overlap list", lines: 1 });
    expect(pair("mels-house", "mel-schlemming")).toMatchObject({ status: "described", lines: 1 });
    // The house names Mel's type: no other part is in its pairs.
    expect(pairs.pairs.filter((p) => p.sourcePart === "mels-house")).toHaveLength(1);
    expect(pair("conveyor-belt", "cat")).toMatchObject({ status: "described", way: "touch" });
  });

  it("says which decided assumption rules a pair out", () => {
    expect(pair("conveyor-belt", "brick-wall")).toMatchObject({
      status: "ruled out",
      reasons: [FIXED_LIST_ASSUMPTION],
    });
    expect(pair("candle", "cat")).toMatchObject({ status: "ruled out", reasons: [LIGHTABLE_ASSUMPTION] });
    // The candle can light itself, another candle: the candle's own rules read the control value, so it is a walk.
    expect(pair("candle", "candle")).toMatchObject({ status: "described", walks: 1 });
  });

  it("says why a pair is missing", () => {
    expect(pair("teeter-totter", "cat")).toMatchObject({ status: "missing", reasons: [SOURCE_VALUE] });
    expect(pairs.consumers).toEqual([
      { sourceType: 3, sourcePart: "teeter-totter", routine: 0x600, consumer: 0x1d797, calls: [0x650], fields: [0x12] },
    ]);
    expect(renderOtherPartPairs(pairs)).toContain(CONSUMER_UNREAD);
  });

  it("reads a loop's way past the rope pull, and names the contact search where it stops", () => {
    const data = report();
    const M = "overlap candidate at 0x700";
    data.helpers!.push(
      ...([
        { ...finding, address: 0x1d638, kind: "connection-query", purpose: "rope pull", writes: [] },
        { ...finding, address: 0x4fd, kind: "contact-search", purpose: "contact search", writes: [] },
      ] as unknown as NonNullable<BehaviourReport["helpers"]>),
    );
    const loop = data.routines.find((r) => r.address === 0x600)!;
    loop.engineCalls!.push(
      { ...finding, instruction: 0x610, summary: 0x1d638, purpose: "rope pull" },
      { ...finding, instruction: 0x680, summary: 0x4fd, purpose: "contact search" },
      { ...finding, instruction: 0x690, summary: 0x1d797, purpose: "consumer" },
    );
    const run = (outcome: ReturnType<typeof member>, confidence: "inferred" | "unresolved") => {
      loop.iterationOutcomes = [{ ...outcome, confidence }];
      return otherPartPairs(data, evaluateBehaviourCondition).pairs.find(
        (p) => p.sourcePart === "teeter-totter" && p.targetPart === "cat",
      );
    };
    const isCat = compare(f(M, 4), "==", c(12));
    const unresolved = (object: string, offset: number): Expression =>
      ({ kind: "field", object, offset, width: 16, unresolved: true }) as Expression;
    const searched: Expression = {
      kind: "unknown",
      reason: "Conditional contact-search effect on field 0x20",
      width: 16,
    };
    // Launched, then swept by the contact search: its place after it is the run's, and so is a value read from it.
    const launch = [write(M, 0x38, c(0x1c00)), write(M, 0x20, searched)];
    expect(run(member(M, 0x700, isCat, launch), "inferred")).toMatchObject({ reasons: [CONTACT_SEARCH] });
    expect(
      run(
        member(M, 0x700, isCat, [write(M, 0x24, unresolved(`${M} after unresolved write at 0x680`, 0x20))]),
        "unresolved",
      ),
    ).toMatchObject({ reasons: [CONTACT_SEARCH] });
    // The rope pull's answer, or the tilt after it, decides whether the part is launched: the line reads it as the
    // source's test, and a found part's width after the pull as its own. Only the contact search's fields stay unsaid.
    const pulled = and(
      isCat,
      compare(unresolved("part after the query at 0x610", 0x12), "==", c(1)),
      compare(unresolved(`${M} after field effect at 0x610`, 0x44), "!=", c(0)),
    );
    expect(run(member(M, 0x700, pulled, launch), "unresolved")).toMatchObject({
      status: "partly described",
      undescribedFields: [0x20],
      reasons: [CONTACT_SEARCH],
    });
    const [line] = effectsFromOthers(data, evaluateBehaviourCondition).get(12)!.effects;
    expect(line).toMatchObject({ searched: [0x20], confidence: "inferred" });
    expect(line!.description).toContain("Then it runs the contact search on it, which may change its field 0x20");
    expect(JSON.stringify(line!.condition)).not.toContain("after field effect");
    expect(JSON.stringify(line!.sourceCondition)).toContain("part after the query at 0x610");
    // The cat's rules read its velocityX, and this test names its type: a walk reads past the rope pull.
    expect(run(member(M, 0x700, pulled, [write(M, 0x36, c(0x400))]), "unresolved")).toMatchObject({
      status: "described",
      walks: 1,
    });
    // Without its type named, a walk needs the search's tests, which this loop's search doesn't have read.
    const anyType = and(...(pulled as Extract<Predicate, { kind: "and" }>).terms.filter((t) => t !== isCat));
    expect(run(member(M, 0x700, anyType, [write(M, 0x36, c(0x400))]), "unresolved")).toMatchObject({
      status: "missing",
      reasons: [SEARCH_UNREAD],
    });
    // The same unknowns after another call, or anything else unknown, keep the general reasons.
    expect(
      run(
        member(M, 0x700, isCat, [write(M, 0x24, unresolved(`${M} after unresolved write at 0x690`, 0x20))]),
        "unresolved",
      ),
    ).toMatchObject({ reasons: [UNRESOLVED_PATH] });
    expect(
      run(member(M, 0x700, isCat, [write(M, 0x38, { kind: "unknown", reason: "Other", width: 16 })]), "inferred"),
    ).toMatchObject({ reasons: [UNKNOWN_VALUE] });
    // A helper's effect the loop doesn't carry, like the explosion's split of a wall, and a value past the size
    // budget, like the jack-in-the-box's push of a teeter-totter, say so.
    const unknownSet = (reason: string) => [write(M, 0x38, { kind: "unknown", reason, width: 16 })];
    expect(
      run(
        member(M, 0x700, isCat, unknownSet("Conditional owner-and-outline-relation effect on field 0x38")),
        "inferred",
      ),
    ).toMatchObject({ reasons: [HELPER_VALUE] });
    expect(
      run(member(M, 0x700, isCat, unknownSet("Symbolic expression size budget reached")), "inferred"),
    ).toMatchObject({ reasons: [BUDGET_VALUE] });
    // A velocity kept within the part's own speed limit, which the cat's rules read: a walk can't follow it.
    const limit: Expression = {
      kind: "table",
      segment: 0x2ef1,
      offset: 0x0a,
      index: bin("*", f(M, 4), c(58)),
      width: 16,
    };
    const negative = bin("-", c(0), limit);
    const speed = bin("+", f(M, 0x36), c(0x200));
    const test = (operator: string, right: Expression) =>
      ({ kind: "compare", operator, left: speed, right, signed: true }) as Extract<Predicate, { kind: "compare" }>;
    const kept = choose(test(">", limit), limit, choose(test("<", negative), negative, speed));
    expect(run(member(M, 0x700, isCat, [write(M, 0x36, kept)]), "inferred")).toMatchObject({
      status: "missing",
      reasons: [LIMIT_RULE_FIELD],
    });
  });

  it("describes a consumer read path by path apart from the run's own list", () => {
    const data = report();
    const consumer = data.helpers!.find((h) => h.address === 0x1d797)!;
    (consumer.listConsumer as { memberOutcomes?: unknown[] }).memberOutcomes = [];
    const LISTED = "overlap candidate at 0x1d897";
    const distance = bin("-", bin("+", f("part", 0x1e), c(74)), f(LISTED, 0x1e));
    const near = (operator: string, value: number): Predicate => ({
      kind: "compare",
      operator,
      left: distance,
      right: c(value),
      signed: true,
    });
    data.routines
      .find((r) => r.address === 0x600)!
      .iterationOutcomes!.push({
        ...member(LISTED, 0x1d897, and(compare(f(LISTED, 4), "==", c(45)), near(">=", 0), near("<=", 8)), [
          write(LISTED, 0x12, c(1)),
        ]),
        listConsumer: { address: 0x1d797, call: 0x650 },
      });
    const read = otherPartPairs(data, evaluateBehaviourCondition);
    const find = (target: string, way: string) =>
      read.pairs.find((p) => p.sourcePart === "teeter-totter" && p.targetPart === target && p.way === way);
    expect(find("candle", "list consumer")).toMatchObject({ status: "described", walks: 1, fields: [0x12] });
    // The run's own list keeps its reason, and the consumer isn't listed as unread.
    expect(find("cat", "overlap list")).toMatchObject({ status: "missing", reasons: [SOURCE_VALUE] });
    expect(read.consumers).toEqual([]);
  });

  it("reads past a constant test the conditions keep, and drops a path whose constant test fails", () => {
    const withTest = (test: Predicate) => {
      const data = report();
      const outcome = data.routines.find((r) => r.address === 0x600)!.iterationOutcomes![0]!;
      outcome.condition = and(outcome.condition, test);
      return otherPartPairs(data, evaluateBehaviourCondition).pairs.find(
        (p) => p.sourcePart === "teeter-totter" && p.targetPart === "cat",
      );
    };
    // `1 != 0` and `7 >=s 7` read no object: the reason is still the value's, not where the part is.
    expect(withTest(compare(c(1), "!=", c(0)))).toMatchObject({ status: "missing", reasons: [SOURCE_VALUE] });
    expect(withTest({ kind: "compare", operator: ">=", left: c(7), right: c(7), signed: true })).toMatchObject({
      status: "missing",
      reasons: [SOURCE_VALUE],
    });
    expect(withTest(compare(c(0), "!=", c(0)))).toBeUndefined();
  });

  it("names a consumer pair's lines only from that way, not from the same run's own list", () => {
    const data = report();
    const consumer = data.helpers!.find((h) => h.address === 0x1d797)!;
    (consumer.listConsumer as { memberOutcomes?: unknown[] }).memberOutcomes = [];
    const LISTED = "overlap candidate at 0x1d897";
    const OWN = "overlap candidate at 0x710";
    const distance = bin("-", bin("+", f("part", 0x1e), c(74)), f(LISTED, 0x1e));
    const near = (operator: string, value: number): Predicate => ({
      kind: "compare",
      operator,
      left: distance,
      right: c(value),
      signed: true,
    });
    const run = data.routines.find((r) => r.address === 0x600)!;
    run.iterationOutcomes!.push(
      {
        ...member(LISTED, 0x1d897, and(compare(f(LISTED, 4), "==", c(45)), near(">=", 0), near("<=", 8)), [
          write(LISTED, 0x12, c(1)),
        ]),
        listConsumer: { address: 0x1d797, call: 0x650 },
      },
      // The run's own list sets a field of a candle its rules don't read, which is a line of its own.
      member(OWN, 0x710, compare(f(OWN, 4), "==", c(45)), [write(OWN, 0x38, c(512))]),
    );
    const read = otherPartPairs(data, evaluateBehaviourCondition);
    const find = (way: string) =>
      read.pairs.find((p) => p.sourcePart === "teeter-totter" && p.targetPart === "candle" && p.way === way);
    expect(find("overlap list")).toMatchObject({ status: "described", lines: 1 });
    expect(find("list consumer")).toMatchObject({ status: "described", lines: 0, walks: 1 });
  });

  it("counts the found list's link as bookkeeping no part's rules read", () => {
    expect(pairs.foundLists.find((l) => l.sourcePart === "candle")).toMatchObject({
      queries: [{ call: 0x19ab2, helper: 0x448e, fields: [0x78] }],
      readBy: [],
    });
  });
});
