# The levels

What the game does with a level beyond the bytes of its file, read from TIM.EXE: when a puzzle is solved (step L1 of
`docs/plans/behaviour-plan-together.md`) and, later, what the level loader does with each field (L2). The file itself is
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
  their saved places 32 pixels apart (see "Building the direct gear connections" in `docs/research/behaviour/gears.md`), so the file's
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
read as words by the names of their bits ("on the fixed list · placed by the puzzle · mirrored", see
[flag bits](behaviour/in-the-lab.md#flag-bits)), and how many bits the program never uses are set, with the stored words in the
tip. When the loaded `TIM.EXE` is one of the two recorded builds, the header's numbers say "kept",
with their word of the data segment in the tip, and the scroll limits "kept?", since only the block's order puts them
there. The places are in `src/read/level-loader.ts`, which this check found; Toons and TIM 2 levels have no tags,
since their loaders aren't read.

A goal's test of a goal mark reads by the parts that set the mark on a part of that type, from what the walks say
other parts do to it: "marked by cat or alligator" in Even More puzzle 94, "marked by mels-house" in puzzle 88. Until
the walks are read it says "goal mark set". A test of
any other flag bit reads by its name ([flag bits](behaviour/in-the-lab.md#flag-bits)): "part in play" for the out-of-play bit,
"placed by the puzzle" for the bit every part the level places has. The goal's own words read "its count" (or "its word
1" and so on, also the ones only the routine uses), and a field the goal names by its offset gets the Lab's name, like
`marks` for `0x0a` and `part.olderX` for `part.0x26`. The goal routine under the rows reads the same way; in Even More
(English floppy) the goals of the 161 levels show no number in hex, down from 166. A test of a step count says the least time those
steps take, from the timer ticks the run loop waits for each step: Even More puzzle 70 reads "the second step count ≥
308 (10 s)".

## TIM 2 levels

TIM 2's levels (magic `0xACEF`) are read by `readLevel` in their own layout, as TIM2.EXE's loader reads them (in its
overlays; the loader checks the magic and the version, `0x113` in nearly all shipped files). All 206 levels of the
floppy and the CD and the 8 of the demo read to their last byte. The byte layout is in
[the file formats](file-formats.md#tim-2-levels).

What the loader does with the fields, from TIM2.EXE:

- **Every level is a puzzle**: title and goal text are always there. When the game runs in another language, it reads
  the title, the goal and the notes again from a language file, so the level file keeps the English ones.
- **Notes**: eight places for a text the puzzle shows, each with an x, a y, from version `0x112` a third word, and the
  text. The game shows a note for each place with a text. The word before them is read and not kept.
- **Flags**: of the three flag words of a part the game keeps only bit `0x8000` of the first, bits `0x32` of the
  second (`0x10` and `0x20` mirror the part, as in TIM 1) and bits `0x140` of the third; the other bits come from the
  part's type. The files still have the type's bits, because the editor saved the whole words.
- **The part's state** is a step of its animation, not a frame: the step picks the frame. No saved state is past the
  animation's last step, and 255 are past its last frame.
- **The two words where TIM 1 has the scroll limits** are read and set to 0. **The third part count** is read and not
  kept; it is 0 in every shipped level, so TIM 2 levels have no bin list in the file.
- **The programmable ball** (87) stores six words more from version `0x111`. The lasers and the laser mixer have a
  read routine of their own in their type, but it reads nothing from the file.
- **After the parts**, from version `0x107`: the goal, as a word, eight entries and a word. In TIM 1 the goal is a
  routine per puzzle in TIM.EXE instead; TIM 2 has one routine that tests the entries (see below).

### TIM 2 goals

The loader keeps the goal in the data segment: the first word, eight entries of 18 bytes (a part pointer and seven
words) and the last word. One routine of TIM2.EXE tests them for every puzzle (in its first overlay; in the floppy
build at file offset `0x55743`); `summariseTim2Goal` (`src/read/tim2-goal.ts`) says it as conditions. What it does:

- When the first word is 0 the goal is never met. It is 1 in every shipped level.
- The goal isn't met while one of its parts is in the parts bin.
- Every entry with a part must hold. Its words are a low and a high state, a count and an area: x, y, width, height.
- For a moving part whose area width isn't 0, the entry tests the part's middle, its position plus half its base
  size: strictly inside the area, or, when the width is -1, off the screen, outside 0 to 640 across or 0 to 400 down.
  For a static part, or a width of 0, it tests the part's state, from the low to the high one.
- With a count of 0 the entry is about its own part. With a count of N, the routine walks the list its part is on
  again and needs N parts of the part's type that pass.
- The last word holds the goal back: the routine counts its own checks and says the goal isn't met before that many.
  The run loop (the routine at file offset `0x53240` in the floppy build) sets that count back to 0 when the machine
  starts and runs the goal routine once a step, right after the step, so the last word is a number of steps. Four
  levels use it, like 108 steps for the message computers.
- When the routine first says the goal is met, the run loop goes on for 30 more steps and then ends the puzzle as
  solved, whatever the routine says in those steps. The run loop waits for its step timer before each step (see
  [the animation speed](file-formats.md#animations-anm)), so a step takes at least 33.8 ms.

The Levels page shows these conditions, with the area of an inside test drawn on the level.

**The parts bin.** A TIM 2 level has no bin list: its third part count is always 0. When a puzzle starts, TIM2.EXE
(the routine at file offset `0x66cd7` in the floppy build, run only for magic `0xACEF`) walks the static and moving
parts. A part with bit `0x40` of the third flag word stays on the board: it is a fixed part of the puzzle. Every other
part gets its state back to its start and is dropped into the parts bin, by the same code the editor uses when a part
is dropped on the bin; that code clears bit `0x40` and bit `0x8000` of the first word. So the bin of a TIM 2 puzzle is
its parts without bit `0x40`, and the positions the file keeps for them are where the designer left them.

**The solution and bit `0x100`.** The level loader takes a mode, which it keeps in the game's mode word. In mode 9 a
part with neither `0x40` nor `0x100` stays on the board instead of going to the bin. Mode 9 is the puzzle's solution:
the only load in mode 9 is command 10012, which reloads the current level after a question, and `HELP.RES` says of
10012 "Click here to see my very own solution to this puzzle." So the bin parts without `0x100` are where the
designer's solution puts them, and `0x100` marks the bin parts the solution doesn't use. The Levels page puts the parts
without `0x40` in the bin, and its Solution box shows the level as the solution does.

The two bytes after the version: a new level starts with 0 and 3 (TIM2.EXE sets them so when it clears a level). The
second goes from 1 to 15 in the shipped levels and may pick the background; not read further.

### Drawing TIM 2 levels

TIM2.EXE's type table has a far pointer per type to the routine that draws a part (record offset `0x18`;
`readTim2Types` in `src/read/tim2-program.ts` finds the table). Most types share one routine that draws the frame of
the part's state. Two others draw from the part's size:

- **Walls**: the brick wall (1) and every type with the same routine: 1, 46, 48, 56, 60, 82 to 85, 97, 118 and 125
  in all three builds. For a part as wide as tall or wider, the routine takes the states from 0 up to where the
  animation's next sequence starts; for a taller one, the first sequence that starts after state 0, up to the next.
  It draws pieces as wide (or tall) as the first of those frames: the first state at one end, the last at the other,
  and the ones between in turn. When either mirror bit (`0x10` or `0x20` of the second flag word) is set, the routine
  turns every piece over the wall's long side: a lying wall upside down, a standing one left to right, each piece
  measured from the far side of the animation's size (the size in the `.ANM` header), and a standing pool table wall
  (118) moves right by its piece's width less 16. Only pool table walls are mirrored in the shipped levels. The Lab
  follows all of it; the animation's size is kept as the part's `mirrorBox`.
- **Tile patterns**: the tile (122) and the types sharing its routine: 121 to 124, 203, 205, 271 and 280. The
  routine repeats the frame of state 0 on a grid of that frame's size, starting at 0, 0 of the screen, and cuts it
  off at the part's box, widened across to whole groups of 8 pixels.

Without TIM2.EXE nothing in the files names a type's draw routine; the level files, the `.ANM` and the `.PAR` files
were checked. The Lab then goes by two matches in the files. A part's `.PAR` file (`PROPI`, the type, then its
properties) has 576 × 416 in the two words that look like its largest size exactly for the types drawn by the wall
routine, the large pipes (97) included, in the floppy and CD builds (`hasWallLimits`). And the type's flag bits the
levels keep: bit `0x2000` of the third word for walls (every wall type but the large pipes has it) and bits `0x1080`
without `0x0400` for tile patterns. Neither is a rule of the program, so the Lab says which one it used; the demo
ships few `.PAR` files, so there only TIM2.EXE gets every wall right.

- **The colour block** (127) has a routine of its own: it fills the part's box (its position and size) and outlines it
  in one palette colour, the low byte of the part's extra word, or colour 5 when that is 0. Only the colour block
  has all of bits `0x1480` in its type's third flag word, which is how the Lab knows it without TIM2.EXE.

The play area is the screen, 640 × 400: the goal routine counts a part off the screen when its middle is outside it,
and the interface animations (`CNTRLPNL.ANM`, `PARTSBIN.ANM`) draw their panels in a frame of that size. While a
puzzle is set up, the control panel covers x 0 to 48 and the parts bin x 560 to 640, both 377 high; that is why most
levels keep their parts between 0 and 568 across and above 377.

### TIM 2: still open

What isn't worked out yet, and what the Lab does meanwhile:

- **Mirroring other parts.** TIM2.EXE's usual draw routine mirrors a part by two words of its record (offsets `0x44`
  and `0x46`, not read yet) less its first frame's box, and then mirrors the frame in the animation's size. The Lab
  mirrors such parts inside their size, as for TIM 1, which may put them a few pixels off. Walls follow the program.
- **The two bytes after the version.** A new level gets 0 and 3; the second goes from 1 to 15 and may pick the
  background. Not read further.
- **The notes' third word** (from version `0x112`): 0 to 3 in the shipped levels; what it changes isn't read.
- **Other ways a run ends.** Besides the goal, the run loop ends the run on two words of game state (`[0x7ae4]` = 7
  with `[0x7ade]` = 0x16, and bit 2 of `[0x7ad8]`) that aren't named yet.
- **The demo** has few `.PAR` files, so without its TIM2.EXE only the flag bits pick its walls.

## Toons levels

Sid & Al's Incredible Toons ships 100 puzzles in four sets, `CAKE1` to `CAKE30`, `BRAN1` to `BRAN20`, `HARD1` to
`HARD25` and `LOON1` to `LOON25`. All 100 read to their last byte in the Toons layout
([file formats](file-formats.md#level-files-lev-tim-gkc)), versions `0x105` and `0x106`. Each has a title and a goal
text; the goal itself isn't in the file but in TOONS.EXE ([Toons goals](#toons-goals)).

**Parts bin.** The files have no bin list. Bit 0x40 of a part's third flag word decides, as in TIM 2: TOONS.EXE lets
the player neither move nor change a part with it (the routine that says what the player may do with a part returns
early), and it walks both lists and puts every part without it back to state 0, unmirrored and at its own size, as a
part in the bin is, ropes and belts excepted. So the Lab puts the parts without the bit in the bin, and the Solution
box shows them where the file puts them. CAKE15 ("Use a tunnel to help Al get to the bubble gum") then has its two
tunnels in the bin. That the routine is the start of a puzzle is read from what it does, not from where it is called.

**Drawing.** The Lab draws a Toons level with the `toons` list: frames by state, walls and the ladder as tiles by
TOONS.EXE's rule ([file formats](file-formats.md#toonsexe)), the rope and the belt as lines.

The conveyor belt, the timer, the counter, the thumpulator and the message machine are drawn as their own code in
TOONS.EXE draws them, with the tables it reads ([file formats](file-formats.md#toonsexe)), when `TOONS.EXE` is
loaded: the conveyor belt as a row of tiles, the counter with its count, the thumpulator with the sections its setting
asks for, and the message machine with its letter under the frame.

**Al and Sid** are drawn by frame like the other parts, each frame from the sheet of the action it belongs to
([file formats](file-formats.md#toonsexe)). The level reader doesn't set the action, so a part starts with action 0,
whose sheet is `CATROOT` or `SIDROOT`; every Al and Sid in the shipped levels has state 0, the first frame of action 0.
For another state the Lab takes the sheet of the action the frame belongs to.

That the state is the frame is read from code. TOONS.EXE draws Al and Sid with the same routine as every part drawn
from frames (file offset `0x1df79`), which takes the part's state as the place in the type's frame list (and in its
list of positions) and nothing else; before it, for Al and Sid only, a routine (`0x3027f`, called from the drawing
switch at `0x1e40a`) looks the part's action up in the action table and loads that action's sheet as the type's
sheet, without touching the frame. When Al or Sid starts an action, the run code (`0x29c8a` for Al) sets the state to
the action's first frame from the first-frame table, and the action's own code steps it from there (CATSHOT, `0x2aac3`,
sets it to 111 plus a step from a table, within its frames 112 to 123). That a state belongs to the action whose run of
frames holds it is how the two tables lay the frames out; the game doesn't check it, so a state outside the action's
frames would draw with the action's sheet.

**Toons' own fields.** TOONS.EXE's level reader (file offset `0x24c12`) reads three fields a TIM part doesn't have.
The Lab's Structure panel names them:

- **The tunnel's link** (type 46 only) is the tunnel at the other end. The reader ties the two both ways (`0x24f45`).
  When Al or Sid goes in, TOONS.EXE times the trip by how far apart the two tunnels are (half the distance across plus
  down, `0x2bff6`), and when the player fixes or frees one tunnel, the other gets the same bit 0x40 of the third flag
  word (`0x279a9`). In the shipped levels the links come in pairs that point at each other.
- **The plug place**, a byte from version `0x106` (`0x24f76`): which of the plugged part's two plug places the part
  takes. When the player unplugs a part, TOONS.EXE clears that place of the part it was plugged into, and plugging it
  in again sets both (`0xb665`). In all 70 shipped parts that have a plug, the plugged part's plug at this place is
  the part itself; two timers take the second place.
- **The setting**, the last word. The reader keeps it twice, as the part's setting and as the one it starts from, and
  only the code of some types reads it:
  - the timer: its time in the low byte, counted down as it runs. When it is set up, the timer's state becomes 12
    less twice the time (`0x538a1`), which every shipped timer's saved state already is;
  - the up/down counter: its count, with bit `0x4000` set while it counts down; a hit flips the bit (`0x53f37`);
  - the message machine: the text it shows, a letter in every shipped level (`0x41` is "A");
  - the thumpulator: its number of sections in bits 4 to 7, and in other bits how its drawing code lays them out;
  - the pistol, the catapult and the hen: the shots left. Each shot takes one, and at 0 the part doesn't fire
    (`0x6fa31`, `0x52816`, `0x56b39`).

  The editor's labels for these settings are in the data segment: "letter", "time", "count", "ammo", "banana",
  "boulders" and "eggs". What the banana's code does with its setting (0 or 1 in the shipped levels) isn't read, nor
  the other types'.

**The play area** is the screen, 640 × 400, seen from -91, -8. When a puzzle starts, TOONS.EXE (file offset
`0x228d0`) sets the view to -91 across and -8 down, and writes the same two numbers over the level's scroll words, as
TIM.EXE does with its -8, -8; the redraw then covers the whole screen, 640 × 400 (`0x1ce09`). So the play area runs
from -91 to 549 across and from -8 to 392 down, which is where nearly all walls of the shipped levels end (a few run
on to 581 and 424, off the screen). The level files'
own scroll words (-91 in 40 levels, -8 in the others) are read and overwritten. Whether the parts bin or the controls
cover some of the screen while a puzzle is set up isn't read. The Lab draws the play area there.

### Toons goals

As in TIM 1, the goal isn't in the level file but is a routine in TOONS.EXE, one per puzzle. The run loop (the check
at file offset `0x86fb`) calls a dispatcher (`0x87fc`) every step while a word of its own, the goal's countdown
(`[0x470d]`, -1 when a run starts), is below 0. The dispatcher calls the far pointer the puzzle's number (the byte
`[0x448c]`, 0 to 99) picks from a table of 100 (`0x4d99a`); an entry of 0 would meet the goal at once. All 100 point
into one overlay (stub segment `0x4669`, code at `0x71290`), and 61 routines serve the 100 puzzles. A routine meets the
goal by setting the countdown to a number of steps, 10 in most, up to 120: the run loop counts it down by 1 a step,
and at 0 sets the game mode word to `0x200`, which ends the run as solved, as in TIM 1. The step count (`[0x470f]`) is
0 in the first step.

The puzzle's number is its place in the four sets: `CAKE1` is 0, `BRAN1` 30, `HARD1` 50 and `LOON1` 75. TOONS.EXE
builds the file name from a table of the sets' first numbers (0, 30, 50, 75 and 100, at `0x4d672`) and their names
(`0x6dfd0`).

A Toons goal starts, in the step whose count is 0, by finding its parts with a routine that gives the n-th part of a
type on the lists a mask names (`0x882d`; the fixed list `0x2000`, the moving list `0x1000`), and keeps them in words,
some in a far segment (`0x340f`). Each step it then tests their fields, like CAKE1: Al's action 8 and state 66 and the
state of all five message machines not 0, then the goal is met 10 steps later.

`readToonsGoals` (`src/read/toons-goals.ts`) finds the dispatcher, the run loop's words and the level names by their
code, and reads the routines with TIM's goal reader (`readGoalRoutines`), which follows calls through the overlay stubs
and words a goal reaches through `es` once it has loaded a constant segment there. `describeGoal` says a call to the
finder as the part it finds ("word 0x340f:7514 = the 1st al-e-cat on the moving list, or 0 if there is none") and a
write of the countdown as "the goal is met, and the run ends 10 steps later". The fields are named by the record
offsets TOONS.EXE's loader and drawing code use (`state` at `0x0e`, Al's and Sid's `action` at `0x0c`, `positionX` at
`0x1f`, and so on). All 100 goals read; the Levels page shows the routine next to the goal text.

`check-toons-goals` checks the reading in the emulator as `check-goals` does TIM's: TOONS.EXE laid out with its
overlays at segment 0 runs each goal routine on the CPU, and the read program runs over the same made-up parts lists
and words, the step count 0 in half the trials. All 100 goals leave the same words in the data segment and in the far
segment `0x340f` in 1,000 trials each. The parts lists come from the list head routine the finder calls (`0xc36a`):
the fixed list at `[0x4a89]` (mask bit `0x2000`), the moving list at `[0x49d6]` (`0x1000`) and the third at
`[0x4923]` (`0x0800`). About half of the tests are taken both ways; the others are mostly in the finder and the list
head routine, which the made-up worlds rarely take every way.

Eleven routines needed more of the reader than TIM's goals, which it now takes (TIM's goals read the same as before,
by `list-goals` and `check-goals` on six builds):

- **Byte counters** (HARD6, LOON1): a counter in a byte local (`mov byte [bp-1], 0`, `inc byte [bp-1]`,
  `cmp byte [bp-1], 3; jb`), loaded with `mov al, [bp-1]; mov ah, 0`. A byte local is kept as a word that holds only
  the byte, which is exact while no word of the frame overlaps it; a byte elsewhere is the low byte of its word.
- **Long loops** (HARD4): a loop whose body is too long for a short branch back tests with a branch that leaves it and
  a `jmp` back to the body after that.
- **Loops that call** (HARD18 to HARD25, LOON7): a `do … while` whose first part is jumped into and calls the finder,
  like HARD18's "find the next message machine until there is none" (`0x6a33b`).
- **A sum's sign** (BRAN16, LOON1): `add ax, [bx+0x4f]; jge` tests the sum without overflow, as the processor's flags
  do: `a + b ≥ 0` is read as `a ≥ -b`, and when b is -32768, whose negation isn't a word, the sum is below 0 whatever a
  is (`0x6a15a`).

**The finder** (`0x882d`) takes the type, n and the mask, starts at the head of the list the mask picks (the list head
routine at `0x3b4a`), and follows each part's next word, counting the parts of the type. It gives the n-th one, or 0
when the list ends before it. So a goal that looks for more parts than the level has keeps 0 for the others and then
reads the data segment's own words at the field offsets: LOON18 looks for 6 fish and the level has 4. The Lab marks
such a condition "not in this level".

**Which part is the 1st.** The lists are sorted, not in file order. The level loader (`0x250ca`) reads how many parts
each list has and calls one routine per list (`0x2507c`), which reads the parts in file order and puts each on the
list with the insertion routine (`0xbcd1`); the game uses the same routine when a part goes back on a list. It keeps a
list sorted by the type record's word at 0x02 (where TIM 1 keeps the mass: the balloon has 1, Al 2000, Sid 1800, most
fixed types a number of their own from 1000 up), lowest first. Among parts with the same word, a new part goes before
the first one that starts higher up (`savedPositionY` smaller) or at the same height further left (`savedPositionX`
smaller), so lower parts come first, then the ones further right, and a part at the same place as an earlier one after
it. A rope or a part of type 76 goes before the first part with its word, and so does a part right after one of those
(the eye-hooks after the ropes). The third list is sorted by the record's word at 0x2a instead. `toonsListOrder`
follows this, and the emulator agrees: the insertion routine run on the CPU with made-up parts builds the same lists
in 3,000 trials. So the Lab can say which level part a condition is about: in LOON1 the 1st al-e-cat is the lowest
one, #60. It numbers the part in the condition ("al-e-cat #60") and rings it on the drawing, where TIM 1's goals ring
every part of a type they look at. The places are the file's: for a part in the bin, where the player puts it decides.

**As conditions.** All 100 goals show as conditions on the Levels page, said in game terms:

- the parts the goal finds in its first step are "the 1st al-e-cat on the moving list" and so on, for every step after
  (read from code: the setup runs only while the step count is 0, and nothing else writes those words);
- a word set to 0 in the first step and to 1 whenever a test holds, and then tested, is "at some step so far": CAKE2
  is "at some step so far, the 1st eunice-elephant: action 5, state 8, and at some step so far the 2nd one too";
- a goal that goes over its parts with a counter (CAKE1's five message machines, BRAN10's three Sids) gives a
  condition for each part, and parts that each pass one of several tests are one condition each: LOON17 is "the 1st,
  2nd and 3rd sid-mouse: action ≠ 45, one of: positionX > 640 or positionX < 0 or positionY > 400 or positionY < 0";
- a word set to the step count when a test holds keeps the last step it held at: CAKE6, HARD12 and HARD13 are "last
  held 30 steps ago, not at the first step, the 1st sid-mouse: action = 17 (SIDANVIL)" (the word is 0 until then, and
  the goal tests it isn't, so a hit at the first step doesn't count);
- a word that 1 is added to when a test holds counts the steps it held at: CAKE28 is "at exactly 2 steps so far, the
  1st sid-mouse: action = 55 (SIDEGG), state = 484, control = 0";
- a word of a few values is said by what happened in which order: BRAN8's switch word becomes 1 when the switch is on
  and 2 when it is off while the word is 1, so 2 means "the switch is off now, and was on at some step before"; with
  Al's word, which a test sets to 1, read as 0: "at no step so far, the 1st al-e-cat: action = 16 (CATSHOT)", and the
  same for action 37;
- a loop that finds the next part of a type until there is none fills a table with every such part: HARD18 and HARD21
  to HARD25 are "every message-machine on the fixed list: state ≠ 0", however many the level has;
- a field that holds a part is followed to it. Al's word at `0xb1` is his angel: at the end of action 16 (CATSHOT,
  `0x2aac3`) TOONS.EXE makes a new al-e-cat at his place with action 17 (CATANGEL) and keeps it there (for a tunnel the
  same word is the tunnel at the other end). BRAN16 keeps it when Al has action 16 and it is an al-e-cat, and is met
  when it is off the top: "at some step so far, the 1st al-e-cat: action = 16 (CATSHOT), angel's type is al-e-cat" and
  "the kept angel of the 1st al-e-cat: positionY + height < 0". LOON1 asks the same of four Als. The goal's test that the
  kept part isn't 0 holds whenever it was kept: a type read through 0 is the word 0x6f42 from Borland's text (below),
  not a type. The sum is said without overflow, as the reader's two tests (the height is -32768, else positionY < 0
  less the height) work it out;
- a search can stop early: LOON7 looks for the first balloon whose word at `0x6f` isn't 0, starting with n = 0. That
  word is the part's first rope place: the level reader (`0x24e0a`) gives each rope a small record and puts it in the
  word of both parts it ties, at their rope place (`0x6f` or `0x71`). So the goal finds the first balloon on the moving
  list with a rope at its first place, and is met when it is out of play. When the first part on the moving list isn't
  a balloon (n = 0 gives that part only when it is of the type) or no balloon has a rope, the goal keeps 0, and reading
  through 0 finds the data segment's first words: Borland's copyright text, whose drawing flags word has bit 0x2000. The
  goal is then met at once, which the conditions say as two more ways. In LOON7 both balloons come first on the moving
  list and the top one has the rope.
- Al's and Sid's action is named by its sheet ("action = 50 (CATFISH)"), and a state by its frame in the sheet of the
  action tested with it ("state = 417 (CATFISH frame 16 of 16)"). That a state is the frame drawn is read from the
  drawing code ([Al and Sid](#toons-levels)); which action's frames it is in comes from the action tables. CAKE26
  tests action 16 with state 141, which lies in another action's frames, so a state is only named next to its own
  action.

A Toons part's record is 0xb3 bytes: the level reader and two other places allocate it with `calloc(1, 0xb3)`
(`0x24b45`, `0x24293`, `0xc15a`), so a goal's offsets up to `0xb2` are fields (the counters' setting at `0xaf`).

### Toons: still open

- **The goal's parts during a run.** The goals find their parts in the first step of a run, from the lists as they
  are then. Whether anything in a run takes a part off a list and puts it back (which would sort it again by where it
  is then) isn't read; the Lab says the order of the parts where the file puts them.
- **LOON7's balloon** is ringed with every balloon: which balloon has a rope at its first place is in the level (the
  ropes' records), but the Lab doesn't work it out for the condition yet.
- **A step's time** in Toons isn't read, so the countdown is said in steps, not seconds.
