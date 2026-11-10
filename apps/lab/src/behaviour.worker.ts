/**
 * Reads the behaviour of the parts away from the page, because it takes seconds, then every puzzle's goal, named with
 * what the behaviour found, then the walks from the parts' triggers, then the loops over found parts once for each
 * type, which takes longest, and the walks again with what that adds.
 */

import { describeBehaviour, readBehaviourInSteps, readProgramGoals, type BehaviourReport } from "@opentim/content";
import {
  summariseBehaviour,
  summariseDoings,
  summariseEffects,
  summariseRests,
  summariseWalks,
  type BehaviourMessage,
  type BehaviourRequest,
  type WalksResult,
} from "./behaviour.ts";

const post = (message: BehaviourMessage) => (self as unknown as Worker).postMessage(message);

/** The walks, effects, rests and doings of the report as it stands. */
function walksOf(report: BehaviourReport, started: number, perType: boolean): WalksResult {
  const description = describeBehaviour(report);
  return {
    status: "done",
    walks: summariseWalks(report, description),
    effects: summariseEffects(report, description),
    rests: summariseRests(report, description),
    doings: summariseDoings(report, description),
    seconds: (performance.now() - started) / 1000,
    perType,
  };
}

self.onmessage = ({ data }: MessageEvent<BehaviourRequest>) => {
  let started = performance.now();
  let steps: ReturnType<typeof readBehaviourInSteps>;
  try {
    steps = readBehaviourInSteps(data.program, data.parts);
    const summary = summariseBehaviour(steps.report);
    post({ kind: "behaviour", result: { status: "done", summary, seconds: (performance.now() - started) / 1000 } });
  } catch (error) {
    post({ kind: "behaviour", result: { status: "error", message: (error as Error).message } });
    return;
  }
  started = performance.now();
  try {
    const read = readProgramGoals(data.program, steps.report);
    post({
      kind: "goals",
      result: read.problem
        ? { status: "error", message: read.problem }
        : { status: "done", goals: read.goals, seconds: (performance.now() - started) / 1000 },
    });
  } catch (error) {
    post({ kind: "goals", result: { status: "error", message: (error as Error).message } });
  }
  started = performance.now();
  try {
    post({ kind: "walks", result: walksOf(steps.report, started, false) });
  } catch (error) {
    post({ kind: "walks", result: { status: "error", message: (error as Error).message } });
    return;
  }
  started = performance.now();
  try {
    steps.readLoopsPerType();
    post({ kind: "per type", result: walksOf(steps.report, started, true) });
  } catch (error) {
    post({ kind: "per type", result: { status: "error", message: (error as Error).message } });
  }
};
