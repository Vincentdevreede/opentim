# Frames, outlines and resets

## Outlines

Many parts build their own outline in their reset: the shape other parts bounce off. The part's outline pointer at
`0x82` (the layout's `outlinePoints`) leads to a list of four-byte records, an X byte, a Y byte and an edge word the
shared geometry helper works out from the corners. The descriptions used to read writes through that pointer as fields
of another part, so the balls' reset showed "Selects state 31 on another part" where it really writes corner 4's Y.

Writes through the outline pointer now become one line per routine path, "Sets its outline to 8 corners: (8, 0),
(23, 0), ..." when a path writes every corner from the first, and "Moves its outline corner 2 x to ..." when it writes
only some. A size field in a corner reads as that size, and adding 255 to it in a byte reads as the size minus 1. In
Even More:

- the bowling ball, basketball and gear: an octagon from (8, 0) to (0, 8) in a 32 by 32 box;
- the cannonball, super ball and pool ball: an octagon in a 23 by 23 box; the baseball and tennis ball: in a 15 by 15 box;
- the walls and the grass floor: a rectangle from (0, 0) to their frame width and height minus 1, which their resize
  moves when the size changes;
- the conveyor belt and mouse motor: a rectangle as large as their frame;
- the birdcage (12 corners), the bucket (6), the fish bowl (3), the generator and the jack-in-the-box (4).

Writes through another part's outline pointer read the same way, for "another part's" outline. The jack-in-the-box
does that to a part it reaches (`0x1b888` in Even More): it sets that part's outline to the 3 corners (8, 47),
(24, 44) and (39, 47), the same 3 corners the fish bowl's bounce gives its own outline.

The curved pipe wall and the electric switch copy their corners from tables in the data segment, chosen by their
frame, in a loop through a copy of the outline pointer kept on the stack (`behaviour-outline-tables.ts`). The reader
recognises that loop in both compiler forms (TIM 1 reloads `bx` before the second byte), follows every path from the
entry to it to find which frame tests pick which table, and reads the tables' bytes. It gives up when a path does
anything else, or when any instruction it read writes into a table by its address; the tables are then assumed to keep
the bytes the program ships with. In Even More (`0x1c83e` and `0x1a64a`) and TIM 1 the curved pipe wall gets one
8-corner outline for each of frames 0, 1 and 2 and one for any other frame (its four turns), and the switch a thin
4-corner lever, at (8, 8) to (15, 9) on a frame below 4 and at (8, 23) to (15, 24) from frame 4 on.

Most other parts copy their outline from tables too, in loops that reader doesn't match: the bellows, dynamite plunger
and scissors pick a table from a list by their frame and use a second list when flipped left to right, the cat,
cannon, gun and others pick one of two tables by that flip alone, the teeter-totter chooses between three tables
inside the loop by its frame, and the balloon, heart and shamrock copy one fixed table. For those,
`behaviour-outline-run.ts` runs the reset on a small 16-bit processor, once for every frame the part list gives the
part and for every value of the drawing flag bits the reset tests, and records what it writes through the outline
pointer. A run gives up at an instruction it doesn't know, a read of a part field other than the frame, the outline
pointer and a tested flag, a write to the data segment, or a call before the outline is set, and the copy only counts
when every corner byte was read from the data segment. In Even More each copy has as many corners as the type table's
outline point count (`0x1e`) makes room for. This finds 28 more parts in Even More and 20 in TIM 1. The lab draws
the table for the frame and flip shown.

The wood incline has no frame list, since the program draws it, so its reset is run for the frames [decided assumption
21](../../assumptions/behaviour-assumptions.md#21-the-wood-inclines-starting-frame) gives it, the ones its width picks. Its reset
(`0x1b7d1` in Even More, English floppy) picks a table from the list at `0x2f06` by its frame, or from the list at
`0x2f2e` when it is flipped left to right, and copies 4 corners. On frames 0 to 3 (widths 16 to 64) the outline is a
slab 16 pixels thick as wide as the incline, from its top left down to its bottom right: (0, 0), (w − 1, 15),
(w − 1, 31), (0, 16) for a width w, and mirrored when flipped. Frame -1, which an incline of width 0 has in two Even
More levels, is left out: a list indexed by it gives the word before the list, which points at no table the program
ships (`0x1000` and `0x1f00`). A part the program draws gets no other outline this way: the other ones with decided
frames write their corners as numbers or don't read their frame. The game loads such a part's frame N from sprite N
of its one sheet (the frame sizes the analysis reads from the sheet), so the lab draws the incline's outline on the
sprite shown.

The parts whose type has no outline points (the pulley, belt, rope, rope end, eye hook, light bulb, magnifying glass,
solar panel, explosion and Mel's house) have no outline to read.

## Parts whose run keeps everything

Most simple parts share one empty run routine (`0x29f` in Even More: it only sets up and restores `bp`), and the same
for their bounce, flip, resize and rope callbacks. Its only rule keeps the frame and writes nothing, so the description
lists each of the part's frames (up to 32) as a resting frame: a walk from any of them rests at once. Nothing is
assumed about which frame a level saves. A run that keeps the frame only under a test, or writes other fields, still
gets its resting frames from its rules as before.

In Even More this gives frame 0 as the resting frame of 16 parts with one frame: the bowling ball, basketball, rope,
birdcage, bucket, eye hook, baseball, jack-o-lantern, heart, Christmas tree, cannonball, tennis ball, cheese, thumb tack,
pool ball and shamrock (11 of them in TIM 1). Their reset keeps the frame the level saved, and with
[the decided assumption on parts with one frame](../../assumptions/behaviour-assumptions.md#13-parts-with-one-frame) that is frame 0, so
their reset is now known too. The walls, floors, pulley, belt, rope end, super ball and curved pipe wall
share the empty run too, but the program draws them its own way, so they have no frame list to count and stay without
one.

## Resets that set the frame from the sockets

The resets of the electric switch, the generator and the solar panel set the frame from the link slots at `0x62` and
`0x64`, where the editor plugs plugs in. They used to be described only as "the frame depends on fields the reset
doesn't fix". Addresses below are from Even More, English floppy.

- The switch's reset (`0x1a64a`) keeps bit 2 of its frame (the lever) and sets bit 0 when the word at `0x62` isn't 0
  and bit 1 when the word at `0x64` isn't 0. It also picks the lever's outline by whether the frame is at least 4.
- The generator's reset (`0x1aeb3`) keeps bits 0 and 1 (the phase its run turns round) and sets bit 2 and bit 3 the
  same way.
- The solar panel's reset (`0x1ce45`) keeps nothing: its frame is 0, plus 1 for `0x62` and 2 for `0x64`.

The level reset (`0x892b`) copies the saved state `0x90` into the frame (`0x89c6`), calls the part's reset
(`0x8a93`) and saves the frame it leaves back into `0x90` (`0x8a9c`). It doesn't touch `0x62` or `0x64`. The level
loader reads the saved state into `0x90` (`0x136af`) and, from file version 0x101 on, the two plugged parts into
`0x62` and `0x64` (`0x13941`). In the editor, plugging a plug in (`0x5d14`) takes `0x62` when it is free and `0x64`
otherwise, calls the reset of the part it leaves and of the part it joins, and saves their frames into `0x90`
(`0x5de4`, `0x5e25`). The switch's flip (`0x1a6ed`) sets the frame to 4 below frame 4 and to 0 otherwise, saves that
into `0x90` (`0x1a709`) and only then calls the reset, so a level saved after a flip keeps 0 or 4 even when a plug is
in. The generator and the solar panel have the shared empty flip.

When every path of a reset writes the frame as some bits of the frame it starts from with other bits set, and every
frame such a path can give is one the part has, the description now says which bits are kept, which test sets each
other bit, and the frames it can leave (`rest.frames`). For these three parts that is every frame they have: 0 to 7,
0 to 15 and 0 to 3. Which one depends on the saved frame and on the plugs, which TIM.EXE alone doesn't give. The
starting fields of the walks don't change, and every walk of these parts still ends. A write of the saved state is
now described as the state the next level reset starts from, so the switch's flip says it saves 0 or 4.

Shipped levels show that the starting frame isn't always the saved one. In Even More, a switch saved on frame 0 with a
plug in `0x62` starts on frame 1, one saved on 4 with a plug starts on 5, and a generator saved on 0 with a plug
starts on 4.

## Starting frames from decided assumptions

Three decided assumptions give more parts their starting frames
([13](../../assumptions/behaviour-assumptions.md#13-parts-with-one-frame), [14](../../assumptions/behaviour-assumptions.md#14-parts-the-game-draws-itself)
and [15](../../assumptions/behaviour-assumptions.md#15-the-generators-starting-frame)). When the reset keeps the frame the level saved,
the reset now lists the frames it can start on (`rest.frames`): the part's own frames, or the ones the assumption gives
a part the game draws itself (the pulley and the curved pipe wall on 0 to 3). When that is one frame, the reset is
known: the one-frame parts, the walls, the grass floor and the super ball start on frame 0, and a part whose run keeps
everything rests there. The generator's reset keeps bits 0 and 1 of the saved frame, which are 0, so it leaves frame 0,
4, 8 or 12, and its walks start on those. The table of these frames is `LEVEL_FRAMES` in
`behaviour-saved-frames.ts`; an entry with `framed` narrows a part that has a frame list.

## Resets the level gives

A reset whose paths are all read and keep the frame the level saved used to count as unresolved. That is what the
game does: the level gives the frame. The reset now has status `saved` in that case, with the frames it can be
(`rest.frames`) when they are known: the part's own frames up to 32, or the ones in `LEVEL_FRAMES`. A part without a
frame list and without a decided assumption (the wood incline, the belt, the rope end and the pinball bumper) keeps
the status with no frames listed, and its uncertainty says why.

A reset that sets bits of the frame by whether its words at `0x62` and `0x64` are 0, as the electric switch, the
generator and the solar panel do, has status `sockets`. Those two words are where the part's plugs are (see the
section above): the level loader fills them and the editor's plug code takes `0x62` first. The description now says
"when a plug is in its first socket (+0x62)" instead of naming the word. Only a reset whose varying bits are all
decided by those two words gets this status; any other field keeps it unresolved.

So `unresolved` only remains where a reset path can't be read, or where its frame depends on another field. The
comparison counts only those as unresolved resets and counts the other two as resets the level gives. In Even More
that is 0 unresolved and 41 given by the level (38 saved, 3 from sockets); in TIM 1, 0 and 36. The lab doesn't show
the reset's status, so it needed no change.

## Resting frames from the walks

A part's resting frames used to come only from its run outcomes: a rule whose next frame is known and whose walk rests
after one more run. Many parts never get one that way, because the frame they stay on is reached over several runs.
The walks prove more: a walk rests when one more run leaves its frame and every field it knows as they were, under the
tests on its way. A walk that holds a frame it doesn't know proves the same for each frame its rules keep.
`stableStates` now also lists each frame a walk rests on that the run outcomes don't give, once per frame, with the
fields every walk resting there agrees on, the number of resting walk branches (`walks`) and the conditions on the way
of the first eight. No walk starts from these frames: the walks already reach them.

In Even More, 28 of the 33 parts without a resting frame now have one (24 of 28 in TIM 1). The rest have none for a
reason: the wood incline and the belt (and in TIM 1 the rope) rest on any frame they are on, but they have no frame
list to name it from; the mouse motor, Mel's house and the alligator never rest in any walk, their walks only loop or
join another branch.

## Starting frames in the shipped levels

No recording shows 28 part types of Even More and 22 of TIM 1 (walls, balls, rope, pulley, belt, electric switch,
solar panel, magnifying glass, rope end, the holiday parts and others), so the shipped levels are the only check of
where they start. `checkLevelFrames` (`level-frame-check.ts`) compares every saved frame with the frames the
description allows: those a decided assumption gives (`LEVEL_FRAMES`), or else the part's own frames
([assumption 13](../../assumptions/behaviour-assumptions.md#13-parts-with-one-frame)). It also checks the decided control values
([assumption 9](../../assumptions/behaviour-assumptions.md#9-control-values)) and notes a start frame that isn't one of the part's
resting frames. `pnpm --filter @opentim/content check-level-frames` runs it over game folders and fails on a frame or
control value the description doesn't allow.

Over all eleven builds (1,281 level files, every one read, board and bin parts alike) no level disagrees:

- The walls, the grass floor, the super ball and every part with one frame are saved on frame 0; the pulley and the
  curved pipe wall on 0 to 3. That is what the reset gives them, and their resting frame.
- The electric switch is saved on 0, 1, 3, 4 or 5 and the solar panel on 0 or 1. Worked out with the plugs the level
  gives, the reset leaves every switch and panel on one of its resting frames. A few switches (2 or 3 per build) are
  saved without the bit of a plug they have, as the flip saves its frame before the reset (see
  [resets that set the frame from the sockets](#resets-that-set-the-frame-from-the-sockets)).
- The belt is always saved on frame 0, the rope in TIM 1 (no frame list there) on 0, the pinball bumper on 0. The rope
  end, the heart and the shamrock are in no shipped level; the jack-o-lantern and the Christmas tree are in one level
  each (two builds), on frame 0.
- The wood incline has no frame list. Every shipped incline has the frame its resize gives, its width divided by 16
  less 1 (`0x1b82f` in Even More, English floppy): 0 to 3. Two inclines fit the same rule but not the editor: in
  "Ambulance Driver" (L117) and "Rocket Launcher" (L143) of the five full Even More builds, an incline has width 0 and
  frame -1. The editor keeps the width between 16 and 64 (the type record's limits), so these were made another way,
  and their reset reads its outline from the word before its table. The user decided on 2026-11-06 that an incline
  starts on the frame its width gives
  ([decided assumption 21](../../assumptions/behaviour-assumptions.md#21-the-wood-inclines-starting-frame)): `LEVEL_FRAMES` lists frames
  -1 to 3 with the rule, the incline's rest says so, and the check now also compares each incline's frame with the one
  its width gives (`fromWidth`). The walks can't tie the frame to the width, so they start from the five frames.
- The decided starting frames still hold everywhere: the conveyor belt on 0, 7, 14, 21 or 28, each the frame its
  width gives; the gear and the electric motor on 0; the mouse motor on 0 or 1; the generator on 0 or 4. Every level
  saves every control value as 0.
- Only Mel Schlemming starts on a frame that isn't one of his resting frames: he is saved on frame 0 and walks from
  there.

What the code leaves open for these parts, and for effects of other parts no recording covers, is now a list of things
to try in the game: [behaviour-game-checks.md](../../plans/behaviour-game-checks.md).

## Walk notes that name the frame and the test

Two notes were left vague. "The seed does not establish the state. No state zero is assumed." (34 parts in Even More)
comes from a walk whose starting frame isn't known, mostly because the reset keeps the frame the level saved. Every
one of these walks goes on from each frame the part can be on, so the note now says which: "The frame it starts on
isn't known, so the walk follows each frame it can be: frames 0 to 18." When only some bits are known it names those
bits, and when the walk can't follow the frames it says why (no frame list, more than 32 frames, no branch depth left,
or tests that leave no frame).

"The unknown condition selects different next fields, so no branch is chosen." (15 parts) comes from a step where the
rules that apply set different fields and a test the walk doesn't know decides between them. The walk does follow
each way. The note now names the tests, with a test and its opposite said once: for example "At frame 9, the rules
that apply set different fields, and which one does depends on whether the counter at +0x9c is 0, which the walk
doesn't know, so each way is followed." Fields go by their plain or layout name, or their offset, and other objects
by how the part reaches them (the part linked at `+0x54`, the part a search found, its fields when the walk started).
At most four tests are named. Neither old wording is left.

## All input cases

The description used to keep at most 64 conditional input cases per part, and the jack-in-the-box and the monkey bike
went past that. The rest weren't repeats: without the bound the jack-in-the-box has 156 cases with 89 different walks
(39 before) and the monkey bike 154 with 60 (30 before), in Even More and in TIM 1 alike. The list is finite on its
own: the cases come from the run's tests and from the plain numbers the writers found, and each input is expanded at
most 64 times. So every case is now kept, with a safety bound of 1024 that no part reaches; a part past it would still
keep the note that more cases remain. The descriptions grow by about a tenth and take about a tenth longer, and the
recordings compare the same.

## The gear's frame -1

One gear note read "At frame 65535, the next state depends on...". A gear never reaches that frame. Its run adds the
control value at `0x12` to its frame and wraps -1 to 3 and 4 to 0, and the advancement of connected gears does the
same (see [connected gear traversals](gears.md#connected-gear-traversals)); the reset keeps the saved frame, which a level
gives as 0 to 3 ([the decided assumption](../../assumptions/behaviour-assumptions.md#6-the-gears-starting-frame)), and creation sets 0. So a run always starts on 0 to 3. The run's rules still test for -1 and 4, because the code tests the frame after
it adds the control value. The input cases turned the test "the frame is -1" into a case that starts on frame -1,
and that case gave the note.

The rules were read right; the case was not one the game can be in. An input case now has to allow a frame the part
can be on in the middle of a run: one of its own frames, or for a part the program draws itself, the frames its decided
assumption gives (as the walks already use). The gear loses its cases on frames -1 and 4, and no walk stands on frame
65535 any more. The cases that test the frame after adding the control value against 65535 stay: that test is real.
The recordings compare the same.

## Where a part is drawn and how large its frame is

After a routine changes a part's frame, it calls two shared helpers (`0x68aa` and `0x6940` in Even More, English
floppy, `0x5c15` and `0x5ca8` in TIM 1, French). The first sets `drawX` and `drawY` (`0x2a`, `0x2c`) and calls the
second, which sets `frameWidth` and `frameHeight` (`0x44`, `0x46`). Most run and callback rules end with them, and
their writes used to be unknown. The code shows what they compute:

- The belt and the rope (types 8 and 10) get a size of 0 by 0.
- A part with `0x40` set in its flags at `0x06` gets the size it keeps itself, `baseWidth` and `baseHeight` (`0x50`,
  `0x52`).
- Otherwise the word at `+0x1a` of the type record, when it is not 0, points to a list of sizes, four bytes for each
  frame. When it is 0, the word at `+0x14` points to a list with a pointer for each frame, to a record with the width at
  `+6` and the height at `+8`. When that is 0 too, the size is 0 by 0.
- `drawX` starts at `positionX` (`0x1e`). When the word at `+0x18` of the type record is not 0, it points to two signed
  bytes for each frame, the frame's offset. A mirrored part (`0x10` in the drawing flags at `0x08`) is drawn at
  `positionX` plus `horizontalExtent` (`0x40`) less the offset and less the frame's width, any other part at
  `positionX` plus the offset. `drawY` is the same with `positionY`, `verticalExtent`, the flag `0x20` and the height.

The analysis reads each helper the way it reads a callback, with a far pointer kept on the stack and a word read from a
table both read as table reads, like the code does. Every return path must be plain: its tests are equalities of the
part's fields and table words, and its writes are values of those. A field's value is then the sum over the paths of
the path's value times the 0 or 1 of its tests, with a test that every path makes taken out in front. Exactly one
path's tests hold, so the value is exact, and a caller gets it in place of an unknown write. When two paths of a rule
differ only in one test and give a drawing field different values, the rule keeps both values the same way instead of
an unknown one, like any other field (see [Values two paths set differently](helpers.md#values-two-paths-set-differently)).

A part's own rules run on a part of its type, so for each part the type field becomes its type and the words at
`+0x18` and `+0x1a` of its type record become the words in the program, under the type table assumption of
[effects of other parts](other-parts.md#effects-of-other-parts). The word at `+0x14` is not taken from the program, since the program
sets it while a level runs: it stores it when it loads a sheet (`0x107dc` in Even More, English floppy) and clears it
again (`0x1084c`). The cat has no size list, so its frame's size stays a read of that list at run time.

Both helpers are proved in all eleven builds, in every compiler form they have: TIM 1 reads the type table in the data
segment, Even More through a far pointer, and the Even More CD loads that pointer again instead of sharing the ends of
paths. Transitions with unknown writes went from 462 to 365 in Even More, English floppy, and from 402 to 324 in TIM 1,
French. Transitions with an unknown drawing write went from 313 to 70 and from 272 to 12; the rest come from other
values on the same path, like the cat's position after its search loop. Every walk ends the same way and no recorded
animation changes; the monkey bike's walk from its creation rests after one run instead of two, since its drawing
position now stays known. A periodic walk leaves out the drawing fields no rule reads, since their values depend on
the frame.

## Parts a part makes

The balloon, cannon, gun and dynamite plunger make a part with the part factory (`0x15d9b` in Even More, English
floppy; `0x145d7` in TIM 1, French). The factory takes the type as its one argument, stores it as the new part's type
word (`mov [si+0x04], di`) and calls that type's constructor. Each of the four pushes a number right before its call,
so the type is that number:

| Part             | Call (Even More) | Pushes | Makes      |
| ---------------- | ---------------- | -----: | ---------- |
| balloon          | `0x192d3`        | `0x31` | rope end   |
| cannon           | `0x19ba8`        | `0x2b` | cannonball |
| gun              | `0x1b3a1`        | `0x14` | bullet     |
| dynamite plunger | `0x1c3c1`        | `0x29` | explosion  |

Part 43 keeps its id `pinball`, since ids never change once published, but in TIM 1 and Even More it is the cannonball
the cannon fires, so the descriptions call it that. Only the behaviour descriptions do: the user decided on 2026-11-06
that the Lab keeps showing "Pinball" as the part's name.

Helpers make parts the same way: an explosion at `0x1a432`, and in the other builds the scissors' rope cut makes two rope ends and a rope (types `0x31` and `0x0a`). The reader takes the type only from `mov` of a number into a
register and `push` of that register, or a `push` of a number, right before the far call, with nothing jumping to the
push or the call, and only for a factory whose own store of its argument as the type word it has proved
(`createdParts` in the report). The other factory calls in both builds pass a type they read, and get no type.

The effect lines used to give one line per field ("Sets field 0x1e of the object it creates at 0x1b3a1"). Now each
way through the routine that leaves fields on the new part gives one line, with the fields that way leaves on it, the
frame the type's constructor starts it on when the creation defaults know it, and the other fields it sets by name.
The gun, when not flipped: "Creates a bullet (type 20) at positionX = its positionX + 36 and positionY = its positionY

- 3, moving at velocityX = 12288 and the bullet's starting velocityY (each kept within the bullet's speed limit). It
  also sets previousX to its positionX + 12, previousY to its positionY + 3, ...". Flipped, the bullet starts at
  positionX - 32 and moves at -12288. The cannon's cannonball starts at positionX + 97 (flipped - 48) and positionY - 7,
  moving at 12288 (or -12288) and -4096. The plunger's explosion starts at its positionX - 16 (flipped + 80) and its
  positionY. The balloon's rope end starts at the end point its rope record keeps for the balloon's end of the rope, and
  takes over the balloon's rope links at `0x5a` and `0x66`.

The speeds go through the speed limit at `0x37bc`, which keeps each speed within the limit in the new part's type
record (see [The speed limit](#the-speed-limit)); the line gives the speed the routine stored before that limit. The
list insertion at `0x629d` links the new part between neighbours it picks while the game runs ("links it into a list
of parts")); the rules name those neighbours (see [Parts linked into an ordered list](helpers.md#parts-linked-into-an-ordered-list)).

## The type record words the game writes

Lines about other parts read words of a type record from TIM.EXE, like the mass at `+0x02` that picks the explosion's
speed class, under the assumption that a type record keeps its words while a level runs. Three words don't, so they
are never read from the program, and the assumption says so:

- **The frame list at `+0x14`.** The game stores a part's frame list there when it loads the part's pictures and
  clears it when it frees them (`0x107dc` and `0x1084c` in Even More English floppy, `0xfcda` and `0xfd38` in TIM 1
  French).
- **The acceleration at `+0x08` and the speed limit at `+0x0a`.** Both are 0 in the program for every type. The
  routine at `0x369c` (Even More, English floppy; `0x2af1` in TIM 1, French, where the table sits in the data
  segment) works them out for every type: the acceleration from the type's density, the air pressure (`[0x4cb7]`) and
  the gravity (`[0x4cb9]`), and the speed limit as `0x3000` (12288) for the bullet (type 20) and the cannonball (type 43) and as `0x2600` minus a value of the air pressure for every other type: `9728 - (air >> 1)` when the air
  pressure is below 70, else `9728 - (air << 4)`. The level loader calls it right after it reads the air pressure and
  the gravity (`0x13b46`), and so do `0x12593`, right after it stores a new air pressure, and `0x15d90`. In the Even More
  builds no other store reaches those words (the other `es:` stores to `+0x08` and `+0x0a`, at `0x7193` to `0x71f2`,
  go to a block the game allocates); in TIM 1 the table sits in the data segment, where a store to it doesn't show by
  its form. Leaving the words out holds either way.

No line or walk read `+0x08` or `+0x0a` in the recorded builds before the speed limit below, so nothing else changes.

## The speed limit

The routine at `0x37bc` (Even More, English floppy) keeps a part's speeds within its type's speed limit, vertical
first: a speed above the limit becomes the limit, else a speed below minus the limit becomes minus the limit, else it
stays. Its matcher gives two writes per speed, each with its test, and a caller used to call the field unknown
("Conditional contact-velocity-limit effect"). The two tests for a speed never both hold, so the new speed is now one
exact value: `limit if speed > limit, else -limit if speed < -limit, else speed`, signed, built with `choose` from the
speed the caller holds and the limit word `+0x0a` of the part's type record. `speedLimitOf` gives the speed and the
limit back.

This names the speeds of the touching part that the trampoline and the alligator write, the rocket's own speeds and
the speeds of the bullet and the cannonball the gun and the cannon make. The limit is a word the game works out from the
level's air pressure (see above), so for a part whose type the rule knows it is that type's limit; for the bullet and
the cannonball it is 12288, no less than any speed the gun and the cannon set, so those speeds stay as set. Rules with
unknown writes go from 33 to 25 of 925 in Even More, English floppy, and from 28 to 23 of 764 in TIM 1, French; every
walk still ends and the recordings stay at 606 complete, 42 prefix, 0 different and 512, 40, 0.

## Frame sizes from the part's sheet

A part without a size of its own or a list of sizes in its type record gets its frame's size from the list at `+0x14`
of its type record. The program shows what that list holds (Even More, English floppy; TIM 1, French in brackets):

- The routine at `0x10770` (`0xfc73`) loads one part's pictures. It builds the name from `part`, the type number in
  base 10 and `.bmp`, calls the sheet loader `0x2658:0x067c` (`0x24dc:0x067d`) with it and stores what the loader
  returns at `+0x14` of the type record (`0x107dc`, `0xfcda`).
- The loader opens the sheet. When it has a `BMP:SCN:` chunk, the loader's reader `0x1ee5:0x630c` (`0x1c71:0x728d`)
  finds `BMP:INF:`, reads its frame count and makes a list of a word for each frame and a 0 after the last one, each
  word pointing to a ten-byte record. It reads the widths and then the heights and stores frame n's width at `+6` and
  its height at `+8` of record n, as the words they are. Only when the chunk is shorter than four bytes for each frame
  does every frame get the first width and height.
- The loader then marks each record's packing at `+4` (`0x2658:0x09be`), reads the pixels into a block of its own and
  stores where each frame's pixels start at `+0` and `+2`, and counts the list (`0x2658:0x09ea`). An `RLE:` or `SCL:`
  chunk would make it go over the list again; no part sheet has one. When anything fails, it frees the list and
  returns 0.
- The frame size helper reads the list word `L`, and when it isn't 0, the width at `+6` and the height at `+8` of the
  record that `L + 2·frame` points to.

So each frame of such a part is as wide and high as the same frame of its sheet, `PART` and the type number. The analysis matches the routine
that stores the list, the loader, the reader and the two routines the loader hands the list to against their complete
compiler forms, which are two for the store (TIM 1 in the data segment, Even More through `es`), two for the loader
(the Even More CD picks between two allocators for the pixels) and one for the reader, in all eleven builds. Their
strings must be `part`, `.bmp` and the chunk names. The sizes come from the `INF:` chunk the way the reader takes
them; for every part sheet of the eleven builds they are the sizes the resource reader's `decodeImage` gives.

`readProgramParts` takes the sheets' files as an optional fourth argument and keeps the sizes by type. A frame size
read then becomes the sheet's number when the frame is a number. When the frame is a value of the part, like the
frame after this one, it becomes the sheet's sizes selected by that value; for a frame the sheet doesn't have, where
the game reads past the end of the list, the read stays. The test that the list isn't 0 becomes true. These values
state the assumption that the list is the one the game built from the build's `PARTn.BMP` when it loaded the part's
pictures, and that nothing changes its sizes while a level runs.

In Even More, English floppy, 522 of the 1,296 drawing writes of transitions read the list, for 11 parts like the cat,
balloon, teeter-totter and mouse; all of them now use the sheet, and 328 no longer read the list at all (the others
keep the read for a frame past the sheet). In TIM 1, French, it is 640 of 1,122, for 11 parts, and 394. These reads
were never unknown, so transitions with unknown writes stay at 365 and 324, every walk ends as before and no recorded
animation changes; a walk now has numbers for these fields where it knows the frame.

What the size helper reads for a frame the sheet doesn't have (`0x6940`, Even More English floppy): it takes the
frame's entry of the list, `list[frame]`, with no test of the frame or of the entry, and reads the width and height at
that entry plus 6 and plus 8. The list ends with a 0 entry after its last frame. So the frame just past the last one
reads `DS:0x0006` and `DS:0x0008`, which in both recorded builds hold bytes of the compiler's copyright string at the
start of the data segment ("Borland C++ ..."): a width of 27762 and a height of 28257, as long as nothing writes
there. A frame further on reads past the list into memory filled while the game runs. The analysis keeps both cases
unknown: no walk puts a part on a frame its sheet doesn't have, so neither size is ever needed.
