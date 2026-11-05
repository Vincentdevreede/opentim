/** Reads the behaviour of the parts away from the page, because it takes seconds, and then the walks from them. */

import { describeBehaviour, readBehaviour, type BehaviourReport } from "@opentim/content";
import {
  summariseBehaviour,
  summariseEffects,
  summariseWalks,
  type BehaviourMessage,
  type BehaviourRequest,
} from "./behaviour.ts";

const post = (message: BehaviourMessage) => (self as unknown as Worker).postMessage(message);

self.onmessage = ({ data }: MessageEvent<BehaviourRequest>) => {
  let started = performance.now();
  let report: BehaviourReport;
  try {
    report = readBehaviour(data.program, data.parts);
    const summary = summariseBehaviour(report);
    post({ kind: "behaviour", result: { status: "done", summary, seconds: (performance.now() - started) / 1000 } });
  } catch (error) {
    post({ kind: "behaviour", result: { status: "error", message: (error as Error).message } });
    return;
  }
  started = performance.now();
  try {
    const description = describeBehaviour(report);
    const walks = summariseWalks(report, description);
    const effects = summariseEffects(report, description);
    post({ kind: "walks", result: { status: "done", walks, effects, seconds: (performance.now() - started) / 1000 } });
  } catch (error) {
    post({ kind: "walks", result: { status: "error", message: (error as Error).message } });
  }
};
