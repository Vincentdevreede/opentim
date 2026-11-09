# The levels

What the game does with a level beyond the bytes of its file, read from TIM.EXE: when a puzzle is solved (step L1 of
`docs/behaviour-plan-together.md`) and, later, what the level loader does with each field (L2). The file itself is
read by `packages/content/src/read/level.ts`.

## Puzzle goals

A level file has the goal as text for the player, but not as something the game tests. Each puzzle has a goal routine
in TIM.EXE instead. Every step, the run loop calls a dispatcher that calls the routine the puzzle number picks from a
table of far pointers; the routine looks at the parts and sets the game mode word to `0x0200` when the goal is met,
which ends the run.

| Build                          | Dispatcher | Puzzle number | Table                | Puzzles in the table | Levels shipped | Goal routines |
| ------------------------------ | ---------- | ------------- | -------------------- | -------------------: | -------------: | ------------: |
| TIM 1 English, floppy and disk | `0x1465`   | `[0x4ebd]`    | `0x2632`             |                  110 |             87 |            87 |
| TIM 1 French                   | `0x1496`   | `[0x503d]`    | `0x27c0`             |                  110 |             87 |            87 |
| TIM 1 German                   | `0x1496`   | `[0x500d]`    | `0x2788`             |                  110 |             87 |            87 |
| Even More English floppy       | `0x14ae`   | `[0x4ac1]`    | `0x201a`             |                  160 |            160 |           137 |
| Even More English CD           | `0x9e05`   | `[0x4aa7]`    | `0x3180:0` (in `es`) |                  170 |            170 |           138 |
| Even More English demo         | `0x14df`   | `[0x4915]`    | `0x20c6`             |                   10 |             10 |             8 |
| Even More French               | `0x14ae`   | `[0x4cd1]`    | `0x222a`             |                  160 |            160 |           137 |
| Even More German               | `0x14ae`   | `[0x4c51]`    | `0x21aa`             |                  160 |            160 |           137 |

The table is in the data segment, except in the Even More CD, which loads its segment into `es` first. TIM 1's table
has room for 110 puzzles; the 23 after the 87 it ships call another puzzle's goal or nothing. Several puzzles share a
routine, and some routines only call another one, so there are fewer routines than puzzles.

### Reading a goal

