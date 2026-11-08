/**
 * Records what DOSBox does with the processor's instruction cases (`tests/fixtures/cpu-cases.ts`): writes the case
 * programs to a temporary folder, runs them in DOSBox without a window, and copies their results to
 * `tests/fixtures/dosbox-cpu`. The processor test compares with those results, so it needs no DOSBox itself.
 *
 *   pnpm --filter @opentim/content record-cpu-cases [--seed <n>]
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { cpuCasePrograms, CPU_CASE_SEED, RESULT } from "../tests/fixtures/cpu-cases.ts";

const { values } = parseArgs({ options: { seed: { type: "string" } } });
const seed = values.seed === undefined ? CPU_CASE_SEED : Number(values.seed);
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
  const out = new URL("../tests/fixtures/dosbox-cpu/", import.meta.url);
  mkdirSync(out, { recursive: true });
  programs.forEach((_, n) => copyFileSync(join(work, `R${n}.BIN`), new URL(`R${n}.BIN`, out)));
  console.log(`Recorded ${cases.length} cases in ${programs.length} programs with seed ${seed}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
