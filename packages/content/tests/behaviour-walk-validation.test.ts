import { describe, expect, it } from "vitest";
import type { BehaviourReport, Expression, Predicate } from "../src/read/behaviour.ts";
import type { Instruction } from "../src/read/x86.ts";
import {
  WIDENING_ASSUMPTION,
  type AnimationDescription,
  type BehaviourWalk,
  type KnownField,
} from "../src/read/describe-behaviour.ts";
import { compareMeasuredWalks } from "../src/read/behaviour-walk-validation.ts";
import { measuredClips, type MeasuredClip } from "../src/read/behaviour-validation.ts";

const proof = { confidence: "inferred" as const, assumptions: ["Synthetic extracted rules."], evidence: [] };
function animation(states = [0, 1, 0, 0]): AnimationDescription {
  return {
    ...proof,
    id: "activation",
    initial: "documented-rest",
    prerequisites: [],
    initialFields: [
      { ...proof, object: "part", offset: 12, width: 16, value: 0, knownMask: 65535 },
      { ...proof, object: "part", offset: 18, width: 16, value: 1, knownMask: 65535 },
    ],
    trigger: {
      ...proof,
      kind: "callback",
      name: "Contact",
      description: "If contact reaches this write.",
      routine: 0,
      condition: { kind: "true" },
      writes: [],
    },
    walk: {
      ...proof,
      status: "rest",
      states,
      frames: [],
      runCalls: states.length - 1,
      fields: [],
      timingReason: "Run calls only.",
    },
  };
}
const clip = (control = 1): MeasuredClip => ({
  path: "synthetic",
  frames: [
    { state: 0, control },
    { state: 1, control },
    { state: 0, control: 0 },
  ],
  loopStart: null,
  input: {},
  skippedEngineServices: {},
});

describe("measured description walks", () => {
  it("compares a symbolic periodic block without supplying a numeric start to the description", () => {
    const model = animation([]);
    model.trigger.kind = "input-case";
    model.initial = "run-guard";
    model.initialFields = [];
    model.walk.status = "loop";
    model.walk.loopStart = 0;
    model.walk.parameterised = {
      kind: "cycle",
      state: { kind: "field", object: "level-supplied cycle state", offset: 12, width: 16 },
      period: 4,
      direction: 1,
      minimumBase: 0,
      maximumBase: 12,
    };
    const recording = { ...clip(), frames: [5, 6, 7, 4].map((state) => ({ state, control: 1 })), loopStart: 0 };
    expect(compareMeasuredWalks([model], recording).classification).toBe("complete");
    const invalid = { ...recording, frames: [17, 18, 19, 16].map((state) => ({ state, control: 1 })) };
    expect(compareMeasuredWalks([model], invalid).classification).toBe("unavailable");
    expect(model.walk.states).toEqual([]);
  });
  it("recognises a matching full walk with its stable ending", () => {
    expect(compareMeasuredWalks([animation()], clip()).classification).toBe("complete");
  });
  it("does not call a different trigger's walk a behaviour mismatch", () => {
    expect(compareMeasuredWalks([animation()], clip(0)).classification).toBe("unavailable");
  });
  it("counts a correct beginning that stops as a prefix", () => {
    const model = animation([0, 1]);
    model.walk.status = "unresolved";
    model.walk.reason = "The next rule is unresolved.";
    expect(compareMeasuredWalks([model], clip())).toMatchObject({ classification: "prefix", prefixFrames: 2 });
  });
  it("reports a difference when compatible initial fields predict a different continuation", () => {
    expect(compareMeasuredWalks([animation([0, 2])], clip())).toMatchObject({
      classification: "different",
      prefixFrames: 1,
    });
  });
  it("does not treat an unknown starting frame as a correct prefix", () => {
    expect(compareMeasuredWalks([], clip())).toMatchObject({ classification: "unavailable", prefixFrames: 0 });
  });
  it("does not claim repeated external writes were established by a single trigger", () => {
    const measured = clip();
    measured.input = { hold: { control: 1 } };
    expect(compareMeasuredWalks([animation()], measured).classification).toBe("prefix");
  });
});

describe("conditional input walk comparisons", () => {
  it("requires the recording to establish an explicit input case", () => {
    const model = animation();
    model.trigger.kind = "input-case";
    model.initial = "run-guard";
    model.inputCondition = {
      kind: "compare",
      operator: "==",
      left: { kind: "field", object: "part", offset: 18, width: 16 },
      right: { kind: "constant", value: 1, width: 16 },
      signed: false,
    };
    expect(compareMeasuredWalks([model], clip()).basis).toBe("input-case");
    expect(compareMeasuredWalks([model], clip(0)).classification).toBe("unavailable");
  });

  it("checks a parameterised identity without inventing its initial frame", () => {
    const model = animation([]);
    model.initialFields = [];
    model.trigger.kind = "input-case";
    model.initial = "run-guard";
    model.inputCondition = {
      kind: "compare",
      operator: "==",
      left: { kind: "field", object: "part", offset: 18, width: 16 },
      right: { kind: "constant", value: 0, width: 16 },
      signed: false,
    };
    model.walk.parameterised = { kind: "hold", state: { kind: "field", object: "part", offset: 12, width: 16 } };
    model.walk.runCalls = 1;
    const measured = clip(0);
    measured.frames = [{ state: 7, control: 0 }];
    expect(compareMeasuredWalks([model], measured)).toMatchObject({ classification: "complete", basis: "input-case" });
    expect(model.walk.states).toEqual([]);
  });

  it("does not call an unevaluated starting condition a complete match", () => {
    const model = animation();
    model.trigger.kind = "input-case";
    model.inputCondition = {
      kind: "compare",
      operator: "==",
      left: { kind: "field", object: "part", offset: 0xb0, width: 16 },
      right: { kind: "constant", value: 2, width: 16 },
      signed: false,
    };
    expect(compareMeasuredWalks([model], clip())).toMatchObject({
      classification: "prefix",
      conditionCompatibility: "unresolved",
    });
  });
});

