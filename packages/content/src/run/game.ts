/**
 * Runs a shipped puzzle in the game's own code, step by step: starts `TIM.EXE`, presses Enter at the Dynamix logo,
 * waits for the menu, then loads the puzzle with the game's puzzle loader and runs the game's run loop, the one the
 * run button starts, handing each step's parts to the caller. Only the game's code runs; this file only calls it.
 *
 * The routines and words it calls and reads are per build, found in the code (see `GAME_BUILDS`).
 */
import { createHash } from "node:crypto";
import { findDataSegment } from "../read/type-table.ts";
import { Dos } from "./dos.ts";
import { readLzexeProgram } from "./program.ts";

export interface GameBuild {
  name: string;
  /** The puzzle loader: builds "L<n>.lev" from the puzzle number it is given and reads it into the lists. */
  loadPuzzle: { segment: number; offset: number };
  /** The run loop the run button starts, and the top of its loop, where one step begins. */
  runLoop: { segment: number; offset: number; top: number };
  /** Words in the data segment. */
  words: { puzzle: number; mode: number; step: number; moving: number; fixed: number };
  /** The game modes the run loop runs in and the menu's. */
  modes: { running: number; menu: number };
}

/**
 * Even More, English floppy (Even More! The Incredible Machine 1.0). Found in the code:
 * - the puzzle loader at `0x0ecc:0x541e` copies "L" and the number and ".lev" into a name, sets the title flag
 *   `[0x508c]` and calls the level reader `0x0ecc:0x4dc2` (which `0x0ecc:0x54dd` calls without the title, for the
 *   title and credits machines);
 * - the run loop at `0x0000:0x1230` (called by the run button's code at `0x3396` and the title at `0x0ecc:0x12c3`)
 *   loops from `0x1247` while the mode word `[0x4a6d]` is `0x2000`, counting steps in `[0x4aab]`; each pass reads
 *   input, runs the parts (`0x0e89`), moves them (`0x73f5`), checks the goal (`0x1497`, through `0x14ae` by the puzzle
 *   number `[0x4ac1]`), draws, and waits for 8 timer ticks;
 * - the parts are on the moving list `[0x4d7d]` and the fixed list `[0x4e1f]`; the menu's mode is `0x8000`.
 */
const EVEN_MORE_FLOPPY: GameBuild = {
  name: "Even More, English floppy",
  loadPuzzle: { segment: 0x0ecc, offset: 0x541e },
  runLoop: { segment: 0x0000, offset: 0x1230, top: 0x1247 },
  words: { puzzle: 0x4ac1, mode: 0x4a6d, step: 0x4aab, moving: 0x4d7d, fixed: 0x4e1f },
  modes: { running: 0x2000, menu: 0x8000 },
};

/**
 * The Incredible Machine, French. Found in the code the same way:
 * - the puzzle loader at `0x0e44:0x48a4` builds "l<n>.lev", sets the title flag `[0x55f2]` and calls the level reader
 *   `0x0e44:0x42aa`; the game calls it with the puzzle number `[0x503d]` (at `0x0e44:0x10bd` and `0x0e44:0x31e3`);
 * - the run loop at `0x0000:0x12dc` loops from `0x12f3` while the mode word `[0x4feb]` is `0x2000`, counting steps in
 *   `[0x5027]`;
 * - the parts are on the moving list `[0x52f9]` and the fixed list `[0x539b]`.
 */
const TIM_FRENCH: GameBuild = {
  name: "The Incredible Machine, French",
  loadPuzzle: { segment: 0x0e44, offset: 0x48a4 },
  runLoop: { segment: 0x0000, offset: 0x12dc, top: 0x12f3 },
  words: { puzzle: 0x503d, mode: 0x4feb, step: 0x5027, moving: 0x52f9, fixed: 0x539b },
  modes: { running: 0x2000, menu: 0x8000 },
};