`findGoalTable` (`src/read/puzzle-goals.ts`) finds the dispatcher by its code: a routine that loads the puzzle number,
multiplies it by 4 (two shifts by 1, or TIM 1's one shift by `cl` = 2) and calls the far pointer at that place in a
table. Each entry from puzzle 1 on must start a routine, and the first that doesn't ends the table.

`readGoalRoutines` reads a goal routine, and every routine it calls, into a small structured program: words set,
tests, loops, calls, breaks and returns, in the routine's own order. A word is a register, a local of the routine's
frame, or a word of the data segment at an address, which can be a part's address plus a field's offset. A push is a
word set below the frame and a pop reads it back, so a call's arguments are the words its caller pushed, as in the
game. Nothing is assumed about a call: the list head and list next routines the goals walk the parts with
(`0x682f` and `0x686f` in Even More, English floppy) are read the same way. A routine the reader can't read is named
with the instruction and the reason, and so is every goal that calls it; in all eleven builds there is none.

`runGoal` runs such a program over the words of the data segment, with a stack of its own for the locals. It tells
when a program reads a register or local it never set, divides by 0, or runs past its limit, since in those cases
the game reads whatever is there, stops with a divide error, or runs on.

The goals take a few forms (puzzle numbers of Even More, English floppy):

- every part of a type on a list passes a test, like every bowling ball at y 264 and still (puzzle 2);
- the first part of a type on the moving list passes, like the basketball within a box (puzzle 1);
- the last part of a type a loop finds is tested after it, like a bowling ball and a basketball each in its own box
  (puzzle 79);
- a goal remembers something between steps in words of its own (from `0x5068`), like each mouse motor that has
  turned (puzzle 78), or counts the steps a test held in such a word.

### Checked in the game

`check-goals` runs every goal routine in the emulator next to its read program, on made-up parts lists and words over
the same data segment, and compares every word they leave. The parts lists are the ones the analysis reads from the
list head routine (fixed, moving and the third list by the bits `0x2000`, `0x1000` and `0x0800`), and each part's
fields and the goal's words are drawn from the constants the routine compares with, one more and one less, and other
numbers. A world that takes a test a way no world took before is kept and changed further, until every test went both
ways or 3,000 trials ran.

On 2026-11-08, on all eleven builds, no read goal leaves a word different from the game's routine:

| Build                    | Goals checked |  Trials | Differ | Every test both ways | Tests both ways |
| ------------------------ | ------------: | ------: | -----: | -------------------: | --------------: |
| TIM 1 (each build)       |           110 | 112,365 |      0 |                   90 |      539 of 638 |
| Even More floppy, French |           160 | 168,127 |      0 |                  129 |    890 of 1,051 |
| Even More CD             |           170 | 175,075 |      0 |                  138 |    953 of 1,124 |
| Even More demo           |            10 |   5,364 |      0 |                    9 |        63 of 73 |

The other builds of a game give the same counts, with a few hundred trials more or fewer where their words are at
other addresses. Most tests not taken both ways are in the list routines, which test bits no goal passes, like the
third list's.

Some trials can't be compared, because the game itself reads something undefined there:

- puzzles 68, 79 and 81 (and once or twice 113 and 138) read the place of a part a loop looked for and didn't find;
- puzzle 101 divides by a count of parts that is 0 when there are none;
- puzzles 1 and 21 search for a part without stopping at the end of the list, so without that part the search runs
  on through memory, in the game as in the read program.

Each of these needs a part the shipped level has, so they matter only for levels made without it.

    pnpm --filter @opentim/content check-goals --tim1 <game folder> --evenmore <game folder> [--trials 3000]

### Goals in words

`describeGoal` (`src/read/describe-goals.ts`) says a goal program as indented pseudo-code: the parts' fields and types
by the names the analysis gives them, a loop over parts as "for each part on" the lists it walks, and the write that
ends the run as "the goal is met". It finds the two forms of loop the goals use: one that starts at a list's first
part and follows each part's link, and one through the list head and list next routines, whose masks give the lists
(`0x3000` then `0x1000` is the fixed list, then the moving list). A routine another goal calls is said in place, named
by the first puzzle whose goal it is. The field at `0x06` is called `listFlags`, for the list bits the list routines
test there. Puzzle 2 of Even More, for example:

    dx = 1
    for each part on the moving list:
      if part.type is bowling-ball:
        if part.positionY ≠ 264:
          dx = 0
        else:
          ax = part.positionY
          if ax ≠ part.previousY:
            dx = 0
    if dx ≠ 0:
      the goal is met

`list-goals` lists every puzzle's goal next to the goal text its level shows the player, and compares the builds of a
game, with each word the goals keep for themselves taken by its place among them, since the builds keep the same
words at other addresses. All five TIM 1 builds read the same 110 goals, and the Even More floppy, French and German
builds the same 160. The Even More CD reads the same apart from its 10 puzzles more and puzzles 79, 81, 101 and 136,
whose code loads registers in another order and, in 101 and 136, takes a wall's size from `baseWidth` on another way.
Each build's goals are checked against its own routines, but whether these four mean the same as the floppy's isn't
checked. The demo's 10 puzzles are its own.

Two words some goals read are the run loop's counts of steps. `findStepCounts` finds the run loop as the one routine
that calls the goal dispatcher, and the words it adds 1 to itself (`inc word`) and that a routine it calls adds 1 to.
Every build has exactly one of each, and `list-goals` calls them "the step count" and "the second step count":

| Build                          | Run loop | Step count | Second step count (routine) |
| ------------------------------ | -------- | ---------- | --------------------------- |
| TIM 1 English, floppy and disk | `0x12ab` | `[0x4ea7]` | `[0x4e87]` (`0x144e`)       |
| TIM 1 French                   | `0x12dc` | `[0x5027]` | `[0x5007]` (`0x147f`)       |
| TIM 1 German                   | `0x12dc` | `[0x4ff7]` | `[0x4fd7]` (`0x147f`)       |
| Even More floppy               | `0x1230` | `[0x4aab]` | `[0x4a8b]` (`0x1497`)       |
| Even More CD                   | `0x9b83` | `[0x4a91]` | `[0x4a71]` (`0x9dee`)       |
| Even More demo                 | `0x1261` | `[0x48ff]` | `[0x48df]` (`0x14c8`)       |
| Even More French               | `0x1230` | `[0x4cbb]` | `[0x4c9b]` (`0x1497`)       |
| Even More German               | `0x1230` | `[0x4c3b]` | `[0x4c1b]` (`0x1497`)       |

The run loops and step counts of the two recorded builds are the ones the level recorder found. Even More puzzle 70's
goal needs the second step count to be at least 308 (see [what the loader keeps](#what-the-loader-keeps)).

    pnpm --filter @opentim/content list-goals --tim1 <game folder> --evenmore <game folder> [--out <folder>]

## What the loader keeps

`check-level-fields` loads every shipped puzzle of a recorded build with the game's own puzzle loader in the emulator
(`loadPuzzle` in `src/run/game.ts`, which stops right after the loader, before the run button's preparation), reads
the same level with `level.ts`, and pairs each placed part of the file with the record the loader made for it. Parts
in the parts bin aren't on either list, so they aren't paired. A part pairs with the record of its type on the list of
its group (fixed or moving) when it is the only one of its type there, or else when one record has its flags at
`0x06` and `0x08` and its place at `0x8c` and `0x8e` (the place was first found there on pairs made by type alone,
with `--by-type`). For each field it then lists the words of the record that hold the field's value in every pair:

| Field in the file             | In the record                                                    | Even More pairs | TIM 1 pairs |
| ----------------------------- | ---------------------------------------------------------------- | --------------: | ----------: |
| type                          | `0x04` type                                                      |           4,448 |       2,211 |
| flags, first word             | `0x06` (the list bits and more)                                  |           4,448 |       2,211 |
| flags, second word            | `0x08` drawingFlags and `0x94` savedDrawingFlags                 |           4,448 |       2,211 |
| flags, third word             | `0x0a`, in 4,438 Even More parts (see below)                     |           4,448 |       2,211 |
| first state value             | `0x90` savedState                                                |           4,448 |       2,211 |
| size                          | `0x40`, `0x42` (the extents) and `0x44`, `0x46` (the frame size) |           4,448 |       2,211 |
| second size                   | `0x50`, `0x52` baseWidth and baseHeight                          |           4,448 |       2,211 |
| position                      | `0x8c`, `0x8e` savedPositionX and savedPositionY                 |           4,448 |       2,211 |
| extra                         | `0x96`                                                           |           4,448 |       2,211 |
| belt place (two bytes), width | bytes `0x56`, `0x57` and the word `0x58`                         |           4,448 |       2,211 |
| rope slots' places            | bytes `0x6a`, `0x6b` and `0x6c`, `0x6d`                          |           4,448 |       2,211 |
| plugged parts                 | `0x62`, `0x64`, as the plugged part's record (0 for none)        |           4,448 |       2,211 |

So the second size, which `level.ts` didn't know, is the part's base size, and the position, state and drawing flags
go to the saved words the run starts from. Pairing by type alone (`--by-type`, 833 pairs in Even More) finds the same
places. The second plugged part shows only in Even More, where one shipped part has one; in TIM 1 it is always none.

The check also counts, for a field no word holds in every pair, the words that hold it in most, and for a field that
names another part it looks one record further, through each word of the record:

- The belt's two parts are in the belt record the word `0x54` points at, at `+4` and `+6` (the belt part itself is
  at `+2`), in all 15 Even More and 10 TIM 1 belts; each of the three parts points at that record.
- The links go to `0x5a` and `0x5e` (the first) and `0x5c` and `0x60` (the second), as the linked part's record: in
  270 of 310 and 152 of 176 Even More parts (TIM 1: 188 of 212 and 96 of 118). Every other one, in all 160 Even More
  puzzles, is a gear linked to a gear, whose words the loader leaves 0: a gear's reset finds its neighbours itself, by
  their saved places 32 pixels apart (see "Building the direct gear connections" in `docs/behaviour.md`), so the file's
  gear links aren't used. The analysis knows these words as the rope links.
- A rope's two tied parts are in the rope record the word `0x66` points at, at `+2` and `+4` (again at `+6` and
  `+8`; the rope part itself is at `+0`), in 46 of the 47 Even More ropes the check pairs. The parts a rope ties point
  at the same record from their own `0x66`, as puzzle 9 shows. Ropes have no place of their own in the file, so the
  check pairs a rope only when it is the only one on its list. The 47th is the rope of Even More puzzle 105 that ties
  its two buckets: its `0x66` is 0, so it has no rope record at all, because 105 is one of the puzzles where the
  recorder runs out of near heap (see the parts bin below). Every rope that has a record holds its tied parts there.
- The third flag word is at `0x0a` in every TIM 1 part and in 4,438 of 4,448 Even More parts. In Even More `0x0a`
  also has the goal marks, so the 10 others may be parts whose constructor sets one; not checked yet.

What the pairing doesn't show:

- the second state value and the second rope slot are 0 in every shipped part, so they show nothing;
- the pulley's rope: the loader doesn't keep it as such. In Even More puzzle 66 no word of the data segment points
  from the pulley to the rope part its file names; the pulley's links (`0x5a`, `0x5c`) hold the rope's two tied
  parts, and those parts' links hold the pulley;
- the word before the parts bin: the level reader (`0x0ecc:0x4dc2`) reads it into `[0x4a67]` (0 for files before
  version 0x105) and reads the parts bin only when it isn't 0 or when the title flag `[0x508c]` is set, which the
  puzzle loader sets. It is 0 in all 73 Even More puzzles that have it, so a puzzle always gets its bin, and the
  title and credits machines, which the reader loads without the flag, get theirs only when their own word isn't 0.

The parts bin is the third list, the one the list head routine picks by the bit `0x0800` (`[0x4cdb]` in Even More,
English floppy, `[0x5257]` in TIM 1, French): after loading it holds the file's bin parts in the file's order, in 157
of the 160 Even More puzzles, and their fields go where a placed part's do (tallied as `bin: <field>`), with the first
state value also at `0x0c`. In puzzle 105 the list stops after the first of its two ropes (5 of 14 parts), and in
puzzles 106 and 115, with 45 and 15 parts in the bin, it is empty after loading.

That comes from the level recorder, not the game. The level reader takes all of a level's part records from the near
heap at once (`0x0ecc:0x48bf`, `0x00a2` bytes each), and the recorder loads the puzzle straight from the menu, while
the menu's title machine still holds its 58 parts. In 105, 106 and 115 the last 9, 1 and 10 allocations then give 0,
the end of the parts bin, and the parts bin list comes out short or empty. It isn't the emulator's DOS memory, which
has room. Before the game loads a puzzle itself (at `0x0ecc:0x365a`), it calls `0x0ecc:0x1361`, which calls
`0x0ecc:0x7e82`: that frees every part of the parts bin, the fixed and the moving list (TIM 1, French: `0x0e44:0x6da7`).
With that call added to the recorder all three bins load in full, but it isn't enough on its own. In Even More,
puzzles 106 and 115 then no longer meet their goals early, and in TIM 1 puzzles 54, 70 and 76 run on without
returning, 76 right after the step where it used to meet its goal. So the recorder needs more of the game's way from
the menu into a puzzle before it can clear the level; until then it loads as before, and these three puzzles' bins
are short.

The header's numbers go to one block of words. Searched at every byte below `0x8000`, each one is in all puzzles only
in its word below, apart from the scroll limits: they are -8 in every shipped puzzle, so they could be either of their
two words (the file's order puts x first), and in TIM 1 three other words are -8 too.

| Header field   | Even More, English floppy | TIM 1, French      |
| -------------- | ------------------------- | ------------------ |
| bonus counters | `0x4cb3`, `0x4cb5`        | `0x522f`, `0x5231` |
| air pressure   | `0x4cb7`                  | `0x5233`           |
| gravity        | `0x4cb9`                  | `0x5235`           |
| scroll limits  | `0x4cbb`, `0x4cbd`        | `0x5237`, `0x5239` |
| music          | `0x4cbf`                  | `0x523b`           |

The counts of parts aren't kept as such. The word `0x4a8b` that Even More puzzle 70's goal reads isn't one of these:
it is a second count of steps. The run loop calls `0x1497` every step, after running and moving the parts, and
`0x1497` adds 1 to it and sets it back to `0x1c00` when it reaches `0x2a00`; the routine at `0x0ecc:0x1ee2` sets it
to 0 with the words next to it (`0x4a6b`, `0x4a8d` to `0x4a97`). It is 0 right after the puzzle loader in puzzle 70.
So puzzle 70's goal needs at least 308 steps without a broken fishbowl, the way TIM 1's puzzle 76 waits for step 130
on the other count. Where the game calls `0x0ecc:0x1ee2` isn't read yet.

    pnpm --filter @opentim/content check-level-fields --game <game folder> [--by-type] [--puzzles 1-20]
