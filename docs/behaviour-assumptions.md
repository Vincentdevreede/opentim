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

- Read the list insertion at `0x629d` (Even More, English floppy) and check that it never inserts a part that is
  already on a list.
- If a build turns out to skip the owner in this search, nothing breaks: the analysis only gets more careful than
  needed.

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
- The reset at `0x892b` puts the saved frame back and sets the counter at `0x96` to 0.
- For the monkey bike, the saved frame is only set by a level file, by copying another part (`0x67fe`), and by the
  editor's shared actions, which save the frame the part shows after its resize callback (`0x5de4`, `0x5e9d`,
  `0x8a9c` and others). None of the bike's own routines writes it.
- The bike shows frames 5 to 12 only after its bounce at `0x1bd05`, which sets frame 5 or 9 and starts the counter at
  28 in the same step. Its run leaves those frames when the counter runs out. Its reset and resize don't change its
  frame.
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
- Check that the editor's actions that call a part's resize callback only run while the machine is stopped.
- Look at levels saved by players for a monkey bike with a saved frame from 5 to 12.