describe("walks that start on an unknown frame", () => {
  const equals = (offset: number, value: number) => ({
    kind: "compare" as const,
    operator: "==",
    left: { kind: "field" as const, object: "part", offset, width: 16 },
    right: { kind: "constant" as const, value, width: 16 },
    signed: false,
  });
  /** A walk that follows each starting frame as a branch, like a reset that restores a level's saved frame. */
  function branched(offset = 12): AnimationDescription {
    const model = animation([]);
    model.initialFields = [];
    model.walk.status = "unresolved";
    model.walk.runCalls = 0;
    model.walk.stop = {
      kind: "state",
      description: "The starting frame is not known.",
      evidence: [],
      branches: [
        { condition: equals(offset, 0), walk: { ...animation([0, 1, 0, 0]).walk } },
        { condition: equals(offset, 1), walk: { ...animation([1, 0, 0]).walk } },
      ],
    };
    return model;
  }

  it("compares the recording with the branch of its first frame", () => {
    expect(compareMeasuredWalks([branched()], clip())).toMatchObject({ classification: "complete", prefixFrames: 3 });
    const second = { ...clip(), frames: [1, 0].map((state) => ({ state, control: 1 })) };
    expect(compareMeasuredWalks([branched()], second)).toMatchObject({ classification: "complete", prefixFrames: 2 });
  });

  it("chooses no branch for a frame the walk doesn't follow", () => {
    const other = { ...clip(), frames: [2, 0].map((state) => ({ state, control: 1 })) };
    expect(compareMeasuredWalks([branched()], other).classification).toBe("unavailable");
  });

  it("takes a split on something other than the frame as the rules that give the next frame", () => {
    // Each branch then starts one run later, whatever the first frame was; the control value 1 rules out the first.
    const any = { ...clip(), frames: [5, 1, 0].map((state) => ({ state, control: 1 })) };
    expect(compareMeasuredWalks([branched(18)], any)).toMatchObject({ classification: "complete", prefixFrames: 3 });
    const other = { ...clip(), frames: [5, 0, 1].map((state) => ({ state, control: 1 })) };
    expect(compareMeasuredWalks([branched(18)], other).classification).toBe("different");
  });
});

