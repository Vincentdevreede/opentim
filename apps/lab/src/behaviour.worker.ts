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

/** Tells the page how far a step has come. */
const progress = (step: number) => (done: number, total: number) => post({ kind: "progress", step, done, total });

/** The walks, effects, rests and doings of the report as it stands. */
function walksOf(report: BehaviourReport, started: number, perType: boolean): WalksResult {
  const description = describeBehaviour(report, progress(perType ? 4 : 2));
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
    steps = readBehaviourInSteps(data.program, data.parts, progress(0));
    const summary = summariseBehaviour(steps.report);
    post({ kind: "behaviour", result: { status: "done", summary, seconds: (performance.now() - started) / 1000 } });
  } catch (error) {
    post({ kind: "behaviour", result: { status: "error", message: (error as Error).message } });
    return;
  }
  started = performance.now();
  try {
    progress(1)(0, 1);
    const read = readProgramGoals(data.program, steps.report);
    progress(1)(1, 1);
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
    steps.readLoopsPerType(progress(3));
    post({ kind: "per type", result: walksOf(steps.report, started, true) });
  } catch (error) {
    post({ kind: "per type", result: { status: "error", message: (error as Error).message } });
  }
};
