# Walks against the recordings

## The recorder's normal seed

The v25 recorder sets a part's normal seed on the part before each of its clips, and then the clip's own seed over it
(`clip` in `research/v24/verify_animations.py`). Its frames save the frame, control value, counter, heat and flags,
but not the speed. The comparison used to take a clip's starting fields from the clip's own seed and its first frame
only, so the speed of 0x3000 that the bullet's normal seed gives was lost. The bullet's run tests that speed on its
first run: at 0x3000 (or 0xd000) it stays on frame 0, at any other speed it shows its impact frames 1 and 2. Without the
speed the impact stayed a way the recording allowed, and the bullet's normal recordings were prefixes.

The comparison now takes the part's normal seed under the clip's seed and frames, as a starting field like the others
(only on the first run). Only the bullet's normal seed gives a field the frames don't save. Its four normal recordings
now match completely in both builds: complete matches went from 560 to 564 in Even More and from 472 to 476 in TIM 1.

The recorder also puts each part alone on an empty bench, touching nothing. Decided with the user, the comparison
takes the contact bits of the list flags at `0x06` as clear at the start of every recording: `0x0002` and `0x0004`,
which the contact dispatch tests before it calls a bounce callback (`0x1071`, `0x10b5`), and `0x0001`, which picks
its response (`0x1096`, Even More English floppy). The other list flags, like the moving list `0x1000`, stay unknown,
and so does the belt link at `0x54`, which the user chose to leave open. Like the other recorded fields this only rules
out ways at the start. The cat's flipped move recordings and the mouse's normal recordings test those bits on their first
run, so 4 more of each match completely per build: 564 to 572 in Even More and 476 to 484 in TIM 1, none different.

What stays a prefix, by cause (Even More 84, TIM 1 76):

- The recorder writes the control value again while it runs: the teeter-totter (4), the gear (8), the bellows (4) and
  the teapot (4). A single trigger can't describe that.
- Another part may start it: the mouse motor (8), whose run with the control value at 0 scans the parts lying on it
  (0x1bff5 in Even More, 0x1a70c in TIM 1), and Mel's house in Even More (4, the scan at 0x1e29b). In Even More the
  mouse motor's run recording is open one run after its countdown on a test of the control value, which the walk
  doesn't know there.
- Its search for another part: the cat (8), through the loop at 0x1a01a and the query at 0x19fd3 in Even More
  (0x186af and 0x18668 in TIM 1).
- A field the recording doesn't save: the mouse (8) starts again once its counter is 0 when bit 0 of the word at 0x06
  is set (and, in TIM 1, a value the scan at 0x1acf5 leaves is not 400). The monkey bike's recordings seeded on frames 5 to 12
  (32) are compared with its hit, which sets the counter, so the recorded counter of 0 doesn't apply; its rules there
  also test the word at 0x54, which the recording doesn't save.
- A field the recording gives only at the start: the monkey bike's reaction (4) ends on frame 0 with its counter at
  0, where the run pedals again when the control value is not 0. No rule on that way writes a known control value, and
  the recording gives it only at the start, so the walk can't tell it is still 0.

## Recordings whose recorder writes again

Some v25 clips write an input again while they run (`clip` in `research/v24/verify_animations.py`). Before each run the
recorder writes its hold values, on every run when the clip names no `holdTicks`, or else before run `holdTicks`, and
at run `holdTicks` it writes its release values (the control value 0 when it names none). The write at run 0 is part of
the clip's starting fields. A frame the recorder saves is taken after a run and before the next write. The teeter-totter
holds its control value at 1 and writes -1 at run 1, the bellows writes 1 twice and -1 at run 2, the teapot writes 1
for 60 runs and 0 at run 60, and the gear writes 1 (or -1) before every run. A walk follows one trigger, so these
recordings used to stay prefixes after their first write.

The comparison now restarts at each write that changes the part:

- A write of the value the saved frame already shows changes nothing, so the walk goes on through it. That holds only
  for the fields the recorder saves in full: the frame, the control value, the counter and the heat. The bellows'
  second write and the teapot's release are such writes.
- At any other write the comparison starts a new walk from the fields the recording gives there: the saved frame's
  fields with the written values over them, everything else unknown. It is a walk of the run rules from those fields,
  like an input case in the middle of a run. The part's normal seed and the clear contact bits are not used there:
  they only hold at the start of the recording.