describe("comparisons that follow a walk's branches", () => {
  type Branches = NonNullable<NonNullable<BehaviourWalk["stop"]>["branches"]>;
  const test = (offset: number, operator: string, value: number): Predicate => ({
    kind: "compare",
    operator,
    left: { kind: "field", object: "part", offset, width: 16 },
    right: { kind: "constant", value, width: 16 },
    signed: false,
  });
  const walk = (
    states: number[],
    status: BehaviourWalk["status"],
    more: Partial<BehaviourWalk> = {},
  ): BehaviourWalk => ({
    ...proof,
    status,
    states,
    frames: [],
    runCalls: Math.max(0, states.length - 1),
    fields: [],
    timingReason: "Run calls only.",
    ...(status === "rest" ? { loopStart: states.length - 2 } : {}),
    ...more,
  });
  const rest = (...states: number[]) => walk(states, "rest");
  const split = (states: number[], branches: Branches, kind: "ambiguity" | "state" = "ambiguity") =>
    walk(states, "unresolved", { stop: { kind, description: "Branches.", evidence: [], branches } });
  const start = (root: BehaviourWalk): AnimationDescription => ({
    ...animation(),
    initialFields: [{ ...proof, object: "part", offset: 12, width: 16, value: 0, knownMask: 65535 }],
    walk: root,
  });
  const recording = (frames: number[], control = 1, loopStart: number | null = null): MeasuredClip => ({
    path: "synthetic",
    frames: frames.map((state) => ({ state, control })),
    loopStart,
    input: {},
    skippedEngineServices: {},
  });
  // A field the recording doesn't save: the frames decide between these branches.
  const unsaved = (operator: string) => test(0x54, operator, 0);

  it("follows the branch whose frames the recording shows", () => {
    const model = start(
      split(
        [0],
        [
          { condition: unsaved("=="), walk: rest(1, 1) },
          { condition: unsaved("!="), walk: rest(2, 2) },
        ],
      ),
    );
    expect(compareMeasuredWalks([model], recording([0, 1]))).toMatchObject({
      classification: "complete",
      prefixFrames: 2,
    });
    expect(compareMeasuredWalks([model], recording([0, 2])).classification).toBe("complete");
    const different = compareMeasuredWalks([model], recording([0, 3]));
    expect(different).toMatchObject({ classification: "different", prefixFrames: 1 });
    expect(different.reason).toMatch(/^Every branch the recording allows disagrees/);
  });

  it("does not follow a branch the recording's starting fields rule out", () => {
    const model = start(
      split(
        [0],
        [
          { condition: test(18, "==", 0), walk: rest(1, 1) },
          { condition: test(18, "==", 1), walk: rest(2, 2) },
        ],
      ),
    );
    // The recording starts with control 1: only the second branch fits, and it shows another frame.
    expect(compareMeasuredWalks([model], recording([0, 1], 1)).classification).toBe("different");
    expect(compareMeasuredWalks([model], recording([0, 1], 0)).classification).toBe("complete");
    // A branch is ruled out only when every alternative it lists is ruled out too.
    const alternatives = start(
      split(
        [0],
        [
          { condition: { kind: "true" }, alternatives: [test(18, "==", 0), test(0x54, "==", 0)], walk: rest(1, 1) },
          { condition: test(18, "==", 1), walk: rest(2, 2) },
        ],
      ),
    );
    expect(compareMeasuredWalks([alternatives], recording([0, 1], 1)).classification).toBe("complete");
  });

  it("takes a recording's part as touching nothing at the start", () => {
    const touching = (bit: number): Predicate => ({
      kind: "compare",
      operator: "!=",
      left: {
        kind: "binary",
        operator: "&",
        left: { kind: "field", object: "part", offset: 0x06, width: 16 },
        right: { kind: "constant", value: bit, width: 16 },
        width: 16,
      },
      right: { kind: "constant", value: 0, width: 16 },
      signed: false,
    });
    const free = (bit: number): Predicate => ({
      ...(touching(bit) as Extract<Predicate, { kind: "compare" }>),
      operator: "==",
    });
    const model = (bit: number) =>
      start(
        split(
          [0],
          [
            { condition: touching(bit), walk: rest(1, 1) },
            { condition: free(bit), walk: rest(0, 0) },
          ],
        ),
      );
    const [normal] = measuredClips({ normal: { frames: [{ state: 0 }], loopStart: null } });
    // The contact bits 0 to 2 of the list flags are clear on the recorder's bench.
    expect(compareMeasuredWalks([model(1)], normal!).classification).toBe("complete");
    expect(compareMeasuredWalks([model(2)], normal!).classification).toBe("complete");
    // Other list flags, like the moving list, stay unknown.
    expect(compareMeasuredWalks([model(0x1000)], normal!).classification).toBe("prefix");
    // A match that needs them says so, as decided with the user; one that doesn't, doesn't.
    expect(compareMeasuredWalks([model(1)], normal!)).toMatchObject({
      untouchedStart: true,
      reason: expect.stringMatching(/touching nothing at the start/),
    });
    expect(compareMeasuredWalks([animation()], clip()).untouchedStart).toBeUndefined();
  });

  it("takes the part's normal seed as a starting field when the frames don't save it", () => {
    const model = start(
      split(
        [0],
        [
          { condition: test(0x36, "!=", 0x3000), walk: rest(1, 1) },
          { condition: test(0x36, "==", 0x3000), walk: rest(0, 0) },
        ],
      ),
    );
    // The recorder sets the speed from the part's normal seed before every clip; the frames don't save it.
    const part = { normalSeed: { vx: 0x3000 }, normal: { frames: [{ state: 0 }], loopStart: null } };
    const [normal] = measuredClips(part);
    expect(normal!.partSeed).toEqual({ vx: 0x3000 });
    expect(compareMeasuredWalks([model], normal!).classification).toBe("complete");
    // Without the seed the frames can't tell whether the speed lets the part rest.
    expect(compareMeasuredWalks([model], { ...normal!, partSeed: undefined }).classification).toBe("prefix");
    // A clip's own seed goes over the part's normal seed.
    const hit = measuredClips({
      ...part,
      actions: [{ clip: { frames: [{ state: 0 }, { state: 1 }], input: { seed: { vx: 0 } } } }],
    })[1]!;
    expect(compareMeasuredWalks([model], hit).classification).toBe("complete");
  });

  it("uses the starting fields only for the first run's branches", () => {
    const model = start(
      split(
        [0],
        [
          {
            condition: { kind: "true" },
            walk: split(
              [1],
              [
                { condition: test(18, "==", 0), walk: rest(2, 2) },
                { condition: test(18, "==", 1), walk: rest(3, 3) },
              ],
            ),
          },
        ],
      ),
    );
    // The run may have changed the control value by its second run, so its control test can't be ruled out.
    expect(compareMeasuredWalks([model], recording([0, 1, 2], 1)).classification).toBe("complete");
  });

  it("stays a prefix while a branch the recording allows is open", () => {
    const model = start(
      split(
        [0],
        [
          { condition: unsaved("=="), walk: rest(1, 1) },
          { condition: unsaved("!="), walk: walk([1], "unresolved", { reason: "The next rule is unresolved." }) },
        ],
      ),
    );
    expect(compareMeasuredWalks([model], recording([0, 1]))).toMatchObject({
      classification: "prefix",
      prefixFrames: 2,
      reason: "The next rule is unresolved.",
    });
  });

  it("stays a prefix when a branch the recording allows changes the frame after it ends", () => {
    const model = start(
      split(
        [0],
        [
          { condition: unsaved("=="), walk: rest(1, 1) },
          { condition: unsaved("!="), walk: rest(1, 2, 2) },
        ],
      ),
    );
    expect(compareMeasuredWalks([model], recording([0, 1])).classification).toBe("prefix");
    // A longer recording shows which way it went.
    expect(compareMeasuredWalks([model], recording([0, 1, 1])).classification).toBe("complete");
  });

  it("continues a join where the branch it names is, and checks a repeating cycle", () => {
    const joined = (sameTests: boolean) =>
      start(
        split(
          [0],
          [
            {
              condition: unsaved("=="),
              walk: walk([1, 0], "joins", { joined: { path: [], index: 0, sameTests } }),
            },
            { condition: unsaved("!="), walk: rest(2, 2) },
          ],
        ),
      );
    expect(compareMeasuredWalks([joined(true)], recording([0, 1], 1, 0)).classification).toBe("complete");
    expect(compareMeasuredWalks([joined(true)], recording([0, 2], 1, 0)).classification).toBe("different");
    // A join that knew more tests than the place it continues at: those ways may include some it can't take, so the
    // frames may not choose between them.
    expect(compareMeasuredWalks([joined(false)], recording([0, 1], 1, 0)).classification).toBe("prefix");
  });

  it("lets no frame choose among the ways of a walk that forgot fields at the depth limit", () => {
    const widened = split(
      [0],
      [
        { condition: unsaved("=="), walk: rest(1, 1) },
        { condition: unsaved("!="), walk: rest(2, 2) },
      ],
    );
    widened.assumptions = [WIDENING_ASSUMPTION];
    expect(compareMeasuredWalks([start(widened)], recording([0, 1])).classification).toBe("prefix");
    widened.stop!.branches![1]!.walk = rest(1, 1);
    expect(compareMeasuredWalks([start(widened)], recording([0, 1])).classification).toBe("complete");
  });

  it("starts from each frame a level can save when the walk doesn't know the first", () => {
    const model = start(
      split(
        [],
        [
          { condition: test(12, "==", 0), walk: rest(0, 1, 1) },
          { condition: test(12, "==", 1), walk: rest(1, 1) },
        ],
        "state",
      ),
    );
    model.initialFields = [];
    expect(compareMeasuredWalks([model], recording([1])).classification).toBe("complete");
    expect(compareMeasuredWalks([model], recording([0, 1])).classification).toBe("complete");
    expect(compareMeasuredWalks([model], recording([0, 2])).classification).toBe("different");
    expect(compareMeasuredWalks([model], recording([2])).classification).toBe("unavailable");
  });

  it("keeps the stop for a value the branches don't cover", () => {
    const stopped = walk([0, 1], "unresolved", { reason: "The next state depends on a field." });
    const model = start(
      split(
        [0, 1],
        [
          { condition: test(0x40, "==", 3), walk: rest(1, 1) },
          { condition: test(0x40, "!=", 3), walk: stopped },
        ],
        "state",
      ),
    );
    expect(compareMeasuredWalks([model], recording([0, 1, 1]))).toMatchObject({
      classification: "prefix",
      prefixFrames: 2,
    });
  });
});

