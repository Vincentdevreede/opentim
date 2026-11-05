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

Decided on 2026-11-04. In the code: `ROPE_ASSUMPTIONS` in `packages/content/src/read/behaviour-rope-dispatch.ts`.
Explained in [the rope connection query](behaviour.md#the-rope-connection-query).

**The question.** When a rope moves, the game asks the part at the other end of the rope what to do. That part can
pass the question on along its own ropes. The analysis can't see which parts are tied together, so it couldn't tell
whether the question might come back and change the part that asked.

**What we assume.**

- A rope ties two different parts, so the part at the other end of a rope is never the part that asks.
- Ropes between parts never form a loop, so a chain of questions along ropes never comes back to the part that asked.
- A rope end's slot number is one of the part's two rope links, so indexing the links at `0x66` by it reaches a rope
  record.

**What it gives.** A part that asks along its ropes keeps its own fields. Used by the teeter-totter. Walks that stop
went from 287 to 241 in Even More and from 246 to 200 in TIM 1.

**How to recheck.**

- Try to tie both ends of one rope to the same part in the game, and look for a level where ropes go round in a circle
  back to where they started. Either would break the first two.
- In `TIM.EXE`, find the code that attaches a rope to a part and check it only ever stores slot 0 or 1.
- Check the query's skip of the part the question came from (`0x1d67a`, Even More, English floppy), and that its only
  callers are the teeter-totter's run (`0x1d2af`, `0x1d2d1`) and rope callback (`0x1d5ef`).
- Check the editor's tie: it picks slot 0 or 1 (`0x515d`) and refuses to tie a rope's second end to its first part
  (`0x10f98`). The level loader (`0x138a9`) takes both slots and both ends from the file without a check.

**Rechecked on 2026-11-05** in all eleven builds (9 different programs). The editor never ties a rope to one part
twice, and every slot writer stores 0 or 1. Shipped levels have no rope from a part to itself, no slot above 1 and no
loop of ropes. Two ropes between the same two parts are possible, but the skip above stops the question coming back.
One real risk remains: a ring of three or more teeter-totters tied in a circle would bring the question back to the
part that asked, and nothing in the code prevents building one. Whether rope lengths and positions allow it in the game
is not checked. A level file made outside the game could also break the first and third bullet.

## 2. The scissors' rope cut

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
  and 32. Then it calls the part's resize callback (`0x114d8`).
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
- Look at levels saved by players for a belt whose saved frame isn't a multiple of 7, or is above 28.

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
