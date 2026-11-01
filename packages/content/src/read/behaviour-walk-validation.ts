/** Compares independently described frame walks with saved recordings. Recordings never seed a description. */
import type { BehaviourReport } from "./behaviour.ts";
import type { MeasuredClip } from "./behaviour-validation.ts";
import {
  evaluateBehaviourCondition,
  type AnimationDescription,
  type BehaviourWalk,
  type KnownField,
  type PartBehaviourDescription,
} from "./describe-behaviour.ts";

export interface DescribedWalkMatch {
  clip: string;
  classification: "complete" | "prefix" | "different" | "unavailable";
  basis: "reset-or-rest" | "creation" | "trigger" | "input-case" | "unavailable";
  measuredFrames: number;
  measuredTransitions: number;
  prefixFrames: number;
  animation?: string;
  conditionCompatibility: "established" | "unresolved" | "conditional-event";
  reason: string;
  evidenceAddresses: number[];
}
export interface DescribedWalkCoverage {
  clips: number;
  oneFrameClips: number;
  complete: number;
  prefix: number;
  different: number;
  unavailable: number;
  completeFromCreation: number;
  completeFromTriggers: number;
  completeFromResetOrRest: number;
  completeFromInputCases: number;
  matches: DescribedWalkMatch[];
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * The v25 recording adapter names the fields it actually saved. Flags are masked in the recording. No other
 * fields, including zeros from its old artificial objects, are supplied to this compatibility check.
 */
function recordedFields(
  report: BehaviourReport | undefined,
  clip: MeasuredClip,
): Pick<KnownField, "object" | "offset" | "width" | "value" | "knownMask">[] {
  const seed = object(clip.input.seed) ? clip.input.seed : {};
  const hold = object(clip.input.hold) ? clip.input.hold : {};
  const values = { ...seed, ...clip.frames[0], ...hold };
  const state = report?.layout.fields.find((field) => field.name === "state")?.offset ?? 12;
  const delta = report?.layout.fields.find((field) => field.name === "stateDelta")?.offset ?? 18;
  const fields = [
    ["state", state],
    ["control", delta],
    ["timer", 0x96],
    ["heat", 0x9c],
    ["vx", 0x36],
    ["vy", 0x38],
    ["flags8", 8],
  ] as const;
  return fields.flatMap(([name, offset]) => {
    const value = values[name];
    return typeof value === "number" && offset !== undefined
      ? [{ object: "part", offset, width: 16, value, knownMask: name === "flags8" ? 0x3030 : 0xffff }]
      : [];
  });
}
function stateAt(walk: BehaviourWalk, index: number, parameter: number): number | undefined {
  if (walk.parameterised?.kind === "hold") return parameter;
  if (index < walk.states.length) return walk.states[index];
  if (walk.status === "rest") return walk.states.at(-1);
  if (walk.status !== "loop" || walk.loopStart === undefined) return undefined;
  const period = walk.states.length - 1 - walk.loopStart;
  return period > 0 ? walk.states[walk.loopStart + ((index - walk.loopStart) % period)] : undefined;
}
function matchWalk(
  report: BehaviourReport | undefined,
  animation: AnimationDescription,
  clip: MeasuredClip,
): DescribedWalkMatch | undefined {
  const walk = animation.walk;
  if (!clip.frames.length) return undefined;
  const parameter = clip.frames[0]!.state;
  if (!walk.parameterised && walk.states[0] !== parameter) return undefined;
  const recorded = recordedFields(report, clip);
  if (
    animation.initialFields?.some((field) => {
      const other = recorded.find(
        (other) => other.object === field.object && other.offset === field.offset && other.width === field.width,
      );
      return other && ((other.value ^ field.value) & other.knownMask & field.knownMask) !== 0;
    })
  )
    return undefined;
  if (walk.parameterised?.allowedStates && !walk.parameterised.allowedStates.includes(parameter)) return undefined;
  const basis =
    animation.initial === "creation"
      ? "creation"
      : animation.trigger.kind === "input-case"
        ? "input-case"
        : animation.trigger.kind === "run"
          ? "reset-or-rest"
          : "trigger";
  const compatibility = animation.inputCondition
    ? evaluateBehaviourCondition(animation.inputCondition, recorded)
    : true;
  if (compatibility === false) return undefined;
  const expected = clip.frames.map((frame) => frame.state);
  if (clip.loopStart !== null) expected.push(clip.frames[clip.loopStart]!.state);
  const base = {
    clip: clip.path,
    measuredFrames: clip.frames.length,
    measuredTransitions: expected.length - 1,
    animation: animation.id,
    basis,
    conditionCompatibility:
      compatibility === undefined ? "unresolved" : basis === "trigger" ? "conditional-event" : "established",
    evidenceAddresses: [...new Set(walk.evidence.map((item) => item.address))] as number[],
  } as const;
  let matched = 0;
  for (const [index, state] of expected.entries()) {
    const prediction = stateAt(walk, index, parameter);
    if (prediction === undefined)
      return {
        ...base,
        classification: "prefix",
        prefixFrames: matched,
        reason: walk.reason ?? "The extracted walk stops before the recording ends.",
      };
    if (prediction !== state)
      return {
        ...base,
        classification: compatibility === undefined || (object(clip.input.hold) && matched) ? "prefix" : "different",
        prefixFrames: matched,
        reason:
          compatibility === undefined
            ? "The recording does not establish this input case's starting condition."
            : object(clip.input.hold) && matched
              ? "The oracle supplies further external writes; the description contains one trigger only."
              : `The described walk predicts state ${prediction} at frame ${index}; the oracle records ${state}.`,
      };
    matched++;
  }
  if (compatibility === undefined)
    return {
      ...base,
      classification: "prefix",
      prefixFrames: matched,
      reason: "The saved frames agree but do not establish every starting condition of this input case.",
    };
  if (walk.status !== "rest" && walk.status !== "loop")
    return {
      ...base,
      classification: "prefix",
      prefixFrames: matched,
      reason: walk.reason ?? "The known frames agree but the ending remains unresolved.",
    };
  if (object(clip.input.hold))
    return {
      ...base,
      classification: "prefix",
      prefixFrames: matched,
      reason: "The saved frames agree, but repeated external input is outside this single-trigger walk.",
    };
  if (clip.loopStart === null) {
    const complete = walk.status === "rest" && walk.runCalls <= clip.frames.length;
    return {
      ...base,
      classification: complete ? "complete" : "prefix",
      prefixFrames: matched,
      reason: complete
        ? "The frames agree and the extracted rules prove a stable ending."
        : "The recorded prefix agrees; its ending is not established by this walk.",
    };
  }
  const oraclePeriod = clip.frames.length - clip.loopStart;
  const modelPeriod = walk.status === "rest" ? 1 : walk.states.length - 1 - walk.loopStart!;
  const span = (oraclePeriod * modelPeriod) / gcd(oraclePeriod, modelPeriod);
  const end = Math.max(clip.loopStart, walk.loopStart ?? walk.states.length - 1) + span;
  if (end > 4096)
    return {
      ...base,
      classification: "prefix",
      prefixFrames: matched,
      reason: "The full cycle comparison exceeds 4096 frames; only the prefix was checked.",
    };
  for (let index = expected.length; index <= end; index++) {
    const expectedState = clip.frames[clip.loopStart + ((index - clip.loopStart) % oraclePeriod)]!.state;
    if (stateAt(walk, index, parameter) !== expectedState)
      return {
        ...base,
        classification: "different",
        prefixFrames: matched,
        reason: "The proved and recorded visible cycles differ.",
      };
  }
  return {
    ...base,
    classification: "complete",
    prefixFrames: matched,
    reason: "The recorded prefix and the complete repeating state-selected frame cycle agree.",
  };
}

/** Complete counts retain their basis: actual code triggers and conditional input scenarios are distinct. */
export function validateDescribedWalks(
  report: BehaviourReport,
  part: PartBehaviourDescription,
  clips: MeasuredClip[],
): DescribedWalkCoverage {
  const rank = { complete: 2, prefix: 1, different: 0, unavailable: -1 };
  const basisRank = { "reset-or-rest": 2, creation: 2, trigger: 1, "input-case": 0, unavailable: -1 };
  const matches = clips.map((clip): DescribedWalkMatch => {
    const candidates = part.animations
      .filter((animation) => animation.walk.states.length || animation.walk.parameterised)
      .flatMap((animation) => {
        const match = matchWalk(report, animation, clip);
        return match ? [match] : [];
      });
    candidates.sort(
      (left, right) =>
        rank[right.classification] - rank[left.classification] ||
        right.prefixFrames - left.prefixFrames ||
        basisRank[right.basis] - basisRank[left.basis],
    );
    return (
      candidates[0] ?? {
        clip: clip.path,
        classification: "unavailable",
        basis: "unavailable",
        measuredFrames: clip.frames.length,
        measuredTransitions: clip.frames.length - 1 + (clip.loopStart === null ? 0 : 1),
        prefixFrames: 0,
        conditionCompatibility: "unresolved",
        reason: "No described initial state or conditional input case is established by the recording.",
        evidenceAddresses: [],
      }
    );
  });
  return {
    clips: clips.length,
    oneFrameClips: clips.filter((clip) => clip.frames.length === 1 && clip.loopStart === null).length,
    complete: matches.filter((match) => match.classification === "complete").length,
    prefix: matches.filter((match) => match.classification === "prefix").length,
    different: matches.filter((match) => match.classification === "different").length,
    unavailable: matches.filter((match) => match.classification === "unavailable").length,
    completeFromCreation: matches.filter((match) => match.classification === "complete" && match.basis === "creation")
      .length,
    completeFromTriggers: matches.filter((match) => match.classification === "complete" && match.basis === "trigger")
      .length,
    completeFromResetOrRest: matches.filter(
      (match) => match.classification === "complete" && match.basis === "reset-or-rest",
    ).length,
    completeFromInputCases: matches.filter(
      (match) => match.classification === "complete" && match.basis === "input-case",
    ).length,
    matches,
  };
}

export type WalkMatch = DescribedWalkMatch;

/** Compares one recording with independently extracted starts; a missing compatible start is unavailable. */
export function compareMeasuredWalks(
  animations: AnimationDescription[],
  clip: MeasuredClip,
  report?: BehaviourReport,
): WalkMatch {
  const rank = { complete: 3, prefix: 2, different: 1, unavailable: 0 };
  const basisRank = { "reset-or-rest": 2, creation: 2, trigger: 1, "input-case": 0, unavailable: -1 };
  const candidates = animations.flatMap((animation) => {
    const match = matchWalk(report, animation, clip);
    return match ? [match] : [];
  });
  candidates.sort(
    (a, b) =>
      rank[b.classification] - rank[a.classification] ||
      b.prefixFrames - a.prefixFrames ||
      basisRank[b.basis] - basisRank[a.basis],
  );
  return (
    candidates[0] ?? {
      clip: clip.path,
      classification: "unavailable",
      basis: "unavailable",
      measuredFrames: clip.frames.length,
      measuredTransitions: clip.frames.length - 1 + (clip.loopStart === null ? 0 : 1),
      prefixFrames: 0,
      conditionCompatibility: "unresolved",
      reason:
        "No independently described start is compatible with the saved recording. No oracle field was supplied to a description.",
      evidenceAddresses: [],
    }
  );
}