- Each part of the recording up to the next write only needs to agree with the walk up to there, by the same rules as
  a whole recording (some way the recording allows matches, and no allowed way stops before then). The last part needs
  a proved ending, like a whole recording.
- A recorder that writes on every run must have recorded a cycle. Its cycle was found on the fields after the write, so
  from the end of the recording on, each run restarts from the fields of the run the cycle repeats. The comparison
  checks one more round of the cycle that way; after that every part is one it already checked. A recorder that
  writes on every run and records no cycle stays a prefix.

The start of a recording is still compared with every described start as before; the parts after a write are the same
for all of them. A restart only forgets fields, so it never proves more than the recording gives.

All 20 such recordings in Even More and 16 in TIM 1 now match completely: complete matches went from 576 to 596 in Even
More and from 488 to 504 in TIM 1, none is different, and the walks themselves don't change. The teeter-totter's walk
from its frame after the write asks along its ropes, which the recording can't rule out, so its ending is proved over
the ways the rope answers allow, like any other branch.

## Recordings that wait for a search

Twenty recordings in Even More and sixteen in TIM 1 agree with the walks frame for frame but stay prefixes, because
the part next waits for a search to find another part: the mouse motor's restart (8 per build), the cat looking for a
mouse (4), the mouse starting again (4) and Mel's house in Even More (4). Decided with the user, such a recording may
only close when the part stays alone for the whole recording: no part in it makes another part, and the recording
shows nothing else on the bench.

The second check can't be made from the recordings. Each v25 clip in `animations.json` holds the recorded part's own
saved fields per frame (the frame, control value, counter, heat, the masked drawing flags and whether it is hidden),
the input it got, the callback it ran, how the clip ended, a source note `isolated-original-callback` and a count of
the engine calls it skipped (`skippedEngineServices`). It lists no other part and no position, not even the recorded
part's own. What else lay on the bench is not in the data, so none of these recordings closes, and nothing is assumed
in its place.

The data does show something else: the searches these parts wait for are among the calls the recorder skipped. In
Even More the cat's move clips skip the overlap search at `0x417e` four times, the mouse motor's clips skip it once,
and Mel's house skips the overlap search at `0x42da` on every run (in TIM 1 the cat and the mouse motor skip the
overlap search at `0x3597`). So the recorder did not run the search over an empty bench, it left the search out, and
what the part got in place of its answer comes from the recorder, not from the game. Taking it as "found nothing"
would be a new assumption. The mouse's clips skip no search: what its run tests there, bit 0 of the list flags at
`0x06`, is a field the clips don't save.

## What the recorder gives for a skipped search

Decided with the user: a clip that lists a search as skipped may be compared with the walk's "found nothing" way,
since that is what the recorder gave the part. This is a fact about the recorder, not about the game.

The recorder (`research/v24/verify_animations.py`) runs only the part's run routine. Its hook catches the first
instruction of any routine outside the part types' code segment, pops the far return address, sets AX and DX to 0 and
writes no memory, and counts the call in `skippedEngineServices`. Before each clip it loads the program again and
clears the part's 0x300 bytes, then sets the type, the flags, the frame, the fields `0x1e` to `0x28` (the position) at
100, the size, the outline and drawing pointers at `0x80` to `0x84` and the clip's seed (the control value, counter,
heat, speed). Between runs it only writes the previous frames at `0x0e` and `0x10`, the position fields at 100 again
and its hold values.

An overlap search like `0x417e` first clears the found list at `0x78` of the part and then links each part it finds.
Skipped, it writes nothing, so the field keeps the 0 the recorder cleared it to, as long as nothing else writes it. The
comparison checks that on the run routine: no instruction outside the loops over the list writes `0x78` through any
pointer, and every call outside those loops leaves the part's code segment (so the recorder skips it too). Then every
loop over that list finds it empty:

- a loop that stops at the first part it acts on, like the cat's at `0x1a01a`, finds no part: its member link is 0;
- after a loop over every part, like the mouse motor's at `0x1bff5` and Mel's house's at `0x1e29b`, the part's fields
  hold what they held before the loop. That is the value at the run's start when nothing on the way from the start to
  the loop writes the field and the only call is the search.

