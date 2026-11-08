import { describe, expect, it } from "vitest";
import type { BehaviourReport, Expression, FieldWrite, Predicate } from "../src/read/behaviour.ts";
import { describeBehaviour, evaluateBehaviourCondition } from "../src/read/describe-behaviour.ts";
import { BULLET_LIST_ASSUMPTION, FIXED_LIST_ASSUMPTION } from "../src/read/describe-effects.ts";
import { hitsFromOthers, LIGHTABLE_ASSUMPTION, placeTest, placeWords } from "../src/read/describe-hits.ts";

const MEMBER = "overlap candidate at 0x1a819";
const proof = {
  confidence: "inferred" as const,
  assumptions: ["Synthetic extracted rule"],
  evidence: [{ address: 0x123, bytes: [0x90], text: "nop" }],
};
const c = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const f = (object: string, offset: number): Expression => ({ kind: "field", object, offset, width: 16 });
const compare = (left: Expression, operator: string, right: Expression): Predicate => ({
  kind: "compare",
  operator,
  left,
  right,
  signed: false,
});
const and = (...terms: Predicate[]): Predicate => ({ kind: "and", terms });
const masked = (object: string, offset: number, mask: number): Expression => ({
  kind: "binary",
  operator: "&",
  left: f(object, offset),
  right: c(mask),
  width: 16,
});
const write = (object: string, offset: number, value: Expression): FieldWrite => ({
  object,
  offset,
  width: 16,
  value,
  condition: { kind: "true" },
  routine: 500,
  ...proof,
});
const isType = (type: number) => compare(f(MEMBER, 4), "==", c(type));
const goingToFrame2 = compare(
  { kind: "binary", operator: "+", left: f("part", 12), right: c(1), width: 16 },
  "==",
  c(2),
);
const moving = compare(masked(MEMBER, 6, 0x1000), "!=", c(0));
const mirrored = compare(masked(MEMBER, 8, 0x10), "!=", c(0));
const notMirrored = compare(masked(MEMBER, 8, 0x10), "==", c(0));
const outcome = (condition: Predicate, fields: FieldWrite[]) => ({
  ...proof,
  scope: "one overlap-list member" as const,
  header: 0x1a819,
  object: MEMBER,
  effectsComplete: true,
  condition,
  fields,
});
const rule = (to: Expression, condition: Predicate) => ({ from: null, to, condition, routine: 100, ...proof });
const part = (id: string, type: number, transitions: ReturnType<typeof rule>[], routines: number[] = []) => ({
  id,
  type,
  frameCount: 3,
  routines: routines.map((address) => ({ slot: 1, address, role: "run callback candidate", ...proof })),
  stateWrites: [],
  transitions,
  counters: [],
  reset: [],
  visibleEffects: [],
  triggers: [],
  uncertainties: [],
});

const flags = (offset: number, mask: number, set: boolean) => ({ ...proof, offset, mask, set });
const search = (address: number, memberTests: ReturnType<typeof flags>[]) => ({
  ...proof,
  address,
  kind: "overlap-list",
  list: { memberTests },
});
/** A routine whose loop goes over the list one search call fills. */
const fromSearch = (
  address: number,
  header: number,
  call: number,
  query: number,
  found: ReturnType<typeof outcome>,
) => ({
  address,
  writes: [],
  ...proof,
  listLoops: [{ header, source: "overlap-query", queries: [call] }],
  engineCalls: [{ ...proof, instruction: call, summary: query, purpose: "Synthetic search." }],
  iterationOutcomes: [{ ...found, header }],
});

/**
 * A balloon and a mouse motor whose run reads the control value at 0x12, and an explosion that hits them. A rocket
 * that a candle lights, and a bullet and Mel Schlemming that a jack-in-the-box may punch, whose sources name no type.
 */
