import { describe, expect, it } from "vitest";
import type { Predicate } from "../src/read/behaviour.ts";
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
