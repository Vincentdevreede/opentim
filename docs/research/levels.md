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

    pnpm --filter @opentim/content check-goals --tim1 <game folder> --evenmore <game folder> --tim2 <game folder> \
      --toons <game folder> [--trials n]

The same script checks TIM 2's goals ([below](#tim-2-goals)) and Toons' ([below](#toons-goals)), each folder the
same way and with the same lines. Each game has its own number of trials unless `--trials` says: 3,000 for TIM 1 and
Even More, 1,000 for TIM 2 and Toons.

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

    pnpm --filter @opentim/content list-goals --tim1 <game folder> --evenmore <game folder> --tim2 <game folder> \
      --toons <game folder> [--out <folder>] [--conditions]

It lists Toons' goals the same way, by level name, and TIM 2's as the entries each level keeps with their
conditions; the builds of TIM 2 are compared by level name, since the demo has levels of its own.

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

**As the puzzle starts.** `check-puzzle-start` loads every shipped puzzle of the two recorded builds the same way and
compares it with what the Lab says the puzzle starts with (`puzzleStart`): the bin list holds the file's bin in its
order, and every placed part that pairs keeps the file's saved state (0x90), plugs (0x62, 0x64) and first rope place
(0x66, set in the rope and in each part it ties at its first place). All 160 puzzles of Even More (English floppy) and
all 87 of TIM 1 (French) start as the Lab says; 73 and 49 placed parts don't pair and aren't compared. The other TIM
builds aren't known to the recorder, so the script says it doesn't check them.

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
  text. The game shows a note for each place with a text. The word before them is read and not kept. The third word
  picks the note's picture: TIM2.EXE draws picture 41 of `HANDLES.BMP` at the note's place, or 42 when the word is 2 or
  more, and when the word is odd mirrors it left to right and draws it 4 pixels further left (the routine at file
  offset `0x1e010` in the floppy build). The shipped levels use 0 to 3. The Levels page draws the pictures.
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

### TIM 2: the loader's records and the puzzle start

`check-level-fields --tim2` and `check-puzzle-start --tim2` run TIM2.EXE's own level loader (file offset `0x68020` in
the CD build, in an overlay) and its puzzle start (`0x686de`, the routine that calls the loader with the level's name
and the game's mode) on every level, standing in only for the game's file and memory routines. The game keeps its
part records in a store of 150 records of 0xba bytes that it makes when it starts (`0x1a539`, called with 150 at
`0x1985f`), so that runs first. The loader's table of parts has a far pointer per part, in the file's order, so each
part of the file pairs with its record; all 8,583 parts of the CD's 206 levels do. Where the loader puts the fields:

- the type at 0x08, the flag words at 0x0a, 0x0c and 0x0e (each the type's own bits with the kept bits of the file's,
  as above), the second also at 0xac;
- the state at 0xa8 and at 0x10 (in 8,491 of the parts; the others are set by their type), the place at 0x22, 0x24
  and again at 0xa4, 0xa6;
- the links as far pointers at 0x5e and 0x62 (again at 0x66 and 0x6a), the plugs as far pointers at 0x6e and 0x72;
- a belt's record (0x3e bytes from the near `calloc`) at 0x58 in the belt and in both its parts, with the two parts at
  +6 and +0x0a; a rope's record (0x36 bytes) at 0x76 or 0x78, with the parts at +4 (again at +0x0c) and +8; the rope
  places' bytes at 0x7a, 0x7b and 0x7c, 0x7d.

The size and the base size aren't in any one word of every record: the type sets them from its pictures, which the
check doesn't give it.

**The puzzle start.** With the mode of a puzzle (any but 1 and 6, which keep every part where it is, and 9), the start
routine (`0x68817`) walks the moving list and then the fixed list and puts each part without bit 0x40 of its third
flag word in the bin. The Lab first put those parts in the bin in the file's order and changed nothing else; in 195 of
the CD's 206 puzzles the game started otherwise. `puzzleStart` now follows TIM2.EXE (`tim2PuzzleStart` in
`src/read/tim2-start.ts`), and every puzzle of the three builds starts as the game does: 206 of 206 on the CD and the
floppy, 8 of 8 in the demo, and the designer's solutions too.

- **The third flag word** the start tests is the loader's: the type's own bits (the word at 0x28 of the type's record,
  for the types below 0x119) with the file's bits 0x140. So the type decides most of it, not the file.
- **The order it walks in** is the lists' order, which the insertion routine (`0x221e2`, `0x1a31:0x2a58`) keeps as the
  loader puts the parts there in the file's order: by the word at 0x38 of the type's record, lowest first; among parts
  with the same word the rope, the rope end (49) and the steel cable (76) first, then the lowest on the screen first (a
  larger y at 0xa6), at the same height the one further right; type 11 the other way up. The loader asks for a part
  with bit 0x1000 of its third flag word to go last. `tim2ListOrder` gives the same lists as the game for every level.
- **The bin's order** comes from the same routine: for the bin it asks a routine (`0x59ac4`, `0x541d:0x154`) which of
  two types comes first in a table in the data (`0x422b:0x1f0`, ended by -1), and puts the new part before the first
  part of its own type or of a later one. A type the table doesn't have goes after the others. So the types come in
  the table's order, and a type's parts in the reverse of the order the start put them there (`tim2BinInsert`).
- **What goes with a part.** A part that goes to the bin takes with it the belt round it (a belt part whose two parts
  name it) and the ropes tied to it (a rope, rope end or steel cable whose record names it), also when those have bit
  0x40; their other ends on the board are untied. A belt or a rope the start reaches on its own goes too, and is untied
  from both ends. Before a pulley it takes the rope over it (the pulley's field). A remote control (22) and its
  explosives (55) name each other in their second link: when either goes, the remote control goes to the bin and the
  explosives are taken off and freed, as Toons takes off a tunnel's other end. That is why the remote controls ELEV22
  #10, HLEV6 #3 and MLEV21 #9 go to the bin although they have bit 0x40: their explosives don't.
- **Plugs and states.** A part plugged into one that goes to the bin is unplugged by the routine that pulls a plug out
  (`0x21b4f`): it clears both plug words, calls the type routine at 0x08 of each part's type record, and keeps the
  board part's new state as the one it starts from (0xa8). Read from those routines: the electric switch (21,
  `2354:0x28b8`) and the electrical outlet (120, `2354:0xb119`) keep bit 4 of the state and take 1 for a plug in the
  first place and 2 for one in the second; the generator (26, `2354:0x2f6c`) and the solar panel (38, `2354:0x4f9b`)
  take only those two bits; the laser-activated plug (96, `2354:0x9fcd`) takes the state's remainder by 7, plus 7 for
  a plug in the first place and 14 for one in the second. These five are the only types the shipped puzzles unplug on
  the board. A part that names a binned part as its plug while that part doesn't name it back keeps its plug (HLEV1
  #45, MLEV15 #7).
- **A pulley before its rope** in the file has no rope over it, as in Toons: the loader takes the rope's record as it
  reads the pulley.

For the designer's solution (mode 9) the same happens to the parts with bit 0x100; the others stay on the board.

### TIM 2 goals

The loader keeps the goal in the data segment: the first word, eight entries of 18 bytes (a part pointer and seven
words) and the last word. One routine of TIM2.EXE tests them for every puzzle, in its first overlay, the same in all
three builds:

| Build        | Goal routine | File offset | Goal words           | Check count |
| ------------ | ------------ | ----------- | -------------------- | ----------- |
| TIM 2 floppy | `4e03:2503`  | `0x55743`   | `0x7416` to `0x74a8` | `[0x2c2]`   |
| TIM 2 CD     | `4ee4:2503`  | `0x56753`   | `0x7896` to `0x7928` | `[0x47a]`   |
| TIM 2 demo   | `4d86:2503`  | `0x54f73`   | `0x756e` to `0x7600` | `[0x240]`   |

`findTim2GoalRoutine` (`src/read/tim2-goal.ts`) finds it in TIM2.EXE laid out with its overlays (the same Borland
overlays as TOONS.EXE, so `readToonsMemory` lays it out): the one place that reaches an entry by a part's number
counted from 1 (`mov ax, entries; add ax, -18`), and from its instructions the first word, the check count, the last
word and the three lists it walks: the bin at `[0x64af]`, the moving list at `[0x64a7]` and the static list at
`[0x649f]` in the floppy build (the level loader puts a level's static parts on the list at `[0x649f]` and its moving
parts on the one at `[0x64a7]`).
`summariseTim2Goal` says the goal as conditions, and `runTim2Goal` tests it as the routine does. What it does:

- When the first word is 0 the goal is never met. It is 1 in every shipped level.
- The goal isn't met while one of its parts is in the parts bin.
- Every entry with a part must hold. Its words are a low and a high state, a count and an area: x, y, width, height.
  Up to version `0x109` an entry has no high state: the loader (floppy build, file offset `0x61853`) reads the low one
  and copies it into the high one. No shipped level is that old: they are `0x111` to `0x113`.
- For a moving part whose area width isn't 0, the entry tests the part's middle, its position plus half its base
  size: strictly inside the area, or, when the width is -1, off the screen, outside 0 to 640 across or 0 to 400 down.
  For a static part, or a width of 0, it tests the part's state, from the low to the high one.
- With a count of 0 the entry is about its own part. With a count of N, the routine walks the list its part is on
  again from its first part and needs N parts of the part's type that pass; then it goes on after the entry's own
  part. When the list ends first the goal isn't met, except when the entry's own part is the last on its list: then
  nothing marks the count as running, and the routine just forgets the entry (see below).
- The routine looks a part's entry up from the first entry to the first one without a part, so an entry after a gap
  is never tested. No shipped level has a gap.
- The routine answers 0 when the first word is 0, 1 when the goal isn't met and 2 when it is. A part in the bin
  answers 1 before anything else, and that check isn't counted.
- The last word holds the goal back: the routine counts its own checks and says the goal isn't met before that many.
  The run loop (the routine at file offset `0x53240` in the floppy build) sets that count back to 0 when the machine
  starts and runs the goal routine once a step, right after the step, so the last word is a number of steps. Four
  levels use it, like 108 steps for the message computers.
- **Two other ways a run ends.** The run loop checks the input after every step. Its input routine (file offset
  `0x36311` in the floppy build) keeps the mouse buttons in `[0x7ad8]`, the typed character in `[0x7ade]` (its low 7
  bits) and the held modifier keys in `[0x7ae4]`: 1 for Ctrl (scan code `0x1d`), 2 for Alt (`0x38`), 4 for either
  Shift (`0x2a`, `0x36`) and 8 for the right Alt. With Ctrl, Alt and Shift held (7) and character `0x16`, which is
  Ctrl+V, the loop sets the game's mode to `0x200`, the same as a met goal: a hidden key that solves the puzzle. With
  the right mouse button (value 2; the click code elsewhere counts the middle button, 4, as it too) it sets the mode to
  `0x1000`, the mode the game is in while the player builds, so the machine stops.
- When the routine first says the goal is met, the run loop goes on for 30 more steps and then ends the puzzle as
  solved, whatever the routine says in those steps. The run loop waits for its step timer before each step (see
  [the animation speed](file-formats.md#animations-anm)), so a step takes at least 33.8 ms.

The Levels page shows these conditions, with the area of an inside test drawn on the level.

**Checked in the game.** `check-goals --tim2` runs the goal routine in the emulator next to `runTim2Goal`, as
`check-goals` does for TIM 1's routines: TIM2.EXE laid out with its overlays at segment 0, each level's goal entries
in the data segment, and made-up parts lists. The parts are the level's goal parts, a few of its other parts and up
to three more of the goal's types, each on its own list, in the bin or on no list, in the level's order or shuffled,
with states, places and base sizes drawn around the goal's numbers (the state limits, the area's edges and the
screen's, one more and one less) and other numbers. It compares the answer and every word of the data segment and the
parts. Besides the shipped levels it checks 200 made-up goals, with gaps, counts, a first word of 0 and areas off the
screen, which reach the parts of the routine no shipped level does. A world that takes a test a way no world took
before counts, and a goal stops when every test went both ways or after 1,000 trials.

On 2026-11-13 no goal differs from the game, in all three builds:

| Build                | Goals |  Trials | Differ | Every test both ways | Tests both ways |
| -------------------- | ----: | ------: | -----: | -------------------: | --------------: |
| TIM 2 floppy and CD  |   206 |  68,166 |      0 |                  156 |    963 of 1,032 |
| TIM 2 demo           |     8 |   4,311 |      0 |                    5 |        37 of 41 |
| Made-up (each build) |   200 | 176,370 |      0 |                   28 |    797 of 1,310 |

A made-up goal with a first word of 0 has only that test, which goes one way, so few made-up goals take every test
both ways. The check finds a change to `runTim2Goal`: counting a middle at x 640 as off the screen, failing a count
that runs out after the last part, or looking past a gap in the entries each makes goals differ.

**A count whose part is last on its list.** The routine starts a count by keeping the part after the entry's part,
to go on from there when the count is reached, and it fails the goal when the list ends while it keeps one. When the
entry's part is the last on its list there is no part after it, so running out of parts doesn't fail the goal: the
entry is skipped, and the goal can be met with too few parts. Ten levels of the floppy and CD count parts (ELEV8,
HH14, HH18, HH7 with four counts, MLEV2, TLEV2, TLEV3, TLEV4, TLEV6, TLEV17) and the demo's ELEV2.

None of those counts can pass with fewer parts, because none of the counted parts can be last on its list. How
TIM2.EXE keeps the lists (addresses of the CD build):

- **Only two routines change a list**: the insertion routine (`0x1a31:0x2a58`,
  [above](#tim-2-the-loaders-records-and-the-puzzle-start)) and the one that takes a part off (`0x1a31:0x2a22`). Their
  callers are the level loader, the puzzle start and the bin (`0x1a31:0x2ca1`), the player, and the type routines of
  the parts the machine makes (ten places in `0x2354`, from `0x2354:0x0a09` to `0x2354:0xa834`). Those type routines
  only put a part they make on a list (and mark it with bit `0x10` of its first flag word), after taking off the one
  of the same type they made before (`0x1436:0x11a8`). When the machine stops, the parts it made are taken off again
  (`0x1a31:0x4a44`). Nothing sorts a list while the machine runs, so the parts keep the order they were put in.
- **When the player drops a part** on the board, TIM2.EXE sets its start place (0xa4, 0xa6) to where it is and puts it
  on its list again (`0x624a:0x0fa0` calls `0x1a31:0x2d4c`, which takes it off and inserts it on the fixed list when
  bit `0x4000` of its first flag word is set, else on the moving list), with 0 for the insertion routine's last word.
  So a dropped part goes by the same rules as the loader's, except that a part with bit `0x1000` goes before the first
  part that has it too instead of after every part.
- **The parts that stay on the board** (bit `0x40`) are the puzzle's own: the routine that gives a part its handles
  (`0x1a31:0x12a2`, kept in `[0x6885]` for the code that draws them) stops at that bit (`0x1a31:0x12f9`) before any
  handle but the editor's, so the player can't move or turn them, and nothing takes them off. So they keep the order
  the start leaves them in, and a part after the counted one stays after it.
- **The word the lists sort by** (0x38 of the type's record) is 0 for every type in all three builds, so on each list
  the parts go from the lowest on the screen to the highest, with the ropes first and the parts with bit `0x1000` of the
  third flag word last.

Every counted part of the shipped goals stays on the board, and a part higher on the screen stays on the board on the
same list: the last on the list is ELEV8 #44, HH14 #22, HH18 #67, HH7 #60 (for all four counts), MLEV2 #68, TLEV17
#29, TLEV2 #51, TLEV3 #28, TLEV4 #23, TLEV6 #18 and the demo's ELEV2 #34. `tim2LastOnList` (`src/read/tim2-start.ts`)
works this out for a part, also for one from the bin (last when the player puts it higher than every part of its list
with its word, unless a part on the board must come after it), and the Lab marks a count with "can pass with fewer"
only when its part can be last, with the reason. No shipped count gets the mark. Without TIM2.EXE's tables every count
gets it. `check-puzzle-start --tim2` compares the order of the moving and fixed lists the Lab gives with the game's,
after the loader and after the start: they agree in every level of the three builds.

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

**The two bytes after the version** (from version `0x113`). A new level starts with 0 and 3 (TIM2.EXE sets them so
when it clears a level). The loader keeps them in two bytes of the data segment (`[0x66a8]` and `[0x66a7]` in the
floppy build). The first is only written back when the game saves a level; nothing else reads it, and it is 0 in every
shipped level. The second is the level's background: the routine that draws the play area fills it with that palette
colour (a box from 0, 0, 560 wide) before the parts, and the editor's dialog with the air and gravity also sets it. It
is 3 in 172 of the 206 levels and goes from 1 to 15 in the others. Before version `0x113` the loader leaves both as they
were. The Levels page fills the play area with it when the background is set to Game.

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

Nothing in the other files names a type's draw routine; the level files, the `.ANM` and the `.PAR` files were
checked. Two things in the files match it, though neither is a rule of the program. A part's `.PAR` file (see [the file formats](file-formats.md#part-properties-par)) has
576 × 416 as its largest size exactly for the types drawn
by the wall routine, the large pipes (97) included, in the floppy and CD builds; the demo ships few `.PAR` files. And
the type's flag bits the levels keep: bit `0x2000` of the third word for walls (every wall type but the large pipes
has it) and bits `0x1080` without `0x0400` for tile patterns. The Lab used to go by these when TIM2.EXE wasn't loaded;
it now needs TIM2.EXE to open TIM 2 and draws by its type table only. Every type the levels of the three builds use is
in that table. When the table isn't found, the Lab draws walls and patterns by their frames and says so.

- **Mirroring the other parts.** The usual routine mirrors a part with bit `0x10` of the second flag word left to
  right and with `0x20` upside down, but not in the part's size. It moves the part by two words of its record
  (offsets `0x44` and `0x46`) less the right (or bottom) edge of the frame of state 0, and then mirrors the frame in
  the animation's size. TIM2.EXE's size routine (file offset `0x21477` in the floppy build; it runs whenever a part's
  state is set, also when a level is set up) fills those two words by the type, from lists in its code that are the
  same in all three builds: the part's own size for the walls, tiles and the other parts drawn from their size (1, 2,
  5, 46, 48, 56, 60, 82 to 85, 97, 99 to 102, 118, 121 to 127, 203, 205, 271 and 280), 0 for the belt, the rope and
  type 76, and the size of the frame the state shows for 4, 7, 57, 58, 71 and 88. Every other type gets that frame's
  size too when bit `0x1000` of its third flag word is set, and the size in its `.PAR` file when it isn't. The same
  routine makes that the part's size, unless the type record has a size of its own. The `.PAR` size is often a few
  pixels narrower than the animation, so a part of such a type mirrored left to right lands that much further left:
  up to 7 pixels in the shipped levels, like 6 for the cat (12); the mouse motor's is 1 wider, so it moves right. Lines mirror as the width less x, without taking 1 off.
  The Lab follows all of it (`tim2MirrorSide`); without the `.PAR` file (the demo has few) it mirrors such a part in
  its own size.
- **The colour block** (127) has a routine of its own: it fills the part's box (its position and size) and outlines it
  in one palette colour, the low byte of the part's extra word, or colour 5 when that is 0. Only the colour block
  has all of bits `0x1480` in its type's third flag word; the Lab knows it from TIM2.EXE's type table.

The play area is the screen, 640 × 400: the goal routine counts a part off the screen when its middle is outside it,
and the interface animations (`CNTRLPNL.ANM`, `PARTSBIN.ANM`) draw their panels in a frame of that size. While a
puzzle is set up, the control panel covers x 0 to 48 and the parts bin x 560 to 640, both 377 high; that is why most
levels keep their parts between 0 and 568 across and above 377.

### TIM 2: still open

What isn't worked out yet, and what the Lab does meanwhile:

- **The demo** has few `.PAR` files, so a mirrored part whose type takes its mirror size from the `.PAR` file is
  mirrored in its own size.
- **Cut off pictures.** The usual draw routine draws types 36, 45 and 70 with bit `0x10` of the third flag word cut off
  at a row the part's record keeps (offset `0xae`). What sets that row isn't read, and the Lab draws them whole.
- **Screen width.** The 256 colour `VGA:` driver in `VM.OVL` addresses rows 320 pixels wide in a 400 line mode, while
  the play area is taken as 640 by 400 from the goal check and the panel animations. How the two fit (a doubled pixel,
  or another mode for the play area) isn't settled. The line rule is the same at any width, so drawing lines doesn't
  depend on it.
- **Unplugging other types.** Only the routines of the five types the shipped puzzles unplug are read
  ([above](#tim-2-the-loaders-records-and-the-puzzle-start)); for another type the Lab leaves the state as the file has
  it.

## Toons levels

Sid & Al's Incredible Toons ships 100 puzzles in four sets, `CAKE1` to `CAKE30`, `BRAN1` to `BRAN20`, `HARD1` to
`HARD25` and `LOON1` to `LOON25`. All 100 read to their last byte in the Toons layout
([file formats](file-formats.md#level-files-lev-tim-gkc)), versions `0x105` and `0x106`. Each has a title and a goal
text; the goal itself isn't in the file but in TOONS.EXE ([Toons goals](#toons-goals)).

**Parts bin.** The files have no bin list. Bit 0x40 of a part's third flag word decides, as in TIM 2: TOONS.EXE lets
the player neither move nor change a part with it (the routine that says what the player may do with a part,
`0xab37`, returns early), and its puzzle setup (file offset `0x25829`) puts every part without it in the bin. That the
routine is the start of a puzzle is read from what it does, not from where it is called. Read from code:

- The setup walks the moving list and then the fixed list, in the order the level loader leaves them. It puts each
  part without the bit back to state 0, unmirrored and at its own size, and then into the bin through the same routine
  as the player's bin handle (`0x281c9`), with the words that routine reads set as for a drop in the bin (`0x25a24`).
- That routine puts the part on the third list (`0xbe19`) and then takes off what the part holds (`0xbb07`), in this
  order: its plugs (below), a belt round the part, which is untied from both its parts and goes to the bin too
  (`0xb88c`, which puts it there at `0xb8f8`), and the ropes tied to the part, its first rope place first, each untied
  from both its parts, which clears their rope places, and put in the bin (`0xb902`, at `0xbabf`). Untying a rope runs
  the type routine of both parts it ties (the record's far pointer at 0x36) and clears the links of the pulleys
  between its first end and its second.
- **Plugs** (`0xb7b3`, called for a part with bit 0x1 or 0x2 of its third flag word). Bit 0x2 marks a part that takes
  plugs (the electric switch in every shipped level), bit 0x1 one that plugs into another (the hair drier, the timer
  and the vacuum). For a part with 0x1, the routine takes the part it is plugged into (its first plug word), clears
  that part's plug at this part's plug place and this part's own plug word, runs the type routine of both, keeps the
  other part's state as the one it starts from (`0x99` from `0x0e`) and marks it to be drawn again. For a part with
  0x2 it clears both its plugs and the first plug word of each part in them, and runs their type routines and its
  own. The part's plug place byte isn't cleared. So the part that stays on the board is unplugged where it stands.
- **The belt bit** (`0xb88c`). Untying a belt also clears, on both its parts, bit 0x2 of the second flag word, in the
  working word (0x08) and the saved one (0x9d), and the part's belt record word (0x5d). The bit says a belt runs round
  the part: tying a belt end sets it (`0x27b81` and `0x27bc8` when the player drops a belt, `0x2816b` when they drag one
  end), and in the shipped files exactly the 100 parts a belt runs round have it. One routine reads it (`0xb0eb`, the
  tests at `0xb112` and `0xb141`): for a belt with a loose end, a part that `0xa7e6` finds on the board takes the end
  only when it has bit 0x1 (a place for a belt) and not bit 0x2 (no belt yet). A belt tied at both ends skips the test.
  The routine is called when the player drops a belt (`0x27b4e`) or drags one (`0x28013`), and at `0xc0a6`, `0xd2bf`
  and `0xd72b`, each with a belt's record. The drawing routine (`0x1df79`) tests bits 0x10, 0x20 and 0x1000 of the
  word, not this one, and a search of TOONS.EXE and its overlays for code that tests, sets or clears bit 0x2 of the
  word at 0x08 finds only the places named here. The reset that starts a run copies the saved word back (`0xecc6`), so
  the bit stays clear. So clearing it changes nothing on the screen: it lets the player tie a belt from the bin round
  that part again. In the shipped puzzles it is cleared on 22 parts in 19 puzzles that stay on the board while their
  belt goes to the bin: 12 conveyor belts, 5 chow-men, 2 ant motors, 2 skeleto-bobbins and the gear in CAKE29. The
  Lab draws them as the file does.
- A tunnel takes the tunnel at its other end with it: that one is taken off its list and freed (`0x28253`, `0x23fa8`).
  So the bin holds one tunnel of a pair, and when the player puts it on the board TOONS.EXE makes a copy at its other
  end (`0x27fbb`), which the player places next.
- The setup skips ropes and belts themselves: for them it only clears the bit (`0x25892`). So a rope or a belt between
  two parts that stay on the board stays there, tied as the level ties it. None of the shipped ropes and belts has the
  bit.
- Before it puts a pulley in the bin, the setup follows the pulley's first links to a part whose link leads back to
  the last pulley, and puts the rope tied at that link's rope place in the bin first (`0x258ac`). No shipped level has
  a pulley without the bit under a rope whose two ends stay.
- When the part before the one it looked at went to the bin meanwhile (a rope or a belt the part held), the walk
  starts its list again from the head (`0x25a38`). That doesn't change the order: the parts it meets again are on the
  board or are ropes and belts, which it skips.

So in the 100 shipped puzzles, 699 of the 3,439 parts start in the bin: 65 of the 121 ropes and 35 of the 50 belts,
each because a part it ties goes there. The other 56 ropes and 15 belts stay on the board, and 7 tunnels are taken
off (in BRAN10, BRAN18, BRAN20, CAKE15, HARD5, LOON7 and LOON21). The Lab does the same (`toonsPuzzleStart`): it draws
the ropes and belts that stay, puts the others in the bin, and lists a tunnel taken off on its own in the Structure
panel and in a note. Which tunnel of a pair goes to the bin follows the lists' order, with TOONS.EXE's type table,
which the Lab needs to open Toons; the shipped levels give the same tunnels by place alone. The Solution box shows every part where the
file puts it. CAKE15 ("Use a tunnel to help Al get to the bubble gum") has one of its two tunnels in the bin and the
other taken off. In LOON7, rope #2 between balloon #41 and eye-hook #4 is now drawn on the board.

**The bin's order.** The bin is the third list, which the insertion routine (`0xbcd1`) keeps sorted by the type
record's word at 0x2a, lowest first: it compares that word only when the list's head is the third list's (`0x4923`)
and puts the new part before the first one whose word is higher (a signed compare), so parts with the same word stay
in the order they were put there. The word isn't the file's: a start-up routine (`0x25b9c`, called at `0x26004` among
the routines that load the program's resources) goes along a table of the 85 types in the data (`0x3b6a:0x48`) and
writes each type's place in it into the record's word at 0x2a. The table starts with Al, Sid and the dragon and ends
with the walls and the inclines. That the routine runs once at start is inferred from where it is called; what it
writes is read. So in the bin the types come in the table's order, and a type's parts in the order the setup put them
there: the moving list's before the fixed list's, each list in its order, and a rope or a belt when the part it holds
goes. `readToonsBinKinds` reads the table, and `toonsPuzzleStart` gives the bin in this order (`binOrder`).

**Checked on the CPU.** `check-puzzle-start --toons` runs TOONS.EXE's own level loader on each of the 100 level files
and then its puzzle start as the game runs it: the routine that loads the level and runs the setup (`0x2573f`), the
routine after it and the level reset (`0x228bc`, `0xec1e`, called one after the other at `0x2290a`), after the
start-up routine that writes the bin's sort words. Only the game's file and memory routines are stood in for
([the code map](../code/descriptions-and-goals.md#the-emulator-srcrun)). It gives the same bin in the same order, the
same tunnels taken off, and on the board the same plugs, the same states, the same rope places untied and the same
belts taken off as `toonsPuzzleStart`, in all 100 puzzles.

That needed one fix the earlier check, over records built by hand, couldn't show: **a pulley before its rope in the
file has no rope over it.** The level reader keeps the rope over a pulley at the pulley's second rope place (0x71),
taking the record at the first rope place of the part the pulley's field names (`0x24f3c`), and it does that as it
reads the pulley. It reads the parts in the file's order and makes a rope's record as it reads the rope, so a pulley
that comes first gets 0 there. In HARD6 pulleys #4 and #15 come before their rope #21, and in HARD25 pulley #32 before
its rope; when the rope goes to the bin, there is nothing at their second place to untie. `toonsPuzzleStart` follows
the reader in this now. The second flag word of a part on the board changes only by the belt bit, on
the same 22 parts. Run between the two resets of a puzzle start ([Toons: assumptions](#toons-assumptions)), it gives
the same again. LOON7's bin, for example, is fish #43, peanut #42, rope #1, teeter-totter #0,
trans-roto-matic #18, skeleto-bobbin #19, bomb #46, baseball #45 and tunnel #20; the file has them in the order 0, 1,
18, 19, 20, 42, 43, 45, 46. Sorting by the type's number instead, as the Lab once did without TOONS.EXE, gives
another order in 78 puzzles; the Lab now needs TOONS.EXE to open Toons.

**Unplugged as the puzzle starts.** The setup pulls out 22 plugs in 19 puzzles. In 13 both parts go to the bin. In
the other 9, in 8 puzzles, the part plugged in goes to the bin and the electric switch it was in stays on the board,
unplugged: BRAN14 (timer #22 from switch #5), CAKE12 (vacuum #6 from #2), CAKE21 (timer #1 from #0), HARD19 (hair
drier #0 and timer #18 from #1), HARD25 (vacuum #29 from #28), LOON12 (timer #26 from #6), LOON15 (hair drier #0 from
#5) and LOON2 (timer #37 from #6). The switch's type routine (file offset `0x6f3f2`) sets its state again: bit 4 stays
(on or off), and 1 is for a plug in its first place, 2 for one in its second (`0x6f461`). So the switches start with
state 4 or 0 instead of 5, 1 or 3. Untying a rope runs the anvil's routine too, which gives it state 1 while a rope is
tied at its first place and else 0 (`0x5382b`): the anvils #24 in HARD19, #66 in LOON1 and #32 in LOON12 lose their
rope to the bin and start with state 0, which is the frame TOONS.EXE draws them with (the drawing routine `0x1df79`
reads the state at 0x0e). The anvil's routine doesn't keep it as the state the part starts from (`0x99` stays 1), but
the reset that follows the setup does; that the Lab shows 0 is a decided assumption
([Toons: assumptions](#toons-assumptions)). These are the only parts on the board whose state the setup changes in the
shipped levels. The Lab draws the switches and the anvils with these states, and says in the
Structure panel which plugs are pulled out.

**Ropes and belts the player can change.** Clearing the bit is what lets the player change a rope or a belt that is
tied when the puzzle starts. Read from code: the routine that says what the player may do with a part (`0xab37`) gives
a rope or a belt without the bit two handles, the bin handle and the part itself, and nothing more. Clicking the place
where a rope is tied on a part picks the rope, with the clicked end as the one to move (`0xa7ac`, which turns the rope
round when that is its first end); a belt is picked at its hub the same way (`0xa6ed`). Dragging it then unties that
end and leaves the other tied (`0x280f3`: `0xb902` with only the second end, and for a belt `0xb88c` and the first end
tied again), and the player ties the loose end where they drop it. The bin handle unties both ends and puts the rope
or the belt in the bin (`0x281c9`). Either way the rope place of the part it is untied from is cleared, the word
LOON7's goal tests.

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
  in again sets both (`0xb665`). The puzzle setup unplugs a part it puts in the bin the same way (`0xb7b3`, above). In all 70 shipped parts that have a plug, the plugged part's plug at this place is
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

`check-goals --toons` checks the reading in the emulator as it does TIM's: TOONS.EXE laid out with its
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
(the eye-hooks after the ropes). The third list is sorted by the record's word at 0x2a instead, the type's place in
a table TOONS.EXE writes there when it starts (see the bin's order above). `toonsListOrder`
follows this, and the emulator agrees: the insertion routine run on the CPU with made-up parts builds the same lists
in 3,000 trials. So the Lab can say which level part a condition is about: in LOON1 the 1st al-e-cat is the lowest
one, #60. It numbers the part in the condition ("al-e-cat #60") and rings it on the drawing, where TIM 1's goals ring
every part of a type they look at. The places are the file's: for a part in the bin, where the player puts it decides
(below).

**The order when a run starts.** Two routines change a list: the insertion routine (`0xbcd1`) and the removal routine
just before it (`0xbcad`), which unlinks a part. Neither moves the other parts, so a part keeps its place among them
until it is itself taken off and put back. Their callers, read from code:

- the level loader (`0x250b3`), each list in file order;
- the bin, the third list. A part goes there through `0xbe19` (its call at `0xbe9d`) when the puzzle setup (`0x25829`)
  or the player puts it in the bin (`0x281c9`), when a rope or a belt is taken off (`0xbabf`, `0xb8f8`), or when
  `0xbf06` puts every part there. `0x240a9` fills the third list with new parts, and `0x27fbb` puts a copy of a part
  there and keeps it at the part's `0xb1` (a tunnel's other end, inferred from that word);
- the board. `0xbea6` (its call at `0xbedd`) puts a part on the fixed or the moving list, by bit 0x4000 of its list
  word, when the player puts it on the board (`0x27bb4`, `0x27dcf`, `0x27f87`, `0x280c4`, `0x28e50`). At `0x27f87`
  and `0x280c4` the part's place is first copied into `savedPositionX` and `savedPositionY`, which the insertion
  routine sorts by, so the part goes where the player's place puts it;
- a part changing list during a run. `0x30345` takes a part off its list and puts it on the fixed list, `0x30374` on
  the moving list. The code of Al's and Sid's actions calls them 32 times (`0x29a8f` to `0x2fe60`; the two calls read,
  `0x29a8f` and `0x29b87`, put Al on the fixed list when he takes hold of the part his `0xb1` holds), an overlay
  routine once (`0x56a42`), and the reset below;
- a part made during a run. `0x303a3` puts a new part on the fixed or the moving list (`0x303d6`, `0x303ee`), before
  its place is set. Al's code calls it for his angel (`0x2ac16`, action 17) and for a splat (`0x2aa17`), and other
  types' code in the overlays at `0x528ef`, `0x56c19` and `0x6fb01`. Some types' overlay code puts new parts on the
  lists itself: a part of type 76 (`0x6e8f6`), a copy of a part (`0x6edc7`, `0x6ef3a`), one of type 75 (`0x6f04f`),
  and a rope with two parts (`0x70490` to `0x704de`), which it marks with bit 0x10 of the list word;
- the removal alone: when the reset frees a part made during a run (`0xecb4`), when a tunnel's other end goes with it
  (`0x28253`, `0xbf5f`), and in two editing routines not read further (`0xbaed`, `0x28b6e`).

When a run starts, the run loop's first routine (`0x874e`) calls the reset (`0xec1e`), which the loop also calls when
a run ends unsolved (`0x879b`). The reset takes every Al and Sid on the fixed list to the moving list and every rug
(type 77) on the moving list to the fixed list, clearing their `0xb1`, which sorts them again by their saved place. It
frees the parts made during a run (bit 0x10 of the list word), and puts every other part back to its saved place and
state without moving it on its list. So at the first step the lists are the level loader's, less the parts the puzzle
setup put in the bin or took off, plus the bin parts the player put on the board, each where its place sorts it, with Al and Sid
on the moving list. In all 100 shipped goals, every part a goal finds is fixed in place (bit 0x40) and on the list the
goal searches, no level keeps Al or Sid on the fixed list or a rug on the moving list, and the level has no part of
that type in the bin. So the order the goals see is the file's, sorted by the file's places, whatever the player
does. Where a part from the bin could come before the found one, the Lab says so in a chip ("bin parts"); no shipped
goal has one.

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
  list (their sort word is 1, the lowest), the lower one, #40, first. The level's rope #2 ties the upper one, #41, at
  its first place to eye-hook #4 (both fixed in place), so the goal is about balloon #41: the Lab numbers it and rings
  only it. Neither other way holds as the puzzle starts (the first part on the moving list is a balloon, and #41 has a
  rope), which the Lab says with a chip and doesn't ring. Which balloon it is depends on the ropes, though: the puzzle setup
  leaves rope #2 tied on the board with its fixed bit cleared (`0x25892`), so the player can take either end off and
  tie it elsewhere, or put it in the bin ([Ropes and belts the player can change](#toons-levels)). The Lab says so in a
  chip ("ropes").
- Al's and Sid's action is named by its sheet ("action = 50 (CATFISH)"), and a state by its frame in the sheet of the
  action tested with it ("state = 417 (CATFISH frame 16 of 16)"). That a state is the frame drawn is read from the
  drawing code ([Al and Sid](#toons-levels)); which action's frames it is in comes from the action tables. CAKE26
  tests action 16 with state 141, which lies in another action's frames, so a state is only named next to its own
  action.

A Toons part's record is 0xb3 bytes: the level reader and two other places allocate it with `calloc(1, 0xb3)`
(`0x24b45`, `0x24293`, `0xc15a`), so a goal's offsets up to `0xb2` are fields (the counters' setting at `0xaf`).

### Toons: assumptions

Where the code read so far doesn't settle what the Lab shows, the owner decided an answer. Each is written the way
[the decided assumptions](../assumptions/behaviour-assumptions.md) of the behaviour analysis are: the question, what is
read from code, what we assume, what it gives and how to recheck it. They are kept here, next to what they are about,
because `docs/assumptions/` is for the behaviour analysis of TIM.EXE, whose wording a test keeps the same as in that
code.

#### 1. The anvil that loses its rope

Decided on 2026-11-13. In the code: `states` of `toonsPuzzleStart` (`packages/content/src/read/toons-goals.ts`), which
`layoutScene` in `apps/lab/src/levels.ts` draws the board with and the Structure panel tags ("0 at the start").

**The question.** In HARD19 (#24), LOON1 (#66) and LOON12 (#32) an anvil stays on the board while the rope tied at its
first rope place goes to the bin. The file gives it state 1. Which frame does the player see while building the
machine, and does the run start from it?

**Read from code.**

- Untying the rope (`0xb902`) runs the anvil's type routine (the type record's far pointer at 0x36), which sets the
  state at 0x0e to 1 while a rope is tied at its first rope place (0x6f) and else to 0 (`0x5382b`). It leaves the state
  the part starts from (0x99) at 1, where unplugging a switch keeps the new state there too (`0xb7b3`).
- A puzzle starts through `0x25710`, which loads the level (`0x2573f`): the level loader (`0x250ca`), the reset
  (`0xec1e`, its call at `0x2578b`), and then the setup (`0x257e5`). `0x228d0`, which sets the play area's view, calls
  `0x25710` when the word at `0x46d7` is 0 and then calls the reset again (`0x22911`).
- The reset puts each part on the board back to the state it starts from (0x99 into 0x0e at `0xed22`), runs its type
  routine through the same pointer (`0xedf1`) and keeps the state that gives as the one it starts from (`0xedf7`). For
  an anvil without a rope that is 0 again, now in 0x99 too. The run loop's first routine calls the same reset
  (`0x8753`), so a run starts the anvil at 0 as well, unless the player ties a rope at its first place.
- TOONS.EXE draws the anvil from its frames by the state at 0x0e (`0x1df79`).
- Checked on the CPU: the reset, the setup and the reset again, run over records built from all 100 level files, leave
  the three anvils with state 0 at both 0x0e and 0x99, and give the same bin, plugs and states as `toonsPuzzleStart`.

**What we assume.**

- The board the player sees while building is the one this sequence leaves, so the Lab shows the anvil with state 0,
  not the file's 1.
- Nothing else sets the anvil's state back to 1 before the board is drawn or before a run starts. The routines that run
  between the setup and the first drawing (`0x22d4b`, `0x22884`, `0x228bc`, `0xa1fe`) aren't read for it. `0x25710` is
  also called at `0x21f07`, which doesn't call the reset after it; there 0x99 stays 1 until the run's reset gives 0
  again, and the frame drawn is 0 either way.

**What it gives.** The Lab draws the three anvils with state 0 and tags it in the Structure panel. The Solution box
shows the file's state.

**How to recheck.** Open HARD19, LOON1 or LOON12 in the game and look at the anvil before starting the machine: state 0
and state 1 are different frames. Or read the routines named in the second bullet for a write of the state at 0x0e.

### Toons: still open

- **The first step's own changes.** Within a step the parts' own code runs before the goal: the run loop calls
  `0x82f2`, which calls each part's routines from the type table, at `0x8696`, and checks the goal at `0x86fb`. So in
  the first step a part could already change list (Al's and Sid's actions) or a new part be made before the goal finds
  its parts. Whether that happens in a shipped level depends on what the parts do, which isn't read; the Lab says the
  order as the run starts.
- **A step's time** in Toons isn't read, so the countdown is said in steps, not seconds.