function report(): BehaviourReport {
  const reset = [write("part", 12, c(0)), write("part", 0x12, c(0))];
  return {
    listId: "synthetic",
    imageLength: 0,
    dataSegment: 0,
    layout: {
      fields: [
        { name: "state", offset: 12, ...proof },
        { name: "type", offset: 4, ...proof },
        { name: "drawingFlags", offset: 8, ...proof },
      ],
      ...proof,
    },
    timing: { diagnostics: [] },
    assumptions: [],
    relatedObjectEffects: [],
    parts: [
      {
        ...part("balloon", 4, [
          rule(c(1), and(compare(f("part", 12), "==", c(0)), compare(f("part", 0x12), "==", c(1)))),
          rule(c(1), compare(f("part", 12), "==", c(1))),
          rule(c(0), and(compare(f("part", 12), "==", c(0)), compare(f("part", 0x12), "==", c(0)))),
        ]),
        reset,
        routines: [
          { slot: 1, address: 100, role: "run callback candidate", ...proof },
          { slot: 2, address: 200, role: "reset callback candidate", ...proof },
        ],
      },
      part("mouse-motor", 6, [rule(c(1), compare(f("part", 0x12), "!=", c(0)))]),
      part("cat", 12, []),
      part("explosion", 41, [], [500]),
      part("rocket", 36, [rule(c(1), compare(f("part", 0x12), "!=", c(0)))]),
      part("bullet", 20, [rule(c(1), compare(f("part", 0x36), "!=", c(0)))]),
      part("mel-schlemming", 54, [rule(c(1), compare(f("part", 0x36), "!=", c(0)))]),
      part("candle", 45, [], [600]),
      part("jack-in-the-box", 13, [], [700]),
    ],
    helpers: [
      search(0x448e, [flags(0x0a, 4, true), flags(8, 0x2000, false)]),
      search(0x42da, [flags(8, 0x2000, false)]),
      {
        ...proof,
        address: 0x15d9b,
        kind: "part-factory",
        factory: { constructorFlags: [{ ...proof, type: 36, field: 0x0a, mask: 4 }] },
      },
    ],
    routines: [
      { address: 100, writes: [], ...proof },
      { address: 200, writes: reset, outcomes: [{ condition: { kind: "true" }, fields: reset, ...proof }], ...proof },
      {
        address: 500,
        writes: [],
        ...proof,
        iterationOutcomes: [
          // The balloon's control value set to 1, reached on two paths with different tests of the explosion.
          outcome(and(goingToFrame2, moving, isType(4)), [write(MEMBER, 0x12, c(1))]),
          outcome(and(compare(f("part", 12), "==", c(3)), moving, isType(4)), [write(MEMBER, 0x12, c(1))]),
          // The mouse motor's start: the step by whether it is mirrored, and the counter.
          outcome(and(goingToFrame2, isType(6), mirrored), [
            write(MEMBER, 0x12, c(0xffff)),
            write(MEMBER, 0x96, c(100)),
          ]),
          outcome(and(goingToFrame2, isType(6), notMirrored), [write(MEMBER, 0x12, c(1)), write(MEMBER, 0x96, c(100))]),
          // No type named: the search may hold parts the explosion never acts on.
          outcome(compare(f(MEMBER, 0x12), "==", c(0)), [write(MEMBER, 0x12, c(1))]),
          // A value the walk can't follow.
          outcome(isType(6), [write(MEMBER, 0x12, { kind: "unknown", reason: "unknown", width: 16 })]),
          // A field no rule reads.
          outcome(isType(12), [write(MEMBER, 0x96, c(5))]),
        ],
      },
      // The candle's first search: it lights every part it finds that isn't lit yet, and names no type.
      fromSearch(
        600,
        0x19acd,
        0x19ab2,
        0x448e,
        outcome(compare(f(MEMBER, 0x12), "==", c(0)), [write(MEMBER, 0x12, c(1))]),
      ),
      // The jack-in-the-box's punch on any part on the moving list.
      fromSearch(700, 0x1b9c8, 0x1b92f, 0x42da, outcome(moving, [write(MEMBER, 0x36, c(0xf800))])),
    ],
  } as unknown as BehaviourReport;
}