The comparison rewrites the walk's branch conditions with those values, and a condition that then tests a field for one
number and for another (like "the control value is 0 and the control value after the scan isn't 0") is ruled out. A
search's answer in AX is 0 too, but none of these runs uses it. Only clips that list the search get this, and only when
the walks as they are don't already match. Such a match has its own basis, `recorder-skipped-search`, and is counted
apart: it shows the walk agrees with the recorder, not that the game finds nothing.

Complete matches went from 596 to 606 in Even More (10 through a skipped search) and from 504 to 512 in TIM 1 (8), and
prefixes from 52 to 42 and from 48 to 40. None is different. In Even More Mel's house's four still recordings close,
and so do the mouse motor's four still recordings and the cat's two move recordings that look in the found list. In
TIM 1 all eight mouse motor recordings close. What stays open, and why:

- the mouse motor's four run recordings in Even More: at the end of the countdown some joined branches no longer know
  the control value is 0, so they may still flip the frame. That is the countdown, not the search;
- the cat's four still recordings in both builds: the cat first compares two of its position fields, `0x20` and `0x28`
  (when they differ by more than 1 it counts up and then shows frame 1), and after the first run the walk no longer knows its counter, its flags
  or whether it touches something. The recorder sets both position fields to 100 before every run, but that is another
  fact about the recorder, not a skipped search;
- the cat's two move recordings in TIM 1: the analysis doesn't sum up the cat's loop over the found list at `0x186af`
  as a loop over that list (it does in Even More), so the comparison can't tie the loop to the skipped search;
- the mouse in both builds (4 each): it skips no search. It only searches when bit 0 of its list flags at `0x06` is
  set; the recorder clears those flags and the run never sets them, but the comparison only takes them as clear on the
  first run.

## What the recorder writes between runs

Decided with the user, on the same principle as the skipped search: a recording may be compared with exactly what the
recorder did to the part between runs, not only with what its clip saved. Read in `research/v24/verify_animations.py`:

- `setup` loads the program again, clears the part's 0x300 bytes, sets the six words at `0x1e` to `0x28` to 100 and
  sets the type, flags, size and the pointers at `0x80` to `0x84`; `apply` writes the seed (frame, control value,
  counter, heat, speed, flags);
- before each run `clip` writes its hold values, which the comparison already follows;
- after each run `step` copies `0x0e` into `0x10`, then the frame into `0x0e`, and sets the six words at `0x1e` to `0x28`
  to 100 again.

So before every run the words at `0x1e` to `0x28` are 100, and `0x0e` holds the frame the clip saved there (0 before the
first run, since the recorder cleared it). `0x10` holds the frame of the run before, and 0 before the first two runs,
but only when nothing in the clip writes `0x0e`, since the recorder copies whatever `0x0e` holds after the run.

Every other byte the recorder clears stays 0 on every run when nothing in the clip can write it. That is shown from the
code, not assumed: the comparison goes through every instruction of the run routine and of the routines it calls in its
own code segment, counts each data write by its offset whatever pointer it goes through, and gives up on string
instructions, interrupts, a call it can't follow and a pointer the routine moves by an offset. A call that leaves the
code segment writes nothing, since the recorder skips it. The mouse's list flags at `0x06` are such a field: its run
never writes them, so they are 0 on every run, not only the contact bits on the first.

These fields replace what a walk knew for them at each run. A walk that knew another value for one (or something other
than 0 for a cleared field nothing writes) isn't on the recorder's way there and stays open, and a start that knows
another value isn't the recorder's start. The comparison only takes them when the walks as they are don't match; such a
match has its own basis, `recorder-fields`, counted apart. A skipped search's empty found list comes on top of them and
keeps the basis `recorder-skipped-search`. Neither says what the game does.