describe("recordings whose recorder writes an input again", () => {
  const walk = (states: number[], status: BehaviourWalk["status"] = "rest"): BehaviourWalk => ({
    ...proof,
    status,
    states,
    frames: [],
    runCalls: states.length - 1,
    fields: [],
    timingReason: "Run calls only.",
    ...(status === "unresolved" ? { reason: "The next rule is unresolved." } : {}),
  });
  /** A start that only knows its first run: the recorder writes again right after it. */
  const start = () => {
    const model = animation();
    model.walk = walk([0, 1], "unresolved");
    return model;
  };
  /** Holds the control value at 1 for one run, then writes -1, like the teeter-totter's tilt. */
  const tilt = (states = [0, 1, 0]): MeasuredClip => ({
    ...clip(),
    frames: states.map((state, run) => ({ state, control: run ? 0 : 1 })),
    input: { seed: { control: 1 }, hold: { control: 1 }, holdTicks: 1, release: { control: -1 } },
  });
  const value = (fields: KnownField[], offset: number) => fields.find((field) => field.offset === offset)?.value;

  it("follows the rest of the recording from the write, with only the fields the recording gives there", () => {
    const seeds: KnownField[][] = [];
    const walkFrom = (fields: KnownField[]) => (seeds.push(fields), walk([1, 0]));
    expect(compareMeasuredWalks([start()], tilt(), undefined, walkFrom)).toMatchObject({
      classification: "complete",
      prefixFrames: 3,
    });
    expect(seeds).toHaveLength(1);
    expect(seeds[0]!.map((field) => [field.offset, field.value])).toEqual([
      [12, 1],
      [18, 0xffff],
    ]);
  });
  it("is different when the walk from the write disagrees, and a prefix when it stops", () => {
    expect(compareMeasuredWalks([start()], tilt(), undefined, () => walk([1, 1]))).toMatchObject({
      classification: "different",
      prefixFrames: 2,
    });
    expect(compareMeasuredWalks([start()], tilt(), undefined, () => walk([1], "unresolved"))).toMatchObject({
      classification: "prefix",
      prefixFrames: 2,
    });
  });
  it("needs a proved ending from the last write", () => {
    expect(compareMeasuredWalks([start()], tilt(), undefined, () => walk([1, 0], "unresolved")).classification).toBe(
      "prefix",
    );
  });
  it("goes on through a write of the value the frame already shows", () => {
    const measured = tilt([0, 1, 0]);
    measured.frames[1]!.control = -1;
    const model = animation();
    model.walk = walk([0, 1, 0]);
    let called = false;
    const walkFrom = () => ((called = true), walk([1, 0]));
    expect(compareMeasuredWalks([model], measured, undefined, walkFrom).classification).toBe("complete");
    expect(called).toBe(false);
  });
  it("stays a prefix after the write without walks from it", () => {
    expect(compareMeasuredWalks([start()], tilt())).toMatchObject({ classification: "prefix" });
  });
  it("follows a recorder that writes on every run through its recorded cycle", () => {
    // The gear: the run clears the control value, and the recorder sets it to 1 again before every run.
    const turn: MeasuredClip = {
      ...clip(),
      frames: [0, 1, 2, 3].map((state, run) => ({ state, control: run ? 0 : 1 })),
      loopStart: 0,
      input: { seed: { control: 1 }, hold: { control: 1 } },
    };
    const model = animation();
    model.walk = walk([0, 1]);
    const seen = new Set<number>();
    const step = (fields: KnownField[]) => {
      const state = value(fields, 12)!;
      seen.add(state);
      expect(value(fields, 18)).toBe(1);
      return walk([state, (state + 1) % 4]);
    };
    expect(compareMeasuredWalks([model], turn, undefined, step)).toMatchObject({ classification: "complete" });
    // Every frame of the cycle is a restart, the first frame too once the cycle comes round.
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    const wrong = (fields: KnownField[]) => (value(fields, 12) === 3 ? walk([3, 3]) : step(fields));
    expect(compareMeasuredWalks([model], turn, undefined, wrong).classification).toBe("different");
    expect(compareMeasuredWalks([model], { ...turn, loopStart: null }, undefined, step).classification).toBe("prefix");
  });
});

