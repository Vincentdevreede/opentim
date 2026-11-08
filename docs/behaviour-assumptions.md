# Decided assumptions

The behaviour analysis reads `TIM.EXE` without running it. In a few places the code alone can't settle a question, so
we decided to assume an answer and go on. This page lists those decisions, so they can be rechecked later. The other
assumptions the analysis states are general ones about the compiler and memory; this page is only about the choices
made during the research.

Each assumption is written here exactly as the analysis states it on every finding that uses it, so a finding can be
traced back to this page. A test (`packages/content/tests/behaviour-assumptions.test.ts`) fails when the wording in the
code and on this page drift apart.

Every other assumption the analysis states is in [the generated list](behaviour-assumptions-all.md), with how many
findings and which parts use it. Run `pnpm --filter @opentim/content list-assumptions --check` with the game folders
after changing the analysis: it fails when a new assumption appears that isn't listed yet, so it can be added there or,
when it is a real decision, here.

If an assumption turns out to be wrong, the findings that state it can be wrong too. Removing it from the code makes
those findings unresolved again, which is safe.

## 1. Ropes

Decided on 2026-11-04 and narrowed on 2026-11-05. In the code: `ROPE_ASSUMPTIONS` in
`packages/content/src/read/behaviour-rope-dispatch.ts`. Explained in
[the rope connection query](behaviour.md#the-rope-connection-query).

**The question.** When a rope moves, the game asks the part at the other end of the rope what to do. That part can
pass the question on along its own ropes. The analysis can't see which parts are tied together, so it can't tell
whether the question might come back and change the part that asked.

**What we assume.**

- A rope end's slot number is one of the part's two rope links, so indexing the links at `0x66` by it reaches a rope
  record.

**Dropped on 2026-11-05.** Two more bullets were assumed at first: "A rope ties two different parts, so the part at the
other end of a rope is never the part that asks" and "Ropes between parts never form a loop, so a chain of questions
along ropes never comes back to the part that asked". The second is wrong. The user built a ring of teeter-totters
tied with ropes in the game on 2026-11-05: it works, and it locks every teeter-totter in the ring, because the pull
down is blocked by the pull up. The code agrees (Even More, English floppy):

- The query (`0x1d638`) finds each rope's far end (`0x7b11`) and only skips the part the question came from (the
  compare at `0x1d67a`). So two ropes between the same two parts don't bring the question back, but a ring of three or
  more teeter-totters does.
- Nothing marks a part as asked: flag `0x200` is set only after the nested query returns (`0x1d613`).
- When the question comes back, the asking part's own rope callback (`0x1d52d`) runs on it and writes its control
  value at `0x12` (`0x1d5d6`) and its flags at `0x08` (`0x1d60a`, `0x1d613`).

The first bullet isn't needed any more either: a rope from a part to itself would be the same as a question that comes
back, which the analysis now allows for.

**What the analysis does instead.** A question that comes back runs the asking part's own rope callback on it. The
query is called only by the teeter-totter's run (`0x1d2af`, `0x1d2d1`) and its rope callback (`0x1d5ef`), each with its
own part as the part that asks. The reader checks this in every build: every routine that calls the query is one the
type table names directly and nothing else calls, so the part that asks is of a type that names it. Only that type's
rope callback can then change the asking part, and only in the fields it writes on its own part. For the teeter-totter
those are `0x12` and `0x08` in all eleven builds, so a teeter-totter that asks forgets those two after the query and
keeps the rest. Other parts still forget every field any rope callback writes. If the check fails, the asking part
forgets every one of those fields too.

**What it gives.** A part that asks along its ropes keeps its own fields, except those its own rope callback writes.
Used by the teeter-totter. Its control value after it asks for real (`0x1d2d1`) is one value of that run, which its
run adds to its frame (`0x1d2da`). The walks branch on it with the decided control values (assumption 9) and leave out
a tilt past an end (assumption 10). With that, every walk of the teeter-totter ends in each of its branches again, in
Even More and in TIM 1 alike, and no recording comparison changed (440 complete in Even More, 388 in TIM 1, none
different).

**How to recheck.**

- In `TIM.EXE`, find the code that attaches a rope to a part and check it only ever stores slot 0 or 1. The editor's
  tie picks slot 0 or 1 (`0x515d`); the level loader (`0x138a9`) takes the slots from the file without a check.
- Check that the query's only callers are still the teeter-totter's run and rope callback, and what that callback
  writes on its own part.

**Rechecked on 2026-11-05** in all eleven builds (9 different programs). The editor never ties a rope to one part
twice (`0x10f98`), and every slot writer stores 0 or 1. Shipped levels have no rope from a part to itself, no slot
above 1 and no loop of ropes. A level file made outside the game could still break the remaining bullet.

## 2. The scissors' rope cut and the part copy

