import { describe, expect, it } from "vitest";
import type { Expression, Transition } from "../src/read/behaviour.ts";
import { measuredClips, validateMeasuredPart } from "../src/read/behaviour-validation.ts";

const constant = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const state: Expression = { kind: "field", object: "part", offset: 0x0c, width: 16 };
const transition = (to: Expression, extra: Partial<Transition> = {}): Transition => ({
  from: null,
  to,
  condition: { kind: "true" },
  routine: 0,
  evidence: [],
  confidence: "checked",
  assumptions: [],
  ...extra,
});

describe("measured state coverage", () => {
  it("does not call a one-frame recording a proven walk", () => {
    const report = validateMeasuredPart([], measuredClips({ frames: [{ state: 0 }] }));
    expect(report.clipsWithoutSteps).toBe(1);
    expect(report.completeClips).toBe(0);
  });

  it("requires a graph edge to explain unchanged states", () => {
    const clips = measuredClips({ frames: [{ state: 0 }, { state: 0 }] });
    expect(validateMeasuredPart([], clips).unchanged.missed).toBe(1);
    const report = validateMeasuredPart([transition(state)], clips);
    expect(report.unchanged.checked).toBe(1);
    expect(report.completeClips).toBe(1);
  });

  it("finds nested clips and checks the closing edge of a loop", () => {
    const clips = measuredClips({ actions: [{ clip: { frames: [{ state: 0 }, { state: 1 }], loopStart: 0 } }] });
    const report = validateMeasuredPart(
      [transition(constant(1), { from: [0] }), transition(constant(0), { from: [1] })],
      clips,
    );
    expect(report.checked).toBe(2);
    expect(report.missed).toBe(0);
    expect(report.transitions[1]).toMatchObject({ from: 1, to: 0 });
  });

  it("requires a recorded condition to agree and preserves unresolved conditions", () => {
    const clips = measuredClips({ frames: [{ state: 0, control: 0 }, { state: 1 }] });
    const control: Expression = { kind: "field", object: "part", offset: 0x12, width: 16 };
    const falseEdge = transition(constant(1), {
      condition: { kind: "compare", operator: "!=", left: control, right: constant(0), signed: false },
    });
    expect(validateMeasuredPart([falseEdge], clips).missed).toBe(1);
    const unknownEdge = transition(constant(1), { condition: { kind: "unknown", reason: "Related object unknown" } });
    const report = validateMeasuredPart([unknownEdge], clips);
    expect(report.unresolved).toBe(1);
    expect(report.checked).toBe(0);
  });

  it("substitutes graph arithmetic with word wrapping", () => {
    const clips = measuredClips({ frames: [{ state: 0xffff }, { state: 0 }] });
    const report = validateMeasuredPart(
      [transition({ kind: "binary", operator: "+", left: state, right: constant(1), width: 16 })],
      clips,
    );
    expect(report.checked).toBe(1);
  });

  it("reports unchanged steps separately from proven transitions", () => {
    const report = validateMeasuredPart([], measuredClips({ frames: [{ state: 0 }, { state: 0 }, { state: 1 }] }));
    expect(report.unchangedSteps).toBe(1);
    expect(report.missed).toBe(1);
  });

  it("uses hold and release inputs at the measured tick", () => {
    const control: Expression = { kind: "field", object: "part", offset: 0x12, width: 16 };
    const clips = measuredClips({
      frames: [{ state: 0, control: 0 }, { state: 1, control: 1 }, { state: 0, control: 7 }, { state: 1 }],
      input: { hold: { control: 1 }, holdTicks: 1, release: { control: -1 } },
    });
    const edges = [1, -1, 7].map((value, index) =>
      transition(constant(index === 1 ? 0 : 1), {
        from: [index === 1 ? 1 : 0],
        condition: { kind: "compare", operator: "==", left: control, right: constant(value), signed: true },
      }),
    );
    expect(validateMeasuredPart(edges, clips).checked).toBe(3);
  });

  it("does not turn masked flag values into complete field knowledge", () => {
    const flags: Expression = { kind: "field", object: "part", offset: 8, width: 16 };
    const clip = measuredClips({ frames: [{ state: 0, flags8: 16 }, { state: 1 }] });
    const whole = transition(constant(1), {
      condition: { kind: "compare", operator: "==", left: flags, right: constant(16), signed: false },
    });
    expect(validateMeasuredPart([whole], clip).unresolved).toBe(1);
    const mask = {
      ...whole,
      condition: {
        kind: "compare" as const,
        operator: "!=",
        signed: false,
        left: { kind: "binary" as const, operator: "&", left: flags, right: constant(16), width: 16 },
        right: constant(0),
      },
    };
    expect(validateMeasuredPart([mask], clip).checked).toBe(1);
  });
});