describe("recordings whose recorder skipped a search", () => {
  type Branches = NonNullable<NonNullable<BehaviourWalk["stop"]>["branches"]>;
  const walk = (
    states: number[],
    status: BehaviourWalk["status"],
    more: Partial<BehaviourWalk> = {},
  ): BehaviourWalk => ({
    ...proof,
    status,
    states,
    frames: [],
    runCalls: Math.max(0, states.length - 1),
    fields: [],
    timingReason: "Run calls only.",
    ...(status === "rest" ? { loopStart: states.length - 2 } : {}),
    ...more,
  });
  const rest = (...states: number[]) => walk(states, "rest");
  const split = (branches: Branches) =>
    walk([0], "unresolved", { stop: { kind: "ambiguity", description: "Branches.", evidence: [], branches } });
  const start = (root: BehaviourWalk): AnimationDescription => ({
    ...animation(),
    initialFields: [{ ...proof, object: "part", offset: 12, width: 16, value: 0, knownMask: 65535 }],
    walk: root,
  });
  const field = (object: string, offset: number, unresolved = true) =>
    ({ kind: "field", object, offset, width: 16, ...(unresolved ? { unresolved } : {}) }) as const;
  const compare = (left: Expression, operator: string, value: number): Predicate => ({
    kind: "compare",
    operator,
    left,
    right: { kind: "constant", value, width: 16 },
    signed: false,
  });
  const and = (...terms: Predicate[]): Predicate => ({ kind: "and", terms });
  // The control value after a scan over the parts the search found, and the first part a find-first loop acts on.
  const afterScan = field("part after list scan at 0x1010", 0x12);
  const link = field("member found by the loop at 0x1010 link", 0);
  const control = field("part", 0x12, false);
  /** Like the mouse motor: with the control value at 0 it scans the found list and starts when a part sets it. */
  const scanning = start(
    split([
      { condition: and(compare(control, "==", 0), compare(afterScan, "==", 0)), walk: rest(0, 0) },
      { condition: and(compare(control, "==", 0), compare(afterScan, "!=", 0)), walk: rest(1, 1) },
    ]),
  );
  /** Like the cat: it acts on the first part the loop finds. */
  const finding = start(
    split([
      { condition: compare(link, "==", 0), walk: rest(0, 0) },
      { condition: compare(link, "!=", 0), walk: rest(1, 1) },
    ]),
  );
  const instruction = (address: number, text: string, more: Partial<Instruction>): Instruction =>
    ({
      address,
      segment: 0x190f,
      offset: address,
      size: 4,
      bytes: [],
      mnemonic: text.split(" ")[0]!,
      operands: [],
      prefixes: [],
      flow: "next",
      text,
      ...more,
    }) as Instruction;
  const memory = (base: string, displacement: number) =>
    ({ kind: "memory", segment: "ds", base: [base], displacement, width: 16 }) as Instruction["operands"][number];
  /**
   * A run that calls the search at 0x417e, loads the found list from 0x78 and scans it at 0x1010; the scan's body sets
   * the control value. `extra` goes in before the call.
   */
  const report = (
    extra: Instruction[] = [],
    calls: { instruction: number; segment: number; address: number }[] = [],
  ) => {
    const instructions = [
      instruction(0x1000, "push si", {}),
      ...extra,
      instruction(0x1004, "call 0x0000:0x417e", { flow: "call" }),
      instruction(0x1008, "mov di, word [si+0x78]", {
        operands: [{ kind: "register", name: "di", width: 16 }, memory("si", 0x78)],
      }),
      instruction(0x100c, "jmp 0x1010", { flow: "jump" }),
      instruction(0x1010, "or di, di", {}),
      instruction(0x1012, "mov word [si+0x12], 0x0001", {
        operands: [memory("si", 0x12), { kind: "immediate", value: 1, width: 16 }],
      }),
      instruction(0x1014, "retf", { flow: "return" }),
    ];
    const order = instructions.map((i) => i.address);
    const edges = [
      ...order
        .slice(0, -1)
        .map((from, n) => ({ from, to: order[n + 1]!, kind: "next" }))
        .filter((edge) => edge.from !== 0x1012),
      { from: 0x1012, to: 0x1010, kind: "jump" },
      { from: 0x1010, to: 0x1014, kind: "taken" },
    ];
    return {
      layout: { fields: [] },
      helpers: [
        { address: 0x417e, kind: "overlap-list", list: { headField: 0x78, nextField: 0x78, excludesArgument: true } },
      ],
      parts: [{ type: 6, routines: [{ slot: 1, address: 0x1000 }] }],
      routines: [
        {
          address: 0x1000,
          segment: 0x190f,
          offset: 0x1000,
          status: "complete",
          instructions,
          edges,
          calls: [
            { instruction: 0x1004, target: { segment: 0, offset: 0x417e, address: 0x417e }, far: true },
            ...calls.map(({ instruction, segment, address }) => ({
              instruction,
              target: { segment, offset: address, address },
              far: true,
            })),
          ],
          listLoops: [
            {
              header: 0x1010,
              body: [0x1012],
              source: "overlap-query",
              headField: 0x78,
              query: 0x1004,
              nextField: 0x78,
            },
          ],
        },
      ],
    } as unknown as BehaviourReport;
  };
  const normal = (skipped: Record<string, number> = { "0x417e": 1 }): MeasuredClip => ({
    path: "synthetic",
    frames: [{ state: 0, control: 0 }],
    loopStart: null,
    input: {},
    skippedEngineServices: skipped,
  });

  it("takes the skipped search's list as empty, under its own basis", () => {
    for (const model of [scanning, finding]) {
      expect(compareMeasuredWalks([model], normal(), report())).toMatchObject({ classification: "prefix" });
      const match = compareMeasuredWalks([model], normal(), report(), undefined, 6);
      expect(match).toMatchObject({ classification: "complete", basis: "recorder-skipped-search" });
      expect(match.reason).toMatch(/recorder skipped the search at 0x417e.*not the game's/);
    }
  });
  it("only for a clip that lists the search as skipped", () => {
    expect(compareMeasuredWalks([scanning], normal({}), report(), undefined, 6).classification).toBe("prefix");
    expect(compareMeasuredWalks([scanning], normal({ "0x7970": 1 }), report(), undefined, 6).classification).toBe(
      "prefix",
    );
  });
  it("not when the run may write the list's head outside the scan, or call into its own code", () => {
    const head = instruction(0x1002, "mov word [bx+0x78], ax", {
      operands: [memory("bx", 0x78), { kind: "register", name: "ax", width: 16 }],
    });
    expect(compareMeasuredWalks([finding], normal(), report([head]), undefined, 6).classification).toBe("prefix");
    const own = instruction(0x1002, "call 0x1000:0x2000", { flow: "call" });
    const ownCall = [{ instruction: 0x1002, segment: 0x190f, address: 0x2000 }];
    expect(compareMeasuredWalks([finding], normal(), report([own], ownCall), undefined, 6).classification).toBe(
      "prefix",
    );
    // A call the recorder skips writes nothing.
    const engine = [{ instruction: 0x1002, segment: 0, address: 0x68aa }];
    expect(compareMeasuredWalks([finding], normal(), report([own], engine), undefined, 6).classification).toBe(
      "complete",
    );
  });
  it("keeps a field through the scan only when nothing before the scan writes it", () => {
    const write = instruction(0x1002, "mov word [si+0x12], ax", {
      operands: [memory("si", 0x12), { kind: "register", name: "ax", width: 16 }],
    });
    expect(compareMeasuredWalks([scanning], normal(), report([write]), undefined, 6).classification).toBe("prefix");
    // The cat's way still closes: the found list stays empty whatever the run writes elsewhere.
    expect(compareMeasuredWalks([finding], normal(), report([write]), undefined, 6).classification).toBe("complete");
  });
  it("shows a recording that then disagrees", () => {
    const model = start(
      split([
        { condition: compare(link, "==", 0), walk: rest(2, 2) },
        { condition: compare(link, "!=", 0), walk: walk([0], "unresolved", { reason: "A part was found." }) },
      ]),
    );
    const two = { ...normal(), frames: [0, 0].map((state) => ({ state, control: 0 })) };
    expect(compareMeasuredWalks([model], two, report())).toMatchObject({ classification: "prefix" });
    expect(compareMeasuredWalks([model], two, report(), undefined, 6)).toMatchObject({
      classification: "different",
      basis: "recorder-skipped-search",
    });
  });
});

describe("recordings compared with what the recorder writes between runs", () => {
  type Branches = NonNullable<NonNullable<BehaviourWalk["stop"]>["branches"]>;
  const walk = (
    states: number[],
    status: BehaviourWalk["status"],
    more: Partial<BehaviourWalk> = {},
  ): BehaviourWalk => ({
    ...proof,
    status,
    states,
    frames: [],
    runCalls: Math.max(0, states.length - 1),
    fields: [],
    timingReason: "Run calls only.",
    ...(status === "rest" ? { loopStart: states.length - 2 } : {}),
    ...more,
  });
  const rest = (...states: number[]) => walk(states, "rest");
  /** A walk that shows frame 0 twice and then splits, so the split is decided on the second run. */
  const later = (branches: Branches, fields: KnownField[] = []) => ({
    ...animation(),
    initialFields: [{ ...proof, object: "part", offset: 12, width: 16, value: 0, knownMask: 65535 }],
    walk: walk([0, 0], "unresolved", {
      fields,
      stop: { kind: "ambiguity", description: "Branches.", evidence: [], branches },
    }),
  });
  const test = (offset: number, operator: string, value: number, mask?: number): Predicate => ({
    kind: "compare",
    operator,
    left:
      mask === undefined
        ? { kind: "field", object: "part", offset, width: 16 }
        : {
            kind: "binary",
            operator: "&",
            left: { kind: "field", object: "part", offset, width: 16 },
            right: { kind: "constant", value: mask, width: 16 },
            width: 16,
          },
    right: { kind: "constant", value, width: 16 },
    signed: false,
  });
  const choose = (offset: number, value: number, mask?: number) =>
    later([
      { condition: test(offset, "==", value, mask), walk: rest(0, 0) },
      // Unless ruled out, this way changes the frame after the recording ends.
      { condition: test(offset, "!=", value, mask), walk: rest(0, 1, 1) },
    ]);
  const write = (displacement: number, more: Partial<Instruction> = {}): Instruction =>
    ({
      address: 0x1002,
      segment: 0x190f,
      offset: 0x1002,
      size: 3,
      bytes: [],
      mnemonic: "mov",
      operands: [
        { kind: "memory", segment: "ds", base: ["si"], displacement, width: 16 },
        { kind: "register", name: "ax", width: 16 },
      ],
      prefixes: [],
      flow: "next",
      text: `mov word [si+0x${displacement.toString(16)}], ax`,
      ...more,
    }) as Instruction;
  const report = (instructions: Instruction[] = [], transitions: unknown[] = []) =>
    ({
      layout: { fields: [] },
      helpers: [],
      parts: [{ type: 6, routines: [{ slot: 1, address: 0x1000 }], transitions }],
      routines: [
        {
          address: 0x1000,
          segment: 0x190f,
          offset: 0x1000,
          status: "complete",
          instructions: [
            {
              address: 0x1000,
              segment: 0x190f,
              offset: 0x1000,
              size: 1,
              bytes: [],
              mnemonic: "retf",
              operands: [],
              prefixes: [],
              flow: "return",
              text: "retf",
            },
            ...instructions,
          ],
          edges: [],
          calls: [],
        },
      ],
    }) as unknown as BehaviourReport;
  const still: MeasuredClip = {
    path: "synthetic",
    frames: [0, 0, 0].map((state) => ({ state, control: 0 })),
    loopStart: null,
    input: {},
    skippedEngineServices: {},
  };

  it("gives the position words the recorder sets to 100 before every run, under their own basis", () => {
    const model = choose(0x20, 100);
    expect(compareMeasuredWalks([model], still, report()).classification).toBe("prefix");
    const match = compareMeasuredWalks([model], still, report(), undefined, 6);
    expect(match).toMatchObject({ classification: "complete", basis: "recorder-fields" });
    expect(match.reason).toMatch(/recorder's bench, not the game's/);
  });
  it("gives the frame it copies into 0x0e, and 0x10 only while nothing writes 0x0e", () => {
    // Before the second run 0x0e holds the frame saved there, and 0x10 the 0 it held before the first run.
    expect(compareMeasuredWalks([choose(0x0e, 0)], still, report(), undefined, 6).classification).toBe("complete");
    expect(compareMeasuredWalks([choose(0x10, 0)], still, report(), undefined, 6).classification).toBe("complete");
    expect(compareMeasuredWalks([choose(0x10, 0)], still, report([write(0x0e)]), undefined, 6).classification).toBe(
      "prefix",
    );
  });
  it("keeps a field it cleared at 0 on every run only when nothing in the run writes it", () => {
    // The list flags at 0x06: the first run's contact bits were already clear, now every bit on every run.
    const touching = choose(0x06, 0, 1);
    expect(compareMeasuredWalks([touching], still, report()).classification).toBe("prefix");
    expect(compareMeasuredWalks([touching], still, report(), undefined, 6).classification).toBe("complete");
    expect(compareMeasuredWalks([touching], still, report([write(0x06)]), undefined, 6).classification).toBe("prefix");
    // A pointer moved by an offset could reach any field: nothing is shown then.
    const moved = write(0, {
      mnemonic: "add",
      operands: [
        { kind: "register", name: "si", width: 16 },
        { kind: "immediate", value: 6, width: 16 },
      ],
      text: "add si, 6",
    });
    expect(compareMeasuredWalks([touching], still, report([write(0x40), moved]), undefined, 6).classification).toBe(
      "prefix",
    );
  });
  it("leaves a walk open that knows another value for a field the recorder sets", () => {
    const knows: KnownField = { ...proof, object: "part", offset: 0x20, width: 16, value: 5, knownMask: 0xffff };
    const model = later(
      [
        { condition: test(0x20, "==", 100), walk: rest(0, 0) },
        { condition: test(0x20, "!=", 100), walk: rest(0, 1, 1) },
      ],
      [knows],
    );
    expect(compareMeasuredWalks([model], still, report(), undefined, 6).classification).toBe("prefix");
  });
  it("takes a field an input case tests as 0 when the recorder cleared it and nothing writes it", () => {
    // Like the monkey bike seeded on frame 5 with its counter at 0: the run keeps the frame when its belt link at 0x54
    // is 0, which the clip doesn't save.
    const model: AnimationDescription = {
      ...animation([]),
      initial: "run-guard",
      initialFields: [],
      inputCondition: { kind: "and", terms: [test(0x54, "==", 0), test(0x12, "==", 0)] },
      walk: {
        ...walk([], "rest"),
        runCalls: 1,
        parameterised: { kind: "hold", state: { kind: "field", object: "part", offset: 12, width: 16 } },
      },
    };
    model.trigger.kind = "input-case";
    const seeded: MeasuredClip = { ...still, frames: [{ state: 5, control: 0 }] };
    expect(compareMeasuredWalks([model], seeded, report()).classification).toBe("prefix");
    expect(compareMeasuredWalks([model], seeded, report(), undefined, 6)).toMatchObject({
      classification: "complete",
      basis: "recorder-fields",
    });
    expect(compareMeasuredWalks([model], seeded, report([write(0x54)]), undefined, 6).classification).toBe("prefix");
  });
  describe("a start that knows another value than the recorder had", () => {
    /** The reset, knowing 9 at 0x58 where the recorder cleared the part. */
    const reset = () => {
      const model = animation();
      model.id = "reset";
      model.initial = "reset";
      model.trigger.kind = "run";
      model.initialFields = [
        ...model.initialFields!,
        { ...proof, object: "part", offset: 0x58, width: 16, value: 9, knownMask: 0xffff },
      ];
      return model;
    };
    /** A run rule that tests 0x58. */
    const reads = [
      {
        ...proof,
        from: null,
        routine: 0x1000,
        condition: test(0x58, "==", 9),
        to: { kind: "constant", value: 1, width: 16 },
      },
    ];
    it("stands when the run never reads that field", () => {
      expect(compareMeasuredWalks([reset()], clip(), report(), undefined, 6)).toMatchObject({
        classification: "complete",
        basis: "reset-or-rest",
      });
    });
    it("doesn't count when the run reads it, so a walk from the recorder's value must fit", () => {
      expect(compareMeasuredWalks([reset()], clip(), report([], reads), undefined, 6).classification).toBe(
        "unavailable",
      );
      const input = animation();
      input.id = "input";
      input.trigger.kind = "input-case";
      input.initial = "run-guard";
      input.inputCondition = test(18, "==", 1);
      expect(compareMeasuredWalks([reset(), input], clip(), report([], reads), undefined, 6)).toMatchObject({
        classification: "complete",
        basis: "input-case",
        animation: "input",
      });
    });
  });
  describe("a walk from a trigger the recorder never performs", () => {
    /** A walk from a callback that writes this field, knowing the written bits from its start. */
    const triggered = (offset: number, value: number, knownMask = 0xffff, condition: Predicate = { kind: "true" }) => {
      const model = animation();
      model.initialFields = [
        ...model.initialFields!,
        { ...proof, object: "part", offset, width: 16, value, knownMask },
      ];
      model.trigger.writes = [
        {
          ...proof,
          object: "part",
          offset,
          width: 16,
          value: { kind: "constant", value, width: 16 },
          condition: { kind: "true" },
          routine: 0,
        },
      ];
      model.trigger.condition = condition;
      return model;
    };
    it("counts as a seeded state when the recorder's action gives what the trigger writes", () => {
      // Like the monkey bike's rope callback setting its control value to 1, which the recorder's run action seeds.
      expect(compareMeasuredWalks([triggered(18, 1)], clip())).toMatchObject({
        classification: "complete",
        basis: "seeded-state",
        conditionCompatibility: "established",
      });
    });
    it("needs the recorder's bench for a field its action doesn't name", () => {
      // Like a trampoline clearing the mouse's contact bit at 0x06: the recorder cleared it, but never seeds it.
      const touched = triggered(0x06, 0, 1);
      expect(compareMeasuredWalks([touched], clip()).classification).toBe("unavailable");
      expect(compareMeasuredWalks([touched], clip(), report(), undefined, 6)).toMatchObject({
        classification: "complete",
        basis: "recorder-fields",
      });
      expect(compareMeasuredWalks([triggered(0x50, 3)], clip(), report(), undefined, 6).classification).toBe(
        "unavailable",
      );
    });
    it("needs the trigger's tests of the part's other fields to hold for the recorder's fields", () => {
      expect(compareMeasuredWalks([triggered(18, 1, 0xffff, test(0x60, "==", 3))], clip()).classification).toBe(
        "unavailable",
      );
      const cleared = triggered(18, 1, 0xffff, test(0x60, "==", 0));
      expect(compareMeasuredWalks([cleared], clip()).classification).toBe("unavailable");
      expect(compareMeasuredWalks([cleared], clip(), report(), undefined, 6).basis).toBe("recorder-fields");
      // A test of what the event passes, like the rope's argument, isn't a test of the part.
      const argument: Predicate = {
        kind: "compare",
        operator: "==",
        left: { kind: "field", object: "argument", offset: 12, width: 16 },
        right: { kind: "constant", value: 1, width: 16 },
        signed: false,
      };
      expect(compareMeasuredWalks([triggered(18, 1, 0xffff, argument)], clip()).basis).toBe("seeded-state");
    });
    it("gives way to an input case that fits as well, since that needs fewer facts", () => {
      const input = animation();
      input.id = "input";
      input.trigger.kind = "input-case";
      input.initial = "run-guard";
      input.inputCondition = test(18, "==", 1);
      expect(compareMeasuredWalks([triggered(18, 1), input], clip())).toMatchObject({
        classification: "complete",
        basis: "input-case",
        animation: "input",
      });
    });
  });
});

describe("a loop that stops at the first part it finds in a skipped search's list", () => {
  const at = (address: number) => ({ segment: 0x190f, offset: address, address });
  const register = (name: string) => ({ kind: "register", name, width: 16 }) as const;
  const memory = (segment: string, base: string, displacement: number) =>
    ({ kind: "memory", segment, base: [base], displacement, width: 16 }) as const;
  const op = (
    address: number,
    size: number,
    mnemonic: string,
    operands: unknown[] = [],
    flow: Instruction["flow"] = "next",
    target?: number,
  ): Instruction =>
    ({
      address,
      segment: 0x190f,
      offset: address,
      size,
      bytes: [],
      mnemonic,
      operands,
      prefixes: [],
      flow,
      text: mnemonic,
      ...(target === undefined ? {} : { target: at(target) }),
    }) as Instruction;
  /** Like the cat in TIM 1: it loads the found list from 0x78 and stops at the first part of type 0x2a. */
  const instructions = (load: number) => [
    op(0x1000, 3, "mov", [register("si"), memory("ss", "bp", 6)]),
    op(0x1003, 1, "push", [register("si")]),
    op(0x1004, 5, "call", [], "call"),
    op(0x1009, 3, "mov", [register("di"), memory("ds", "si", load)]),
    op(0x100c, 2, "jmp", [], "jump", 0x101c),
    op(0x100e, 4, "cmp", [memory("ds", "di", 4), { kind: "immediate", value: 0x2a, width: 16 }]),
    op(0x1012, 2, "jne", [], "branch", 0x1019),
    op(0x1014, 2, "xor", [register("di"), register("di")]),
    op(0x1016, 3, "jmp", [], "jump", 0x101c),
    op(0x1019, 3, "mov", [register("di"), memory("ds", "di", 0x78)]),
    op(0x101c, 2, "or", [register("di"), register("di")]),
    op(0x101e, 2, "je", [], "branch", 0x1023),
    op(0x1020, 3, "jmp", [], "jump", 0x100e),
    op(0x1023, 1, "pop", [register("si")]),
    op(0x1024, 1, "retf", [], "return"),
  ];
  const edges = (list: Instruction[]) =>
    list.flatMap((i) =>
      i.flow === "return"
        ? []
        : i.flow === "jump"
          ? [{ from: i.address, to: i.target!.address, kind: "jump" }]
          : i.flow === "branch"
            ? [
                { from: i.address, to: i.target!.address, kind: "taken" },
                { from: i.address, to: i.address + i.size, kind: "not-taken" },
              ]
            : [{ from: i.address, to: i.address + i.size, kind: "next" }],
    );
  const report = (load = 0x78) => {
    const list = instructions(load);
    return {
      layout: { fields: [] },
      helpers: [
        {
          address: 0x3597,
          kind: "overlap-list",
          list: { headField: 0x78, nextField: 0x78, excludesArgument: true },
          footprint: {},
          writes: [],
          returns: [],
        },
      ],
      parts: [{ type: 12, routines: [{ slot: 1, address: 0x1000 }] }],
      routines: [
        {
          address: 0x1000,
          segment: 0x190f,
          offset: 0x1000,
          status: "complete",
          instructions: list,
          edges: edges(list),
          calls: [{ instruction: 0x1004, target: { segment: 0, offset: 0x3597, address: 0x3597 }, far: true }],
          listLoops: [],
        },
      ],
    } as unknown as BehaviourReport;
  };
  const link: Expression = {
    kind: "field",
    object: "member found by the loop at 0x101c link",
    offset: 0,
    width: 16,
    unresolved: true,
  };
  const rest = (...states: number[]): BehaviourWalk => ({
    ...proof,
    status: "rest",
    states,
    frames: [],
    runCalls: states.length - 1,
    fields: [],
    timingReason: "Run calls only.",
    loopStart: states.length - 2,
  });
  const model: AnimationDescription = {
    ...animation(),
    initialFields: [{ ...proof, object: "part", offset: 12, width: 16, value: 0, knownMask: 65535 }],
    walk: {
      ...rest(0),
      status: "unresolved",
      stop: {
        kind: "ambiguity",
        description: "Branches.",
        evidence: [],
        branches: [
          {
            condition: {
              kind: "compare",
              operator: "==",
              left: link,
              right: { kind: "constant", value: 0, width: 16 },
              signed: false,
            },
            walk: rest(0, 0),
          },
          {
            condition: {
              kind: "compare",
              operator: "!=",
              left: link,
              right: { kind: "constant", value: 0, width: 16 },
              signed: false,
            },
            walk: rest(1, 1),
          },
        ],
      },
    },
  };
  const clip: MeasuredClip = {
    path: "synthetic",
    frames: [{ state: 0, control: 0 }],
    loopStart: null,
    input: {},
    skippedEngineServices: { "0x3597": 1 },
  };

  it("finds no part when the loop loads the list from the part's own found list field", () => {
    expect(compareMeasuredWalks([model], clip, report(), undefined, 12)).toMatchObject({
      classification: "complete",
      basis: "recorder-skipped-search",
    });
    // A list loaded from another field isn't the search's list.
    expect(compareMeasuredWalks([model], clip, report(0x7a), undefined, 12).classification).toBe("prefix");
  });
});
