/**
 * Runs a shipped puzzle in the game's own code, step by step: starts `TIM.EXE`, presses Enter at the Dynamix logo,
 * waits for the menu, presses Enter there and lets the menu end its title machine itself, then enters the play screen
 * as the game does, which loads the puzzle, and runs the game's run loop, the one the run button starts, handing each
 * step's parts to the caller. Only the game's code runs; this file only calls it.
 *
 * The routines and words it calls and reads are per build, found in the code (see `GAME_BUILDS`).
 */
import { createHash } from "node:crypto";
import { EVEN_MORE_FLOPPY_EXE, TIM_FRENCH_EXE } from "../read/level-loader.ts";
import { findDataSegment } from "../read/type-table.ts";
import { Dos } from "./dos.ts";
import { readLzexeProgram } from "./program.ts";

export interface GameBuild {
  name: string;
  /**
   * The place in the menu just after it has freed its title machine, at the end of a round, before it looks at what
   * the player chose. The recorder takes over there, so the title machine is gone the way the game ends it.
   */
  menuEnd: { segment: number; offset: number };
  /**
   * The play screen's entry: it loads the puzzle `words.puzzle` names with the game's puzzle loader, sets the view and
   * the bonus display, and sets the mode to building.
   */
  enterPlay: { segment: number; offset: number };
  /** The run loop the run button starts, and the top of its loop, where one step begins. */
  runLoop: { segment: number; offset: number; top: number };
  /** Words in the data segment; `bin` heads the parts bin, the list the list head routine picks by bit 0x0800. */
  words: { puzzle: number; mode: number; step: number; moving: number; fixed: number; bin: number };
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
 * - the parts are on the moving list `[0x4d7d]` and the fixed list `[0x4e1f]`, and the parts bin is the list at
 *   `[0x4cdb]` (the list head routine `0x682f` picks the three by the bits 0x1000, 0x2000 and 0x0800); the menu's mode
 *   is `0x8000`;
 * - the menu (from `0x0ecc:0x0930`) ends each round of its title machine with `0x864b`, the level reset `0x892b`,
 *   `0x8eed` for 1 to 21, and `0x0ecc:0x7e82`, which frees every part of the three lists, and goes on at
 *   `0x0ecc:0x0ba8` to look whether the player chose something;
 * - the play screen's loop `0x0ecc:0x129e` first calls its entry `0x0ecc:0x12f2`, which runs the heap check, calls the
 *   puzzle loader with `[0x4ac1]`, and sets the mode to building (2); then, by the mode, the building screen or the
 *   run loop.
 */
const EVEN_MORE_FLOPPY: GameBuild = {
  name: "Even More, English floppy",
  menuEnd: { segment: 0x0ecc, offset: 0x0ba8 },
  enterPlay: { segment: 0x0ecc, offset: 0x12f2 },
  runLoop: { segment: 0x0000, offset: 0x1230, top: 0x1247 },
  words: { puzzle: 0x4ac1, mode: 0x4a6d, step: 0x4aab, moving: 0x4d7d, fixed: 0x4e1f, bin: 0x4cdb },
  modes: { running: 0x2000, menu: 0x8000 },
};

/**
 * The Incredible Machine, French. Found in the code the same way:
 * - the puzzle loader at `0x0e44:0x48a4` builds "l<n>.lev", sets the title flag `[0x55f2]` and calls the level reader
 *   `0x0e44:0x42aa`; the game calls it with the puzzle number `[0x503d]` (at `0x0e44:0x10bd` and `0x0e44:0x31e3`);
 * - the run loop at `0x0000:0x12dc` loops from `0x12f3` while the mode word `[0x4feb]` is `0x2000`, counting steps in
 *   `[0x5027]`;
 * - the parts are on the moving list `[0x52f9]` and the fixed list `[0x539b]`, and the parts bin is the list at
 *   `[0x5257]` (the list head routine `0x5b96` picks the three the same way);
 * - the menu ends each round of its title machine with `0x7b84`, the level reset `0x7e8b`, `0x8430` for 1 to 20, and
 *   `0x0e44:0x6da7`, which frees every part of the three lists, and goes on at `0x0e44:0x0951`;
 * - the play screen's loop `0x0e44:0x102b` first calls its entry `0x0e44:0x1081`, which loads the puzzle the same way.
 */
const TIM_FRENCH: GameBuild = {
  name: "The Incredible Machine, French",
  menuEnd: { segment: 0x0e44, offset: 0x0951 },
  enterPlay: { segment: 0x0e44, offset: 0x1081 },
  runLoop: { segment: 0x0000, offset: 0x12dc, top: 0x12f3 },
  words: { puzzle: 0x503d, mode: 0x4feb, step: 0x5027, moving: 0x52f9, fixed: 0x539b, bin: 0x5257 },
  modes: { running: 0x2000, menu: 0x8000 },
};

/** The builds the recorder knows, by the SHA-256 of their `TIM.EXE`. */
export const GAME_BUILDS = new Map<string, GameBuild>([
  [EVEN_MORE_FLOPPY_EXE, EVEN_MORE_FLOPPY],
  [TIM_FRENCH_EXE, TIM_FRENCH],
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

/** Starts the game, leaves the menu and enters the play screen with a puzzle; returns the machine and a reader. */
function startPuzzle(
  exe: Uint8Array,
  file: (name: string) => Uint8Array | undefined,
  puzzle: number,
  build: GameBuild | undefined,
  tickEvery?: number,
) {
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
  // Press Enter at the menu and let it end its round: it frees its title machine itself, and the recorder takes over
  // right after, where the menu would look at the player's choice.
  const pressed = cpu.steps;
  let released = false;
  dos.key(0x1c);
  const menuEnd = (build.menuEnd.segment << 4) + build.menuEnd.offset;
  dos.runUntil(
    () => {
      if (!released && cpu.steps >= pressed + 1_000_000) {
        dos.key(0x9c);
        released = true;
      }
      return !dos.inInterrupt && inGame() && ((cpu.cs - dos.load) << 4) + cpu.ip === menuEnd;
    },
    400_000_000,
    "the menu's end",
  );
  // The play screen as the game enters it: its entry loads the puzzle.
  cpu.segs[3] = data;
  cpu.write16(data, build.words.puzzle, puzzle);
  dos.callFar(dos.load + build.enterPlay.segment, build.enterPlay.offset, [], 300_000_000, "entering the play screen");
  const chain = (head: number) => {
    const records: { at: number; record: Uint8Array }[] = [];
    for (let at = cpu.read16(data, head); at && records.length < 1000; at = cpu.read16(data, at))
      records.push({ at, record: cpu.memory.slice(data * 16 + at, data * 16 + at + PART_RECORD) });
    return records;
  };
  const read = (list: "moving" | "fixed"): StepParts["parts"] =>
    chain(build.words[list]).map((part) => ({ list, ...part }));
  return {
    dos,
    cpu,
    data,
    build,
    parts: () => [...read("moving"), ...read("fixed")],
    bin: () => chain(build.words.bin),
  };
}

/**
 * Loads puzzle `puzzle` with the game's puzzle loader and gives the parts on both lists and in the parts bin right
 * after it, before the run
 * button's preparation, with the data segment's words at `words` (each a word address) and a copy of the whole data
 * segment, for records the parts point at.
 */
export function loadPuzzle(
  exe: Uint8Array,
  file: (name: string) => Uint8Array | undefined,
  puzzle: number,
  words: readonly number[] = [],
  build: GameBuild | undefined = GAME_BUILDS.get(exeHash(exe)),
): {
  parts: StepParts["parts"];
  bin: { at: number; record: Uint8Array }[];
  words: Map<number, number>;
  dataSegment: Uint8Array;
} {
  const { cpu, data, parts, bin } = startPuzzle(exe, file, puzzle, build);
  return {
    parts: parts(),
    bin: bin(),
    words: new Map(words.map((w) => [w, cpu.read16(data, w)])),
    dataSegment: cpu.memory.slice(data * 16, data * 16 + 0x10000),
  };
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
  const { dos, cpu, data, parts, build: known } = startPuzzle(exe, file, puzzle, build, tickEvery);
  // The puzzle is run as the run button does.
  cpu.write16(data, known.words.mode, known.modes.running);
  let step = 0;
  const top = { segment: dos.load + known.runLoop.segment, offset: known.runLoop.top };
  cpu.push(0xffff);
  cpu.push(0);
  cpu.segs[1] = dos.load + known.runLoop.segment;
  cpu.ip = known.runLoop.offset;
  dos.runUntil(
    () => {
      if (cpu.cs === top.segment && cpu.ip === top.offset) {
        // The top of a pass is where the step before has ended: after the last step the run goes back to the menu.
        if (step <= steps) onStep({ step, parts: parts() });
        if (++step > steps) cpu.write16(data, known.words.mode, known.modes.menu);
      }
      return cpu.cs === 0xffff && cpu.ip === 0;
    },
    (steps + 1) * 2_000_000 + 10_000_000,
    "running",
  );
}
