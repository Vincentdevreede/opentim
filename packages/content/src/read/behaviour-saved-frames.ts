/**
 * States a part is never in, decided after reading the code (docs/behaviour-assumptions.md). A level stores a part's
 * saved frame, at `0x90`, not the frame it shows while the machine runs, and the reset sets the monkey bike's counter
 * at `0x96` to 0. In play the monkey bike reaches frames 5 to 12 only from its bounce, which starts that counter in
 * the same step, and its run leaves them when the counter runs out. So it is on those frames with the counter at 0
 * only when a level starts it there, and no level does: the game itself never gives its saved frame one of them.
 */
export const MONKEY_BIKE_ASSUMPTION =
  "The monkey bike is never on frames 5 to 12 with its counter at 0x96 at 0. In play it reaches them only from its bounce, which starts the counter, and leaves them when the counter runs out; a level never starts it there.";

/**
 * The conveyor belt is drawn by its own code, so its type has no frame list to count. Its frame is a block of 7 frames
 * per width: the editor changes the width at `0x50` in steps of 16 between the type record's minimum at `+0x10` (32)
 * and maximum at `+0x0c` (96), and the belt's resize routine then sets the shown frame at `0x0c` and the saved frame
 * at `0x90` both to `(width - 32) / 16 * 7`, the first frame of that block. Its run only moves it within its block.
 */
export const CONVEYOR_BELT_ASSUMPTION =
  "A level starts the conveyor belt on frame 0, 7, 14, 21 or 28, the first frame of the block of 7 its width selects. The editor keeps the width between 32 and 96 in steps of 16, and the belt's resize sets its saved frame to the start of that block.";

/**
 * The gear is drawn by its own code too. Its run adds its control value at `0x12` to its frame and wraps it, from -1
 * to 3 and from 4 to 0, so it has four frames. Every shipped level saves it on frame 0; the walks still start it on
 * each of the four, which only rules out frames it doesn't have.
 */
export const GEAR_ASSUMPTION =
  "A level starts the gear on one of its four frames, 0 to 3. Its run wraps the frame within them, and every shipped level saves it on frame 0.";

/** By part id: the frames a level can start a part on when its type has no frame list, and why. */
export const LEVEL_FRAMES: ReadonlyMap<string, { frames: number[]; assumption: string }> = new Map([
  ["conveyor-belt", { frames: [0, 7, 14, 21, 28], assumption: CONVEYOR_BELT_ASSUMPTION }],
  ["gear", { frames: [0, 1, 2, 3], assumption: GEAR_ASSUMPTION }],
]);

/** By part id: frames the part is never on while a field has a value, and the assumption that says so. */
export const IMPOSSIBLE_STATES: ReadonlyMap<
  string,
  { frames: number[]; field: { offset: number; width: number; value: number }; assumption: string }
> = new Map([
  [
    "monkey-bike",
    {
      frames: [5, 6, 7, 8, 9, 10, 11, 12],
      field: { offset: 0x96, width: 16, value: 0 },
      assumption: MONKEY_BIKE_ASSUMPTION,
    },
  ],
]);
