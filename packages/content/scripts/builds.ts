/**
 * Reading game builds for the scripts, several at once. Each build is read on its own worker thread, because reading
 * one build's behaviour takes up to a minute on one core and the builds don't depend on each other.
 *
 * A script that reads builds this way exports `inBuild(build)`, which reads one build and returns what the script
 * needs from it, and keeps its own work under `if (isMainThread)`. Each worker loads the script again and calls
 * `inBuild(build, given)`, with `given` from `inEachBuild`'s options, so what goes in and out must survive a structured
 * clone (plain data, Maps and Sets).
 */
import { readdirSync, readFileSync } from "node:fs";
import { availableParallelism, freemem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { decodeImage, isArchiveName, readArchive } from "@opentim/resources";
import { readProgramParts, readTim2ProgramParts, readToonsParts, type ProgramParts } from "../src/read/parts.ts";

export type Game = "tim1" | "evenmore" | "tim2" | "toons";

/** The games in the order the scripts read them, and the name of each game's program. */
export const GAME_PROGRAMS: Record<Game, string> = {
  tim1: "TIM.EXE",
  evenmore: "TIM.EXE",
  tim2: "TIM2.EXE",
  toons: "TOONS.EXE",
};

/** One game folder given to a script, with its place among the folders given for its game. */
export interface BuildFolder {
  game: Game;
  folder: string;
  index: number;
}

/** About the most one build's reading holds in memory (an Even More build peaks at 1.7 GB). */
const MEMORY_PER_BUILD = 2.5 * 2 ** 30;

/** The folders in the order the scripts always read them: TIM 1, Even More, TIM 2, then Toons. */
export function buildFolders(values: Partial<Record<Game, string[]>>): BuildFolder[] {
  return (Object.keys(GAME_PROGRAMS) as Game[]).flatMap((game) =>
    (values[game] ?? []).map((folder, index) => ({ game, folder: resolve(folder), index })),
  );
}

export function readResources(folder: string): Map<string, Uint8Array> {
  const at = [folder, dirname(folder)].find((dir) => readdirSync(dir).some(isArchiveName));
  if (!at) throw new Error(`${folder}: no RESOURCE files here or in the parent folder`);
  const files = new Map<string, Uint8Array>();
  for (const name of readdirSync(at).filter(isArchiveName).sort())
    for (const entry of readArchive(readFileSync(join(at, name)), name)) files.set(entry.name, entry.data);
  return files;
}

/** A build's program, its resource files and its parts. */
export function readBuild({ game, folder }: BuildFolder) {
  const program = readFileSync(join(folder, GAME_PROGRAMS[game]));
  const files = readResources(folder);
  const spriteCount = (sheet: string) => {
    const data = files.get(`${sheet}.BMP`);
    return data && decodeImage(data).frames.length;
  };
  let parts: ProgramParts;
  if (game === "tim2") parts = readTim2ProgramParts(program, (name) => files.get(name), { keepUnknown: true });
  else if (game === "toons") parts = readToonsParts(program, spriteCount, { keepUnknown: true });
  else parts = readProgramParts(game, program, spriteCount, (sheet) => files.get(`${sheet}.BMP`));
  return { program, files, parts };
}

/** How many builds to read at once when the script isn't told: one per core but one, as far as memory allows. */
export function defaultJobs(): number {
  return Math.max(1, Math.min(availableParallelism() - 1, Math.floor(freemem() / MEMORY_PER_BUILD)));
}

/**
 * Calls the `inBuild` export of `script` for each build on worker threads, at most `jobs` at a time, and gives it
 * `given` as well. `onResult` gets
 * the results in the builds' order, each as soon as it and every build before it are read, so a script's output
 * reads as if it read the builds one after another. Fails with the build's folder when a worker fails.
 */
export async function inEachBuild<T>(
  script: string | URL,
  builds: readonly BuildFolder[],
  onResult: (result: T, build: BuildFolder) => void,
  { jobs = defaultJobs(), given }: { jobs?: number; given?: unknown } = {},
): Promise<void> {
  const results: { done: boolean; value?: T }[] = builds.map(() => ({ done: false }));
  let reported = 0;
  let next = 0;
  const read = (build: BuildFolder) =>
    new Promise<T>((done, fail) => {
      const worker = new Worker(new URL("./build-worker.ts", import.meta.url), {
        workerData: { script: String(script), build, given },
      });
      let answered = false;
      worker.once("message", (value: T) => {
        answered = true;
        done(value);
      });
      worker.once("error", (error: Error) => fail(new Error(`${build.folder}: ${error.message}`, { cause: error })));
      worker.once("exit", (code) => {
        if (!answered) fail(new Error(`${build.folder}: the worker stopped (code ${code}) without an answer`));
      });
    });
  const lane = async () => {
    while (next < builds.length) {
      const at = next++;
      results[at] = { done: true, value: await read(builds[at]!) };
      for (; reported < builds.length && results[reported]!.done; reported++)
        onResult(results[reported]!.value as T, builds[reported]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, builds.length)) }, lane));
}

/** Reads `--jobs` as a positive whole number, or the default when it isn't given. */
export function jobsOption(value: string | undefined): number {
  if (value === undefined) return defaultJobs();
  const jobs = Number(value);
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`--jobs must be a positive whole number, not ${value}`);
  return jobs;
}
