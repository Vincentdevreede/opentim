/**
 * Checks every shipped level's saved frames against the behaviour description, build by build (step E1 of
 * the finished behaviour plan). Fails when a level saves a part on a frame the description doesn't allow, or a decided
 * control value outside its numbers. The builds are read side by side (`--jobs` sets how many at once).
 *
 * TIM 2 and Toons have no behaviour description (only TIM.EXE's behaviour is read), so the check doesn't apply to
 * them, and the output says so. It still lists, as notes, the states their levels save that the type has no frame
 * for: TIM 2 picks a type's frame by its state through the animation's list, and Toons draws the state as the frame.
 * Those notes don't fail the check. A level that can't be read does, in every game.
 *
 *   pnpm --filter @opentim/content check-level-frames --tim1 <game folder> --evenmore <game folder>
 *     --tim2 <game folder> --toons <game folder>
 */
import { parseArgs } from "node:util";
import { isMainThread } from "node:worker_threads";
import { readBehaviour } from "../src/read/behaviour.ts";
import { describeBehaviour } from "../src/read/describe-behaviour.ts";
import { checkLevelFrames, type CheckedLevel } from "../src/read/level-frame-check.ts";
import { readLevel, type Level } from "../src/read/level.ts";
import { readTim2Parts, readToonsParts } from "../src/read/parts.ts";
import { decodeImage } from "@opentim/resources";
import {
  buildFolders,
  folderOptions,
  GAMES,
  inEachBuild,
  jobsOption,
  readBuild,
  readProgram,
  readResources,
  type BuildFolder,
  type Game,
} from "./builds.ts";

const frames = (counts: Map<number, number>) =>
  [...counts]
    .sort(([a], [b]) => a - b)
    .map(([frame, count]) => `${frame} (${count})`)
    .join(", ");

/** One build's lines in the order they are printed (errors to stderr), and how many problems it has. */
export function inBuild(build: BuildFolder<Game>) {
  if (build.game === "tim2" || build.game === "toons")
    return withoutDescription(build as BuildFolder<"tim2" | "toons">);
  return withDescription(build as BuildFolder);
}

/**
 * TIM 2 and Toons: no description to check against. The levels are read, and the states they save that the type has
 * no frame for are noted.
 */
function withoutDescription(build: BuildFolder<"tim2" | "toons">) {
  const { folder } = build;
  const lines: { error: boolean; text: string }[] = [];
  const log = (text: string) => lines.push({ error: false, text });
  const error = (text: string) => lines.push({ error: true, text });
  const files = readResources(folder);
  const program = build.game === "tim2" ? "TIM2.EXE" : "TOONS.EXE";
  const spriteCount = (sheet: string) => {
    const data = files.get(`${sheet}.BMP`);
    return data && decodeImage(data).frames.length;
  };
  const parts =
    build.game === "tim2"
      ? readTim2Parts((name) => files.get(name), { keepUnknown: true }).parts
      : readToonsParts(readProgram(build), spriteCount, { keepUnknown: true }).list.parts;
  const levels: Level[] = [];
  const unread: string[] = [];
  for (const [name, data] of files) {
    if (!/\.LEV$/i.test(name)) continue;
    try {
      levels.push(readLevel(data, { layout: build.game, name }));
    } catch (problem) {
      unread.push(name);
      error(`  ${name}: ${problem instanceof Error ? problem.message : String(problem)}`);
    }
  }
  let disagreements = unread.length;
  if (!levels.length) {
    error(`${folder}: no level could be read, so nothing was checked.`);
    disagreements++;
  }
  log(`${folder}: ${levels.length} levels${unread.length ? `, ${unread.length} unread (${unread.join(", ")})` : ""}`);
  log(
    `  No behaviour description of ${program}, so the saved frames aren't checked against one. ` +
      `Notes: states a type has no frame for.`,
  );
  const saved = new Map<number, Map<number, number>>();
  for (const level of levels)
    for (const part of level.parts) {
      const counts = saved.get(part.type) ?? new Map<number, number>();
      counts.set(part.state[0], (counts.get(part.state[0]) ?? 0) + 1);
      saved.set(part.type, counts);
    }
  const unlisted: number[] = [];
  const frameless: string[] = [];
  for (const [type, counts] of [...saved].sort(([a], [b]) => a - b)) {
    const part = parts.find((p) => p.type === type);
    if (!part) {
      unlisted.push(type);
      continue;
    }
    const shown = part.states?.length ?? part.frames.length;
    const outside = [...counts.keys()].filter((state) => state < 0 || state >= shown);
    if (!shown) frameless.push(`${type} (${part.id})`);
    else if (outside.length)
      log(
        `  ${type}: ${part.id}: saved ${frames(counts)}; ${outside.join(", ")} past its ${shown} ${part.states ? "states" : "frames"}`,
      );
  }
  if (frameless.length) log(`  Types without frames to check: ${frameless.join(", ")}`);
  if (unlisted.length) log(`  Types the part list doesn't have, not checked: ${unlisted.join(", ")}`);
  return { lines, disagreements };
}

/** TIM 1 and Even More: the saved frames against the description of TIM.EXE's behaviour. */
function withDescription(build: BuildFolder) {
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
    options: { jobs: { type: "string" }, ...folderOptions(GAMES) },
  });
  const builds = buildFolders(values, GAMES);
  if (!builds.length) throw new Error("Give at least one --tim1, --evenmore, --tim2 or --toons folder");

  let disagreements = 0;
  await inEachBuild<ReturnType<typeof inBuild>, Game>(
    import.meta.url,
    builds,
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
