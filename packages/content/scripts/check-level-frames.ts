/**
 * Checks every shipped level's saved frames against the behaviour description, build by build (step E1 of
 * docs/behaviour-plan.md). Fails when a level saves a part on a frame the description doesn't allow, or a decided
 * control value outside its numbers. The builds are read side by side (`--jobs` sets how many at once).
 *
 *   pnpm --filter @opentim/content check-level-frames --tim1 <game folder> --evenmore <game folder>
 */
import { parseArgs } from "node:util";
import { isMainThread } from "node:worker_threads";
import { readBehaviour } from "../src/read/behaviour.ts";
import { describeBehaviour } from "../src/read/describe-behaviour.ts";
import { checkLevelFrames, type CheckedLevel } from "../src/read/level-frame-check.ts";
import { readLevel } from "../src/read/level.ts";
import { buildFolders, inEachBuild, jobsOption, readBuild, type BuildFolder } from "./builds.ts";

const frames = (counts: Map<number, number>) =>
  [...counts]
    .sort(([a], [b]) => a - b)
    .map(([frame, count]) => `${frame} (${count})`)
    .join(", ");

/** One build's lines in the order they are printed (errors to stderr), and how many problems it has. */
export function inBuild(build: BuildFolder) {
  const { folder } = build;
  const lines: { error: boolean; text: string }[] = [];
  const log = (text: string) => lines.push({ error: false, text });
  const error = (text: string) => lines.push({ error: true, text });
  let disagreements = 0;
  const { program, files, parts } = readBuild(build);
  const report = readBehaviour(program, parts);
  const description = describeBehaviour(report);
  const levels: CheckedLevel[] = [];
  const unread: string[] = [];
  for (const [name, data] of files) {
    if (!/\.(LEV|GKC)$/i.test(name)) continue;
    try {
      levels.push({ name, parts: readLevel(data, { layout: "tim", name }).parts });
    } catch (problem) {
      unread.push(name);
      error(`  ${name}: ${problem instanceof Error ? problem.message : String(problem)}`);
    }
  }
  // A level that can't be read is a level not checked, which must not pass as agreement; nor may a folder
  // without one level read.
  disagreements += unread.length;
  if (!levels.length) {
    error(`${folder}: no level could be read, so nothing was checked.`);
    disagreements++;
  }
  const rows = checkLevelFrames(
    description.parts.map((part) => ({
      description: part,
      frameCount: report.parts.find((item) => item.type === part.type)?.frameCount,
    })),
    levels,
  );
  log(`${folder}: ${levels.length} levels${unread.length ? `, ${unread.length} unread (${unread.join(", ")})` : ""}`);
  for (const row of rows) {
    const problems = [...row.outside, ...row.controls];
    disagreements += problems.length;
    const notes = [
      ...(row.allowed.frames ? [] : [`no frames to check (${row.allowed.basis})`]),
      ...(row.notResting.size ? [`starts on frames that aren't resting frames: ${frames(row.notResting)}`] : []),
    ];
    if (problems.length || notes.length)
      log(`  ${row.type}: ${row.id}: saved ${frames(row.saved)}${notes.map((note) => `; ${note}`).join("")}`);
    for (const problem of problems) error(`    Not allowed: ${problem}`);
  }
  return { lines, disagreements };
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

  let disagreements = 0;
  await inEachBuild<ReturnType<typeof inBuild>>(
    import.meta.url,
    buildFolders(values),
    (result) => {
      for (const { error, text } of result.lines) (error ? console.error : console.log)(text);
      disagreements += result.disagreements;
    },
    { jobs: jobsOption(values.jobs) },
  );
  if (disagreements) {
    console.error(
      `${disagreements} problems: saved values that disagree with the description, levels that can't be read, or folders without a level.`,
    );
    process.exitCode = 1;
  } else console.log("Every saved frame and control value is one the description allows.");
}