Complete matches went from 606 to 612 in Even More (4 through the recorder's fields, 12 through a skipped search) and
from 512 to 516 in TIM 1 (4 and 8), prefixes from 42 to 36 and from 40 to 36. None is different. The mouse's four run
recordings close in both builds (its flags at `0x06`), and in Even More the cat's two still recordings that look in the
found list (the position words at 100 rule out the frame it shows when they differ).

## The TIM 1 cat's loop over the found list

The comparison tied a skipped search to the loops over its list through the analysis's list scans (`listLoops`). The
Even More cat's loop at `0x1a01a` is one only because of a test the TIM 1 cat doesn't have: inside the loop, Even More
checks that the cat's frame is 0 (`cmp word [si+0x0c], 0` at `0x19fa6`) before it moves the cat, and the list scan
summary follows that loop for a frame other than 0, where the body keeps the cat as it is. The TIM 1 cat
(`0x18431`, loop at `0x186af`) moves itself whenever a mouse is close enough, on any frame, so its body changes the cat
and no list scan summary can hold. That is right as it is, and `behaviour-list-loops.ts` stays unchanged.

Both loops are loops that stop at the first part they act on (`discoverFindFirstLoops`), and the walks name their member
"member found by the loop at 0x186af". The comparison now also takes such a loop as a loop over a skipped search's list
when its first part is loaded once, from the found list field the search fills, through the routine's own part pointer
(only loaded from its argument, and restored on the way out), with every way into the loop going through that load and
nothing on the way changing the pointer. The bytes the run can write are now counted without the bodies of these loops,
which never run while the list is empty, and a pointer tested against itself (`or di, di`) counts as kept.

The TIM 1 cat's four recordings that look in the found list close: complete matches in TIM 1 went from 516 to 520 (12
through a skipped search), prefixes from 36 to 32. Even More stays at 612. None is different.

## The mouse motor's control value at the end of its count

The Even More mouse motor's four run recordings (control value 1, counter 12) agreed frame for frame and stayed
prefixes: some ways of the walk could still flip the frame after the count ran out. The cause wasn't a join. At every
run the mouse motor (`0x1bfb5`) has two paths that flip the frame: one while the counter at `0x96` still runs, one for
the last count, which also clears the control value at `0x12`. The walk doesn't know the counter, only its starting
value plus how far it moved, so both paths apply, and since they lead to the same frame the walk took one step with
what they agree on and forgot the control value. After the count it then allowed "the control value isn't 0" and
another flip.

Now, when only tests of a countdown's starting value tell such rules apart, the walk follows each path as its own branch,
as it already does when they lead to different frames. Nothing is chosen: each branch carries its own test of the
starting value, which a recording that gives the counter decides. The branch for the last count knows the control
value is 0.

All eight mouse motor recordings in Even More now match (the four run recordings through the skipped search, as the
others): complete matches went from 612 to 616, prefixes from 36 to 32. TIM 1 stays at 520, and walk endings don't
change (Even More 696 end through branches and 629 directly, TIM 1 625 and 521). None is different. What stays open in
both builds are the monkey bike's 32 recordings (D2).

## The monkey bike's control value after its reaction

The monkey bike's reaction recordings start on frame 5 with the counter at `0x96` at 20 and the control value at
`0x12` at 0. After 20 runs the bike is on frame 0 with the counter at 0, and there its run (`0x1be5a` in Even More,
`0x1a567` in TIM 1) pedals again unless the control value is 0. Those recordings stayed prefixes in both builds.

Nothing lost the value on the way: the reset walk never knew it. The reset puts back the control value a level saves,
which the walk doesn't know, and the run doesn't write it during the reaction, so the walk carried "unknown" to frame 0. The join into the walk that starts on frame 0 didn't lose anything either, since that walk didn't know it. The
comparison takes a recording's starting fields as the part's fields only on the first run, and on later runs only as
starting values of fields the walk follows from its start (the countdowns). So at run 21 the test of the control value
stayed open.

