/**
 * Records what DOSBox does with the processor's instruction cases (`tests/fixtures/cpu-cases.ts`): writes the case
 * programs to a temporary folder, runs them in DOSBox without a window, and copies their results to
 * `tests/fixtures/dosbox-cpu`. The processor test compares with those results, so it needs no DOSBox itself. The test
 * builds its cases with `CPU_CASE_SEED`, so the results of another seed go to a folder of their own (`--out`).
 *
 *   pnpm --filter @opentim/content record-cpu-cases [--seed <n> --out <folder>]
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { cpuCasePrograms, CPU_CASE_SEED, RESULT } from "../tests/fixtures/cpu-cases.ts";

const { values } = parseArgs({ options: { seed: { type: "string" }, out: { type: "string" } } });
const seed = values.seed === undefined ? CPU_CASE_SEED : Number(values.seed);
if (!Number.isInteger(seed)) throw new Error(`--seed must be a whole number, not ${values.seed}`);
if (seed !== CPU_CASE_SEED && values.out === undefined)
  throw new Error(`The test reads the results of seed ${CPU_CASE_SEED}: give --out <folder> for seed ${seed}`);
const out =
  values.out === undefined
    ? new URL("../tests/fixtures/dosbox-cpu/", import.meta.url)
    : pathToFileURL(`${resolve(values.out)}/`);
const { cases, programs } = cpuCasePrograms(seed);
const work = mkdtempSync(join(tmpdir(), "cpu-cases-"));
try {
  // One DOSBox per program: DOSBox sometimes hangs after a program has closed its results, so a run is cut off after a
  // while and counts when its results are complete.
  programs.forEach((program, n) => {
    writeFileSync(join(work, program.name), program.bytes);
    spawnSync(
      "dosbox",
      ["-noconsole", "-c", `mount c ${work}`, "-c", "c:", "-c", program.name.replace(/\.COM$/, ""), "-c", "exit"],
      {
        env: { ...process.env, SDL_VIDEODRIVER: "dummy", SDL_AUDIODRIVER: "dummy" },
        stdio: "ignore",
        timeout: 20_000,
        killSignal: "SIGKILL",
      },
    );
    const results = join(work, `R${n}.BIN`);
    if (!existsSync(results) || statSync(results).size !== program.cases.length * RESULT)
      throw new Error(`DOSBox gave no complete results for ${program.name}`);
  });
  mkdirSync(out, { recursive: true });
  // The results of a run before, which can have more programs, go first, so none is left over.
  for (const name of readdirSync(out)) if (/^R\d+\.BIN$/.test(name)) rmSync(new URL(name, out));
  programs.forEach((_, n) => copyFileSync(join(work, `R${n}.BIN`), new URL(`R${n}.BIN`, out)));
  console.log(`Recorded ${cases.length} cases in ${programs.length} programs with seed ${seed} in ${out.pathname}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
