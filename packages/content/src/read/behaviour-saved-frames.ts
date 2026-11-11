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

/**
 * The motors are drawn by their own code as well. The mouse motor's run only flips bit 0 of its frame (`xor` at
 * `0x1c019` in Even More), so it has frames 0 and 1. The electric motor's run counts its frame down and sets 2 after 0
 * (`0x1a52b` to `0x1a534`), so it has frames 0 to 2. No other routine of theirs writes the frame.
 */
export const MOUSE_MOTOR_ASSUMPTION =
  "A level starts the mouse motor on frame 0 or 1. Its run only flips between them, and every shipped level saves it on one of them.";
export const ELECTRIC_MOTOR_ASSUMPTION =
  "A level starts the electric motor on one of its three frames, 0 to 2. Its run counts down within them, and every shipped level saves it on frame 0.";

/**
 * The level reset keeps the frame a level saved for most parts. A part with one frame can only have been saved on it:
 * every part in every shipped level of the eleven builds is saved on one of its own frames.
 */
export const ONE_FRAME_ASSUMPTION =
  "A level saves a part on one of its own frames, so a part with one frame starts on frame 0. Every part in every shipped level of the eleven builds is saved on one of its own frames.";

/**
 * More parts the program draws with its own code, so their types have no frame list either. The pulley's frame is the
 * direction of its rope, which only `0x59d5` (Even More) sets, to `(angle >> 14) & 3`. The curved pipe wall's flip
 * (`0x1c8a5`) turns its frame by `xor 1` or `xor 2`, and its reset picks one of four outlines by it. The walls and the
 * grass floor draw tiles from their frame on (`0x18bd9`), right only from frame 0, and the super ball draws sprite 0 of
 * its three; nothing changes their frame while the game runs. Decided with the user.
 */
export const SELF_DRAWN_ASSUMPTION =
  "A level starts the pulley on one of its four rope directions 0 to 3, the curved pipe wall on one of its four turns 0 to 3, and the brick, pipe and wood walls, the grass floor and the super ball on frame 0. The game itself only ever sets these frames, and every shipped level saves them.";

/**
 * The generator's reset (`0x1aeb3`) keeps bits 0 and 1 of the saved frame, the turn its run is at, and sets bits 2 and
 * 3 from its sockets. Only the level file sets those two bits of the saved frame. Decided with the user.
 */
export const GENERATOR_ASSUMPTION =
  "A level never starts the generator partway through a turn: bits 0 and 1 of its saved frame are 0, so it starts on frame 0, 4, 8 or 12. Its reset keeps those bits, only the level file sets them, and every shipped level saves it on frame 0 or 4.";

/**
 * The wood incline has no frame list: the program draws it. Its resize (`0x1b82f` in Even More, English floppy) sets
 * its frame and saved frame (`0x0c`, `0x90`) to its width at `0x44` (copied from `0x50`) divided by 16, less 1, and its
 * reset keeps the saved frame. The editor keeps the width between 16 and 64, the type record's limits. Decided with
 * the user.
 */
export const WOOD_INCLINE_ASSUMPTION =
  'A wood incline starts on the frame its width gives: its width divided by 16, less 1. That is frame 0 to 3 for the widths 16 to 64 the editor allows, and frame -1 for an incline of width 0, which two Even More levels have ("Ambulance Driver", L117, and "Rocket Launcher", L143) though the editor can\'t make it.';

/** The frame the wood incline's resize gives a width: the width as a signed word divided by 16, rounded to 0, less 1. */
const inclineFrame = (width: number) => Math.trunc((((width & 0xffff) ^ 0x8000) - 0x8000) / 16) - 1;

/**
 * By part id: the frames a level can start a part on, and why: for a type without a frame list, and for one with a
 * frame list when a decided assumption narrows it (`framed`), like the generator. `shown` lists every frame it can
 * show in the middle of a run, when that is more, like the belt's whole blocks. `fromWidth` gives the one frame a part
 * of a width starts on, with `rule` in words, when the assumption ties the frame to the width.
 */
type LevelFrames = {
  frames: number[];
  shown?: number[];
  framed?: true;
  assumption: string;
  fromWidth?: (width: number) => number;
  rule?: string;
};
export const LEVEL_FRAMES: ReadonlyMap<string, LevelFrames> = new Map<string, LevelFrames>([
  ["conveyor-belt", { frames: [0, 7, 14, 21, 28], shown: [...Array(35).keys()], assumption: CONVEYOR_BELT_ASSUMPTION }],
  ["gear", { frames: [0, 1, 2, 3], assumption: GEAR_ASSUMPTION }],
  ["mouse-motor", { frames: [0, 1], assumption: MOUSE_MOTOR_ASSUMPTION }],
  ["electric-motor", { frames: [0, 1, 2], assumption: ELECTRIC_MOTOR_ASSUMPTION }],
  ["pulley", { frames: [0, 1, 2, 3], assumption: SELF_DRAWN_ASSUMPTION }],
  ["curved-pipe-wall", { frames: [0, 1, 2, 3], assumption: SELF_DRAWN_ASSUMPTION }],
  ...["brick-wall", "pipe-wall", "wood-wall", "grass-floor", "super-ball"].map((id): [string, LevelFrames] => [
    id,
    { frames: [0], assumption: SELF_DRAWN_ASSUMPTION },
  ]),
  ["generator", { frames: [0, 4, 8, 12], framed: true, assumption: GENERATOR_ASSUMPTION }],
  [
    "wood-incline",
    {
      frames: [-1, 0, 1, 2, 3],
      assumption: WOOD_INCLINE_ASSUMPTION,
      fromWidth: inclineFrame,
      rule: "the one its width gives: its width divided by 16, less 1",
    },
  ],
]);

