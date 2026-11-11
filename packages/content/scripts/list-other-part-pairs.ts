/**
 * Lists which part types can do something to which, as the code allows it, and where each pair is described in the
 * part's "From other parts" (step C2 of the finished behaviour plan). Fails when a pair is neither described, ruled out by
 * a decided assumption, nor missing with a reason. The builds are read side by side (`--jobs` sets how many at once).
 *
 *   pnpm --filter @opentim/content list-other-part-pairs --tim1 <game folder> --evenmore <game folder>
 */
import { parseArgs } from "node:util";
import { isMainThread } from "node:worker_threads";
import { readBehaviour } from "../src/read/behaviour.ts";
import { evaluateBehaviourCondition } from "../src/read/describe-behaviour.ts";
import { otherPartPairs, renderOtherPartPairs } from "../src/read/other-part-pairs.ts";
import { buildFolders, inEachBuild, jobsOption, readBuild, type BuildFolder } from "./builds.ts";

export function inBuild(build: BuildFolder) {
  const { program, parts } = readBuild(build);
  const pairs = otherPartPairs(readBehaviour(program, parts), evaluateBehaviourCondition);
  return {
    text: renderOtherPartPairs(pairs),
    unexplained: pairs.pairs.some((p) => p.status !== "described" && !p.reasons.length),
  };
}

if (isMainThread) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== "--"),
    options: {
      jobs: { type: "string" },
      tim1: { type: "string", multiple: true },
      evenmore: { type: "string", multiple: true },
    },
  });
  if (!values.tim1?.length && !values.evenmore?.length)
    throw new Error("Give at least one --tim1 or --evenmore folder");

  await inEachBuild<ReturnType<typeof inBuild>>(
    import.meta.url,
    buildFolders(values),
    ({ text, unexplained }, { folder }) => {
      console.log(`== ${folder}`);
      console.log(text);
      if (unexplained) {
        console.error("A pair has no description and no reason.");
        process.exitCode = 1;
      }
    },
    { jobs: jobsOption(values.jobs) },
  );
}