A decided assumption ([the monkey bike's reaction](../../assumptions/behaviour-assumptions.md#16-the-monkey-bikes-reaction)) settles
it: while the bike plays its reaction, nothing pulls its rope or bounces it, so its control value keeps the value it
had when the reaction started. A walk that starts in the reaction (a first walk, or a starting frame a level saves, on
frames 5 to 12) now keeps the control value as its starting value, like a countdown that never moves. It keeps it
through every run that begins on frames 5 to 12 and through the run right after them, which reads it; then the field
goes back to plain tests of itself. A run that writes it ends this, as for a countdown. A walk started by the bike's own
bounce or rope callback doesn't keep it, since those write the control value; the reset, the flip and the input cases
can. Every finding that keeps the value past a run states the assumption.

The four reaction recordings now match completely in both builds: complete matches went from 564 to 568 in Even More
and from 476 to 480 in TIM 1, and prefixes from 84 to 80 and from 76 to 72. None is different. Walk endings don't
change (Even More 521 end through branches and 577 end directly, TIM 1 450 and 476), and the monkey bike's 65 walks
all still end. What stays a prefix for the bike are its recordings seeded on frames 5 to 12, as before.

## The monkey bike against what the user saw

The user played the game and described the monkey bike. Each statement is checked here against the bike's code and
walks. Addresses are Even More, English floppy; TIM 1, French, has the same routines (bounce `0x1a411`, run `0x1a4ce`,
rope callback `0x1a5d9`, belt partner `0x6df5`), instruction for instruction apart from the addresses.

What the code shows:

- **Frames.** Frame 0 is the bike standing still, frames 1 to 4 pedalling. Frames 5 to 8 are its reaction to a hit
  from standing still, 9 to 12 its reaction to a hit while pedalling. In the part list frames 0 and 5 to 8 draw sprite 4
  of `PART31` at (40, 0) where frames 1 to 4 and 9 to 12 draw sprite 5 at (40, 6): the shade, up or down. Frames 5 to
  12 draw the bike itself with its still sprite 0 and one of sprites 6 to 9 on top: the stars.
- **The run** (`0x1bdbd`). First it asks for the part at the other end of its belt (`0x7970`: the belt record at
  `0x54`, and its other end at `+0x04` or `+0x06`, or 0 without a belt). When there is one and that part doesn't have
  flag `0x0800` in `+0x08`, it copies its own control value `0x12` into that part's (`0x1bddc`). Then, while the counter
  at `0x96` runs, it counts down and steps through its reaction frames (5 to 8, or 9 to 12). When the counter runs out on
  frames 9 to 12 it plays a sound, sets the control value to -1 when the bike is flipped (`0x10` in `+0x08`) or 1
  otherwise, and shows frame 1; on frames 5 to 8 it shows frame 0 and leaves the control value alone. With the counter at
  0 it pedals (frames 1 to 4, round and round) when the control value isn't 0, and otherwise keeps its frame.
- **The bounce** (`0x1bd05`). Only with the counter at 0 (and a contact value below 3): the counter to 28, the control
  value to 0, and frame 5 from frame 0 or frame 9 from any other frame.
- **The rope callback** (`0x1becc`). The rope code of the part at the other end calls it: `0x7e3b` notices that part
  move up or down (`0x7e60`), works out a kind with `0x7996` and calls the bike's rope callback through the type table
  (`0x8462`). Kind 4, with the control value at 0, starts the bike: a sound and the control value -1 or 1 by the flip, as
  above (`0x1bf4c`, `0x1bf53`). On frames 5 to 8 it moves the reaction on to frames 9 to 12 instead (`0x1bf2f`). It
  answers 1 to kind 2 always and to kind 4 while the bike pedals or is on frames 9 to 12; what that answer does to the
  rope isn't followed here.
- **Nothing else writes the bike's control value.** The other place that writes a control value on a rope pull
  (`0x8419`) only does it for a teeter-totter (the type test at `0x83af`), and belt writers skip parts with `0x0800`.
  The bike's constructor gives it flags `0x1805`, the mouse motor's `0x0801`, the jack-in-the-box's `0x1001`. The level
  reset puts back the saved frame and control value (0 in every shipped level).

The statements:

1. **It starts biking when the shade is pulled down.** Agrees. The bike learns of it through its rope callback, not
   from a value another part writes, the byte relay or a search: kind 4 sets its control value to -1 or 1 and its next
   run pedals with the shade down. Which way the rope moves for kind 4 isn't worked out here (`0x7996` compares the
   heights of the rope's ends), so "down" is the user's word for it.
2. **A belt on it works like the mouse motor's wheel while it bikes.** Agrees. Both runs use the same belt helper
   `0x7970`, skip the same flag and copy their own control value into the part at the other end on every run
   (`0x1bddc` and `0x1c010`), and both set that value the same way: -1 when flipped, 1 otherwise (the mouse motor in
   `0x1c074`). The bike copies at the start of its run, before it changes its own value, so the belt follows one run
   later. The mouse motor stops after its 100 runs; the bike doesn't stop.
3. **When hit, it pauses and shows stars, then bikes on.** Agrees. A hit while pedalling shows frames 9 to 12 for 28
   runs (stars, shade down, legs still) with the control value at 0, so a part on its belt gets 0 and stands still too;
   then the bike pedals on. A hit
   while standing still shows frames 5 to 8 and goes back to frame 0, still standing. Until now the walk after a hit
   while pedalling also allowed "stands still on frame 1", because it forgot that -1 or 1 isn't 0 (see
   [values two paths set differently](helpers.md#values-two-paths-set-differently)); now it pedals on in every branch.
4. **If the shade isn't pulled down again, it doesn't start again.** Agrees for the start: only the rope callback's
   kind 4, or the end of a reaction that began while pedalling, makes the control value something other than 0, and a
   hit alone never starts a bike that stands still. But the code has no way for a pedalling bike to stop during a run:
   no routine sets its control value to 0 except the bounce, and after that reaction it pedals on. It stops only when
   the machine is stopped and the level reset puts it back on frame 0 with control value 0. The user confirmed on
   2026-11-06 that this is what the game does: a pedalling bike stops only when the machine is stopped.
5. **A belt from the bike can drive another part, like a jack-in-the-box.** Agrees. The jack's flags have no `0x0800`,
   so the bike's copy reaches it. Its run (`0x1b888`) adds its control value to its frame on frames 0 to 7 (turned round
   when the jack is flipped) and wraps at 8 and -1. The bike writes only -1, 0 or 1, the numbers
   [decided assumption 9](../../assumptions/behaviour-assumptions.md#9-control-values) allows. Each full turn counts `0x96` up, and at 6
   the jack pops (frame 8, sound 3), so a pedalling bike should pop a jack on its belt after 6 turns (48 runs), with a
   pause while the bike shows its stars.

The bike's recordings seeded on frames 5 to 12 (32 per build) used to stay open: they start there with the counter and
the control value at 0, a state the game never gives
([decided assumption 4](../../assumptions/behaviour-assumptions.md#4-the-monkey-bikes-starting-frame)), and the run's input case that
keeps the frame there also tests the belt link at `0x54`, which a clip doesn't save. The recorder answers it: `setup` in
`research/v24/verify_animations.py` clears the part's 0x300 bytes and then sets only the type, flags, position, size,
pointers and the clip's seed, never `0x54`, and the bike's run never writes `0x54` (the comparison counts every write
of the run, as in [what the recorder writes between runs](#what-the-recorder-writes-between-runs)). So in every
recording the bike had no belt. The recorder skipped the belt helper as well (every bike clip lists `0x7970`, in TIM 1
`0x6df5`, as skipped), which also gives 0. The comparison now also checks an input case's starting condition against
those cleared fields, under the basis `recorder-fields`: it says the bike's run keeps the frame on the recorder's bench,
not that the game puts the bike there. All 32 close in both builds: complete matches go from 616 to 648 of 648 in Even
More and from 520 to 552 of 552 in TIM 1 (32 of them through the recorder's fields in each), none is a prefix and none
is different. Walks don't change.

## Walks from a trigger the recorder never performs

A clip used to count for any walk that fits it, also a walk from a trigger: another callback of the part, like the
monkey bike's rope, or another part's write, like a trampoline clearing the mouse's contact bit at `0x06`. But the v25
recorder performs no trigger. `setup` and `clip` in `research/v24/verify_animations.py` put each part alone on a cleared
bench and write the fields the action names (frame, control value, counter, heat, speed and the flags at `0x08`), and
`step` then only calls the part's run routine (`callbacks['update']`), returning 0 from every call that leaves the
parts' code segment. No action calls another callback, and no other part is on the bench. So the mouse's run clips
counted as "touching a trampoline", a touch the recording never had.

A walk from a trigger now counts for a clip only when its start is the recorder's: every bit the trigger writes that
the walk knows is one the action seeds, with that value, and every test of the trigger's on the part's other fields holds
for the seeded fields. A test of the event itself, like the argument the rope passes, says nothing about the part and is
left out. Such a match has its own basis, `seeded-state`, in place of `trigger`: the walk is the run from the recorder's
seed, not proof that the trigger happens. With the recorder's bench (the fields it writes and the ones it clears that
nothing writes) the same check counts under `recorder-fields`. The contact bits a recording starts with clear are bench
here: a walk whose trigger is a touch can't stand for a clip on the grounds that nothing touches the part. When several
walks fit as well, the comparison takes the one that needs the fewest facts beyond the recording: the reset, a resting
frame or creation, then an input case of the run, then a seeded state, then the recorder's bench.

The 11 matches per build through a trigger all move, and every clip still matches: complete stays 648 in Even More and
552 in TIM 1, none is a prefix or different.

- The monkey bike's run clips: the action seeds the control value 1, which the rope callback writes from rest. The rope
  writes 1 only when the flag `0x10` at `0x08` is clear, so for orientations 0 and 32 that is the rope's start and they
  count as `seeded-state` (2 per build). Orientations 16 and 48 set that flag, so the rope doesn't start them like
  this; they now match the run's input case with the belt link the recorder cleared (`recorder-fields`).
- The mouse's four run clips: back to the reset walk with its flags at `0x06` cleared by the recorder
  (`recorder-fields`), as before the touch effects.
- The mouse's three still clips in orientations 16, 32 and 48: the run's input case, which needs fewer facts than the
  trampoline.

Per build the bases go from 1 creation, 11 trigger, 456 reset or rest (364 in TIM 1), 132 input case, 32 recorder fields
and 16 skipped search (12 in TIM 1) to 1 creation, 456 (364) reset or rest, 135 input case, 2 seeded state, 38 recorder
fields and 16 (12) skipped search.

An input case may test the contact bits too, and the comparison takes them as clear from the start, as decided with
the user. A complete match that needs them now says so (`untouchedStart`, with a sentence in its reason), whatever its
basis, and the comparison counts those apart: 8 per build, the cat's 4 still clips and the mouse's 4 still clips.

## Starts that know another value than the recorder had

A walk from the reset, a resting frame or a seeded state starts from the fields that start knows, like the monkey bike's
reset putting `0x2d` at `0x6b`. The recorder never runs the reset: before the first run the part holds its cleared
bytes, the fields `setup` writes (type, flags, position words, pointers) and the clip's seed. The comparison now has that
start for every clip (only the size at `0x40` to `0x46`, the drawing bit `0x1000` of the flags and bytes past `0x300` stay unknown) and the
part's bytes its run rules test, show or work a value out from. A start that knows another value for such a byte isn't
the recorder's start and doesn't count, under any basis; the comparison then needs a walk that starts from the
recorder's value. A start that differs only in bytes the run never reads still stands.

Per build 140 matches from the reset know other values the run never reads, so they stand: the generator (76) and the
electric motor (20) at `0x56` to `0x58`, the candle (12), rocket (8), dynamite (8) and cannon (4) at `0x72` and `0x73`,
the gun (8) at `0x6a` and `0x6b`, the fish bowl (4) at `0x80`. 31 per build read one, and all still match from the
recorder's value, so complete stays 648 and 552:

- the monkey bike's 24 still clips (its normal and stop clips on frames 0 to 4): the run's input case with the belt
  link the recorder cleared, `recorder-fields` (the run reads `0x6b`, which the reset sets to `0x2d`);
- its 4 reaction clips: the walk from its flip callback, `seeded-state`. That walk knows nothing of the part but its
  type, so nothing it knows differs from the seed;
- its 2 run clips that matched the rope: the run's input case under `recorder-fields`, like the other two;
- the mouse's still clip that matched its creation (creation sets flags and position words the run reads): the run's
  input case.

Per build the bases go from 1 creation, 456 reset or rest (364 in TIM 1), 135 input case, 2 seeded state, 38 recorder
fields and 16 skipped search (12) to 0, 428 (336), 136, 4, 64 and 16 (12).

## A seeded state needs the trigger's own start

A walk that knows almost nothing fits almost any seed, like the bike's flip above: the frame and counter came from the
recording, not from the flip. Decided: a seeded state counts only when the trigger's start sets or tests
every field the recorder seeds that the run reads (the frame, control value, counter, heat, speed and flags). The
trigger may write it, its start may carry it from the reset or rest, or one of its tests on the part may hold it, like
the rope's test that the bike is on frames 0 to 4. Otherwise the clip needs the run's input case on the recorder's
values (`input-case` or `recorder-fields`), and stays a prefix if none fits.

Later changes to the descriptions had already moved the bike's 4 reaction clips to the run's input case on the
recorder's values, so on the current base nothing moves: per build 428 reset or rest (336 in TIM 1), 136 input case, 0
seeded state, 68 recorder fields and 16 skipped search (12), all 648 and 552 complete. The rule still matters: in Even
More, of the trigger walks that alone fit a clip as a seeded state (the flips of the vacuum cleaner, fan, alligator and
others, the conveyor belt's, the balloon's and bullet's hits and more), only the teeter-totter's rope outcomes and Mel's
flip still do.