/**
 * The teeter-totter's run adds its control value at `0x12` to its frame (`0x1d2da` in Even More) without checking the
 * frame, and clears it after the tilt (`0x1d458`). Its own bounce and rope callback only set a direction that tilts it
 * towards a frame it has (`0x1d0d8` to `0x1d110` and `0x1d584` to `0x1d5bc`). Decided with the user: nothing else tips
 * it past an end either.
 */
export const TEETER_TOTTER_END_ASSUMPTION =
  "Nothing tips the teeter-totter past an end: it is never on frame 0 with its control value at 0x12 at -1, or on frame 2 with it at 1.";

/**
 * Where a walk needs a control value at `0x12` it doesn't know, it branches on the numbers the writers give and one
 * more branch for any other number. Decided with the user: for these parts the control value is only ever -1, 0 or 1.
 * Every writer found sets one of those or copies another part's, and every shipped level saves 0.
 */
export const CONTROL_VALUE_ASSUMPTION =
  "The control value at 0x12 of the jack-in-the-box, the gear and the teeter-totter is only ever -1, 0 or 1. Every writer found sets one of those or copies another part's, and every shipped level saves 0.";

/** By part id: the only numbers the control value at `0x12` takes, and the assumption that says so. */
export const CONTROL_VALUES: ReadonlyMap<
  string,
  { offset: number; width: number; values: number[]; assumption: string }
> = new Map(
  ["jack-in-the-box", "gear", "teeter-totter"].map((id) => [
    id,
    { offset: 0x12, width: 16, values: [0, 1, 0xffff], assumption: CONTROL_VALUE_ASSUMPTION },
  ]),
);

/** By part id: frames the part is never on while a field has a value, and the assumption that says so. */
export const IMPOSSIBLE_STATES: ReadonlyMap<
  string,
  { frames: number[]; field: { offset: number; width: number; value: number }; assumption: string }[]
> = new Map([
  [
    "monkey-bike",
    [
      {
        frames: [5, 6, 7, 8, 9, 10, 11, 12],
        field: { offset: 0x96, width: 16, value: 0 },
        assumption: MONKEY_BIKE_ASSUMPTION,
      },
    ],
  ],
  [
    "teeter-totter",
    [
      { frames: [0], field: { offset: 0x12, width: 16, value: 0xffff }, assumption: TEETER_TOTTER_END_ASSUMPTION },
      { frames: [2], field: { offset: 0x12, width: 16, value: 1 }, assumption: TEETER_TOTTER_END_ASSUMPTION },
    ],
  ],
]);

/**
 * The monkey bike's reaction after a hit: its bounce (`0x1bd05` in Even More) puts it on frame 5 or 9, starts the
 * counter at `0x96` and sets its control value at `0x12` to 0 (`0x1bd2e`). While the counter runs, its run (`0x1bdbd`)
 * shows frames 5 to 12 and doesn't touch the control value. When the counter runs out on frames 5 to 8 it goes to frame
 * 0, and the next run pedals again unless the control value is 0 (`0x1be5a`). Only the bounce and the rope callback
 * (`0x1becc`, which writes 1 or -1) change the control value otherwise. Decided with the user: neither happens while
 * the reaction plays.
 */
export const MONKEY_BIKE_REACTION_ASSUMPTION =
  "While the monkey bike plays its reaction after a hit, nothing pulls its rope or bounces it, so its control value at 0x12 keeps the value it had when the reaction started.";

/**
 * By part id: a field a decided assumption keeps while the part plays a reaction on these frames, and the assumption.
 * A walk keeps it as the value it had at the walk's start through the reaction and the run right after it, but not when
 * one of the part's own callbacks that change the field (named here by role) starts the walk.
 */
export const REACTION_FIELDS: ReadonlyMap<
  string,
  { frames: number[]; offset: number; changedBy: string[]; assumption: string }
> = new Map([
  [
    "monkey-bike",
    {
      frames: [5, 6, 7, 8, 9, 10, 11, 12],
      offset: 0x12,
      changedBy: ["bounce callback candidate", "rope callback candidate"],
      assumption: MONKEY_BIKE_REACTION_ASSUMPTION,
    },
  ],
]);