Decided on 2026-11-04. In the code: `ROPE_CUT_ASSUMPTIONS` in `packages/content/src/read/behaviour-rope-cut.ts`.
Explained in [the scissors' rope cut](behaviour.md#the-scissors-rope-cut).

**The question.** When the scissors cut a rope, the game makes new rope pieces. The analysis can't see where in memory
the game puts them, so it feared they might overwrite an existing part, like the scissors themselves, and then lost
track of which frame the scissors were on.

**What we assume.**

- A new rope piece the part factory makes gets fresh memory: it never overlaps an existing part, a rope record or
  other storage, and releasing a piece that was never linked changes nothing else.
- A rope end's slot number, in bytes `0x0a` and `0x0b` of its rope record, is 0 or 1: one of the part's two rope
  links.
- Rope, belt and pulley records are allocations of their own, reached only through a part's link fields at `0x54`,
  `0x66` and `0x68`; they never overlap a part.
- The parts list and a pulley chain each end: a finite chain without cycles. The fields written are the same on every
  pass.

The first one is the decision made here. The second is the rope slot assumption above, said for the rope record. The
last two were already used for the rope and belt helpers before.

**What it gives.** The scissors keep their frame after a cut. In each recorded build 4 more recorded animations now
match completely, 14 more walks end and 11 more end in every branch.

**How to recheck.**

- Read the part factory at `0x15d9b` (Even More, English floppy) and the memory allocator it calls, and check that
  the allocator only hands out blocks that are free.
- Check that a piece released on the failure path was never put on a list.
- The slot check is the same as for ropes above.
- Check the heap check wrapper at `0x903c` around allocating and freeing, and that the cut makes all three pieces
  before it puts any of them on a list (`0x1cb4c`, `0x1cb5f`, `0x1cb7a`, then `0x1cb97`).

**Rechecked on 2026-11-05** in all eleven builds. The factory allocates through `0xc7b7`, `0xd4a1` (zero filled) and
`0xd607`, the C library's near heap, and the game stops if a heap check finds the heap broken. A failed piece is freed
before it is put on any list. Not proved: that the library's allocator only hands out free blocks. The new rope
record's slots are 0 (`0x1cc02`) or copied from an existing one (`0x1cc0f`, `0x1cc70`). A level file with a slot above
1 would make the loader write into other fields of the part, or past it, so this assumption also leans on the slot one
for files made outside the game.

### The part copy

Extended on 2026-11-05 to the part copy. In the code: `PART_COPY_ASSUMPTIONS` in
`packages/content/src/read/behaviour-part-copy.ts`. Explained in [the explosion's wall split](behaviour.md#the-explosions-wall-split).

**The question.** When the explosion splits a brick or wood wall, the game copies the wall with the part copy at
`0x66aa` (Even More, English floppy). The copy allocates the new part and, for a belt, a rope or a part with an
outline, a record of its own, from the same allocator as the part factory. The analysis couldn't tell whether that new
memory overlaps the explosion, so it lost the explosion's frame.

**What we assume.**

- A part copy gets fresh memory, and so do the belt, rope and outline records it makes for the copy: none of it
  overlaps an existing part, a rope, belt or pulley record or other storage.
- Releasing a copy that was never linked, after one of its allocations failed, frees only the copy and the records it
  made for it, and changes nothing else.

This is the first assumption above, said for the part copy instead of the part factory.

**What the code shows** (Even More, English floppy):

- The copy allocates 0xa2 bytes, the size of a part, through `0xc7b7` (then `0xd4a1`, zero filled, and `0xd607`),
  the allocator the part factory at `0x15d9b` uses. Then it copies the source part's fields, among them the shown frame
  (`0x66f2`), the saved frame (`0x6802`) and the saved control value (`0x680a`). It only reads the source part.
- It allocates a belt record for type 8 (`0x673b`), a rope record for types 10 and 7 (`0x6771`) and an outline buffer
  of 4 bytes per outline point (`0x67be`), each from the same allocator, and writes only into the copy and those
  records. The outline loop at `0x67f5` copies as many points as the buffer holds.
- When an allocation fails, it calls the release at `0x16b94` with the copy, which frees the outline buffer, the belt
  record and the rope record when they are set, and then the copy. The copy sets them only from its own allocations,
  and the zero filled block holds zero in the others. The copy isn't on any list yet.
- The wall split at `0x1a8ae` puts the copy on the parts list (`0x629d`) and writes its position and size
  (`0x1a937` to `0x1a956`, `0x1aa16` to `0x1aa35`). It never stores the copy's address in the wall or the explosion.

**What it gives.** The explosion keeps its frame while it goes through the parts it hits. All its walks now end in
both recorded builds, and 8 more recorded animations match completely in each.

**How to recheck.**

- The checks for the part factory above hold for the copy too: it uses the same allocator.
- Check that the wall split puts the copy on a list only after every allocation succeeded (`0x1a924`, `0x1aa03`).
  The copy's only other caller, at `0x11f0d`, is in the editor and never runs from a part's callback.
- The copy's outline buffer holds as many points as the type's outline count at `+0x1e` of the type record; for brick
  and wood walls that is 4 in all eleven builds, the 4 points the wall's outline update at `0x1d8bc` writes.

## 3. The teeter-totter's search

Decided on 2026-11-04. In the code: `OUTLINE_SEARCH_ASSUMPTIONS` in
`packages/content/src/read/behaviour-outline-search.ts` and `INCLUSIVE_LIST_ASSUMPTION` in
`packages/content/src/read/behaviour-list-loops.ts`. Explained in [the outline search](behaviour.md#the-outline-search).

**The question.** The teeter-totter searches for the parts lying on it and then moves them. Unlike the other searches,
this one doesn't skip the teeter-totter itself, so in theory it could find itself and move its own position.

**What we decided.** That's fine: the analysis now says the teeter-totter's frame stays known and its position becomes
unknown. It states:

- The parts lists are finite and without cycles, and each part is on them once, so each part is put on the found list
  at most once.
- The search may list the owner itself: it does not skip it.
- The query may list the owner. The body never writes a listed part's state, so the owner keeps its state; other
  fields it writes on listed parts may be the owner's.

Only the first is a real assumption. The second describes the code, and the third is checked by the analysis: it
refuses the loop if the teeter-totter could write a listed part's state.

**What it gives.** The teeter-totter's walks go on. In each recorded build 24 fewer transitions are open and 9 more
walks end.

**How to recheck.**

- The list insertion at `0x629d` (Even More, English floppy) has no check of its own, so check every caller of it:
  each one must insert a fresh part or take the part off its list first.
- If a build turns out to skip the owner in this search, nothing breaks: the analysis only gets more careful than
  needed.

**Rechecked on 2026-11-05.** All 15 callers in Even More, English floppy, are safe: 2 take the part off first, 10
insert a part the factory just made, 2 insert a fresh copy, and the level loader inserts each loaded part once. The
other builds follow the same pattern. The search at `0x437d` really doesn't skip its owner, and its only caller is the
teeter-totter's run.

## 4. The monkey bike's starting frame

Decided on 2026-11-05, after checking the code. In the code: `MONKEY_BIKE_ASSUMPTION` in
`packages/content/src/read/behaviour-saved-frames.ts`. Explained in
[walks that split at every step](behaviour.md#walks-that-split-at-every-step).

**The question.** While the monkey bike pedals, it shows frames 5 to 12 and counts down a counter. When the counter
runs out, it goes back to frame 0 or 1. If it were on frames 5 to 12 with the counter already at 0 and a direction set,
its own code would count on past frame 12 to a frame 13 that has no picture. Could a level start it like that?

**What the code shows** (Even More, English floppy):

- A level stores each part's saved frame, at `0x90`, and its saved control value, at `0x92`: the writer at `0x13c97`
  passes those fields, not the frame the part shows while the machine runs. The loader fills the same fields.
- The reset at `0x892b` puts the saved frame back and sets the counter at `0x96` to 0. In Even More it then calls
  the part's reset callback at `+0x2a` and saves the frame the part shows into `0x90` again (`0x8a9c`); TIM 1's reset
  doesn't do that last step.
- For the monkey bike, the saved frame is only set by a level file, by the part copy at `0x66aa` (which copies the
  shown frame, the saved frame at `0x6802` and the saved control value), by the reset above, and by the plug actions
  `0x5d14` and `0x5e2f`, which call the reset callback and then save the shown frame (`0x5de4`, `0x5e25`, `0x5e9d`,
  `0x5ef1`). None of the bike's own routines writes it.
- The bike comes onto frames 5 to 12 only from its bounce at `0x1bd05`, which sets frame 5 or 9 and starts the counter
  at 28 in the same step. Its rope callback (`0x1becc`) moves it from frames 5 to 8 on to 9 to 12 (`0x1bf2f`) without
  touching the counter, but never brings it there from another frame. Its run leaves those frames when the counter
  runs out. Its reset callback doesn't change its frame.
- Every shipped level of all eleven builds saves the monkey bike on frame 0.

**What we assume.**

- The monkey bike is never on frames 5 to 12 with its counter at `0x96` at 0. In play it reaches them only from its
  bounce, which starts the counter, and leaves them when the counter runs out; a level never starts it there.

Not proved: whether an editor action can happen while the machine runs (it would save the frame shown then), and
whether a level file made outside the game holds such a frame.

**What it gives.** Walks don't start the bike there, and a branch that would put it there is left out. All 65 walks of
the monkey bike now end in each of their branches, in both recorded builds. Walks that end in every branch went from
302 to 330 in Even More and from 255 to 283 in TIM 1.

**How to recheck.**

- Find where the game stops the machine and check that it calls the reset at `0x892b` before any editing.
- Check that the editor's actions that save a part's shown frame only run while the machine is stopped.
- Check the bike's rope callback still only moves it within frames 5 to 12.
- Look at levels saved by players for a monkey bike with a saved frame from 5 to 12.

**Rechecked on 2026-11-05** in all eleven builds. The run loop calls the reset at its start and its end in every build
(Even More, English floppy: loop `0x1230`, reset `0x892b`), and the attract loop resets at its end too. In Even More,
English floppy, TIM 1 French and Even More CD, a call graph from the run loops and every part callback except reset,
flip and resize never reaches the plug actions, the save writer, the rope tie, the flip or resize actions, or the
part copy except where an explosion splits a brick or wood wall, which never copies a bike. About 70 indirect calls
stay unresolved there, mostly graphics and drivers. No other routine writes the bike's counter. Every shipped bike is
saved on frame 0 with control value 0. No levels saved by players were available to check.

## 5. The conveyor belt's starting frame

Decided on 2026-11-05, after checking the code. In the code: `CONVEYOR_BELT_ASSUMPTION` in
`packages/content/src/read/behaviour-saved-frames.ts`. Explained in
[parts drawn by their own code](behaviour.md#parts-drawn-by-their-own-code).

**The question.** The conveyor belt is drawn by its own code, so its type has no list of frames to count, and the walks
had no frames to start it on. Which frames can a level start it on?

**What the code shows** (Even More, English floppy):

- The belt's frame is a block of 7 frames per width. Its run at `0x1b640` moves the frame one step within its block,
  forward or backward by the sign of its control value, and wraps at the block's ends (`0x1b692` to `0x1b6c6`).
- The editor grows a part's width at `0x50` by 16 while it is below the type record's maximum at `+0x0c`
  (`0x11419`), and shrinks it by 16 while it is above the minimum at `+0x10` (`0x11486`). For the belt those are 96
  and 32. Then it calls the part's resize callback (`0x114d8`). Two drag resizes (`0x117b3`, `0x11925`) set the width
  from the mouse, clamp it to the same limits and call the resize callback too (`0x11856`, `0x119ac`). A width off the
  16 grid can reach up to 111 with the step resize, but the division truncates, so the block is still 0 to 4.
- The belt's resize at `0x1b6cd` sets both the shown frame at `0x0c` and the saved frame at `0x90` to
  `(width - 32) / 16 * 7`, the first frame of the block for that width. A new belt starts on frame 28.
- Every shipped level of all eleven builds saves the belt on frame 0, 7, 14, 21 or 28.

**What we assume.**

- A level starts the conveyor belt on frame 0, 7, 14, 21 or 28, the first frame of the block of 7 its width selects. The
  editor keeps the width between 32 and 96 in steps of 16, and the belt's resize sets its saved frame to the start of
  that block.

Not proved: whether an editor action can save the frame shown while the machine runs (see assumption 4), and what a
level file made outside the game holds.

**What it gives.** The belt's walks start on those five frames. All 73 of its walks now end in each of their branches,
in both recorded builds.

**How to recheck.**

- Check the width limits at `+0x0c` and `+0x10` of the belt's type record in each build.
- Check the two drag resizes and that the level loader doesn't call the resize callback, so a loaded frame comes
  straight from the file.
- Look at levels saved by players for a belt whose saved frame isn't a multiple of 7, or is above 28.

**Rechecked on 2026-11-05** in all eleven builds: the limits, the resize formula, the run's wrap and the constructor
(frame 28, control 0) are the same everywhere. The only other writers of the belt's frame are the reset, the part copy
and the loader. Every shipped belt has a width from 32 to 96 and the frame its width gives (corrected on 2026-11-07:
two in L21 have width 40, off the 16 grid; see the recheck below).

## 6. The gear's starting frame

Decided on 2026-11-05, after checking the code. In the code: `GEAR_ASSUMPTION` in
`packages/content/src/read/behaviour-saved-frames.ts`. Explained in
[parts drawn by their own code](behaviour.md#parts-drawn-by-their-own-code).

**The question.** The gear is drawn by its own code too, so the walks had no frames to start it on either.

**What the code shows** (Even More, English floppy):

- The gear's run at `0x1b1b0` ends in `0x1b2d7`, which adds the control value at `0x12` to the frame and wraps it:
  frame -1 becomes 3 and frame 4 becomes 0. Then it sets the control value to 0. No other routine of the gear writes
  its frame.
- Every shipped level of all eleven builds saves the gear on frame 0.

**What we assume.**

- A level starts the gear on one of its four frames, 0 to 3. Its run wraps the frame within them, and every shipped
  level saves it on frame 0.

This allows more than the shipped levels use: it only rules out frames the gear doesn't have.

**What it gives.** The gear's walks start on its four frames. Together with branching on whether its gear train is
blocked, all of its walks end in every branch they can follow. The ones still open are only the branches for a control
value other than 0, 1 and -1.

**How to recheck.**

- Look at levels saved by players for a gear with a saved frame above 3.

**Rechecked on 2026-11-05** in all eleven builds. The wrap only catches -1 and 4, so the gear stays on frames 0 to 3
only while its control value is -1, 0 or 1: this one rests on assumption 9.

## 7. The mouse motor's starting frame

Decided on 2026-11-05, after checking the code. In the code: `MOUSE_MOTOR_ASSUMPTION` in
`packages/content/src/read/behaviour-saved-frames.ts`. Explained in
[parts drawn by their own code](behaviour.md#parts-drawn-by-their-own-code).

**The question.** The mouse motor is drawn by its own code, so the walks had no frames to start it on.

**What the code shows** (Even More, English floppy):

- Its run at `0x1bfb5` only flips bit 0 of its frame (`xor word [si+0x0c], 1` at `0x1c019`). No other routine of the
  mouse motor writes its frame.
- Every shipped level of all eleven builds saves it on frame 0 or 1.

**What we assume.**

- A level starts the mouse motor on frame 0 or 1. Its run only flips between them, and every shipped level saves it on
  one of them.

**What it gives.** 17 of its 18 walks end in each of their branches in Even More. The one left is its explosion
trigger, whose effects on the motor aren't tracked yet.

**How to recheck.**

- Look at levels saved by players for a mouse motor with a saved frame above 1.

## 8. The electric motor's starting frame

Decided on 2026-11-05, after checking the code. In the code: `ELECTRIC_MOTOR_ASSUMPTION` in
`packages/content/src/read/behaviour-saved-frames.ts`. Explained in
[parts drawn by their own code](behaviour.md#parts-drawn-by-their-own-code).

**The question.** The electric motor is drawn by its own code too. From a frame above 2 its run would count down
through frames it doesn't have, so the starting frame matters.

**What the code shows** (Even More, English floppy):

- Its run at `0x1a4d1` counts its frame down (`0x1a52b`) and sets it to 2 after 0 (`0x1a534`). No other routine of
  the electric motor writes its frame.
- Every shipped level of all eleven builds saves it on frame 0.

**What we assume.**

- A level starts the electric motor on one of its three frames, 0 to 2. Its run counts down within them, and every
  shipped level saves it on frame 0.

**What it gives.** All 34 of its walks end in each of their branches, in both recorded builds.

**How to recheck.**

- Look at levels saved by players for an electric motor with a saved frame above 2.

## 9. Control values

Decided on 2026-11-05 with the user. In the code: `CONTROL_VALUE_ASSUMPTION` in
`packages/content/src/read/behaviour-saved-frames.ts`. Explained in
[decided control values and ends](behaviour.md#decided-control-values-and-ends).

**The question.** The jack-in-the-box, the gear and the teeter-totter turn their frame by their control value at
`0x12`. Where a walk doesn't know that value, it branches on the numbers the writers give (-1, 0 and 1) and keeps one
more branch for any other number, which stopped. Can the control value be anything else?

**What the code shows** (Even More, English floppy):

- The jack-in-the-box's run at `0x1b888` adds the control value to its frame and only wraps at exactly 8 and -1, so
  another number would jump frames. Its own routines never write the control value.
- The writers found set -1, 0 or 1: the electric motor (`0x1a4d1`), the windmill (`0x1d9ac`), the teeter-totter's own
  routines (`0x1d458`, its bounce at `0x1d138` and its rope callback at `0x1d5d6`), the collision path in `0x7e3b`
  (`0x8419`), the jack-in-the-box's pop (`0x1badd`) and the alligator (`0x1ddb1`). The mouse motor (`0x1c010`) and the
  monkey bike (`0x1bddc`) copy their own value: the mouse motor sets its own only through `0x1c074` (-1 or 1) or to 0
  (`0x1c028`), and the bike sets -1 or 1 from its run and rope callback and 0 from its bounce (`0x1bd2e`). The gear
  passes its value on to the gears it turns with the sign flipped, and to its belt partner with the same sign.
- Belt writers skip parts with `0x0800` in `+0x08`, so they don't write the mouse motor or the bike. The saved control
  value at `0x92` is only written by the part copy (`0x680a`) and the belt's constructor (0).
- The level reset at `0x892b` restores the control value from the saved value at `0x92`. Every shipped level of all
  eleven builds saves 0.

**What we assume.**

- The control value at `0x12` of the jack-in-the-box, the gear and the teeter-totter is only ever -1, 0 or 1. Every
  writer found sets one of those or copies another part's, and every shipped level saves 0.

Not proved: unresolved indirect calls could hide another writer, and a level file made outside the game could hold
another number.

**What it gives.** The branch for any other number is gone for these three parts. Together with the next assumption,
every walk of the jack-in-the-box, the gear and the teeter-totter ends in each of its branches, in both recorded
builds. Since the rope assumptions were narrowed (assumption 1), this also holds for the control value the
teeter-totter has right after it asks along its ropes.

**How to recheck.**

- List every writer of `0x12` on these three types and check the numbers it can write (the list above), the `0x0800`
  skip of the belt writers, the writers of `0x92`, and that `0x7996` only gives the rope callback kinds 1, 2 or 4.
- Look at levels saved by players for one of these parts with a saved control value other than 0.

**Rechecked on 2026-11-05** in all eleven builds: no writer puts anything other than -1, 0 or 1 into the control value
of these three parts, and every shipped level saves 0 for all eight types involved.

## 10. The teeter-totter's ends

Decided on 2026-11-05 with the user. In the code: `TEETER_TOTTER_END_ASSUMPTION` in
`packages/content/src/read/behaviour-saved-frames.ts`. Explained in
[decided control values and ends](behaviour.md#decided-control-values-and-ends).

**The question.** The teeter-totter has three frames. Its run adds its control value to its frame (`0x1d2da`, Even
More, English floppy) without checking the frame, and clears the value after the tilt (`0x1d458`). If it were on frame
2 with a control value of 1, or on frame 0 with -1, it would tilt on to a frame 3 or -1 that has no picture. Can
anything tip it past an end like that?

**What the code shows:**

- Its own bounce only sets a direction when the frame allows it (`0x1d0d8`, `0x1d0ef`, `0x1d0ff`, `0x1d110`), and so
  does its rope callback (`0x1d584`, `0x1d593`, `0x1d5ab`, `0x1d5bc`).
- Three more writers reach the teeter-totter, and all check its frame: the collision path in `0x7e3b` (type 3 at
  `0x83af`; -1 only above frame 0, +1 only below frame 2), the jack-in-the-box's pop (`0x1badd`: +1 on frame 0, -1 on
  frame 2) and the alligator (`0x1ddb1`, Even More only, the same).
- The motors, the windmill, the monkey bike and the gear write only to their belt partner, and the editor only ties a
  belt to a part with `0x1` and without `0x2` in `+0x08` (`0x584d`, `0x5880`). The teeter-totter's constructor gives it
  `0x000c` (`0x15f4a`), so it can't be belted. No shipped belt ends at a teeter-totter.

**What we assume.**

- Nothing tips the teeter-totter past an end: it is never on frame 0 with its control value at `0x12` at -1, or on frame
  2 with it at 1.

**What it gives.** Walks don't start the teeter-totter like that, don't branch into it, and input cases that start
like that are left out (12 in each recorded build). About 140 branches that went to frame 3 or -1 are gone.

**How to recheck.**

- Check the belt gate in the editor and the three writers above in each build.
- In the game, try to tip a teeter-totter that is already fully tilted further the same way.

**Rechecked on 2026-11-05** in all eleven builds. Only a level file made outside the game could tie a belt to a
teeter-totter, since the loader takes `+0x08` and the belt ends unchecked.

## 11. Parts on the fixed list

Decided on 2026-11-05 with the user. In the code: `FIXED_LIST_ASSUMPTION` in
`packages/content/src/read/describe-effects.ts`. Explained in
[effects of other parts](behaviour.md#effects-of-other-parts).

**The question.** The explosion pushes a part it hits only when that part's list flags at `0x06` have `0x1000`, which
the game sets when it puts a dropped part on the moving list. (Parts that part code itself puts there, like rope ends,
bullets and pinballs, don't get it.) Parts like walls, the teeter-totter or the fan are of a type the game puts on the fixed list.
Can such a part ever have `0x1000`, and so be pushed?

**What the code shows** (Even More, English floppy):

- The part factory (`0x15d9b`) gives a new part the flags word of its type from a 16-byte table at `0x2488` in the data
  segment (`0x15ddb`). The types of the fixed list have `0x4000`. (Type 55, not a listed part, gets `0x4000` from its
  constructor at `0x169a0`.)
- The routine that puts a part on a list when the player drops it (`0x6469`) tests `0x4000` (`0x6476`). Without it, the
  part gets `0x1000` and the moving list (`0x6494`); with it, `0x2000` and the fixed list. A search of the whole
  program finds no other instruction that adds `0x1000` to a word.
- A level file stores the flags word itself, and the part reader (`0x13653`) reads it straight into `0x06`.
- No shipped level of the eleven builds saves a part of a fixed type with `0x1000`: 2,738 such parts in each TIM 1
  build and 5,445 in Even More (English floppy), none with it. TIM 1 has the same code (French: table at `0x2ae6`,
  routine at `0x57bd`).

**What we assume.**

- A part of a type whose starting flags have `0x4000` is never on the moving list: its list flags at `0x06` never have
  `0x1000`. The game puts such a part on the fixed list, and no shipped level saves one with `0x1000`.

Not proved: a level file made outside the game could store `0x1000` for such a part, since loading keeps the stored
flags.

**What it gives.** Parts of a fixed type get no line for the explosion's push. Without it, every wall, ramp and motor
would show the push with the condition "on the moving list". The parts it rules out state it in their description. The
contact dispatch walks the moving parts list too, so these parts also get no line for what a part they touch does to
them, see [effects of parts that touch](behaviour.md#effects-of-parts-that-touch).

**How to recheck.**

- Look at levels saved by players for a part of a fixed type with `0x1000` in its first flags word.
- Search the program again for writes that set `0x1000` in a part's flags at `0x06`, and for anything that clears
  `0x4000`.

**Rechecked on 2026-11-05** in all eleven builds: `0x6469` is the only writer of `0x1000` (TIM 1 French `0x57e8`),
nothing clears `0x4000`, and no shipped fixed part has `0x1000`.

## 12. Screen directions

Decided on 2026-11-05 with the user. In the code: `SCREEN_DIRECTION_ASSUMPTION` in
`packages/content/src/read/describe-effects.ts`. Explained in
[effects of other parts](behaviour.md#effects-of-other-parts).

**The question.** The jack-in-the-box sets a part's two velocities to fixed numbers: -4096 and -4096 for a cat when
the box isn't flipped, and 4096 and -4096 when it is. Which way on the screen is that?

**What the user saw.** In the game, on 2026-11-05: a jack-in-the-box that isn't flipped knocks a part up and to the
left.

**What the code shows** (Even More, English floppy):

- The jack-in-the-box's run at `0x1b888` sets both velocities negative when its flip flag (`0x10` of `0x08`) is clear,
  and the horizontal one positive when it is set. So the flipped box is the mirror image: up and to the right.
- The routine at `0x7df7` sets `velocityX` at `0x36` from `positionX` at `0x1e` minus the previous `positionX` at
  `0x22` (`0x7e08`), and `velocityY` at `0x38` the same way from `0x20` and `0x24` (`0x7e1f`). So a velocity has the
  sign of the change of its position.
- It does not show how a position maps to the screen: that is in the drawing code, which the analysis doesn't follow
  that far.

**What we assume.**

- On the screen, a negative velocityX at `0x36` moves a part to the left and a negative velocityY at `0x38` moves it
  up. In the game, a jack-in-the-box that isn't flipped, which sets both negative, knocks a part up and to the left.

Not proved: that a smaller position is further left or higher on the screen. It rests on what the user saw.

**What it gives.** A line that sets both velocities to numbers says the direction in words, with the numbers after
it: "sets its velocity up and to the left (velocityX -4096, velocityY -4096)". Today that is the jack-in-the-box's
punch. The explosion's push doesn't need it: "away from the explosion" is proved without screen directions.

**How to recheck.**

- Follow the drawing code from `drawY` at `0x2c` to the screen and check that a smaller value is drawn higher.
- In the game, flip a jack-in-the-box and check that it knocks a part up and to the right.

## 13. Parts with one frame

**What the code shows** (Even More, English floppy):

- The level reset keeps the frame a level saved at `0x90` for most parts: no reset path writes the frame at `0x0c`.
- Many parts have a single frame: the bowling ball, basketball, rope, birdcage, bucket, eye hook, baseball,
  magnifying glass, jack-o-lantern, heart, Christmas tree, pinball, tennis ball, cheese, thumb tack, pool ball and
  shamrock.
- Every part in every shipped level of the eleven builds is saved on one of its own frames, and every one-frame part on
  frame 0.

**What we assume.**

- A level saves a part on one of its own frames, so a part with one frame starts on frame 0. Every part in every shipped level of the eleven builds is saved on one of its own frames.

**What it gives.** These parts' reset is known: frame 0, so their reset walks start there.

**How to recheck.**

- Run the saved frame check over the levels of every build (a level saved on a frame the part doesn't have fails it).
- In the editor, check that no part offers a frame its sheet doesn't have.

## 14. Parts the game draws itself

**What the code shows** (Even More, English floppy):

- These parts have no frame list in their type record, so the frames a level can start them on can't be counted.
- The pulley's frame is the direction of its rope: only `0x59d5` writes it, as `(angle >> 14) & 3`, and every caller
  checks for a pulley first. Its sheet has 4 sprites.
- The curved pipe wall's flip (`0x1c8a5`) turns its frame with `xor 1` or `xor 2`, and its reset (`0x1c83e`) picks one
  of four outlines by it: frames 0 to 3 stay within 0 to 3. A higher frame would draw a sprite the sheet doesn't have.
- The walls and the grass floor (types 1, 46, 48 and 60) draw tiles from their frame on (`0x18bd9`): a row draws
  sprites f to f+3 and a column f+4 to f+7, so only frame 0 draws the right pieces. Nothing changes their frame.
- The super ball's sheet has a round, a squashed and a stretched sprite, but no routine ever sets its frame.
- Shipped levels: the pulley on 0 to 3, the curved pipe wall on 0 to 3, the walls, the floor and the super ball on 0.

**What we assume.**

- A level starts the pulley on one of its four rope directions 0 to 3, the curved pipe wall on one of its four turns 0 to 3, and the brick, pipe and wood walls, the grass floor and the super ball on frame 0. The game itself only ever sets these frames, and every shipped level saves them.

**What it gives.** The walls, the floor and the super ball start on frame 0, so their reset is known. The pulley's and
the curved pipe wall's walks start on each of their four frames, and all of them rest on those frames.

**How to recheck.**

- Look for other writers of the frame at `0x0c` or the saved frame at `0x90` for these types.
- Run the saved frame check over the levels of every build.

## 15. The generator's starting frame

**What the code shows** (Even More, English floppy):

- The generator's reset (`0x1aeb3`) keeps bits 0 and 1 of its frame, the turn its run is at, and sets bit 2 and bit 3
  from its sockets at `0x62` and `0x64`. The level reset copies the saved frame at `0x90` into the frame first.
- Only the level loader (`0x136af`) writes those two bits of the saved frame. The plug code and the level reset save
  what the reset leaves.
- Every shipped level saves the generator on frame 0 or 4 (Even More 14 and 2, TIM 1 French 8 and 2).

**What we assume.**

- A level never starts the generator partway through a turn: bits 0 and 1 of its saved frame are 0, so it starts on frame 0, 4, 8 or 12. Its reset keeps those bits, only the level file sets them, and every shipped level saves it on frame 0 or 4.

**What it gives.** The generator's reset leaves frame 0, 4, 8 or 12 instead of any of its 16 frames, and its walks
start on those.

**How to recheck.**

- Look for another writer of the generator's saved frame.
- Run the saved frame check over the levels of every build.

## 16. The monkey bike's reaction

Decided on 2026-11-06 with the user. In the code: `MONKEY_BIKE_REACTION_ASSUMPTION` and `REACTION_FIELDS` in
`packages/content/src/read/behaviour-saved-frames.ts`. Explained in
[the monkey bike's control value after its reaction](behaviour.md#the-monkey-bikes-control-value-after-its-reaction).

**The question.** After a hit, the monkey bike plays its reaction: it shows frames 5 to 12 while its counter at `0x96`
counts down. When the counter runs out on frames 5 to 8 it goes to frame 0, and its next run pedals again unless its
control value at `0x12` is 0. A walk that starts in the middle of the reaction, like the reset walk on frame 5, doesn't
know the control value. Can it change while the reaction plays, or does the run after it see the value it had when the
reaction started?

**What the code shows** (Even More, English floppy; TIM 1 French in brackets):

- The bike's run at `0x1bdbd` (`0x1a4ce`) reads the control value only when the counter is 0 (`0x1be5a`, `0x1a567`).
  While the counter runs it only counts down and moves the frame. When the counter runs out on frames 9 to 12 it sets
  the control value to -1 or 1 (`0x1be0e` and `0x1be15`, `0x1a51f` and `0x1a526`); on frames 5 to 8 it goes to frame 0
  and leaves the control value alone. It also copies its control value to a part it reaches (`0x1bddc`), but never
  writes its own otherwise.
- Its bounce at `0x1bd05` (`0x1a411`) starts the reaction: it sets frame 5 or 9, the counter to 28 and the control
  value to 0 (`0x1bd2e`, `0x1a43a`), but only when the counter is 0.
- Its rope callback at `0x1becc` (`0x1a5d9`) writes 1 or -1 (`0x1bf4c` and `0x1bf53`, `0x1a65b` and `0x1a662`). On
  frames 5 to 8 it can also move the bike on to frames 9 to 12 (`0x1bf2f`).
- Belt writers skip parts with `0x0800` in `+0x08`, so they don't write the bike (see assumption 9). No other writer of
  the bike's control value was found.

**What we assume.**

- While the monkey bike plays its reaction after a hit, nothing pulls its rope or bounces it, so its control value at
  `0x12` keeps the value it had when the reaction started.

Not proved: a rope tied to the bike can be pulled at any time, and that writes the control value. The bounce only acts
while the counter is 0, so it can't come during the countdown, but it can between the run where the counter runs out
and the next one. The decision is that the reaction is described on its own, as the recorder plays it.

**What it gives.** A walk that starts in the reaction (on frames 5 to 12, from the reset, a flip or an input case)
keeps the control value as the value it had at the walk's start, through the reaction and the run right after it.
That run's test of the control value is then a test of the starting value, which a recording that gives the control
value decides. Walks started by the bike's own bounce or rope callback don't use it: those are what write the control
value. The monkey bike's reaction recordings (4 in each recorded build) now match completely: complete matches went
from 564 to 568 in Even More and from 476 to 480 in TIM 1. Walk endings don't change.

**How to recheck.**

- List every writer of the bike's `0x12` (the list above and in assumption 9) and check none can run during the
  reaction other than the rope callback and the bounce.
- In the game, pull a rope tied to a monkey bike while it reacts to a hit, and see whether it pedals again afterwards.

## 17. Parts the candle can light

Decided on 2026-11-06 with the user. In the code: `LIGHTABLE_ASSUMPTION` in
`packages/content/src/read/describe-hits.ts`. Explained in
[hits found by a search's flags](behaviour.md#hits-found-by-a-searchs-flags).

**The question.** The candle's first search and the rocket's keep only parts with `0x0004` in field `0x0a`, and their
loops set the control value at `0x12` of each such part to 1 when it is 0: they light it. A level stores that word, so
can a part of another type have the flag, or one of these four lack it?

**What the code shows** (Even More, English floppy):

- The constructors of the cannon (`0x162c9`), the dynamite (`0x16306`), the rocket (`0x1664f`) and the candle
  (`0x167ea`) set `0x0004` in `0x0a`. The factory's own table gives it to no type, and a scan of the program finds no
  other instruction that sets it. The instructions that clear bits there (`0x00fba`, `0x08971`, `0x1857f` and the part
  reader at `0x136a9`) all keep it, and the part copy (`0x66ec`) takes the word of the part it copies.
- The candle's first search (call at `0x19ab2`, search `0x448e`) keeps only parts with `0x0004` in `0x0a` (`0x44c7`),
  and its loop at `0x19abf` sets `0x12` to 1 on each one where it is 0. The rocket's run makes the same search (call at
  `0x1c76a`).
- The part reader (`0x13653`) reads the third flags word of a level of version `0x101` or later into `0x0a` and clears
  only `0x0010` there.
- In the shipped levels of the eleven builds, every cannon, candle, dynamite and rocket is saved with `0x0004` in its
  third flags word and no other part is. Every build's constructors set it for the same four types and no others (TIM
  1 French: `0x14b33`, `0x14b72`, `0x14edd`, `0x15088`).

**What we assume.**

- Only the cannon, dynamite, rocket and candle are ever marked as lightable (`0x0004` in field `0x0a`), and they always
  are. Only their constructors set it, and in the shipped levels every one of these four has it and no other part does.

Not proved: a level file made outside the game could set or clear the flag, since loading keeps the stored word.

**What it gives.** The "Hit by a candle or a rocket" walks of the cannon, the dynamite, the rocket and the candle no
longer keep "only when it has `0x0004` in field `0x0a`" as a condition. A walk still needs the type's constructor to
set the flag. Other types still get no such walk, and the 21 types in Even More (English floppy) that would otherwise
get one, because their rules read the control value, state the assumption in their description.

**How to recheck.**

- Search each build again for instructions that set or clear `0x0004` in a part's word at `0x0a`.
- Look at levels saved by players for a part with `0x0004` in its third flags word that isn't one of these four, or one
  of these four without it.

## 18. The bullet and the jack-in-the-box

Decided on 2026-11-06 with the user. In the code: `BULLET_LIST_ASSUMPTION` in
`packages/content/src/read/describe-effects.ts`. Explained in
[hits found by a search's flags](behaviour.md#hits-found-by-a-searchs-flags).

**The question.** The jack-in-the-box's punch sets the velocity of every part it finds that has `0x1000` in its list
flags at `0x06`, which the analysis calls being on the moving list. The bullet's own rules read its velocity, so the
punch gave it two walks. Can a bullet ever have that flag?

**What the code shows** (Even More, English floppy):

- The jack-in-the-box's loop (in its run at `0x1b888`) tests `0x1000` at `0x06` of each part its search finds
  (`0x1b93d`) and only then sets its velocities (`0x1b95c`, `0x1b964`). A part without it is only acted on when its type
  is in a table of six (the teeter-totter, the mouse motor, the fish bowl, the bellows, the electric switch and the
  scissors), and the bullet isn't.
- The gun makes its bullet with the part factory (type 20, `0x1b3a1`) and links it into the list of moving parts itself
  (`0x629d` at `0x1b3b5`). It then sets `0x0010` at `0x06` (`0x1b3bc`), not `0x1000`.
- The routine at `0x6469` is the only one that sets `0x1000` (see [assumption 11](#11-parts-on-the-fixed-list)), when
  the player drops a part. The bullet isn't a part the player can place.
- No shipped level of the eleven builds saves a bullet.

**What we assume.**

- A jack-in-the-box never punches a bullet: a bullet never has `0x1000` in its list flags at `0x06`, which the analysis
  calls being on the moving list. The gun doesn't give the bullets it makes that flag, and no shipped level saves a
  bullet.

Not proved: a level file made outside the game could save a bullet with `0x1000`, since loading keeps the stored flags.

**What it gives.** The bullet gets no walk and no line from the jack-in-the-box's punch. Before, it had two walks:
punched up and to the left or up and to the right (velocityX -2048 or 2048, velocityY -2048), only when on the moving
list. It is ruled out the same way as a part of a fixed type by [assumption 11](#11-parts-on-the-fixed-list), but only
for the bullet, and the bullet states the assumption in its description.

**How to recheck.**

- Look at levels saved by players for a bullet.
- Check in each build that the gun's run still links the bullet in without `0x1000`, and that nothing else sets it.

## 19. Parts that hold a rope record

Decided on 2026-11-06 with the user. In the code: `ROPE_HOLDER_ASSUMPTION` in
`packages/content/src/read/behaviour-connection-relay.ts`, used by `addRelayOwnerKeeps` in
`packages/content/src/read/behaviour.ts`. Explained in
[the owner's rope fields after the relay](behaviour.md#the-owners-rope-fields-after-the-relay).

**The question.** The byte relay (`0x65c1` in Even More, English floppy) updates the geometry of the owner's ropes, and
the rope geometry update (`0x5bf3`) writes the rope ends `0x96` and `0x9c` of the part that holds the rope record. Can
that be the owner?

**What the code shows** (Even More, English floppy; the same in all eleven builds):

- A rope record's slot 0 is the part that holds it. Only four instructions store slot 0, each with the part the record
  is made for: the level loader (`0x1386b`), the rope's and the pulley's constructors (`0x1610c` and `0x16084`, types
  10 and 7) and the part copy (`0x6783`, only for types 10 and 7). Every build has the same four.
- The relay gives its byte to slot 0 of the owner's rope records at `0x66` and `0x68` and passes each record to the
  rope geometry update, which writes `0x96` and `0x9c` only on slot 0.
- The loader takes the rope data from the file for a part of any type.

**What we assume.**

- Only a rope piece or a pulley ever holds a rope record (slot 0 of a record at `0x66` or `0x68`), so the rope geometry update never writes the rope ends `0x96` and `0x9c` of a part of another type. Every rope the game makes and every shipped level says so; only a level file made outside the game could break it.

Not proved: a level file made outside the game could give rope data to a part of another type, since the loader
takes it as it is.

**What it gives.** After the relay, a callback whose part can't be a rope piece or a pulley keeps its own rope ends
`0x96` and `0x9c` instead of naming them "part after field effect". The reader applies it only to a call from a
routine the type table names directly and nothing else calls, when none of the types that name it is the rope or the
pulley: every one of the relay's callbacks (27 types in Even More, 23 in TIM 1, none a rope or a pulley). Parts the
relay reaches still forget the fields, and so does the owner of any other caller. Before, the description named each
of the two fields after the call 74 times in Even More (English floppy) and 67 times in TIM 1 (French); now it names
them nowhere. Walks and recordings don't change.

**How to recheck.**

- Look for another instruction that stores slot 0 of a rope record (`slot0.ts` finds four in every build).
- Look at levels saved by players for a part with rope data that isn't a rope or a pulley.

**Rechecked on 2026-11-06** in all eleven builds: four slot 0 stores in each, and in every shipped level only ropes
(type 10) and pulleys (type 7) have rope data.

## 20. Flipping a part with a loose belt end

Decided on 2026-11-06 with the user. In the code: `FLIP_BELT_ASSUMPTION` in
`packages/content/src/read/behaviour-connection-relay.ts`, used by `addRelayOwnerKeeps` in
`packages/content/src/read/behaviour.ts`. Explained in
[the owner's rope fields after the relay](behaviour.md#the-owners-rope-fields-after-the-relay).

**The question.** The byte relay checks the owner's belt with the belt end check (`0x582a`) while `[0x4a6d]` is
`0x1000`. That check can search the parts for the part under a belt end and turn round a rope tied to it, which writes
rope and belt links `0x5a` to `0x60`, `0x6a` and `0x6c` of the part it finds. That part can be the owner. Can it happen
when a part is flipped?

**What the code shows** (Even More, English floppy):

- The relay (`0x65c1`) calls the belt geometry update and then the belt end check on the owner's belt record at
  `0x54`, only while `[0x4a6d]` is `0x1000` (`0x6602`). It calls nothing else that writes links.
- The belt end check searches only for a belt end that is loose: one of the belt's two parts missing.
- Among the part callbacks, only flip callbacks (`+0x2e`) call the relay, for 27 types in Even More and 23 in TIM 1.
  The editor calls a flip callback when the player flips a part (`0x5314`, and the flip buttons on the selected part at
  `0x11660` and `0x11692`). The relay has other callers (eleven routines in Even More) that the type table doesn't
  name; the analysis doesn't walk them.

**What we assume.**

- In the editor a part is never flipped while one end of its belt is still loose (as while the player drags the belt's end), so the byte relay a flip callback makes never changes the rope and belt links `0x5a` to `0x60`, `0x6a` and `0x6c` through its belt end check. This is about flipping in the editor only, not about the machine running.

Not proved: what mode `0x1000` means, and that the player can't flip a part while a belt end hangs loose.

**What it gives.** After the relay, a flip callback keeps its own part's links `0x5a` to `0x60`, `0x6a` and `0x6c`
instead of naming them "part after field effect". The reader applies it only to a call from a routine the type table
names directly, only as a flip callback, and that nothing else calls. Parts the relay reaches still forget the links.
It says nothing about the machine running: the relay's other callers keep nothing. Before, the description named each
of the six links after the call 74 times in Even More (English floppy) and 67 times in TIM 1 (French); now it names
them nowhere. Walks and recordings don't change.

**How to recheck.**

- Check in each build that only flip callbacks among the part callbacks call the relay, and that the relay calls the
  belt end check only on the owner's belt.
- In the game, drag a belt's end from a part and try to flip the part (or the part at the other end) before the end is
  placed.

**Rechecked on 2026-11-06** in all eleven builds: only flip callbacks among the part callbacks call the relay, and no
shipped level has a belt with a loose end.

## 21. The wood incline's starting frame

Decided on 2026-11-06 with the user. In the code: `WOOD_INCLINE_ASSUMPTION` and `LEVEL_FRAMES` in
`packages/content/src/read/behaviour-saved-frames.ts`. Explained in
[starting frames in the shipped levels](behaviour.md#starting-frames-in-the-shipped-levels).

**The question.** The wood incline has no frame list, since the program draws it, so nothing limited the frame a level
can start it on.

**What the code shows** (Even More, English floppy):

- The incline's resize (`0x1b82f`) copies its width from `0x50` to `0x44` and sets its frame and saved frame (`0x0c`,
  `0x90`) to that width divided by 16, less 1. Its reset keeps the saved frame.
- The editor keeps the width between 16 and 64, the type record's limits, so frames 0 to 3.
- Every shipped incline has the frame its width gives. Two Even More levels, "Ambulance Driver" (L117) and "Rocket
  Launcher" (L143) in the five full Even More builds, have an incline of width 0 on frame -1, which the editor can't
  make.

**What we assume.**

- A wood incline starts on the frame its width gives: its width divided by 16, less 1. That is frame 0 to 3 for the widths 16 to 64 the editor allows, and frame -1 for an incline of width 0, which two Even More levels have ("Ambulance Driver", L117, and "Rocket Launcher", L143) though the editor can't make it.

Not proved: a level file made outside the game could save another width or another frame.

**What it gives.** The incline's rest says the reset keeps the frame the level saved, one of frames -1 to 3, the one
its width gives. Its run rests on each of the five, so it now has resting frames (frame -1 is listed as 65535, the
word the rules read) and 25 more walks in each build, a run and four callback walks from each resting frame, all of
which end. The walks can't tie the frame to the width, so they start from all five. The saved frame check
(`check-level-frames`) checks each incline's frame against its width.

**How to recheck.**

- Run `check-level-frames` over the levels of every build.
- Look for another writer of the incline's frame or saved frame.

**Rechecked on 2026-11-06** in all eleven builds (1,281 level files): every incline (353 in each TIM 1 build, 844 to 911
in the full Even More builds, 78 in the demo) is saved on the frame its width gives, on frames 0 to 3 apart from the two
of width 0 on frame -1.

## 22. Searches of the moving list

Decided on 2026-11-08 with the user, for now: to be checked again later. In the code: `MOVING_SEARCH_ASSUMPTION` in
`packages/content/src/read/describe-effects.ts`, used with `searchesOnlyMovingList` in
`packages/content/src/read/describe-hits.ts`. Explained in
[the lists a search walks](behaviour.md#the-lists-a-search-walks).

**The question.** The teeter-totter's search finds the parts whose outline crosses its plank, and its launch then sets
their speed. It looks only in the list its mask picks, the moving list, but the analysis only knew a part's list
flags at `0x06`, and a bullet is on that list without `0x1000`. Can the search find a part of a fixed type, like a
brick wall?

**What the code shows** (Even More, English floppy; TIM 1 French has the same code at other addresses):

- Every overlap search starts at the list head routine (`0x682f`) and goes on with the list next routine (`0x686f`).
  The head routine returns the first nonempty list whose bit the mask has: `0x2000` the list at `0x4e1f`, `0x1000`
  the list at `0x4d7d`, `0x0800` the list at `0x4cdb`. At the end of a list the next routine goes on with the head
  routine, and with the list at `0x4cdb` only for `0x0800`. The searches pass it their mask with only `0x1000` kept.
- The teeter-totter passes `0x1000`, and so do the mouse motor, the mouse, Mel's house, the vacuum cleaner, and the
  candle's and rocket's second search. The others pass `0x3000`, both lists, apart from the alligator, which passes
  `0x2000`.
- The routine that puts a dropped part on a list (`0x6469`) puts it on the list at `0x4d7d` only when its type's
  starting flags lack `0x4000`, and on the list at `0x4e1f` otherwise. The contact dispatch walks the list at `0x4d7d`.
- Part code links parts into the list at `0x4d7d` itself in four places: the rope maker's two rope ends (type 49),
  the pinballs (type 43) and the gun's bullets (type 20). None is of a fixed type. The rope itself (type 10, a fixed
  type) goes on the list at `0x4e1f`.
- The level loader fills the lists from the level file's groups (`0x13bac`, `0x13bbb`). No shipped level of the
  eleven builds stores a part of a fixed type among its moving parts: 459 moving parts in each TIM 1 build and 848 in
  Even More (English floppy), none of a fixed type.

**What we assume.**

- A search that walks only the moving list (the list the contact dispatch walks) finds no part of a fixed type. The game puts a dropped part there only when its type isn't fixed, the parts part code links there itself (rope ends, pinballs, bullets) aren't of a fixed type, and no shipped level stores a part of a fixed type among its moving parts.

**Checked in the game's own run** (2026-11-08, with `check-moving-list`, which runs the game's code in the level
recorder): every shipped puzzle of Even More (English floppy, 160 puzzles) and TIM 1 (French, 87 puzzles) ran for 500
steps, or until the game's goal check ended the run (Even More 106 and 115, TIM 1 76). At every step no part of a fixed
type was on the moving list. As loaded, the moving lists held 812 parts in Even More and 430 in TIM 1. The only parts
that joined the moving list during a run were bullets (Even More 4 puzzles, TIM 1 3), pinballs (3 and 2) and rope ends
(1 and 1), the parts the code above links there. The fixed list was joined by explosions (type 41, not a fixed type, in
7 and 4 puzzles) and, in Even More puzzle 76, by a brick wall from the explosion's split of a wall.

Not proved: a level file made outside the game could store a part of a fixed type among its moving parts, the places
that save and restore the list heads (`0xffe7`, `0x12203`, `0x16b68`) were not read further, and the run covers only
what the shipped puzzles do with their own parts, without the parts a player adds.

**What it gives.** A part of a fixed type gets no line or walk from a search that walks only the moving list, and the
pair check counts such pairs as ruled out. Most of them were the teeter-totter's launch lines on walls, ramps and
motors, which can't happen in the game. The parts it rules out state it in their description. Unlike
[assumption 18](#18-the-bullet-and-the-jack-in-the-box), it doesn't rule out the bullet, which is on the moving list.

**How to recheck.**

- Look at levels saved by players for a part of a fixed type in the moving group.
- Search the program again for code that links a part into the list at `0x4d7d` (and `0x52f9` in TIM 1), and read the
  routines that save and restore the list heads.
- Run every shipped puzzle in the game's code and look at the lists each step:
  `pnpm --filter @opentim/content check-moving-list --game <game folder>` (the builds the level recorder knows); it
  fails when a part of a fixed type is on the moving list.

## Recheck of the decided assumptions

Rechecked on 2026-11-07 (step F2 of [the plan](behaviour-plan.md)) in all eleven builds and their 1,281 shipped level
files, after the work of 2026-11-06. The eleven `TIM.EXE` files are the same files as at the earlier rechecks (dated
2026-10-27), so the code facts found then still stand. What can have changed is the analysis, so each assumption was
checked again where the analysis finds it in each build (by the kind of routine, not by address), and every level was
read again. The tools: `check-level-frames`, `list-assumptions --check` and `list-other-part-pairs` over all eleven
builds, and small scratch scripts for the code and level checks below.

"Still used" counts the places the report and the description state the assumption in Even More (English floppy), with
the parts whose findings state it; every one is stated in all eleven builds.

| #   | Assumption                         | Result | What was checked in each build                                                                                                                                                                                                      | Still used                                        |
| --- | ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | Ropes                              | holds  | The query's only callers are the teeter-totter's run and rope callback (3 calls); that callback writes `0x12` and `0x08` on its own part. Levels: every rope slot is 0 or 1, no rope has both ends on one part.                     | yes, 9,055 (teeter-totter)                        |
| 2   | Rope cut and part copy             | holds  | The part copy has 3 callers: the wall split (twice) and the editor. Slots as in 1. The allocator is unchanged code.                                                                                                                 | yes, 147 (scissors) and 500 (24 parts)            |
| 3   | The teeter-totter's search         | holds  | The list insertion has 15 callers in Even More and 14 in TIM 1, the same in each build of a game; the search that keeps its owner is called only by the teeter-totter's run. Levels: no part is listed twice.                       | yes, 6,652 (teeter-totter)                        |
| 4   | The monkey bike's starting frame   | holds  | Its own routines come onto frames 5 to 12 only from the bounce (5 or 9) and the rope callback (+4). Levels: every bike on frame 0.                                                                                                  | yes, 2,699 (monkey bike)                          |
| 5   | The conveyor belt's frame          | holds  | Its resize sets both frames to `(width - 32) / 16 * 7`. Levels: every belt on the frame its width gives (two in L21 have width 40, see below).                                                                                      | yes, 1,944 (conveyor belt)                        |
| 6   | The gear's frame                   | holds  | Only its run writes its frame, adding the control value and wrapping. Levels: every gear on frame 0.                                                                                                                                | yes, 278 (gear)                                   |
| 7   | The mouse motor's frame            | holds  | Only its run writes its frame, with `xor 1`. Levels: frame 0 or 1.                                                                                                                                                                  | yes, 1,033 (mouse motor)                          |
| 8   | The electric motor's frame         | holds  | Only its run writes its frame, counting down and back to 2. Levels: frame 0.                                                                                                                                                        | yes, 196 (electric motor)                         |
| 9   | Control values                     | holds  | The three parts' own routines write only -1, 0, 1 or another part's value. Levels: every saved control value is 0.                                                                                                                  | yes, 8,053 (gear, jack-in-the-box, teeter-totter) |
| 10  | The teeter-totter's ends           | holds  | Its constructor gives it `0x000c` in `+0x08`, so the editor can't belt it. Levels: no belt ends at a teeter-totter.                                                                                                                 | yes, 2,215 (teeter-totter)                        |
| 11  | Parts on the fixed list            | holds  | One instruction sets `0x1000` (the drop routine's `or ax, 0x1000`); the only `and` on `0x06` keeps `0x4000`. Levels: no fixed part with `0x1000` (2,738 per TIM 1 build, 5,445 to 5,800 per full Even More build, 477 in the demo). | yes, 40 (39 parts)                                |
| 12  | Screen directions                  | holds  | Nothing to run: the code is unchanged and the screen side still rests on what the user saw.                                                                                                                                         | yes, 128 (22 parts)                               |
| 13  | Parts with one frame               | holds  | Levels: every part on one of its own frames, every one-frame part on frame 0.                                                                                                                                                       | yes, 14,176 (45 parts)                            |
| 14  | Parts the game draws itself        | holds  | Of their own routines only the curved pipe wall's flip writes its frame (`xor 1`, `xor 2`). Levels: pulley and curved pipe wall on 0 to 3, the others on 0.                                                                         | yes, 335 (7 parts)                                |
| 15  | The generator's frame              | holds  | None of its routines writes the saved frame; its reset keeps bits 0 and 1. Levels: frame 0 or 4.                                                                                                                                    | yes, 342 (generator)                              |
| 16  | The monkey bike's reaction         | holds  | Its own writers of `0x12` are still only the bounce (0), the run and the rope callback (-1 or 1). Still not proved, as before.                                                                                                      | yes, 965 (monkey bike)                            |
| 17  | Parts the candle can light         | holds  | Only the constructors of the cannon, dynamite, rocket and candle set `0x0004` in `0x0a`, the factory table gives it to none, and the only `and` there keeps it. Levels: all of these four have it, no other part does.              | yes, 119 (25 parts)                               |
| 18  | The bullet and the jack-in-the-box | holds  | The drop routine is still the only setter of `0x1000`. Levels: no bullet.                                                                                                                                                           | yes, 2 (bullet)                                   |
| 19  | Parts that hold a rope record      | holds  | Four stores of a rope record's slot 0. Levels: only ropes and pulleys hold rope records.                                                                                                                                            | yes, 5,564 (27 parts)                             |
| 20  | Flipping with a loose belt end     | holds  | Among the part callbacks only flip callbacks call the relay (27 types in Even More, 23 in TIM 1). Levels: no belt with a loose end.                                                                                                 | yes, 5,568 (27 parts)                             |
| 21  | The wood incline's frame           | holds  | Only its resize writes its frames, to `width / 16 - 1`. Levels: every incline on the frame its width gives; width 0 on frame -1 only in L117 and L143 of the five full Even More builds.                                            | yes, 118 (wood incline)                           |

Nothing fails and nothing is unused. `list-assumptions --check` finds the same 269 assumptions as the generated list,
`check-level-frames` finds no level that disagrees, and `list-other-part-pairs` passes.

One earlier note was wrong, though the assumption isn't affected: the recheck of assumption 5 said every shipped belt
has a width on the 16 grid. Level L21 has two conveyor belts of width 40 in every build except the Even More demo. Both
are on frame 0, the frame that width gives, since the resize divides with truncation.
