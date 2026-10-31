/** Reads the behaviour of the parts away from the page, because it takes seconds. */

import { readBehaviour } from "@opentim/content";
import { summariseBehaviour, type BehaviourRequest, type BehaviourResult } from "./behaviour.ts";

self.onmessage = ({ data }: MessageEvent<BehaviourRequest>) => {
  const started = performance.now();
  let result: BehaviourResult;
  try {
    const summary = summariseBehaviour(readBehaviour(data.program, data.parts));
    result = { status: "done", summary, seconds: (performance.now() - started) / 1000 };
  } catch (error) {
    result = { status: "error", message: (error as Error).message };
  }
  (self as unknown as Worker).postMessage(result);
};
