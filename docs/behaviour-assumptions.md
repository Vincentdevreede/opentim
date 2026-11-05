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
and the loader. Every shipped belt has a width from 32 to 96 on the 16 grid and the frame its width gives.

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
would show the push with the condition "on the moving list". The parts it rules out state it in their description.

**How to recheck.**

- Look at levels saved by players for a part of a fixed type with `0x1000` in its first flags word.
- Search the program again for writes that set `0x1000` in a part's flags at `0x06`, and for anything that clears
  `0x4000`.

**Rechecked on 2026-11-05** in all eleven builds: `0x6469` is the only writer of `0x1000` (TIM 1 French `0x57e8`),
nothing clears `0x4000`, and no shipped fixed part has `0x1000`.
