/**
 * Fingerprints everything the behaviour read gives for one build: the report, the goals and the description, and with
 * `--loops` also the report and description after the per-type loops. Run it before and after a change that should
 * keep every result (a cleanup, a speed-up): the same hashes mean the same results. It hashes as it walks, so even a
 * report of hundreds of megabytes never becomes one string.
 *
 *   pnpm --filter @opentim/content fingerprint-behaviour --game evenmore --folder <game folder> [--loops]
 *
 * The game is tim1, evenmore, tim2 or toons. The goals are read from TIM.EXE only, so TIM 2 and Toons have no goals
 * hash.
 *
 * Compare two runs from the same commit's tree each time: a checkout that another session is editing gives a mixed
 * result. One build takes a few minutes with `--loops`.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { readBehaviourInSteps } from "../src/read/behaviour.ts";
import { describeBehaviour } from "../src/read/describe-behaviour.ts";
import { readProgramGoals } from "../src/read/program-goals.ts";
import { GAME_PROGRAMS, readBuild, type Game } from "./builds.ts";

/** A short hash of a value: objects with sorted keys, Maps and Sets in their order, cycles marked. */
export function hashOf(value: unknown): string {
  const hash = createHash("sha256");
  const open = new Set<object>();
  const walk = (v: unknown): void => {
    if (v === null || v === undefined) return void hash.update(`${String(v)};`);
    if (typeof v === "string") return void hash.update(`s${v.length}:${v};`);
    if (typeof v !== "object") return void hash.update(`${typeof v}:${String(v)};`);
    if (open.has(v)) return void hash.update("cycle;");
    open.add(v);
    if (v instanceof Uint8Array) hash.update(`u8:${v.length}:`).update(v);
    else if (Array.isArray(v)) {
      hash.update(`[${v.length}`);
      for (const item of v) walk(item);
      hash.update("]");
    } else if (v instanceof Map) {
      hash.update(`M${v.size}`);
      for (const [key, item] of v) {
        walk(key);
        walk(item);
      }
      hash.update("}");
    } else if (v instanceof Set) {
      hash.update(`S${v.size}`);
      for (const item of v) walk(item);
      hash.update("}");
    } else {
      hash.update("{");
      for (const key of Object.keys(v).sort()) {
        const item = (v as Record<string, unknown>)[key];
        if (item === undefined) continue;
        hash.update(`k:${key}=`);
        walk(item);
      }
      hash.update("}");
    }
    open.delete(v);
  };
  walk(value);
  return hash.digest("hex").slice(0, 16);
}

const { values } = parseArgs({
  options: { game: { type: "string" }, folder: { type: "string" }, loops: { type: "boolean", default: false } },
});
if (!values.game || !Object.hasOwn(GAME_PROGRAMS, values.game) || !values.folder) {
  console.error("Usage: fingerprint-behaviour --game tim1|evenmore|tim2|toons --folder <game folder> [--loops]");
  process.exit(1);
}
const game = values.game as Game;
const started = performance.now();
const { program, parts } = readBuild({ game, folder: resolve(values.folder), index: 0 });
const steps = readBehaviourInSteps(program, parts);
const out: Record<string, string> = { report: hashOf(steps.report) };
if (game === "tim1" || game === "evenmore") out.goals = hashOf(readProgramGoals(program, steps.report));
out.description = hashOf(describeBehaviour(steps.report));
if (values.loops) {
  steps.readLoopsPerType();
  out.reportLoops = hashOf(steps.report);
  out.descriptionLoops = hashOf(describeBehaviour(steps.report));
}
out.seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(JSON.stringify(out, null, 2));
