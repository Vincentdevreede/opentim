/**
 * Lists every assumption the behaviour analysis states in the given builds, or checks the list is complete. The
 * builds are read side by side (`--jobs` sets how many at once).
 *
 *   pnpm --filter @opentim/content list-assumptions --out <document> --tim1 <game folder> --evenmore <game folder>
 *   pnpm --filter @opentim/content list-assumptions --check <document> --tim1 <game folder> --evenmore <game folder>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { isMainThread } from "node:worker_threads";
import {
  addBuild,
  collectAssumptions,
  compareAssumptions,
  renderAssumptions,
  type AssumptionTable,
} from "../src/read/behaviour-assumption-list.ts";
import { readBehaviour } from "../src/read/behaviour.ts";
import { buildFolders, inEachBuild, jobsOption, readBuild, type BuildFolder } from "./builds.ts";

export function inBuild(build: BuildFolder) {
  const { program, parts } = readBuild(build);
  return collectAssumptions(readBehaviour(program, parts));
}

if (isMainThread) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== "--"),
    options: {
      out: { type: "string" },
      check: { type: "string" },
      jobs: { type: "string" },
      tim1: { type: "string", multiple: true },
      evenmore: { type: "string", multiple: true },
    },
  });
  if (!values.out === !values.check || (!values.tim1?.length && !values.evenmore?.length))
    throw new Error("Give either --out or --check <document> and at least one --tim1 or --evenmore <game folder>");

  const table: AssumptionTable = new Map();
  const builds = { tim1: 0, evenmore: 0 };
  await inEachBuild<ReturnType<typeof inBuild>>(
    import.meta.url,
    buildFolders(values),
    (uses, { game, folder }) => {
      addBuild(table, game, uses);
      builds[game]++;
      console.log(`${folder}: ${table.size} assumptions so far`);
    },
    { jobs: jobsOption(values.jobs) },
  );

  if (values.out) {
    writeFileSync(resolve(values.out), renderAssumptions(table, builds));
    console.log(`Wrote ${table.size} assumptions to ${values.out}`);
  } else {
    const { missing, stale } = compareAssumptions(table, readFileSync(resolve(values.check!), "utf8"));
    for (const text of stale) console.log(`No longer stated by these builds: ${text}`);
    for (const text of missing) console.error(`Not listed: ${text}`);
    if (missing.length) {
      console.error(`${missing.length} assumptions are not listed. Regenerate the list with --out.`);
      process.exitCode = 1;
    } else console.log(`All ${table.size} assumptions are listed.`);
  }
}
