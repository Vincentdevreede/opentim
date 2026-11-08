/** Reads one build on a worker thread for `inEachBuild` in builds.ts: loads the script and answers with its `inBuild`. */
import { parentPort, workerData } from "node:worker_threads";
import type { BuildFolder } from "./builds.ts";

const { script, build, given } = workerData as { script: string; build: BuildFolder; given: unknown };
const { inBuild } = (await import(script)) as { inBuild: (build: BuildFolder, given: unknown) => unknown };
parentPort!.postMessage(await inBuild(build, given));
