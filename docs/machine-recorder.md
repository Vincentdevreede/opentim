# The level recorder

The level recorder runs a shipped puzzle in the game's own code and saves every part's record after each step. It is
what the machine of part B is checked against (step C1 of [the plan](behaviour-plan-together.md)). Nothing from other
projects runs: the processor runs the instructions of `TIM.EXE` as the analysis decodes them, and the code around it
only answers what the game asks DOS, the BIOS and the hardware for.

```
pnpm --filter @opentim/content record-level --game <game folder> --puzzle <n> [--steps 300] --out <file.json>
```

It takes about two and a half seconds for 50 steps. The output lists each part (its place in the data segment, its type
and its list) and, per step from step 0 (the puzzle as loaded) to the last one asked for, the records that changed since
the step before, as 160 hex bytes each.

## The processor

`packages/content/src/run/cpu.ts` runs real-mode 8086 code with the few 286 forms the game uses (`push` of an immediate,
`pusha` and `popa`, shifts by an immediate, `imul` with three operands, `enter`, `leave`, `bound`). It runs the
`Instruction` objects `decodeInstruction` reads, so the recorder and the analysis read the same bytes the same way.

It is checked against DOSBox 0.74: `tests/fixtures/cpu-cases.ts` builds about 1,500 cases (every arithmetic form with
register and memory operands, shifts and rotates by every count, multiply and divide, the decimal adjusts, conditional
jumps, loops, string instructions forwards and backwards with and without `rep`, the stack, calls and returns,
`enter`/`leave`, `les` and segment overrides), each with random registers, flags and memory. They run as COM programs
in DOSBox (`record-cpu-cases`), whose results are kept in `tests/fixtures/dosbox-cpu`, and the test runs the same
programs in the processor. Every register, every flag the instruction defines and the memory agree. The run found two
mistakes, both fixed: `lahf` must keep flag bit 1 set, and `daa` must keep the auxiliary carry it sets.

## DOS and the PC

`packages/content/src/run/dos.ts` loads the program as DOS does (`run/program.ts` reads LZEXE's unpacking stub for the
entry point and the relocations) and answers:

- files: opened read only from the game folder and its parent, with the lowest free handle from 5, as DOS gives them.
  The C library's file table has room for 20 handles; handing out ever higher numbers made reads fail silently;
- memory: blocks allocated first fit, freed and resized as DOS does. Without freeing, the game ran out of memory while
  loading the menu's pictures;
- the screen: the BIOS data area of a VGA, and the mode the game sets (Even More uses 640 by 480 in 16 colours);
- the keyboard and timer: their interrupts go through the game's own handlers. The timer ticks every 20,000
  instructions and is held back while an interrupt still runs;
- the mouse: installed, never moved or pressed.

## Running a puzzle

`packages/content/src/run/game.ts` starts the game, presses Enter at the Dynamix logo (it waits for a key), and lets the
menu come up. Then it leaves the menu and does what the run button does, with the game's routines (Even More, English
floppy):

1. it sets the puzzle number `[0x4ac1]`, which the goal check `0x14ae` uses to pick its routine;
2. it calls the puzzle loader `0x0ecc:0x541e`, which reads `L<n>.lev` from the resource files into the moving list
   `[0x4d7d]` and the fixed list `[0x4e1f]`;
3. it sets the mode word `[0x4a6d]` to `0x2000` and calls the run loop `0x0000:0x1230`. Each pass from `0x1247` reads
   input, runs the parts (`0x0e89`), moves them (`0x73f5`), checks the goal (`0x1497`), draws and waits for 8 timer
   ticks. The recorder saves the lists at the top of each pass, and ends the run by setting the mode back to the
   menu's `0x8000`.

These addresses are per build, read from the code and kept in `GAME_BUILDS` by the hash of `TIM.EXE`. Two builds are
there:

|                         | Even More, English floppy | TIM 1, French             |
| ----------------------- | ------------------------- | ------------------------- |
| Puzzle loader           | `0x0ecc:0x541e`           | `0x0e44:0x48a4`           |
| Puzzle number           | `[0x4ac1]`                | `[0x503d]`                |
| Run loop, top of a pass | `0x0000:0x1230`, `0x1247` | `0x0000:0x12dc`, `0x12f3` |
| Mode word, step counter | `[0x4a6d]`, `[0x4aab]`    | `[0x4feb]`, `[0x5027]`    |
| Moving list, fixed list | `[0x4d7d]`, `[0x4e1f]`    | `[0x52f9]`, `[0x539b]`    |

TIM 1 was found the same way: the two routines that join "l", the number and ".lev" (the strings at `0x29f6` and
`0x29f8`), of which `0x48a4` sets the title flag `[0x55f2]` and is called with `[0x503d]`; the only word the code
compares with `0x2000` in a loop, `[0x4feb]`; and the two list heads the parts code reads most, `0xa2` bytes apart as
in Even More. The start-up needs nothing different: the same Enter at the logo and the same wait for the menu.

A run ends early when the puzzle's goal check finds the goal met: it sets the mode word to `0x0200`, which ends the run
loop. Even More puzzles 106 and 115 (after 11 and 13 steps) and TIM 1 puzzle 76 (after 131 steps) end this way with
only their own parts. Puzzle 106's goal routine `0x27e7` (from the table at `0x201a`) looks for a bucket on the moving
list, and TIM 1's `0x1f4d` waits for step 130.

## Checking the lists

`check-moving-list` runs every shipped puzzle of a build for 500 steps and checks the lists at every step against
[decided assumption 22](behaviour-assumptions.md#22-searches-of-the-moving-list): no part of a fixed type on the moving
list. It also lists the types that join a list during a run and parts whose list flags at `0x06` disagree with their
list. All puzzles of a build take about two minutes for TIM 1 and four for Even More.

```
pnpm --filter @opentim/content check-moving-list --game <game folder> [--steps 500] [--jobs <n>] [--puzzles 1-20]
```

## What a recording says

A run doesn't depend on the timer: puzzles 17 and 60 recorded with a tick every 20,000 and every 7,001 instructions
agree in every byte of every part apart from pointers (the list links at `0x00` and `0x02`, the outline pointer at
`0x82`, and the bucket's links at `0x5a`, `0x5e` and `0x66`). Those depend on where the menu's
allocations left the heap, so a comparison must not count them.

TIM 1 French gives the same answer for puzzle 60 with a tick every 20,000 and every 7,001 instructions, pointers
included, and for puzzle 17 with a tick every 20,000 and every 13,003. With a tick every 7,001 instructions, puzzle 17's
two brick walls miss bytes `0x74`, `0x75` and `0x7f` from step 1 on. Those are redraw links: the draw code
(`0x0000:0x6d73`) hands every part that overlaps a changed piece of the screen to `0x1529:0x192b`, which links it into
one of six redraw lists `[0x523f]` (the links at `0x74` and `0x76`, the list at `0x7f`), and `0x1529:0x1912` empties
the lists. How much of the screen is redrawn depends on the timer, so a comparison must not count those bytes
either. Nothing that moves differs.

Puzzle 1, as a check: it has a basketball and three bowling balls. Two bowling balls rest where they lie, one falls
from (8, 216), its velocityY growing by 269 each step up to the speed limit, 9,695, and the basketball bounces
(velocityY 266, then -335, -69, -83) before it rests.