/** The builds the recorder knows, by the SHA-256 of their `TIM.EXE`. */
export const GAME_BUILDS = new Map<string, GameBuild>([
  ["b11cf18e51a14dbcee9872ec2a524caec4e5f656c8612c3a4c7de16c79bd9fa9", EVEN_MORE_FLOPPY],
  ["4a54cc37f477dde0f22d887e9930fbc384936cf089faa3343b27cac8aecd82d6", TIM_FRENCH],
]);

/** How many bytes of each part record a step keeps: every field the analysis names lies below. */
export const PART_RECORD = 0xa0;

export interface StepParts {
  step: number;
  /** Each part on the lists, moving list first, with its place in the data segment and its record's bytes. */
  parts: { list: "moving" | "fixed"; at: number; record: Uint8Array }[];
}

export function exeHash(exe: Uint8Array): string {
  return createHash("sha256").update(exe).digest("hex");
}

/**
 * Runs puzzle `puzzle` for `steps` steps and calls `onStep` with the parts after each step, `steps` + 1 times: step 0 is
 * the puzzle as loaded, after the run button's preparation, and step n the parts after n steps. A run that ends early,
 * when the goal is met, calls it fewer times. `file` gives the game's files by name.
 */
export function runPuzzle(
  exe: Uint8Array,
  file: (name: string) => Uint8Array | undefined,
  puzzle: number,
  steps: number,
  onStep: (parts: StepParts) => void,
  build: GameBuild | undefined = GAME_BUILDS.get(exeHash(exe)),
  tickEvery?: number,
): void {
  if (!build) throw new Error(`no recorder addresses for this TIM.EXE (${exeHash(exe)})`);
  const program = readLzexeProgram(exe);
  const dos = new Dos({ file, ...(tickEvery ? { tickEvery } : {}) });
  const cpu = dos.cpu;
  dos.start(program);
  const data = dos.load + findDataSegment(program.image);
  const inGame = () => cpu.cs >= dos.load && cpu.cs < data;
  // Start up to the logo, press Enter, and give the menu time to come up.
  dos.runUntil(() => cpu.steps >= 2_000_000, 2_000_000, "start");
  dos.key(0x1c);
  dos.runUntil(() => cpu.steps >= 3_000_000, 1_000_000, "key");
  dos.key(0x9c);
  dos.runUntil(() => cpu.steps >= 25_000_000, 22_000_000, "menu");
  dos.runUntil(() => !dos.inInterrupt && inGame(), 50_000_000, "a menu step");
  // From here the menu is left: the puzzle is loaded and run as the run button does.
  cpu.segs[3] = data;
  cpu.write16(data, build.words.puzzle, puzzle);
  dos.callFar(dos.load + build.loadPuzzle.segment, build.loadPuzzle.offset, [puzzle], 300_000_000, "loading");
  const read = (list: "moving" | "fixed") => {
    const parts: StepParts["parts"] = [];
    for (let at = cpu.read16(data, build.words[list]); at && parts.length < 1000; at = cpu.read16(data, at))
      parts.push({ list, at, record: cpu.memory.slice(data * 16 + at, data * 16 + at + PART_RECORD) });
    return parts;
  };
  cpu.write16(data, build.words.mode, build.modes.running);
  let step = 0;
  const top = { segment: dos.load + build.runLoop.segment, offset: build.runLoop.top };
  cpu.push(0xffff);
  cpu.push(0);
  cpu.segs[1] = dos.load + build.runLoop.segment;
  cpu.ip = build.runLoop.offset;
  dos.runUntil(
    () => {
      if (cpu.cs === top.segment && cpu.ip === top.offset) {
        // The top of a pass is where the step before has ended: after the last step the run goes back to the menu.
        if (step <= steps) onStep({ step, parts: [...read("moving"), ...read("fixed")] });
        if (++step > steps) cpu.write16(data, build.words.mode, build.modes.menu);
      }
      return cpu.cs === 0xffff && cpu.ip === 0;
    },
    (steps + 1) * 2_000_000 + 10_000_000,
    "running",
  );
}
