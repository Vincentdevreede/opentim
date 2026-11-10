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
      [--conditions]

### Goals as conditions

The pseudo-code is exact but long, so the Lab's level view shows a goal as a few short conditions instead, read by
`summariseGoal` (`src/read/goal-conditions.ts`). It runs the goal program on symbols rather than numbers: each word
is kept as an expression of the parts' fields and of the words the step started with, a walk over the parts turns
into "some part where …" or "how many parts where …", and the tests that lead to "the goal is met" are gathered into
ways, each a list of conditions that must all hold. A word a walk sets when a test holds is that value after the walk
when some part passed the test; a word it adds 1 to counts the parts that pass; a register it sets to the part is the
last part that passes. A walk that only clears a flag then reads as what every part must pass. The conditions are:

- **every**: each part of the types on the lists passes the tests, for the parts a "where" picks when it has one;
- **none**: no part of the types is on the lists (or none passes the "where");
- **some**: at least one part passes the tests;
- **first** or **last**: the part a search stops at, or the last one a walk keeps;
- **count**: how many parts pass the tests, against a number;
- **word**: a test of a word, like the step count;

and a word the goal keeps from step to step is shown with what it becomes. Ways are kept short: a test and its
opposite in two ways give the way without them, a way another one covers is left out, and a test another one implies
(`state ≠ 0` beside `state ≥ 5`) is dropped. Puzzle 2 of Even More reads "every bowling-ball on the moving list:
positionY = 264, positionY = previousY", and puzzle 31 "every basketball on the moving list: 342 ≤ positionX ≤ 442,
positionY ≥ 218". The fields and types are the names the analysis gives them; no word of the game's own is added.

Tests of a part's position against numbers give the goal's area. The Lab draws it on the level as the place the part's
picture covers while its position is in range, from a part of the same type in the level, and rings the parts of the
types the goal looks at. In Even More puzzle 1 the area is the hoop.

152 of Even More's 160 goals and 83 of TIM 1's 87 shipped goals read as conditions. The others add up the parts'
fields or compare two parts with each other (68, 78, 79, 81 in both games, and 101, 113, 136 and 138 in Even More),
and show only their program, with why. `list-goals --conditions` lists the conditions under each program.

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
| base size                     | `0x50`, `0x52` baseWidth and baseHeight                          |           4,448 |       2,211 |
| position                      | `0x8c`, `0x8e` savedPositionX and savedPositionY                 |           4,448 |       2,211 |
| extra                         | `0x96`                                                           |           4,448 |       2,211 |
| belt place (two bytes), width | bytes `0x56`, `0x57` and the word `0x58`                         |           4,448 |       2,211 |
| rope slots' places            | bytes `0x6a`, `0x6b` and `0x6c`, `0x6d`                          |           4,448 |       2,211 |
| plugged parts                 | `0x62`, `0x64`, as the plugged part's record (0 for none)        |           4,448 |       2,211 |

So the second size, which `level.ts` didn't know, is the part's base size (`baseSize` now), and the position, state and drawing flags
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
  `+8`; the rope part itself is at `+0`), in all 47 Even More and 31 TIM 1 ropes the check pairs. The parts a rope ties
  point at the same record from their own `0x66`, as puzzle 9 shows. Ropes have no place of their own in the file, so
  the check pairs a rope only when it is the only one on its list. (Before the level recorder's fix of 2026-11-09 one
  of them, in Even More puzzle 105, had no rope record, because the recorder ran out of near heap there; see [the level
  recorder](machine-recorder.md#running-a-puzzle).)
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
English floppy, `[0x5257]` in TIM 1, French): after loading it holds the file's bin parts in the file's order, in all
160 Even More and 87 TIM 1 puzzles (1,794 and 881 parts), and their fields go where a placed part's do (tallied as
`bin: <field>`), with the first state value also at `0x0c`.

Before the level recorder's fix of 2026-11-09 the bins of Even More puzzles 105, 106 and 115 came out short. The level
reader takes all of a level's part records from the near heap at once (`0x0ecc:0x48bf`, `0x00a2` bytes each), and the
recorder loaded the puzzle while the menu's title machine still held its parts, so the last allocations gave 0. The
recorder now takes over where the menu has freed its title machine itself (see [the level
recorder](machine-recorder.md#running-a-puzzle)).

The header's numbers go to one block of words. Searched at every byte below `0x8000`, each one is in all puzzles only
in its word below, apart from the scroll limits: they are -8 in every shipped puzzle, and the play screen's entry
itself sets `0x4cbb` and `0x4cbd` (TIM 1: `0x5237`, `0x5239`) and the view's six words to -8 after loading, so the check
can't tell where the file's limits go. In the table they are where the block's order puts them.

| Header field   | Even More, English floppy  | TIM 1, French              |
| -------------- | -------------------------- | -------------------------- |
| bonus counters | `0x4cb3`, `0x4cb5`         | `0x522f`, `0x5231`         |
| air pressure   | `0x4cb7`                   | `0x5233`                   |
| gravity        | `0x4cb9`                   | `0x5235`                   |
| scroll limits  | `0x4cbb`, `0x4cbd` (order) | `0x5237`, `0x5239` (order) |
| music          | `0x4cbf`                   | `0x523b`                   |

The counts of parts aren't kept as such. The word `0x4a8b` that Even More puzzle 70's goal reads isn't one of these:
it is a second count of steps. The run loop calls `0x1497` every step, after running and moving the parts, and
`0x1497` adds 1 to it and sets it back to `0x1c00` when it reaches `0x2a00`; the routine at `0x0ecc:0x1ee2` sets it
to 0 with the words next to it (`0x4a6b`, `0x4a8d` to `0x4a97`). It is 0 right after the puzzle loader in puzzle 70.
So puzzle 70's goal needs at least 308 steps without a broken fishbowl, the way TIM 1's puzzle 76 waits for step 130
on the other count. Where the game calls `0x0ecc:0x1ee2` isn't read yet.

    pnpm --filter @opentim/content check-level-fields --game <game folder> [--by-type] [--puzzles 1-20]

### In the Lab

The Lab's Structure panel of a level says under each field of a TIM 1 or Even More part where the loader keeps it,
by the names the behaviour read of the loaded `TIM.EXE` gives the record's words (`→ savedPositionX/Y` for the
position), a field the loader keeps in a record of its own by that record (`→ belt record`), a word without a name as
"kept", and a gear's links to gears and the pulley's rope as "not kept". The offsets are in the tips. A part's flags
read as the bits whose meaning is known ("on the fixed list · mirrored") and how many bits aren't known, with the
stored words in the tip. When the loaded `TIM.EXE` is one of the two recorded builds, the header's numbers say "kept",
with their word of the data segment in the tip, and the scroll limits "kept?", since only the block's order puts them
there. The places are in `src/read/level-loader.ts`, which this check found; Toons and TIM 2 levels have no tags,
since their loaders aren't read.

A goal's test of a goal mark reads by the parts that set the mark on a part of that type, from what the walks say
other parts do to it: "marked by cat or alligator" in Even More puzzle 94, "marked by mels-house" in puzzle 88. Until
the walks are read it says "goal mark set". The goal's own words read "its count" (or "its word 1" and so on), and a
field the goal names by its offset gets the Lab's name, like `marks` for `0x0a`.
