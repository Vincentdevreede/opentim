/**
 * States a part is never in, decided after reading the code (docs/behaviour-assumptions.md). A level stores a part's
 * saved frame, at `0x90`, not the frame it shows while the machine runs, and the reset sets the monkey bike's counter
 * at `0x96` to 0. In play the monkey bike reaches frames 5 to 12 only from its bounce, which starts that counter in
 * the same step, and its run leaves them when the counter runs out. So it is on those frames with the counter at 0
 * only when a level starts it there, and no level does: the game itself never gives its saved frame one of them.
 */
export const MONKEY_BIKE_ASSUMPTION =
  "The monkey bike is never on frames 5 to 12 with its counter at 0x96 at 0. In play it reaches them only from its bounce, which starts the counter, and leaves them when the counter runs out; a level never starts it there.";

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