describe("walks from other parts that change a part's frame", () => {
  const hits = hitsFromOthers(report(), evaluateBehaviourCondition);

  it("keeps one hit per set of written fields, with the tests every path makes", () => {
    const balloon = hits.get(4)!.hits;
    expect(balloon).toHaveLength(1);
    expect(balloon[0]).toMatchObject({
      name: "Hit by an explosion",
      sources: [{ type: 41, part: "explosion", routine: 500 }],
      writes: [{ object: "part", offset: 0x12, value: c(1) }],
      condition: compare(masked("part", 6, 0x1000), "!=", c(0)),
      conditionWords: ["on the moving list"],
    });
  });

  it("walks a part that touches another part whose bounce callback changes it", () => {
    // The contact dispatch calls the touched part's bounce callback with the touching part as `collider`.
    const data = report();
    const tack = { ...part("thumb-tack", 53, []), routines: [{ slot: 0, address: 600, role: "bounce", ...proof }] };
    data.parts.push(tack as never);
    const angle = (value: number) => compare(f("collider", 0x88), "==", c(value));
    data.routines.push({
      address: 600,
      writes: [],
      ...proof,
      outcomes: [
        {
          ...proof,
          effectsComplete: true,
          condition: and(compare(f("collider", 4), "==", c(4)), angle(0x8000)),
          fields: [write("collider", 0x12, c(1))],
        },
        // A path that also changes the thumb tack itself: that is the thumb tack's own business.
        {
          ...proof,
          effectsComplete: true,
          condition: and(compare(f("collider", 4), "==", c(4)), angle(0x5e00)),
          fields: [write("collider", 0x12, c(1)), write("part", 0x12, c(1))],
        },
      ],
    } as never);
    const balloon = hitsFromOthers(data, evaluateBehaviourCondition).get(4)!.hits;
    const touch = balloon.find((hit) => hit.name === "Touching a thumb tack")!;
    // Both paths set the same, so the walk keeps only the tests both make: none.
    expect(touch).toMatchObject({
      sources: [{ type: 53, part: "thumb-tack", routine: 600 }],
      writes: [{ object: "part", offset: 0x12, value: c(1) }],
      condition: { kind: "true" },
    });
    expect(touch.assumptions.join(" ")).toContain("The part touches the source");
    // The explosion's hit stays its own walk, though it writes the same.
    expect(balloon.map((hit) => hit.name)).toContain("Hit by an explosion");
  });

  it("walks every moving part a bounce changes, with values of its own fields and what a response leaves unknown", () => {
    const data = report();
    // The bullet and Mel move; the cat's type is fixed here, so it never touches.
    data.helpers!.push({
      ...proof,
      address: 0x15d9c,
      kind: "part-factory",
      factory: {
        startingWords: [{ field: 6, values: Array.from({ length: 64 }, (_, t) => (t === 12 ? 0x4800 : 0x800)) }],
      },
    } as never);
    data.helpers = data.helpers!.filter((h) => !(h.kind === "part-factory" && h.address === 0x15d9b));
    data.parts.find((p) => p.id === "cat")!.transitions = [rule(c(1), compare(f("part", 0x36), "!=", c(0)))] as never;
    (data as { collisionDispatch?: unknown }).collisionDispatch = [
      { responses: [{ routine: 0x3980, status: "described", writes: [{ path: [], offset: 0x38, width: 16 }] }] },
    ];
    const minusOne: Expression = { kind: "binary", operator: "-", left: f("collider", 0x36), right: c(1), width: 16 };
    const answer = { ...f("answer of the query at 0x1d12a", 0), unresolved: true } as Expression;
    const centres = compare(f("collider", 0x1e), "<", f("part", 0x1e));
    const sw = { ...part("electric-switch", 21, []), routines: [{ slot: 0, address: 800, role: "bounce", ...proof }] };
    data.parts.push(sw as never);
    data.routines.push({
      address: 800,
      writes: [],
      ...proof,
      outcomes: [
        // Any type: velocityX one less, where the two parts are, when the query says so. The switch changes too.
        {
          ...proof,
          confidence: "unresolved",
          effectsComplete: true,
          condition: and(centres, compare(answer, "!=", c(0))),
          fields: [write("collider", 0x36, minusOne), write("part", 12, c(4))],
          returnValue: c(0),
        },
        // Mel only, and a response may follow: velocityY is unknown after it, but the frame isn't.
        {
          ...proof,
          effectsComplete: true,
          condition: compare(f("collider", 4), "==", c(54)),
          fields: [write("collider", 0x38, c(0)), write("collider", 12, c(9))],
          returnValue: c(1),
        },
        // A response would leave nothing known: no walk.
        {
          ...proof,
          effectsComplete: true,
          condition: compare(f("collider", 4), "==", c(20)),
          fields: [write("collider", 0x38, c(5))],
          returnValue: c(1),
        },
      ],
    } as never);
    const hits = hitsFromOthers(data, evaluateBehaviourCondition);
    const bullet = hits.get(20)!.hits.find((h) => h.name === "Touching an electric switch")!;
    expect(bullet.writes).toEqual([
      expect.objectContaining({
        offset: 0x36,
        value: { kind: "binary", operator: "-", left: f("part", 0x36), right: c(1), width: 16 },
      }),
    ]);
    expect(bullet.confidence).toBe("inferred");
    expect(bullet.assumptions.join(" ")).toContain("compare the two parts");
    expect(bullet.assumptions.join(" ")).toContain("A query's answer");
    const mel = hits.get(54)!.hits.filter((h) => h.name === "Touching an electric switch");
    expect(mel.map((h) => h.writes.map((w) => [w.offset, w.value.kind]))).toContainEqual([
      [12, "constant"],
      [0x38, "unknown"],
    ]);
    expect(mel.find((h) => h.writes.length === 2)!.assumptions.join(" ")).toContain("contact response");
    // The cat's type is fixed: it never touches, and says so.
    expect(hits.get(12)!.hits.filter((h) => h.name.startsWith("Touching"))).toEqual([]);
    expect(hits.get(12)!.assumptions).toContain(FIXED_LIST_ASSUMPTION);
  });

  it("splits the mouse motor's start by the step it gets, with the part's own test", () => {
    const motor = hits.get(6)!.hits;
    expect(motor.map((h) => h.writes.map((w) => [w.offset, w.value]))).toEqual([
      [
        [0x12, c(0xffff)],
        [0x96, c(100)],
      ],
      [
        [0x12, c(1)],
        [0x96, c(100)],
      ],
    ]);
    expect(motor.map((h) => h.condition)).toEqual([
      compare(masked("part", 8, 0x10), "!=", c(0)),
      compare(masked("part", 8, 0x10), "==", c(0)),
    ]);
  });

  it("leaves out outcomes that name no type, set an unknown value or a field no rule reads", () => {
    expect(hits.get(12)).toBeUndefined();
    expect(hits.get(41)).toBeUndefined();
    expect(hits.get(6)!.hits).toHaveLength(2);
  });

  it("walks a part no source names when the search's tests are known and the type gets the flags they need", () => {
    const rocket = hits.get(36)!.hits;
    expect(rocket).toHaveLength(1);
    expect(rocket[0]).toMatchObject({
      name: "Hit by a candle",
      writes: [{ object: "part", offset: 0x12, value: c(1) }],
      // The decided assumption marks the rocket as lightable, so the walk doesn't keep that test.
      condition: and(compare(f("part", 0x12), "==", c(0)), compare(masked("part", 8, 0x2000), "==", c(0))),
    });
    expect(rocket[0]!.assumptions).toContain(LIGHTABLE_ASSUMPTION);
    // The balloon reads the control value too, but the decided assumption says it is never lightable.
    expect(hits.get(4)!.hits.map((h) => h.name)).toEqual(["Hit by an explosion"]);
    expect(hits.get(4)!.assumptions).toEqual([LIGHTABLE_ASSUMPTION]);
  });

  it("keeps a lightable part's walk to the flags its constructor gives", () => {
    // Without the constructor's flag the candle's search gives the rocket no walk, though the assumption names it.
    const data = report();
    const factory = data.helpers!.find((h) => h.kind === "part-factory")!;
    (factory as { factory: { constructorFlags: unknown[] } }).factory.constructorFlags = [];
    expect(hitsFromOthers(data, evaluateBehaviourCondition).get(36)).toBeUndefined();
  });

  it("gives the bullet no punch from the jack-in-the-box, by the decided assumption, and says so", () => {
    expect(hits.get(20)).toEqual({ hits: [], assumptions: [BULLET_LIST_ASSUMPTION] });
    // Another part that reads its velocity is still punched when it is on the moving list.
    expect(hits.get(54)!.hits).toMatchObject([
      {
        name: "Hit by a jack-in-the-box",
        writes: [{ offset: 0x36, value: c(0xf800) }],
        condition: and(compare(masked("part", 6, 0x1000), "!=", c(0)), compare(masked("part", 8, 0x2000), "==", c(0))),
      },
    ]);
  });

  it("walks the balloon from its reset frame after the hit", () => {
    const balloon = describeBehaviour(report()).parts[0]!;
    const hit = balloon.animations.find((a) => a.id === "hit-0")!;
    expect(hit.trigger).toMatchObject({ kind: "related-write", name: "Hit by an explosion" });
    expect(hit.walk.states).toEqual([0, 1, 1]);
    expect(hit.walk.status).toBe("rest");
  });

  it("walks what a list consumer does to a part, with where it must lie from the source in words", () => {
    const data = report();
    data.layout.fields.push({ name: "positionX", offset: 0x1e, ...proof } as never);
    data.parts.push(
      part("scissors", 37, [rule(c(1), compare(f("part", 0x12), "!=", c(0)))]) as never,
      part("teeter-totter", 3, [], [900]) as never,
    );
    // The teeter-totter's run hands the list at its right end (its positionX + 74) to the consumer at 0x1d797.
    const end = (point: Expression): Expression => ({
      kind: "binary",
      operator: "+",
      left: point,
      right: c(74),
      width: 16,
    });
    const distance = (point: Expression): Expression => ({
      kind: "binary",
      operator: "-",
      left: end(point),
      right: f(MEMBER, 0x1e),
      width: 16,
    });
    const at =
      (point: Expression) =>
      (operator: string, value: number): Predicate => ({
        kind: "compare",
        operator,
        left: distance(point),
        right: c(value),
        signed: true,
      });
    const within = at(f("part", 0x1e));
    // A value the run gives the owner's field after its list scan is not where the teeter-totter is.
    const scanned = at({ ...f("part after list scan at 0x1d451", 0x1e), unresolved: true } as Expression);
    const consumed = (condition: Predicate, fields: FieldWrite[]) => ({
      ...outcome(condition, fields),
      confidence: "unresolved" as const,
      listConsumer: { address: 0x1d797, call: 0x1d49a },
    });
    data.routines.push({
      address: 900,
      writes: [],
      ...proof,
      iterationOutcomes: [
        consumed(and(isType(37), notMirrored, within(">=", 0), within("<=", 12)), [write(MEMBER, 0x12, c(1))]),
        consumed(and(isType(37), mirrored, within(">=", 25), within("<=", 37)), [write(MEMBER, 0x12, c(1))]),
        consumed(and(isType(37), notMirrored, scanned(">=", 50), scanned("<=", 60)), [write(MEMBER, 0x12, c(1))]),
        // A test of something else of the two parts isn't a place, so no walk is made from it.
        consumed(and(isType(37), compare(f("part", 0x20), "<", f(MEMBER, 0x20))), [write(MEMBER, 0x12, c(2))]),
      ],
    } as never);
    const scissors = hitsFromOthers(data, evaluateBehaviourCondition).get(37)!.hits;
    expect(scissors.map((hit) => hit.name)).toEqual([
      "Hit by a teeter-totter, when its positionX is 0 to 12 pixels left of the teeter-totter's right end (positionX + 74)",
      "Hit by a teeter-totter, when its positionX is 25 to 37 pixels left of the teeter-totter's right end (positionX + 74)",
    ]);
    expect(scissors[0]).toMatchObject({
      sources: [{ type: 3, part: "teeter-totter", routine: 900, consumer: 0x1d797 }],
      writes: [{ object: "part", offset: 0x12, value: c(1) }],
      condition: compare(masked("part", 8, 0x10), "==", c(0)),
      placeWords: ["its positionX is 0 to 12 pixels left of the teeter-totter's right end (positionX + 74)"],
    });
    expect(scissors[0]!.assumptions.join(" ")).toContain("the walk doesn't follow where parts are");
  });

  it("walks what a search's own list does to a part only within reach of the source, in words", () => {
    const data = report();
    data.layout.fields.push(
      { name: "positionX", offset: 0x1e, ...proof } as never,
      { name: "frameWidth", offset: 0x44, ...proof } as never,
    );
    data.parts.push(
      part("electric-switch", 21, [rule(c(1), compare(f("part", 0x0c), ">=", c(4)))]) as never,
      part("jack-in-the-box", 13, [], [901]) as never,
    );
    // The jack-in-the-box flips a switch whose positionX - 2 is left of its own centre X.
    const centre: Expression = {
      kind: "binary",
      operator: "+",
      left: f("part", 0x1e),
      right: { kind: "binary", operator: ">>", left: f("part", 0x44), right: c(1), width: 16 },
      width: 16,
    };
    const reach: Predicate = {
      kind: "compare",
      operator: "<",
      left: { kind: "binary", operator: "+", left: f(MEMBER, 0x1e), right: c(0xfffe), width: 16 },
      right: centre,
      signed: true,
    };
    data.routines.push({
      address: 901,
      writes: [],
      ...proof,
      iterationOutcomes: [outcome(and(isType(21), reach), [write(MEMBER, 0x0c, c(4))])],
    } as never);
    const [flip] = hitsFromOthers(data, evaluateBehaviourCondition).get(21)!.hits;
    expect(flip).toMatchObject({
      sources: [{ type: 13, part: "jack-in-the-box", routine: 901 }],
      placeWords: [
        "its positionX is at most 1 pixel right of the jack-in-the-box's centre X (positionX + frameWidth / 2)",
      ],
    });
    expect(flip!.assumptions.join(" ")).toContain("Two parts' places differ by less than 32,768 pixels");
  });

  it("reads the overlap a search stored in the part as its own, and a type record word its type settles", () => {
    const data = report();
    data.parts.push(
      part("windmill", 40, [rule(c(1), compare(f("part", 0x12), "!=", c(0)))]) as never,
      part("fan", 50, [], [902]) as never,
    );
    // Record words of 0x3a bytes from 0x2ef10; the windmill's word at +0x02 is 3.
    (data as { typeTable?: unknown }).typeTable = {
      address: 0x2ef10,
      stride: 0x3a,
      words: Array.from({ length: 60 }, (_, type) =>
        Array.from({ length: 29 }, (_, n) => (n === 1 && type === 40 ? 3 : 0)),
      ),
    };
    const stored: Expression = {
      ...f(`overlapX the query at 0x1abc7 found for ${MEMBER}`, 0x7a),
      unresolved: true,
    } as Expression;
    const word: Expression = {
      kind: "table",
      segment: 0x2ef1,
      offset: 2,
      index: { kind: "binary", operator: "*", left: f(MEMBER, 4), right: c(0x3a), width: 16 },
      width: 16,
    };
    data.routines.push({
      address: 902,
      writes: [],
      ...proof,
      iterationOutcomes: [
        {
          ...outcome(and(isType(40), { kind: "compare", operator: "<", left: stored, right: c(200), signed: true }), [
            write(MEMBER, 0x12, word),
          ]),
          confidence: "unresolved" as const,
        },
      ],
    } as never);
    const [turn] = hitsFromOthers(data, evaluateBehaviourCondition).get(40)!.hits;
    expect(turn).toMatchObject({
      sources: [{ type: 50, part: "fan", routine: 902 }],
      writes: [{ object: "part", offset: 0x12, value: c(3) }],
    });
    expect(JSON.stringify(turn!.condition)).toContain('"object":"part","offset":122');
  });

  it("walks past the source's rope pull, leaving what it answers to the source", () => {
    const data = report();
    data.parts.push(
      part("windmill", 40, [rule(c(1), compare(f("part", 0x12), "!=", c(0)))]) as never,
      part("teeter-totter", 3, [], [903]) as never,
    );
    (data.helpers as unknown[]).push({ ...proof, address: 0x1d638, kind: "connection-query", purpose: "rope pull" });
    const answer: Expression = { ...f("answer of the query at 0x610", 0), unresolved: true } as Expression;
    data.routines.push({
      address: 903,
      writes: [],
      ...proof,
      engineCalls: [{ ...proof, instruction: 0x610, summary: 0x1d638, purpose: "rope pull" }],
      iterationOutcomes: [
        {
          ...outcome(and(isType(40), compare(answer, "==", c(0))), [write(MEMBER, 0x12, c(1))]),
          confidence: "unresolved" as const,
        },
      ],
    } as never);
    expect(hitsFromOthers(data, evaluateBehaviourCondition).get(40)!.hits).toMatchObject([
      { sources: [{ type: 3, part: "teeter-totter", routine: 903 }], writes: [{ offset: 0x12, value: c(1) }] },
    ]);
  });

  it("puts place tests in words by the side the part lies on", () => {
    const name = (offset: number) => (offset === 0x1e ? "positionX" : "?");
    expect(
      placeWords(
        [
          { offset: 0x1e, shift: 0, high: -4 },
          { offset: 0x1e, shift: 0, low: -9 },
        ],
        "fan",
        name,
      ),
    ).toEqual(["its positionX is 4 to 9 pixels right of the fan's positionX"]);
    expect(placeWords([{ offset: 0x1e, shift: 0, low: 0, high: 8 }], "teeter-totter", name, "teeter-totter")).toEqual([
      "its positionX is 0 to 8 pixels left of the teeter-totter's left end (positionX)",
    ]);
    expect(placeWords([{ offset: 0x1e, shift: 74, low: 0, high: 8 }], "teeter-totter", name, "teeter-totter")).toEqual([
      "its positionX is 0 to 8 pixels left of the teeter-totter's right end (positionX + 74)",
    ]);
    // Another shift of the same part isn't an end.
    expect(placeWords([{ offset: 0x1e, shift: 30, low: 0, high: 8 }], "teeter-totter", name, "teeter-totter")).toEqual([
      "its positionX is 0 to 8 pixels left of the teeter-totter's positionX + 30",
    ]);
    expect(placeWords([{ offset: 0x1e, shift: -6, low: 3 }], "fan", name)).toEqual([
      "its positionX is at least 3 pixels left of the fan's positionX - 6",
    ]);
    // One pixel or more is simply to that side.
    expect(placeWords([{ offset: 0x1e, shift: 0, low: 1 }], "fan", name)).toEqual([
      "its positionX is left of the fan's positionX",
    ]);
    expect(placeWords([{ offset: 0x1e, shift: 0, high: -1 }], "fan", name)).toEqual([
      "its positionX is right of the fan's positionX",
    ]);
  });

  it("says a place down the screen as above or below, and a centre with its formula", () => {
    const name = (offset: number) => ({ 0x1e: "positionX", 0x20: "positionY", 0x44: "frameWidth" })[offset] ?? "?";
    expect(placeWords([{ offset: 0x20, shift: 0, high: -47 }], "vacuum cleaner", name)).toEqual([
      "its positionY is at least 47 pixels below the vacuum cleaner's positionY",
    ]);
    expect(placeWords([{ offset: 0x20, shift: 0, low: -46, high: -45 }], "vacuum cleaner", name)).toEqual([
      "its positionY is 45 to 46 pixels below the vacuum cleaner's positionY",
    ]);
    expect(
      placeWords(
        [
          { offset: 0x1e, half: 0x44, memberHalf: 0x44, shift: 0, low: -4 },
          { offset: 0x1e, half: 0x44, memberHalf: 0x44, shift: 0, high: 4 },
        ],
        "vacuum cleaner",
        name,
      ),
    ).toEqual(["its centre X is within 4 pixels of the vacuum cleaner's centre X (positionX + frameWidth / 2)"]);
    // The jack-in-the-box measures from the part's positionX to its own centre X.
    expect(placeWords([{ offset: 0x1e, half: 0x44, shift: 0, low: 20 }], "jack-in-the-box", name)).toEqual([
      "its positionX is at least 20 pixels left of the jack-in-the-box's centre X (positionX + frameWidth / 2)",
    ]);
    expect(placeWords([{ offset: 0x20, shift: 0, low: 0 }], "fan", name)).toEqual([
      "its positionY is at or above the fan's positionY",
    ]);
  });

  it("reads a test comparing the two parts' places as the distance between them", () => {
    const signed = (left: Expression, operator: string, right: Expression): Predicate => ({
      kind: "compare",
      operator,
      left,
      right,
      signed: true,
    });
    const plus = (left: Expression, right: Expression): Expression => ({
      kind: "binary",
      operator: "+",
      left,
      right,
      width: 16,
    });
    const half = (object: string): Expression => ({
      kind: "binary",
      operator: ">>",
      left: f(object, 0x44),
      right: c(1),
      width: 16,
    });
    // The vacuum cleaner at 0x1e6c4 (Even More, English floppy): `cmp [di+0x20], ax; jg` with ax its positionY + 44.
    expect(placeTest(signed(f(MEMBER, 0x20), ">", plus(f("part", 0x20), c(0x2c))), MEMBER)).toEqual({
      offset: 0x20,
      shift: 0,
      high: -45,
      compared: true,
    });
    // Its centre X less 4 at most the member's centre X: the member is at most 4 pixels left of it.
    const centre = (object: string) => plus(f(object, 0x1e), half(object));
    expect(placeTest(signed(plus(centre("part"), c(0xfffc)), "<=", centre(MEMBER)), MEMBER)).toEqual({
      offset: 0x1e,
      half: 0x44,
      memberHalf: 0x44,
      shift: 0,
      high: 4,
      compared: true,
    });
    // The jack-in-the-box at 0x19f70: the part's positionX + 20 at most its centre X.
    expect(placeTest(signed(plus(f(MEMBER, 0x1e), c(0x14)), "<=", centre("part")), MEMBER)).toEqual({
      offset: 0x1e,
      half: 0x44,
      shift: 0,
      low: 20,
      compared: true,
    });
    // The teeter-totter adds a value of its own fields to its positionX, like half its new frame's width.
    const own: Expression = { kind: "table", segment: 0x2fe1, offset: 6, index: f("part", 0x0c), width: 16 };
    const halfOwn: Expression = { kind: "binary", operator: ">>", left: own, right: c(1), width: 16 };
    expect(placeTest(signed(centre(MEMBER), "<", plus(f("part", 0x1e), halfOwn)), MEMBER)).toEqual({
      offset: 0x1e,
      memberHalf: 0x44,
      extra: halfOwn,
      shift: 0,
      low: 1,
      compared: true,
    });
    // A value that reads the member, or something unknown, isn't the source's own.
    const theirs: Expression = { ...own, index: f(MEMBER, 0x0c) };
    expect(
      placeTest(signed(centre(MEMBER), "<", plus(f("part", 0x1e), { ...halfOwn, left: theirs } as Expression)), MEMBER),
    ).toBeUndefined();
    // Two different places, or a part's place against a number, aren't a place test.
    expect(placeTest(signed(f(MEMBER, 0x20), ">", plus(f("part", 0x1e), c(4))), MEMBER)).toBeUndefined();
    expect(placeTest(signed(f(MEMBER, 0x20), ">", c(4)), MEMBER)).toBeUndefined();
    // Nor is an unsigned test.
    expect(placeTest(compare(f(MEMBER, 0x20), ">", f("part", 0x20)), MEMBER)).toBeUndefined();
  });
});
