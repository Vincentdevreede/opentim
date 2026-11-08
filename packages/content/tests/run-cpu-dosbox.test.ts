import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cpu, CpuStop } from "../src/run/cpu.ts";
import { cpuCasePrograms, CPU_CASE_SEED, RESULT } from "./fixtures/cpu-cases.ts";

/** Runs a case program as DOS runs a COM program and returns what it writes to its results file. */
function run(bytes: Uint8Array): number[] {
  const output: number[] = [];
  const cpu = new Cpu({
    interrupt(c, vector) {
      if (vector === 0x20) throw new CpuStop("done", 0);
      const ah = c.register("ah");
      if (vector === 0x21 && ah === 0x3c) c.regs[0] = 5;
      if (vector === 0x21 && ah === 0x40) {
        for (let k = 0; k < c.regs[1]!; k++) output.push(c.read8(c.ds, c.regs[2]! + k));
        c.regs[0] = c.regs[1]!;
      }
      c.setFlag(1, false);
      return true;
    },
  });
  cpu.memory.set(bytes, 0x20000 + 0x100);
  for (const k of [0, 1, 2, 3]) cpu.segs[k] = 0x2000;
  cpu.regs[4] = 0xfffe;
  cpu.ip = 0x100;
  try {
    for (let n = 0; n < 1_000_000; n++) cpu.step();
  } catch (error) {
    if (!(error instanceof CpuStop) || error.message !== "done at 0") throw error;
  }
  return output;
}

describe("the processor next to DOSBox", () => {
  const { cases, programs } = cpuCasePrograms(CPU_CASE_SEED);
  const REGISTERS = ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"];
  it.each(programs.map((program, n) => [program.name, n] as const))(
    "leaves the registers, flags and memory as DOSBox does in %s",
    (_, n) => {
      const program = programs[n]!;
      const expected = readFileSync(new URL(`./fixtures/dosbox-cpu/R${n}.BIN`, import.meta.url));
      const got = run(program.bytes);
      const differences: string[] = [];
      program.cases.forEach((index, k) => {
        const c = cases[index]!;
        const want = expected.subarray(k * RESULT, (k + 1) * RESULT);
        const have = got.slice(k * RESULT, (k + 1) * RESULT);
        const word = (b: ArrayLike<number>, at: number) => b[at]! | (b[at + 1]! << 8);
        const wrong: string[] = [];
        REGISTERS.forEach((name, r) => {
          if (r !== 4 && word(want, r * 2) !== word(have, r * 2)) wrong.push(name);
        });
        const flags = 0x8d5 & ~c.undefined;
        if ((word(want, 16) & flags) !== (word(have, 16) & flags)) wrong.push("flags");
        if (want.subarray(18).some((b, i) => b !== have[18 + i])) wrong.push("memory");
        if (wrong.length) differences.push(`${c.name} [${c.bytes.join(" ")}]: ${wrong.join(", ")}`);
      });
      expect(differences).toEqual([]);
    },
  );
});
