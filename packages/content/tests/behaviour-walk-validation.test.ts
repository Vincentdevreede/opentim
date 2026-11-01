import { describe, expect, it } from "vitest";
import type { AnimationDescription } from "../src/read/describe-behaviour.ts";
import { compareMeasuredWalks } from "../src/read/behaviour-walk-validation.ts";
import type { MeasuredClip } from "../src/read/behaviour-validation.ts";

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
