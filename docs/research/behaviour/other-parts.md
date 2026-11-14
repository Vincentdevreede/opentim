# What parts do to each other

## The explosion's wall split

The explosion's run (`0x1a73a` in Even More, English floppy) finds the parts it hits with an overlap search and goes
through them one by one. It sets a balloon's control value to 1, starts a mouse motor, makes a new explosion for
dynamite, pushes loose parts away, and splits a brick or wood wall at `0x1a8ae`. The split copies the wall with the
part copy at `0x66aa`, puts the copy on the parts list and shrinks the wall.

The reader checks the part copy's complete instruction graph (three compiler forms over the eleven builds): it
allocates the copy and its belt, rope and outline records from the allocator the part factory uses, only reads the
source part, and on a failed allocation calls the release, whose graph is checked too. Its summary returns a fresh part
or zero and changes no existing part. That rests on two decided assumptions, listed with how to recheck them in
[the decided assumptions](../../assumptions/behaviour-assumptions.md):

- A part copy gets fresh memory, and so do the belt, rope and outline records it makes for the copy: none of it
  overlaps an existing part, a rope, belt or pulley record or other storage.
- Releasing a copy that was never linked, after one of its allocations failed, frees only the copy and the records it
  made for it, and changes nothing else.

A routine's return relation can now become a summary when it also writes to a part it made with the part factory or
the part copy: those writes stay in the fresh part and are left out, as long as no kept write stores the new part's
address. Putting the new part on the parts list may rewrite the list links of any part, so the summary names those.
The wall split then has a summary of what it writes on the wall, and so does the dynamite case, which makes a new
explosion with the factory.

With both, the loop over the parts the explosion hits is proved like the other overlap list loops: the search leaves
out the explosion, the body writes fields of the member, its own stack, globals and the parts list links of any part,
and never the found list's next link at `0x78`. The explosion keeps its frame. All its walks end in both recorded builds, and in each 8 more
recorded animations match completely. TIM 1 has the same routines at other addresses (French: run `0x18dd7`, split
`0x18f4a`, copy `0x5a15`), and the run is proved in all eleven builds.

The balloon's and the mouse motor's triggers "A recorded effect of explosion" are gone. They came from the first part
the unproved loop met. A proved loop's effects on its members are kept as per member outcomes. The ones that change a
part's frame are walks of that part again, see [walks from other parts](#walks-from-other-parts).

## The explosion's push

The push that throws a cat or a ball away from an explosion is part of the same loop (Even More, English floppy). A
member whose list flag `0x1000` in field `0x06` is set, and that is not a balloon (type 4) or dynamite (type 19),
takes three calls:

- `0x1a836` picks a speed from the word at `+0x02` of the member's type record: 6144 below 2, 5632 below 6, 5120
  below 10, 4608 below 21, 4096 below 121, 3584 below 151, 3072 below 201, 2560 below 1801 and 2048 from there on.
  The cat's record has 120, so it gets 4096; a bowling ball (200) gets 3072.
- `0x496e` gives the angle of the line between the centres (position plus half the size) of the explosion and the
  member, with the movement angle helper.
- `0x7d97` sets `velocityX` (`0x36`) and `velocityY` (`0x38`) to that speed times the sine and the cosine of the angle,
  shifted right by 14. It replaces the member's speed; it doesn't add to it.

The pinball bumper's bounce calls the same two helpers with its arguments in the same order to throw the ball off, so
the speed points from the explosion's centre to the member's. The flag `0x1000` marks a part on the moving parts list:
the routine at `0x6469` gives a part `0x1000` and puts it on that list when its type's starting flags (the table at
`0x2488` in the data segment) don't have `0x4000`, and `0x2000` with the fixed parts list otherwise. The overlap
search at `0x417e` gets the mask `0x3000`, so it walks both lists, and leaves out a part with `0x2000` in field `0x08`.
The cat has no `0x4000`, and every cat that a shipped level puts in the machine is saved with `0x1000`. The search
runs once, on the step where the explosion goes from frame 1 to frame 2, over its own box widened by 20 pixels on
each side and 24 above and below.

The analysis already has this: the explosion's member outcomes write `0x36` and `0x38` on these paths, and its
description lists them as "Updates another part's motion". Their values stay unnamed. A push changes no frame, so a
walk from it would show nothing new. TIM 1 has the same code (French: test at `0x18e31`, speed `0x18ed6`, angle
`0x3dd6`, speeds `0x726d`), with the type record read from the data segment. The next section shows the push on the
pushed part's own description.

## Effects of other parts

A part's description now lists what other parts do to it without changing its frame, as short lines in
`effectsFromOthers` instead of walks. The first is the explosion's push: "An explosion that reaches it sets its speed
to 4096, away from the explosion. Only when it is on the moving list." Turning the explosion's member
outcomes into trigger walks was tried first: it added about 1,230 walks and made describing a build take 95 seconds
instead of 6, and a push shows no new frame anyway.

Four things make the line possible:

- **The speed setter.** The routine at `0x7d97` is now proved from its whole instruction graph, in two compiler forms
  over the eleven builds (the English CD calls the shift far). It takes a part, an angle and a speed, and sets
  `velocityX` (`0x36`) and `velocityY` (`0x38`) to the speed times the coefficient a quarter turn on and the plain
  coefficient of the angle, each shifted right by 14. The coefficients come from the same checked table as the
  collision rotation, and both fields are always written. The written values stay unknown, since the angle is, but a
  caller now keeps the speed it passed with the two fields (`directedSpeed`), until something else writes them. In the
  explosion's loop that speed is one number on each path, from the speed class of `0x1a836`. The pinball bumper's
  bounce passes 7168.
- **The centre angle.** See [the push's direction](#the-pushs-direction) below: it proves that the speed points away
  from the explosion.
- **The type table.** The report keeps the words of every type record (`typeTable`), so a table read the analysis
  keeps, like the mass at `+0x02` that picks the speed class, can be looked up for a known type. The line states that
  the record keeps its words from the program while a level runs.
- **The starting flags.** The part factory's summary now lists the words a new part gets from the factory's
  type-indexed table (`startingWords`), such as the list flags at `0x06`. Together with
  [the decided assumption on the fixed list](../../assumptions/behaviour-assumptions.md#11-parts-on-the-fixed-list), a part of a type
  with `0x4000` there gets no push line.

A line is made from a proved per-member outcome of another part's routine when, for this part's type:

- the outcome's tests on the member are decided by its type and the type table, apart from which list it is on, which
  becomes the line's condition ("on the moving list");
- the outcome writes only the member, and every field it writes gets a number: a constant, or a speed;
- it doesn't write the part's state, or any field that the part's own rules read. Such a write can change the frame,
  and walks are the place for that.

The source's own tests stay as the line's source condition (for the explosion: going from frame 1 to frame 2), and a
named drawing flag among them is said in words, like "mirrored". Lines that say the same are kept once.

In Even More (English floppy) these parts get the push, with their speed: the cannonball 2048; the rocket, the rope end
and the shamrock 2560; the bowling ball 3072; the birdcage 3584; the cat, the bucket, the jack-o-lantern, the cheese,
the teapot and the pool ball 4096; the basketball, the candle and the super ball 4608; the baseball 5120; the heart and
the tennis ball 5632; the mouse and the explosion 6144. TIM 1 gives the same speeds to the parts it has. The same rule
also finds the jack-in-the-box's punch, which sets both velocities from the same speed classes: for the cat -4096 and
-4096, or 4096 and -4096 when the box is mirrored. A line that sets both velocities to numbers says where that moves
the part on the screen, with the numbers after it: "sets its velocity up and to the left (velocityX -4096, velocityY
-4096)". That a negative velocity moves a part left or up is what the user saw in the game, recorded as
[the decided assumption on screen directions](../../assumptions/behaviour-assumptions.md#12-screen-directions): the code shows that a
velocity has the sign of its position's change, but not how a position maps to the screen. The lab's row shows the direction,
like "Jack-in-the-box up and to the left", and keeps the numbers in its tip.

These effects of other parts are left out, so they are known gaps:

- The balloon's control value set to 1 by the explosion, the mouse motor the explosion starts, and the fish bowl and
  the dynamite it sets to frame 11 and 5: these change the frame, so they are walks, see
  [walks from other parts](#walks-from-other-parts).
- The push on the bullet and on Mel Schlemming: their own rules read their velocity, so these are walks, see
  [hits found by a search's flags](#hits-found-by-a-searchs-flags).
- The wall split: it writes the wall's position and size, but with values that depend on where the explosion is.
- Every other per-member outcome, like those of the bellows, the fan, the teapot and the vacuum cleaner: each writes a
  value the analysis doesn't know, writes the state or a field the part's rules read, or depends on more than the
  part's type, like where the part is.

Describing a build takes as long as before (about 6 seconds for Even More and 5.5 for TIM 1), and no walk changes.
The lab shows the lines in the Interactions tab, under the part that does it (before 2026-11-10 in the Behaviour
tab, under "From other parts"): one row each, with the other part's name, what
it sets and the value, and a chip for what either part must be.

## The fan, the bellows and the teapot push what they find

The three search a box beside them with the overlap search at `0x417e` (Even More, English floppy; TIM 1 French
`0x3597`) and push every part on the moving list it finds. Their push went through three helpers of the compiler's
runtime, which the analysis now reads, recognised by their exact code (the same bytes in all eleven builds):

- `0x2bdb3`: `mov bx, sp`, `mov ax, [bx+4]`, `imul word [bx+6]`, `retf`. It multiplies the two signed words on the
  stack into the 32-bit product in DX:AX.
- `0xc9d5` and its sister entries: a 145-byte body that divides the 32-bit word pair on the stack by the next one and
  pops both (`retf 8`). Its entry sets CX: bit 0 makes it unsigned and bit 1 gives the remainder. A signed division
  truncates toward zero and a remainder takes the dividend's sign, as the analysis's own `s/` and `s%` do. A divisor
  of 0 would fault, so a running game never has one there (an assumption on the summary).
- `0xcaa4`, the 32-bit shift the analysis already knew.

A 32-bit value passed from one helper to the next is split into its two words and joined again; the analysis joins
`x & 0xffff` and `(x >>> 16) & 0xffff` back into `x`, so the value keeps its size. Multiplying folds exactly in every
width (two 32-bit words multiply past what a double keeps).

The search stores in each part it finds, besides the link at 0x78, the overlap at 0x7a and 0x7c. The search's code
gives each its axis: the stored local starts from the found part's positionX for 0x7a and its positionY for 0x7c, so
they are named overlapX and overlapY. Along X it is how far the part lies outside the box: the gap past the box's
right edge, at least 1, or the gap before its left edge as a negative number, at most -1, whichever edge is nearer.
A value read from a found part after the search names it as a run value, "overlapX the query at 0x1abc7 found for"
that part.

The fan's box is 256 pixels long on the side it blows to (right, or left when flipped) and overlaps the part's height,
with 10 pixels to spare above. For each part it finds, the fan adds 16 × (256 − |overlapX|) ÷ the part's mass to its
velocityX (−16 when flipped), and then keeps both velocities within the part's speed limit. The bellows does the same
with 8. The teapot, when it pours, pushes a part that moves slower than 1536 by 1536 (or 1024) up and to the side it
faces, also kept within the part's speed limit. The mass is the type's word at +0x02; the speed limit is the word at
+0x0a, which the game works out for every type from the level's air pressure and gravity, so a line says "kept within
its speed limit" rather than a number.

The lines and the pair check settle each value for the found part's type the same way (`settleForType`): the overlap
reads as the part's own field, the type's settled words are numbers, and the speed limit's clamp is taken out with
"kept within its speed limit". The words write the arithmetic plainly (`tidyArithmetic`): a sign extended word is the
word, `(4096 × x) >> 8` is `16 × x`, and the low word of the quotient is the quotient, which fits a word here because
the box keeps 256 − |overlapX| between 0 and 255.

With this, no pair is missing for a table word any more: Even More goes from 247 missing pairs to 145, TIM 1 from
124 to 59. Four pairs of these three (one in TIM 1) stay missing because a test of the found part isn't settled by its
type. The scoreboard and every recording are unchanged.

## The vacuum cleaner pulls what lies under its nozzle

The vacuum cleaner's run (`0x1e643`, Even More, English floppy) calls the overlap search `0x417e` with a box of 0, 0,
0 and 64: it finds the parts that overlap it across and lie at most 64 pixels below its bottom, and keeps only parts
whose flag 0x2000 at +0x08 is clear. That test of the search was not read before: the search stores the overlaps in a
part after linking it, so a part it skips jumps past those stores too, and the reader now steps over them. For each
part it finds, the vacuum cleaner:

- goes on only when the part's positionY is more than 44 pixels below its own; then it clears the part's contact
  flag, and when the part is less than 47 pixels below, it swallows it (`0x1e8bb`: a balloon pops, every other part
  goes out of play);
- when the part's velocityY is above -1024, works out the pull from the part's mass (`0x1e84e`: 0x0C00 below 2 down
  to 0x0080 from 201) times 80 − |overlapY|, divided by 64, subtracts it from velocityY, keeps both velocities within
  the part's speed limit and velocityY at -1024 or more;
- unless the part's positionY equals its field 0x28, puts Mel Schlemming (type 0x36) below frame 6 on frame 6, and
  moves the part's velocityX by half the pull toward its own centre X: up to 512 when the part's centre X is more
  than 4 pixels left of its own, down to -512 when more than 4 pixels right, and toward 0 when within 4 pixels;
- and in every case puts out a candle (type 0x2d): it clears the candle's fields 0x9c and 0x12 and its state.

For a balloon the pull is 48 × (80 − |overlapY|). When the part's velocityY is already -1024 or less, the vacuum
cleaner doesn't work out a pull, and the velocityX step uses the pull still in its local from the last part it worked
one out for, or, when no part before it in the list had one, whatever the stack held. Only the run knows that value,
so the lines leave those ways out, and the pair check names it for the bullet, the candle, the cat, Mel Schlemming and
the mouse: "a test reads a local the source sets in its loop for some parts only: for this part it holds what the loop
last left there for an earlier part, or what the stack held when no earlier part set it, which only the run knows".
Before, it gave the general reason for a test that reads more than the two parts' own fields.

Reading this took four changes:

- The loop is read again for each type a found part can have (`readBehaviourInSteps`, `readLoopsPerType`). The
  found part's type field is that type, and a word of its type record the game never writes while it runs is the
  program's word, also when a helper reads it, like the mass in `0x1e84e`. The ways that type resolves are kept with
  a few instructions as evidence; the rest of a loop's unresolved ways are kept as one way per loop and set of the
  part's own tests, with the fields they write, so a pair they allow still counts as missing and one the part's flags
  rule out stays ruled out. Only a loop whose unresolved ways read a word of the found part's type record and have
  values the analysis gave up on for their size is read this way: that is what knowing the type fixes. In the eleven
  builds that is the vacuum cleaner's loop alone. The teeter-totter's also reads the found part's mass, for its launch
  speed, but its ways stay open at the contact search whatever the type, and reading it for every type changed no
  pair while it took three minutes a build. The step takes about 24 seconds for Even More, English floppy, against 13
  seconds for the rest: the Lab takes it after the walks are on the page, and adds the lines it gives when it is done.
  `extract-behaviour` leaves it out of its reports. Written out, the vacuum cleaner's ways would be far over a
  gigabyte, as the speed limit's clamp repeats the value inside it; in memory they share it.
  `list-other-part-pairs`, `list-assumptions` and `check-level-frames` take the step.
- A way that is unresolved only because it reads the overlap the search stored (`onlyStoredOverlapsOpen`) counts: the
  part holds that overlap in its own fields, as the fan's push already reads it.
- A test comparing a place of the part with the same place of the source, like the part's positionY against the vacuum
  cleaner's positionY plus 44, or the two centres X (`positionX + frameWidth / 2`), is a place test. Its words say how
  far, above or below for Y and left or right for X: "its positionY is at least 45 pixels below the vacuum cleaner's
  positionY", "its centre X is within 4 pixels of the vacuum cleaner's centre X (positionX + frameWidth / 2)". Each side
  may be its own point along the axis, like the jack-in-the-box's test of the part's positionX + 20 against its own
  centre X, and the source's point may add a value of its own fields: the teeter-totter, after it tilts and redraws
  itself, compares the part's centre X with its positionX plus half the width of its new frame, which the analysis reads
  through its frame list. Reading the distance from such a comparison states that two parts' places differ by less than
  32,768 pixels.
- A test or value may read the part's own speed limit, the word at +0x0a of its type record, as it would read one of
  its fields. The words say it: "its velocityX kept within its speed limit is below 512".

The balloon now gets 25 lines from the vacuum cleaner. Even More goes from 145 missing pairs to 84; TIM 1, which has
no vacuum cleaner, stays at 59. The teeter-totter's search is left missing at its rope pull and its contact search, see
"Where the teeter-totter's launch stops being known".

## Where the teeter-totter's launch stops being known

When it tilts, the teeter-totter (`0x1d27a` in Even More) launches each part on its plank. Its loop over the parts it
finds is read: it gives a part a launch speed by the part's mass (`0x1d735`: 0x1C00 below a mass of 2, then 0x1A00,
0x1800, 0x1600, 0x1400, 0x1200 and 0x1000 from 151 on) as velocityY, with a quarter of it as velocityX, the signs set
by the side of the plank the part's centre X is on and the way the plank tilts. Two calls leave the rest to the run,
and the pair check used to say only "a test or value on it isn't read" for them:

- Before the loop it pulls its ropes (`0x1d638`, called at `0x1d2af` and `0x1d2d1`): it asks the part at the other
  end of each rope, through that part's type's rope callback, whether it gives way. The analysis reads it as a
  connection query, which changes only the part at the other end and its records. Its answer decides whether the plank
  moves, and the tilt and a found part's width are read after it, so these ways test values only the run knows.
- After setting the speeds it runs the contact search (`0x4fd`) on the part twice. The search sweeps a part from its
  previous place to its place, and the teeter-totter sets the part's previousY 16 pixels above its positionY and then
  16 below (`0x1d3c2` and `0x1d3d7` for a part launched up; below first, at `0x1d405` and `0x1d41a`, for one launched
  down). It then sets previousY and the fine positionY to whatever positionY the search leaves. The search may change
  the part's place, its drawing place and frame size, its list flags and its contact record, but not its speeds.

The analysis takes these from the engine summaries of the calls (`connection-query` and `contact-search`), not from
the teeter-totter's addresses, and the lines now read past both:

- A test of what the rope pull answers, or of the source's own fields after it, is a test of the source. It stays in
  the line's source condition as it is, naming the call.
- A found part's field read after the rope pull is the part's own field, as the loop reads it then. This is how a
  line already reads the overlap a search stored in the part: the line is about the part when the source acts on it.
- The fields the contact search leaves, and those set from them after it, are listed without a value: "Then it runs
  the contact search on it, which may change its positionX, positionY, ...; what that search finds there, only the
  run knows." The pair check says "the source runs the contact search on the part" for them.
- When the callback is its source's type's alone, the source's own type is folded in its tests, as the found part's
  is: the teeter-totter's test of its own type and the words of its type record become numbers, and products by the 1
  or 0 they leave drop out of the words.

The balloon now gets 36 lines from the teeter-totter: one for each of the four ways it can be launched in each of 9
cases of the teeter-totter's own fields, which the Lab joins into four rows: "A teeter-totter that reaches it sets its
velocity up and to the right (velocityX 1792, velocityY -7168). Only when its centre X is at or right of the
teeter-totter's centre X (positionX + frameWidth / 2)". The speeds are its mass's (0x1C00 for a balloon) and a quarter
of it.

Missing pairs: Even More 84 → 23, TIM 1 59 → 9. The teeter-totter's pairs are partly described (61 and 50), with only
the contact search's fields unsaid. The bullet and Mel stay missing: their rules read the velocity the teeter-totter
sets, so they need a walk. Walks read past the rope pull too since "Walks past the rope pull and the overlap", but a
walk also needs the source to name the part's type or the tests its search makes on the part, and the teeter-totter's
search names none: the pair check says "its rules read a field the source sets, so it needs a walk, and a walk needs the
source to name the part's type or the tests its search makes on the part, which aren't read for this search".
Since "The lists a search walks" the search's tests are read (it makes none on the parts' flags), and the bullet's
walk is described.

## Walks within reach of the source

A walk from what another part does read a test of where the part lies from the source only for a list consumer, like
the teeter-totter's ends. The lines read such tests for a search's own list since A2, and the walks now do too. The
jack-in-the-box and the alligator flip an electric switch only when its positionX - 2 is left of their centre X and
its positionX + 20 is right of it: "its positionX is at most 1 pixel right of the jack-in-the-box's centre X (positionX +
frameWidth / 2)". The switch's rules read its frame and sockets, which the flip sets, so it is a walk: 8 of them from
each. The vacuum cleaner's walks of the candle (put out), the cat and the mouse (swallowed at the nozzle) need the
nozzle's place too, so those pairs are partly described now, with only the velocities from the pull left unsaid. A
walk with a test comparing two places states, as a line does, that the places differ by less than 32,768 pixels. A
distance of 1 pixel reads in the singular.

Missing pairs: Even More 23 → 18, TIM 1 9 → 8.

The fan, the bellows and the teapot push Mel and the bullet, whose rules read the velocity they set. That velocity is
kept within the part's speed limit, the word at +0x0a of its type record, which the game works out for each level
(`0x107dc` and `0x1084c` in Even More write it), so a walk has no number to follow. The pair check now says so ("its
rules read a velocity the source keeps within the part's speed limit, a word the game works out for each level, so a
walk can't follow it") instead of the reason it gave when it found no other.

A touch line now takes a velocity kept within the part's own speed limit too, as the lines from a search's list have
since A2: the line's settings settle the type record's words for the part's type and keep the speed limit as its own.
So the trampoline's launch reads "sets velocityY to -|velocityY| - 1024, kept within its speed limit", and the
alligator's snap "sets velocityY to -5632, kept within its speed limit and adds 1536 to velocityX, kept within its
speed limit". Their pairs were partly described with the velocity left out; now every part but the bullet is
described (Even More 389 → 430 described, TIM 1 200 → 215), and no pair is left "for a reason this check doesn't
name". The Lab reads an added number with its speed limit as well.

## Values that pick by where the source is

The jack-in-the-box and the alligator push a bellows, a pair of scissors or a teeter-totter by where they are: the
value they set is a choice between values by tests of their own place against the part's, like "stateDelta becomes
1 when the jack-in-the-box's centre X is past the bellows' positionX + 12, else stays". The analysis writes such a
value as `(test) * a + (!test) * b`, which a walk can't follow, since it reads the source. A value that picks by tests
reading the source is now split into its cases, each a way of its own with the case's tests added to the way's and
the value it picks, so the place tests among them read as places. A case that leaves the field as it was writes
nothing; a case whose tests contradict each other or the way's, which a nested choice brings back, never happens and
is dropped. A choice by the part's own fields alone stays one value, like a velocity kept within its speed limit.

So the jack-in-the-box squeezes a bellows at frame 0 "when its positionX is at least 13 pixels left of the
jack-in-the-box's centre X (positionX + frameWidth / 2)" if the bellows is mirrored, and "at most 43 pixels left" if
not; the alligator tilts a teeter-totter by which side of it the teeter-totter's positionX lies. Missing pairs: Even
More 18 → 13, TIM 1 8 → 6. The jack-in-the-box's push of a teeter-totter stays missing: its value grew past the size
budget before it could be split.

## Walks past the rope pull and the overlap

The walks read a search's own list as the lines do: a way open only at the overlap the search stored in the part, at
the source's rope pull or at the contact search it runs on the part is read, the part's field after the rope pull is
its own, the rope pull's answer and the source's fields after it are the source's tests, a frame width the source
redrew reads by its name, and a value takes the words of the part's type record its type settles (not its speed
limit, which has no number for a walk). The fan's walk of the windmill needed the overlap: Even More 435 → 436
described, TIM 1 217 → 218.

## The lists a search walks

Every overlap search walks the parts lists through two routines that take a mask (Even More, English floppy):

- the list head routine (`0x682f`) returns the first nonempty list whose bit the mask has: `0x2000` the fixed list at
  `0x4e1f`, `0x1000` the moving list at `0x4d7d`, `0x0800` the list at `0x4cdb`;
- the list next routine (`0x686f`) returns a part's link, and at the end of a list goes on with the head routine with
  its own mask, or with the list at `0x4cdb` after a moving part when its mask has `0x0800`.

The searches give the head routine their caller's mask (`0x448e` gives `0x3000` itself) and the next routine that mask
with only `0x1000` kept, so the fixed list comes first and the third list never. The analysis reads this from the code
(`behaviour-list-masks.ts`): where each search's masks come from, the lists the two routines pick by each bit, and the
masks each call passes. The calls pass:

| Mask     | Lists                      | Searches                                                                                                                                             |
| -------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x3000` | the fixed and moving lists | the bellows, boxing glove, cat, explosion, fan, jack-in-the-box, magnifying glass, solar panel, teapot, and the candle's and rocket's first searches |
| `0x1000` | the moving list            | the teeter-totter, mouse motor, mouse, Mel's house, vacuum cleaner, and the candle's and rocket's second searches                                    |
| `0x2000` | the fixed list             | the alligator                                                                                                                                        |

The moving list is the one the contact dispatch walks. By the [decided assumption on searches of the moving
list](../../assumptions/behaviour-assumptions.md#22-searches-of-the-moving-list), a search that walks only it never finds a part of a
fixed type, so such a part gets no line or walk from it, states the assumption instead, and the pair check counts the
pair as ruled out. Unlike the list flag `0x1000`, the list holds the bullet: the gun links it in itself. The alligator's search of
the fixed list needs no assumption: its code does something only to six named types, all of a fixed type, so the
other parts it could find get nothing from it either way. A part of a type that isn't fixed can be on the fixed list: the two
routines that make an explosion (type 41), `0x190f:0x32a9`, which the dynamite plunger's triggers reach, and
`0x16ca:0x3792`, link it into the fixed list with the insert routine `0x629d` and set `0x0010` in its `0x06`. The
game's own runs show the same (see the check in the [decided
assumption](../../assumptions/behaviour-assumptions.md#22-searches-of-the-moving-list)): explosions join the fixed list in 7 shipped
puzzles of Even More and 4 of TIM 1.

The analysis reads which types part code links into each list itself (`typesLinkedInto`): a call of the list
insertion that pushes a list head as a constant and, as the part, a register loaded from the part factory's result
just after a call that pushes the type as a constant. Both games give the explosion for the fixed list (and the two
wall split copies, whose type it doesn't read) and the rope ends, pinballs and bullets for the moving list. By the
[decided assumption on explosions](../../assumptions/behaviour-assumptions.md#23-explosions), a type that part code links only into the
fixed list and that isn't fixed, the explosion, is never on the moving list: it gets no touch lines and no search of
the moving list finds it. Pairs, on Even More (English floppy) and TIM 1 (French):

|                  | Even More before | Even More now | TIM 1 before | TIM 1 now |
| ---------------- | ---------------: | ------------: | -----------: | --------: |
| Described        |              398 |           390 |          219 |       215 |
| Partly described |               32 |            31 |           19 |        18 |
| Ruled out        |              648 |           657 |          378 |       383 |
| Missing          |               12 |            12 |            5 |         5 |

The teeter-totter's search (`0x437d`) tests no flag of the parts it walks, only their outline, so its walks no longer
wait for its tests: the bullet's walk of the launch is described. What changed, on all eleven builds (each game's
builds agree):

|                  | Even More before | Even More now | TIM 1 before | TIM 1 now |
| ---------------- | ---------------: | ------------: | -----------: | --------: |
| Described        |              436 |           398 |          218 |       219 |
| Partly described |               71 |            32 |           52 |        19 |
| Ruled out        |              570 |           648 |          345 |       378 |
| Missing          |               13 |            12 |            6 |         5 |

The described and partly described pairs that went were lines the game can't give: the teeter-totter's launch and the
vacuum cleaner's pull of walls, ramps, motors and the other fixed parts (39 each in Even More).

## The bullet's speed limit

The routine that works out every type's speed limit (`0x369c` in Even More, English floppy; `0x2af1` in TIM 1,
French) walks the type records in a loop. For type 20 (the bullet) and type 43 it stores `0x3000` (12288) at +0x0a;
for every other type it stores `0x2600` (9728) minus a value of the level's air pressure: half of it below 70, else 16
times it. The level loader calls the routine after it reads the air pressure, and the control panel calls it after the
player sets a new one (Even More `0x12593`, which keeps the setting from 0 to 128). So the bullet's limit is 12288 in
every level, and every other type's lies between 7680 and 9728.

The analysis now reads the routine (`behaviour-speed-limits.ts`). It finds it by its structure: the stores to +0x0a
through a pointer the loop works out as `type × 58 + table`, with the table the type records' own place, a loop that
counts the type number from 0 to the number of records, and calls from elsewhere in the program. It then follows each
way through the loop's body with the tests of the type number on it (`cmp` and `je` or `jne`), and gives a type the
number the last store on every one of its ways leaves. A way that changes the type number or the pointer, or stores
to a word it can't place, gives no result. All eleven builds give the same: 12288 for types 20 and 43, `9728 - air`
for the rest. The type table keeps the result (`speedLimits`), with the assumption that no other code writes those
words and that the routine's long multiplication and division calls leave the type records alone.

For a type whose limit is a number in every level, a value kept within its speed limit is now that number's clamp, a
value a walk can work out from its starting fields. The bullet's rules read whether `velocityX` is 12288 or -12288,
which the clamp decides, so the alligator's push of ±1536, the trampoline's halving and the fan's push now give the
bullet walks, and they all end. A line says the number: "kept within its speed limit of 12288". For the other types
the limit stays a word of the level, and the pair check still names it.

Pairs, on Even More (English floppy) and TIM 1 (French):

|                  | Even More before | Even More now | TIM 1 before | TIM 1 now |
| ---------------- | ---------------: | ------------: | -----------: | --------: |
| Described        |              390 |           393 |          215 |       217 |
| Partly described |               31 |            29 |           18 |        17 |
| Ruled out        |              657 |           657 |          383 |       383 |
| Missing          |               12 |            11 |            5 |         4 |

The fan's push, the trampoline's and the alligator's are described for the bullet in both games. The vacuum cleaner's
pull of the bullet stays partly described: its tests read the pull left from an earlier part. Walks go from 1,447 to
1,459 in Even More and from 1,217 to 1,223 in TIM 1, and every one of them ends. The recordings match as before: 648
and 552 complete.

## Mel Schlemming's speed limit

Every other type's limit is `0x2600` minus the value the routine works out from the air pressure (the word at
`0x4cb7`, Even More, English floppy): half of it when it is below 70, else 16 times it. The reader reads that too
(`air`): the only three stores to the local the routine takes from the base, `mov`, `sar` and `shl`, around a `cmp`
with 70 and a `jge`. The control panel keeps the air pressure from 0 to 128 (`0x12566` to `0x1257a`; TIM 1, French,
`0x118a6` to `0x118ba`) and a new level starts at 67, and the shipped levels of all eleven builds use 0 to 68. By
[decided assumption 24](../../assumptions/behaviour-assumptions.md#24-the-air-pressure) a level's air pressure is one the panel can set,
so such a type's limit lies between 7680 (air pressure 128) and 9728 (air pressure 0) (`speedLimitRange`).

Two limits of that range only leave a speed different when it lies between them, from 7680 to 9728 or from -9728 to
-7680. So a part's rules can't tell them apart when every test of the field in them gives one answer over each of
those two stretches, and every value a rule stores from the field is a choice by such tests, or the field itself kept
in its own place (`rulesIgnoreLimit`). Mel's rules look at whether he moves up or down faster than 1536, his bounce
notes whether faster than 7168, and keeps his `velocityY` or clears it: none of these tells the limits apart. For such
a part a walk keeps the value within 7680, and states the assumption and that every limit of the range gives the same
frames. The fan's, the bellows' and the teapot's pushes of Mel are walks now, and they all end.

Pairs, Even More (English floppy): described 393 → 396, missing 11 → 8. TIM 1 has no Mel, so its pairs stay as they
were. The vacuum cleaner's pull of Mel stays partly described for its other reasons. Walks in Even More go from 1,459
to 1,468, and every one ends; the recordings match as before: 648 and 552 complete.

## Pushes along the line between the centres

The explosion pushes a part it hits with a speed of 4096, and the pinball bumper throws a part that touches it with
7168, each along the line from its own centre to the part's (see [the push's direction](#the-pushs-direction)). Which
way that is depends on where the two parts are, so a walk had no number to follow when the part's rules read the
velocity. Now the push is split into the directions the part's rules tell apart (`directionClasses` in
`describe-hits.ts`):

- Every answer the centre angle can give, with the true directions it stands for, gives the velocity the setter
  stores, from the program's own tables (`directionCases`, which `directionError` now uses too).
- The part's rules must read the two velocity fields only in tests of those fields alone, and store them back only as
  they were, moved by a number (like the bullet's bounce taking 1 from velocityX on an electric switch), or chosen by
  such tests. Each direction gets the answers of those tests, also at each moved velocity.
- The directions with the same answers are one case. A case must be one stretch of how far the line between the
  centres is from level, the same on every side, so the words can say it. Centres at the same point give the whole
  speed to velocityY, by the assumption the lines already state, and that velocity must fall in one case too.
- The walk takes the velocity of one direction of each case, the one halfway through its stretch, below level to the
  right, and states that every direction of the case gives the same frames.

Mel Schlemming's rules ask whether he moves up or down faster than 1536, and his bounce whether faster than 7168. So
the explosion gives him two walks: "the line from the explosion's centre to its centre is at most 22.1 degrees from
level" and "is more than 22.1 degrees from level, or the two centres are the same point". The bumper gives two at 12.4
degrees. The bullet's rules ask whether velocityX is 12288 or -12288, which no direction of the bumper's 7168 gives,
before or after its bounce takes 1 off, so the bumper gives it one walk with no place in it.

Pairs, Even More (English floppy): described 396 → 399, missing 8 → 5; TIM 1 has neither part. Walks in Even More go
from 1,468 to 1,473, and every one ends; the recordings match as before: 648 and 552 complete.

## The contact response after a bounce

The conveyor belt's and the gear's bounces set the speed of the part that touches them (the belt ±4096 or 4096 more
or less in velocityX, the gear the same with 2048 and 4096 in both) and return 1. The contact dispatch calls a bounce
only in one of its two passes, and each pass then picks a response by the touching part's flags and type: the first
picks the response at `0x3980` when the part has `0x0001` in its list flags and isn't Mel, else the reflection at
`0x3c1c`; the second always picks the exchange at `0x3df7` (Even More, English floppy). Every one of the three writes
velocityX and velocityY on every way through it, from the angle the two parts touch at, which only the run knows. So
when the part's rules read a speed the bounce sets, as the bullet's and Mel's do, the frame it shows next is up to the
response, not the bounce.

The analysis now checks this (`rewrittenByResponse` in `describe-effects.ts`): each pass's routes test only the
touching part's flag bits and type, and for every value of those exactly one route holds; every response is described
and its relation stores the field with no condition. The fields every response writes again are then the response's.
A touch line may now name such a field, though the part's rules read it, and says what follows: "A conveyor belt it
touches sets velocityX to 4096 … Its bounce returns 1 then, so the game always goes on to a contact response, which
works velocityX out again from the angle they touch at: which frame it shows next is up to that response." As the
check shows a response always follows a bounce that returns something other than 0, every such line now says
"always goes on" in place of "may go on". The user chose to count these pairs as described: the bounce's own part is
said in full, and what follows is the response every touch gets.

Pairs, on Even More (English floppy) and TIM 1 (French):

|                  | Even More before | Even More now | TIM 1 before | TIM 1 now |
| ---------------- | ---------------: | ------------: | -----------: | --------: |
| Described        |              399 |           402 |          217 |       219 |
| Partly described |               29 |            27 |           17 |        16 |
| Missing          |                5 |             4 |            4 |         3 |

The conveyor belt's touch of the bullet is described in both games, and the gear's of the bullet and of Mel. What is
missing now is what A4 named and the user chose to leave: the explosion's split of a brick wall and a wood wall, the
jack-in-the-box's push of a teeter-totter, and in Even More the teeter-totter's launch of Mel. No walk changes (1,473
and 1,223, every one ends), and the recordings match as before: 648 and 552 complete.

## The wall split in the explosion's loop

The explosion's wall split (`0x1a8ae`, Even More, English floppy; `0x18f4a` in TIM 1, French) was read as a relation
with every store to the wall and its test, but the explosion's loop still called the wall's fields "a conditional
effect". Four things kept them apart, now changed:

- A relation's field only got one value when every way through the helper stored something in it. A way that stores
  nothing in a field leaves it as it was, and every way's effects are complete, so that way's value is now the field
  itself (`finalOwnerFields`).
- The ways had to split like a tree on the first test of the first way. The wall split tests "the wall starts at or
  after the hole" on one side before "the wall ends inside it", and in the other order on the other, so `chooseByTests`
  now splits on any test every way makes, as itself or its opposite. It still gives up when none does.
- Its values read the explosion through its second argument (`referenced-by(argument+0x8)`), which a caller didn't map.
  It is now the argument the caller passes, here the explosion.
- When the game can't allocate the copy for the far piece (`0x1a91c`), the wall is only cut on one side. That answer is
  only the run's, so it is named, "allocation answer of the call at 0x1a91c", like the other run values.

A relation's chosen value, a choice by the tests of its ways, gets the same larger size bound as a frame drawing value
does in the caller, and more: the wall's width and drawing flags reach 1,431 nodes. Reading a build takes as long as
before (13 seconds for Even More, English floppy). The explosion's own effect lines now say it may put a part out of
play: "May set another part's out-of-play flag 0x2000 in drawing flags …: it does on the ways its tests pick, and leaves
them as they were on the others."

The wall's pairs stayed missing at this step, with a new reason: Even More's said its values depend on the
explosion's own fields, TIM 1's that one isn't known (the allocation answer). The next section gives them lines. No pair, walk or recording changes: Even More 402 described, 4 missing; TIM 1 219 and 3; walks 1,473 and 1,223,
every one ends; recordings 648 and 552 complete.

## Lines of where the source is

A line now says a value or a test that reads the part together with the source, when it reads nothing else, or reads
whether a helper's allocation found room (`readsSourcePlace` in `describe-effects.ts`). The source's fields are named
("the explosion's centre X"), the source's drawn fields read by name as in its tests, and its own type is settled when
the callback is its type's alone. A test of the allocation reads "the game finds room for the copy the explosion makes
(the allocation at 0x1a91c)", or "no room". Such tests go into the line's source condition, with `collider` the part,
as for a touch. Splitting a value by the source's tests (`splitBySource`) now drops the ways that contradict themselves
as it goes, so fields chosen by the same tests, like the wall's seven, give a way per case instead of more than 64.

So the explosion now gives a brick wall and a wood wall a line for each way of the split, in both games. For a wall
wider than tall (Even More, English floppy):

- inside the hole: "sets its out-of-play flag 0x2000 in drawing flags. Only when its frameWidth is above its frameHeight
  and its positionX is at least ((the explosion's centre X - 32) & 0xfff0) + 8 and …";
- reaching past the hole's far edge only: "sets frameWidth to (positionX + frameWidth) - (((the explosion's centre X + 24) & 0xfff0) + 8) and sets positionX to ((the explosion's centre X + 24) & 0xfff0) + 8 and sets drawX to …";
- reaching past the near edge only, or past both when the game finds room for the copy: "sets frameWidth to (((the
  explosion's centre X - 32) & 0xfff0) + 8) - positionX".

A wall taller than wide gets the same in Y. Pairs, on Even More (English floppy) and TIM 1 (French): described 402 →
404 and 219 → 221, missing 4 → 2 and 3 → 1, the same in all eleven builds of each game. What is missing now is the
jack-in-the-box's push of a teeter-totter, and in Even More the teeter-totter's launch of Mel. No walk changes (1,473
and 1,223, every one ends), and the recordings match as before: 648 and 552 complete.

## The jack-in-the-box's push of a teeter-totter

The jack-in-the-box tilts a teeter-totter through a helper (`0x1badd`, Even More, English floppy) that writes its
stateDelta exactly, four times, each under its own tests: by the plank's frame (0, 1 or 2) and by which side of the
jack-in-the-box's centre X the plank's positionX + 36, 40 or 44 is. A caller put such writes in one after another, each
as a choice between its value and the value so far, so every write copied the value so far into both sides of each of
its tests. In the jack-in-the-box's loop that grew past the size the analysis keeps for one value.

Now a caller that gets exact writes of one field whose tests rule each other out (every two writes have a test one
makes and the other makes the opposite of) makes them one choice, built as a tree: it splits on a test, gives each side
the writes that can still hold there, and ends with the field as it was where no write holds. The plank's frame is
tested once, at the top, and each side's place under it. The value is 121 nodes in the loop instead of past the bound,
and the split by where the source is gives the teeter-totter walks, like "Hit by a jack-in-the-box, when its positionX is
at least 45 pixels left of the jack-in-the-box's centre X (positionX + frameWidth / 2)".

Pairs, on Even More (English floppy) and TIM 1 (French): described 404 → 405 and 221 → 222, missing 2 → 1 and 1 → 0.
The only pair missing in either game is Even More's teeter-totter launching Mel, whose launch stops at the contact
search the teeter-totter runs on what it launches. Walks go from 1,473 to 1,477 and from 1,223 to 1,227, and every one
ends; the recordings match as before: 648 and 552 complete.

## The teeter-totter's launch of Mel

After setting a launched part's speeds, the teeter-totter runs the contact search on it (see "Where the teeter-totter's
launch stops being known"). The search may change the part's place, drawing place, frame size, list flags and contact
record, but not its speeds. Mel Schlemming's rules read one of those fields: while he walks (frames 0 to 5) he goes on
walking when his positionY is the word at `0x28` (his positionY two steps back), and when it isn't and |velocityY| is
above 1536 he starts to fall on frame 6. The launch gives him a velocityY of at least 4096 (by his mass, 0x1400 in Even
More, English floppy), so only the place the search leaves decides between the two. A walk needs a number in a field
the rules read, so the pair was missing.

A walk from another part now takes a field the contact search leaves, of those the part's rules read, as unknown, as it
already did for a field a contact response may change after a bounce. It needs at least one other field the rules read
to have a number, here velocityY, and follows both ways where a rule tests the unknown one. Its assumptions say so: the
search may change the place and the other fields above but not the speeds, and the walk takes what it leaves as
unknown. The other parts the teeter-totter launches stay partly described: their rules read none of its speeds, so
they have nothing to follow.

Pairs, on all eleven builds: Even More described 405 → 406, missing 1 → 0; TIM 1, which has no Mel, stays at 222 and 0.
No pair is missing in either game. The walks and recordings of the saved reports don't change (Even More 1,481 and TIM
1 1,227 walks; 648 and 552 recordings complete), since those reports leave out the loops read once for each type of
found part, and the teeter-totter's launch is one of them. Mel's four walks show in the pair check and in the Lab's
"per type" phase.

## Two values the pair check names

After the teeter-totter's launch, two pairs in each build were left with "a value it sets isn't known to the
analysis". Both are read here from the code, and the pair check now names why a line can't give them:

- The explosion splits a brick wall or a wood wall (Even More `0x1a73a`, its type table sends types 1 and 0x30 to
  `0x1a8ae`). It cuts a hole on a 16-pixel grid around its centre X (cx, its positionX + frameWidth / 2), from
  `((cx - 32) & ~15) + 8` to `((cx + 24) & ~15) + 8`, along the wall's longer side (in Y with cy for a wall no wider than
  it is tall). A wall that reaches past both edges keeps the piece before the hole, and the game copies it
  (`0x66aa`) for the piece after it, with 0x0010 in the copy's field 0x06. A wall that reaches past one edge is cut
  back to it. A wall inside the hole is put out of play (0x2000 in its drawingFlags). Each piece gets its outline
  again (`0x1d8bc`). The analysis reads the helper's writes with their tests, but it allocates a part and links it
  into a list, so its effect in the explosion's loop stays a "conditional effect". Read out, the values would still
  come from the explosion's place, and the copy is a part of its own, which a line of the wall can't say. The pair
  check says "a value it sets comes from a helper the source calls on the part, whose tests the analysis doesn't
  carry into the loop".
- The jack-in-the-box's push of a teeter-totter (Even More `0x1b888`, its type table sends type 3 to `0x1badd`) tilts
  the plank by where the jack-in-the-box's centre X is: at frame 0 it tilts to 1 when the plank's positionX + 36 is
  right of that centre, at frame 1 to 1 or -1 around positionX + 40, and at frame 2 to -1 when positionX + 44 is left
  of it. The helper is read exactly, four writes of stateDelta with their tests, but folded one into another in the
  jack-in-the-box's loop the value grows past the size the analysis keeps for one value. Read out, it would be a value
  from the jack-in-the-box's place, which is A5. The pair check says "a value it sets grew past the size the analysis
  keeps for one value".

No pair in the eleven builds says "isn't known to the analysis" now. The missing ones stay at Even More 23 and TIM 1 9.

## The push's direction

The explosion's run gives the speed setter the answer of the routine at `0x496e` (Even More, English floppy) as its
angle. That routine is now proved from its whole instruction graph, in three compiler forms over the eleven builds
(TIM 1 reloads the answer before it returns, and the Even More demo pushes a word straight from DX). It takes two
parts, works out each centre as the position plus half the frame size (`0x1e` plus `0x44` halved with an arithmetic
shift, and `0x20` plus `0x46`), and gives the movement angle helper at `0x2ede0` the first centre minus the second
across and the second minus the first down, each as a sign-extended word. That helper was already proved from its
whole graph, with its loaded table of 512 words.

A caller now keeps which two parts an answer is of with the answer, through registers, its own locals and pushes,
until something else is computed from it. When the speed setter gets such an answer as its angle, the speed it keeps
with the velocity fields says so too (`direction`). In the explosion's loop the first part is the explosion and the
second the part it hits; in the pinball bumper's bounce they are the bumper and the ball.

Whether the velocity then points from the first centre to the second can't be read from the instructions alone: it
depends on the two tables. `directionError` checks it over everything the helper can answer. The helper folds every
direction into one eighth of a turn, picks a table word by the ratio of the smaller difference to the larger in steps
of 1/512, and folds back. So each of its about 4,100 answers stands for a known range of true directions. For each
one the check works out the velocity the setter gives, with the program's own table words and the setter's integer
arithmetic, and the largest angle to any direction in the range. Host trigonometry is only used for the true
directions. Over every speed the explosion and the bumper use, in all eleven builds, the velocity is within 0.23
degrees of the line from the explosion's centre to the part's centre. A line only says "away from the explosion"
when this check passes for its speed; otherwise it keeps "in a direction the explosion works out". The line keeps
the bound with the speed (`away`). The lab's row then reads "speed away", with the bound in its tip.

This rests on two things the line states. The tables must keep their words from the program, as the helpers'
existing assumptions already say. And the centres must be less than 32768 apart across and down, so the word
differences are the true ones. When the two centres are the same point there is no direction: the helper answers a
quarter turn, and the setter puts the whole speed into `velocityY`.

The jack-in-the-box's punch doesn't use the centre angle: it sets fixed numbers, chosen by whether the box is
mirrored. Its lines say the direction on the screen instead, as described above.

## Walks from other parts

When an explosion hits a balloon, the balloon pops; when it hits a mouse motor, the mouse starts running. The user saw
both in the game. The explosion's loop gives these as per member outcomes: it sets a balloon's control value (`0x12`)
to 1, and it calls the mouse motor's start at `0x1c074` (Even More, English floppy). They are now walks of the part
that is hit, with the trigger "Hit by an explosion".

The mouse motor's start first needed its stores to have conditions. It sets the step at `0x12` to -1 when the motor is
mirrored and to 1 otherwise, and the counter at `0x96` to 100 on every path. A helper that only updates its part's
fields was summarised with its stores but without the tests that pick them. The reader now walks every path of such a
helper (`behaviour-owner-paths.ts`) and gives each plain store the tests of the part's own fields that lead to it, when
they decide it: every path through the store makes those tests, the store is the last one to its field there, and
every other path fails one of them. A test only counts when no store or call before it may change the field it reads,
and an `or` or `inc` sets no value. The counter's store gets no condition at all, so a caller knows the counter is 100.
When a loop passes the member it looks at to such a helper and the helper's tests aren't decided yet, the pass splits
on them, so each member outcome knows the step it sets. Of the helpers in Even More the mouse motor's start, the eye
hook's at `0x1aaaa` and the light bulb's at `0x1bbef` (whose stored values stay unknown) get conditions, and only the
start is called on a loop's member: by the explosion, the alligator, the boxing glove, the jack-in-the-box and the teapot. TIM 1 has the same start at `0x1a78b` (French).

The walks come from `hitsFromOthers` (`describe-hits.ts`), which works out each part type's hits from every proved per
member outcome of another part's routine, like the lines in [effects of other parts](#effects-of-other-parts):

- The source's tests on the member must name this part's type (`member type == 4`). A search can hold parts its owner
  never acts on: the candle's first loop sets `0x12` to 1 on every part its search finds, and that search keeps only
  parts with a flag in field `0x0a` that the outcome doesn't show. Without a named type such an outcome gets no walk,
  unless the search's own tests are known, see [hits found by a search's flags](#hits-found-by-a-searchs-flags).
- The member's other tests are worked out for the type, with the type table and the decided assumption on the fixed
  list. What is left, like being mirrored or on the moving list, is a test on the part's own fields that the walk keeps.
  The source's tests of its own fields, like the explosion going to frame 2, are left out.
- The outcome must write a field the part's rules read, or its state, and every such field must get a number. Other
  fields it writes are kept too, as their number or as unknown.
- Outcomes that leave the same numbers in the fields the rules read share one walk, whichever part and path they come
  from. That walk keeps only the tests all of them make, so it may start from more frames than a single path would.

Each hit is walked from the part's reset fields and from each documented stable state, like a callback. In Even More
(English floppy) 8 parts get 11 walks:

- the balloon, control value 1, from a candle, an explosion or a rocket: it pops;
- the mouse motor, step -1 or 1 by whether it is mirrored and counter 100 (two walks), from an alligator, a boxing
  glove, an explosion, a jack-in-the-box or a teapot;
- the cat, frame 1, from a candle or a rocket;
- the fish bowl, frame 11, from an alligator, a boxing glove, an explosion or a jack-in-the-box;
- the dynamite, frame 5, from an explosion (three walks, with its two stable states);
- the windmill, control value 1 and counter 20, from the bellows or a teapot;
- the candle, frame 0 and control value 0, from the bellows, a fan or a teapot;
- the teapot, control value 1, from a candle or a rocket.

TIM 1 (French) gets the same walks for the parts it has, 10 in all. Every one of them ends. The lab shows them in the
Behaviour tab by walk, under "hit by" and the parts that do it.
Describing takes about 6.1 seconds for Even More instead of 5.6, and 5.5 for TIM 1 instead of 5.3. The recordings
match as before: 556 and 468 complete, none different.

The push on the bullet and on Mel Schlemming, and what the candle's first loop lights, are walks now too, see the next
section.

## Hits found by a search's flags

The jack-in-the-box's punch sets the velocity of every part on the moving list that it finds, and the candle's first
loop sets the control value at `0x12` to 1 on every part it finds that isn't lit yet. Neither names a type, so the rule
above gave them no walk: a search may keep only some parts, by tests the loop's outcome doesn't show. The reader now
reads those tests from the search itself.

**The search's tests.** An overlap query (`behaviour-helpers.ts`) now lists the flag tests that decide whether it keeps
a part (`memberTests`). Each is a `test word [part+X], mask` with a `je` or `jne` to the instruction after the link-in,
or the form some builds use, a `je` over a `jmp` there. Every other conditional branch that follows a compare of the
part's fields must only pick between two ways that meet again with no store outside the stack, like the wider box the
search gives type 62. Otherwise, as for a type test that leaves a part out, the query gets no list. Compares of the
position and size were already taken as the spatial test. In Even More (English floppy):

- the search at `0x42da`, which the punch uses (call at `0x1b92f`), leaves out a part with `0x2000` in field `0x08`
  (`0x430b`), and keeps the rest that overlap its box;
- the search at `0x448e`, the candle's first (call at `0x19ab2`), leaves out the same parts (`0x44c0`) and keeps only
  parts with `0x0004` in field `0x0a` (`0x44c7`) whose point lies in its box.

TIM 1 (French) has both, at `0x370f` and `0x38ea`, in the jump-over form. The explosion's search at `0x417e` writes
more fields after the link-in, so its tests are not read; it names its types anyway.

**The flags a type gets.** The part factory now also lists the flags each type's constructor ORs into the new part in
its first straight run of code, before any branch, call or return (`constructorFlags`). Only `0x0004` in field `0x0a`
matters here: the constructors of the cannon (`0x162c9`), the dynamite (`0x16306`), the rocket (`0x1664f`) and the
candle (`0x167ea`) set it, and the factory's own table gives it to no type.

**The walk.** When a loop's outcome names no type, `hitsFromOthers` takes the tests of the searches that fill the list
(those all of them make, when there are several). A part type gets the walk only when the program gives it every flag
the search needs: from the factory's table or from its constructor. The walk keeps every test of the search on the
part, so it still says "only when it has `0x0004` in field `0x0a`" and "only without `0x2000` in field `0x08`": a level
stores these words, so a part may have other flags than its constructor gives. The part reader (`0x13653`) reads the
second word into `0x08` (`0x1368f`) and, in a level of version `0x101` or later (`0x13692`), the third into `0x0a`
(`0x136a4`), clearing only `0x0010` there (`0x136a9`). The rest is as for other hits.

In Even More (English floppy) this adds 8 walks, all of which end:

- the bullet, punched up and to the left or up and to the right (velocityX -2048 or 2048, velocityY -2048), only when on
  the moving list (two walks);
- Mel Schlemming, velocityY -4096 (one walk; the velocityX his rules don't read stays unknown, since a mirrored box
  sets the other sign);
- the cannon, the dynamite (with its stable state, two walks), the rocket and the candle: "Hit by a candle or a
  rocket", control value 1 when it was 0. The rocket's run has the same first search.

TIM 1 (French) gets the same walks for the parts it has, 7 in all. Walks that end, before and after: Even More 1,064
and 1,072, TIM 1 902 and 909, and no part has a walk that stops.

In the shipped levels (Even More, English floppy, and TIM 1, French), every cannon, candle, dynamite and rocket is
saved with `0x0004` in its third flags word and no other part is, and no part is saved with `0x2000` in its second.
No level saves a bullet, and the gun doesn't give the bullets it makes `0x1000`, so the bullet's walks may never
happen in a game; the walk keeps the test.

## Lightable parts

[Assumption 17](../../assumptions/behaviour-assumptions.md#17-parts-the-candle-can-light) settles the first point of the section above:
only the cannon, the dynamite, the rocket and the candle are marked as lightable (`0x0004` in field `0x0a`), and they
always are. `hitsFromOthers` takes that flag as known for every part: set for these four, clear for the rest. Their
"Hit by a candle or a rocket" walks no longer keep the flag test as a condition; a walk still needs the type's
constructor to set the flag. Other types still get no such walk. The ones whose rules read the control value, which
would otherwise get one, state the assumption in their description, like the balloon and the teapot (21 types in Even
More, English floppy).

No walk is added or lost: walks that end stay at 1,098 in Even More and 926 in TIM 1, and the recordings match as
before, 564 and 476 complete, none different.

## The bullet and the jack-in-the-box

[Assumption 18](../../assumptions/behaviour-assumptions.md#18-the-bullet-and-the-jack-in-the-box) settles the second point: a bullet
never has `0x1000` at `0x06`, so the jack-in-the-box never punches it. It works like the assumption on the fixed list
(`offMovingList` in `describe-effects.ts` gives either one), but only for the bullet. The bullet's two punch walks are
gone, and the bullet states the assumption in its description instead. The effect lines take it too, though the
bullet had none.

Walks that end, before and after: Even More 1,098 and 1,096, TIM 1 926 and 924. No part has a walk that stops, and
the recordings match as before: 564 and 476 complete, none different.

## Walks from parts that touch

The contact dispatch (`0x1078` and `0x10bc` in Even More) goes through the moving parts. For one that touched another
part, it calls the bounce callback of the touched part's type, with the moving part as its argument: the analysis
calls it `collider`, and `part` is the touched part. So a bounce callback's writes to `collider` are what the touched
part does to the part that touches it.

`hitsFromOthers` now also reads these outcomes, the same way as a loop's member outcomes: the tests on `collider` must
name the part's type, every write must be to `collider`, and tests of the touched part itself are its own business. The
walk is named "Touching a thumb tack" and kept apart from the "Hit by" walks, even when it writes the same. Its
assumption says the part touches the source, not that a level makes it happen.

In Even More the balloon gets "Touching a bullet, a gear, a scissors or a thumb tack": each sets its control value at
`0x12` to 1, so it pops. The thumb tack does it only at contact angles `0x5e00`, `0x8000` and `0x9c90` (`0x1e2ce`),
which the walk keeps as its condition. Mel Schlemming gets four walks for touching another Mel. TIM 1 has the bullet,
gear and scissors for the balloon. Bounce outcomes that also change the touched part, like the trampoline's and the
electric switch's, or that write values that aren't numbers, like the alligator's, get no walk.
Those that change the touching part without changing its frame get a line instead, see the next section.

## Effects of parts that touch

Most of what a bounce does to the part that touches it changes no frame: the conveyor belt changes its `velocityX`,
the alligator throws it up, the pinball bumper gives it a new speed. These are now lines in `effectsFromOthers`, like
the explosion's push, and the lab shows them with a "touching" chip. In Even More (English floppy) a basketball gets,
among others:

- "A conveyor belt it touches, when the conveyor belt's stateDelta is at least 1, adds 4096 to velocityX. Only when its
  contactEdge is 0 and its velocityX + 4096 is at most 4096. Its bounce returns 1 then, so the game may go on to a
  contact response, which can change these again."
- "An alligator it touches, when the alligator is not mirrored, sets velocityY to -|velocityY|. Only when its
  contactEdge is 0 and |its velocityY| is at least 1536 and ..."
- "A pinball bumper it touches sets its speed to 7168, away from the pinball bumper. Its bounce returns 0 then, so no
  contact response follows."

A bounce path gives a line for a part type when:

- its effects are complete and it writes only the touching part (`collider`) and the touched part (`part`). What it
  does to the touched part is that part's own business, and the line doesn't say it;
- every value it writes on the touching part is a number, a speed the speed setter got (as for the explosion), or
  worked out from the touching part's own fields when the bounce is called, like `velocityX >> 1`. A value that reads
  the touched part, a table or something unknown gives no line;
- it writes no field the part's own rules read, and not its state. Those are walks, see the section above;
- its tests of the touching part's type pass for the type. Tests that name a type, like the alligator's for the mouse
  (type 42), give the line to that type only; the others go on every type that can move. Its other tests stay as the
  line's conditions, in words: of the touching part ("its contactEdge is 0"), of the touched part ("the alligator is
  mirrored") and of the two together ("its centre x - the trampoline's centre x is between -14 and 14").

The contact dispatch walks the moving parts list (head `0x4d7d` in Even More, English floppy, the list the routine at
`0x6469` puts a dropped part on at `0x649a`; TIM 1 French `0x52f9`, at `0x57ee`). So a part of a fixed type never
touches, by [the decided assumption on the fixed list](../../assumptions/behaviour-assumptions.md#11-parts-on-the-fixed-list), and states
it instead of the lines. The assumption on the bullet doesn't apply here: the gun links each bullet into this list
itself. In Even More the game also calls Mel Schlemming's bounce on Mel himself, with what he touched as `part`, so
Mel's own bounce gives Mel no line.

A bounce reaches the same writes on many paths, like the pinball bumper's on four. The paths that set the same and
return the same are joined: each path's tests become the values each tested expression may take, a path whose cases
another already covers is left out, and two paths that differ only in one expression's values become one when the
values together are still one range. A test every value passes drops out, so the bumper's four paths give one line
without tests. Joining only unites whole paths, so a line holds exactly when one of its paths' tests hold.

What the bounce returns decides what follows: 0 skips the contact response, and another number lets the dispatch
pick one by the part's flags, which can change the velocity again (see [contact callbacks and response
selection](contact.md#contact-callbacks-and-response-selection)). The line says which. The words read the compiler's absolute
value `(x ^ (x >> 15)) - (x >> 15)` as `|x|`, a position plus half the frame size as the centre, and the trampoline's
two words at `0x1a` and `0x1c` as one long, positionY times 512 with its sign.

In Even More (English floppy) this gives 441 lines on 24 part types:

- 20 types that can move get 19 each: 12 from the conveyor belt, 4 from the alligator, 2 from the trampoline and 1
  from the pinball bumper (the bowling ball, balloon, basketball, birdcage, bucket, dynamite, baseball,
  jack-o-lantern, heart, rocket, explosion, cannonball, tennis ball, candle, rope end, cheese, super ball, teapot, pool
  ball and shamrock);
- the cat gets no trampoline lines, and the mouse none either but 8 from the alligator: their rules read the list flags
  at `0x06`, where the trampoline clears `0x0001`. The alligator's other 4 lines for the mouse set `0x2000` in its
  drawing flags and `0x0200` in field `0x0a`, which takes it out of the contact dispatch;
- Mel Schlemming gets the conveyor belt's, the alligator's and the trampoline's, but not the bumper's: his rules read
  `velocityY`;
- the bullet gets the alligator's 4 and the trampoline's that keeps `velocityX`, since its rules read `velocityX`.

TIM 1 (French) has no alligator or bumper and a simpler conveyor belt: 167 lines, 10 each for 15 types (8 from the
conveyor belt, 2 from the trampoline), 8 for the cat and the mouse and 1 for the bullet. No walk changes, the lines of
other parts stay the same, and the recordings match as before: 596 and 504 complete, none different. Describing a build
takes about as long as before.

The vacuum cleaner's, the electric switch's, the teeter-totter's and the trampoline's paths for Mel gave no line or
walk at first; see [touch effects of four more parts](#touch-effects-of-four-more-parts) for what they give now.

What the user sees in the game (asked on 2026-11-06) fits two of these lines:

- The alligator bounces a ball up off its back, but not off its head. The code only bounces the ball near one end of
  the alligator: when the ball's centre is past the alligator's position plus 64, or before its position plus 16 when
  it is mirrored. That this end is the back and not the head is what the user saw, not something the code shows.
- A running conveyor belt pushes a ball under it against the belt's direction, as its bounce does on the underside.

What the user saw of the alligator in the game on 2026-11-08 (Even More), to settle question 5 of [the
plan](../../plans/behaviour-plan-together.md):

- The snap is the mouth opening upwards. An electric switch flips only when it is above the mouth.
- A ball that lands on the mouth makes the alligator snap straight away and is thrown up. The cat does the same. The
  mouse is eaten. A balloon does the same as a ball when reverse gravity brings it down onto the mouth.
- A ball or a balloon that touches the mouth from below makes the alligator snap, but isn't thrown.
- A ball held just above the mouth without touching it is left alone when the alligator snaps, however close it is.
- An explosion next to the alligator does nothing to it.

The touches fit the alligator's touch lines (the throw up near the mouth, the mouse taken out of play). The snap's
search walks only the fixed list (see [the lists a search walks](#the-lists-a-search-walks)), and its code does
something only to the bellows, the electric switch, the fish bowl, the mouse motor, the scissors and the
teeter-totter, all of a fixed type: a ball above the mouth isn't on that list, and an explosion, which is, passes every
type test. A touch from below snaps without a throw because the mouth opens upwards, away from a part
underneath (the user); in the code the alligator's touch routine (`0x190f:0x4971`) tests which of its edges was
touched (`contactEdge`, at `0x8a` of the touching part), and all four lines need edge 0.

## Touch lines with cases

The gear's push gave each moving part 96 lines: 2 turning directions, each read from two state differences, times 8
edges, times the limit cases. Paths whose tests differ in more than one value can't be joined into one test, so they
stayed apart. Lines from the same routine that set the same and return the same are now one line with `cases`: each
path's tests, in words, and a line holds when one case holds. The tests every case makes stay on the line. A
basketball now gets 24 lines from the gear, like "A gear it touches adds 4096 to velocityX in 4 cases: (1) when ...".
The lab shows a "N cases" chip and lists them in the row's tip.

## Touch effects of four more parts

The contact dispatch calls the bounce of the touched part with the part that touched it as `collider`. Four bounces
gave the toucher neither a walk nor a line. Each one is now in its "From other parts":

- **The vacuum cleaner** (`0x1e5af`). With the helper above read, its paths are exact. When the vacuum cleaner is on
  (control value not 0) and the part hits it at edge 5 or at contact angle `0x8000`, a balloon gets control value 1
  (it pops: the balloon's walk "Touching a bullet, a gear, a scissors, a thumb tack or a vacuum cleaner"), and every
  other part gets the out-of-play flag and the goal mark `0x0100`. That is a line for the 22 moving types whose rules
  read neither field, and a walk for the cat, whose rules read its drawing flags. The bounce returns 0 then.
- **The teeter-totter** (`0x1d06e`). Its bounce asks the bounce pool whether the landing is new and only then clears
  the toucher's `contactPart` and returns 0. The pool's answer made those paths unresolved. A query's answer is one
  value of that call ([query answers](helpers.md#query-answers)), so a touch path whose only unknown is such an answer now keeps
  it as a test of the touched part, "when the answer of the query at 0x1d12a is not 0", and the line is `inferred`.
  24 moving types in Even More get the line, 18 in TIM 1.
- **The electric switch on a bullet** (`0x1a5d8`). It takes 1 from the bullet's `velocityX`, which the bullet's rules
  read: a flying bullet keeps frame 0 only while `velocityX` is 12288 or -12288 (`0x199f3`). A hit may now set a value
  worked out from the part's own fields as the touch finds them, like `velocityX - 1`, and the walk works it out from
  its starting fields. From the reset that value isn't known, so the hit is also walked from each input case that
  knows every field such a value reads: from frame 0 with `velocityX` 12288 or -12288 the bullet goes to frame 1 and
  rests on frame 2. The trampoline's halving of `velocityX` gives the bullet the same two walks.
- **The trampoline on Mel Schlemming** (`0x1cf17`). When Mel lands more than 14 pixels from its centre, it sets his
  `velocityY` to 0, his frame from 6, 7 or 8 to 9, and returns 1.

To get there, `hitsFromOthers` reads a bounce path like the lines do:

- What the bounce does to the touched part itself is that part's business. Its tests of the touched part, of a query's
  answer, and those that compare the two parts (where the part landed on the trampoline) are the source's tests: the
  walk doesn't keep them, and states so.
- A touch needs no named type: any part on the moving list can touch, so its type tests decide. A part of a fixed type
  never touches, by [the decided assumption on the fixed list](../../assumptions/behaviour-assumptions.md#11-parts-on-the-fixed-list).
- A bounce that returns anything but 0 lets the dispatch go on to a contact response. Every field a response's relation
  stores on the moving part (its velocity and fine position, and for the two-part exchange its list flags) is unknown
  after the touch. A hit whose fields the rules read would all be unknown gets no walk. For Mel this leaves frame 9
  known and `velocityY` unknown. The exchange's relation lists every store it makes; what stays open about it is only
  whether it returns when the two weights add up to 0, which the walk states.

In Even More (English floppy) this gives 12 more walks (1,325 to 1,337 walks that end) and in TIM 1 (French) 8 more
(1,146 to 1,154). Every walk still ends. The new walks also explain 4 recordings of the mouse per build that stopped
early: the trampoline's touch clears the mouse's contact flag `0x0001` at `0x06`, which its run tests, and from there
the walk follows the recording to its end. Recordings: Even More 606 to 610 complete and 42 to 38 prefix, TIM 1 512 to
516 and 40 to 36, none different.

## Which parts can affect which

`list-other-part-pairs` checks that "From other parts" is complete (step C2 of the plan):

    pnpm --filter @opentim/content list-other-part-pairs --evenmore <game folder> --tim1 <game folder>

It goes over every way the code lets one part change another (`other-part-pairs.ts`):

- **A touch.** The contact dispatch calls the bounce of the touched part's type with the moving part that touched it
  (`collider`). Every bounce path that writes `collider` is a way the touched part changes the toucher. A path whose
  tests of the touched part fail for the bounce's own type only runs in Mel's self call (Even More: 5 paths of Mel's
  bounce, which change Mel himself after he touched something), so it is left out.
- **An overlap list.** A run walks the parts its search found. Every per-member outcome that writes the member is a
  way the run changes it.
- **A list consumer.** A run hands a fresh search's list to a helper that writes its members. Only the teeter-totter
  does this, see below.

A pair (source type, target type) is allowed when one path writes a part of the target type, or may write it because
its effects aren't complete, and the path's tests of the part's type, with the type table, don't rule the type out.
Each allowed pair is then:

- **described**: a line or a walk of the target names the source's routine, and together they name every field the
  allowed paths write;
- **partly described**: some of its paths are said and others not; the check names the fields no line or walk says,
  and why;
- **ruled out**: every path needs something a decided assumption excludes: a part of a fixed type is never on the
  moving list, so it never touches and never meets a test for that list ([11](../../assumptions/behaviour-assumptions.md#11-parts-on-the-fixed-list)),
  a bullet never has that flag either ([18](../../assumptions/behaviour-assumptions.md#18-the-bullet-and-the-jack-in-the-box)), and
  only the cannon, dynamite, rocket and candle can be lit ([17](../../assumptions/behaviour-assumptions.md#17-parts-the-candle-can-light));
- **missing**: with the reason the description can't say it yet.

The search also writes the found list's link at `0x78`, and the explosion's, fan's, bellows', cat's, mouse's, mouse
motor's, magnifying glass's, solar panel's and vacuum cleaner's search (`0x417e` in Even More, English floppy) two
more words at `0x7a` and `0x7c`, on every part it finds. No part's own rules read these words, so they never change a
frame; the check lists them apart, as the searches' bookkeeping. The mouse motor's, the magnifying glass's, the solar
panel's and the mouse's loops only read their members, so they give no pair.

The first run found that the boxing glove's punch and Mel's house gave no line, although they set a number for every
type. A loop's line now takes a value the part's type settles, like the punch's speed, which the glove works out from
the mass word at `+0x02` of the member's type record (5120 for the cat), and a value worked out from the part's own
fields, like setting a goal mark. When the source names the part's type, or the reader has every flag test of the
search that found it, the line also keeps the part's own tests that its type doesn't decide, in words, as a touch line
does: "Only when its state is below 6". Without either, a test the outcome doesn't show could still keep the part out
of the list, so no such line is made. A flag the search needs must be one the program gives the type, as for the
walks, and a flag it needs clear is said by name. Mel's house now gives Mel "sets its out-of-play flag 0x2000 in
drawing flags and sets its goal mark 0x0080 in field 0x0a. Only when its state is below 6", and the glove gives 23
moving parts in Even More a line like "sets its goal mark 0x0400 in field 0x0a and sets velocityX to -5120" (17 in
TIM 1, without goal marks). Effect lines in Even More went from 827 to 875 (from loops 64 to 112), in TIM 1 from 554
to 588. No walk changes: walks that end stay at 1,338 and 1,154 and none stays open, the recordings stay at 648
complete in Even More and 552 in TIM 1 with none different, and no rule writes an unknown value.

The pairs in Even More (English floppy); TIM 1 (French) has the same for the parts it has:

| Source and way                      | Described                                                                                                                          | Ruled out                              | Missing, and why                                                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Alligator, bounce                   | Mel (line and walks), mouse; 22 moving parts in part: the throw that sets `velocityX` reads a table word their type doesn't settle | 39 fixed types (11)                    |                                                                                                                                               |
| Alligator, run                      | fish bowl, mouse motor (walks)                                                                                                     |                                        | bellows, scissors, teeter-totter: the value depends on where the alligator is; electric switch: a test compares the two places                |
| Bellows, run                        | candle, windmill (walks)                                                                                                           | 39 fixed types and the bullet (11, 18) | 22 moving parts: the blow's speed reads a table word their type doesn't settle                                                                |
| Boxing glove, run                   | 23 moving parts (lines), fish bowl and mouse motor (walks)                                                                         | 38 (11, 18)                            |                                                                                                                                               |
| Bullet, bounce                      | balloon (walk)                                                                                                                     |                                        |                                                                                                                                               |
| Candle, run                         | balloon, candle, cannon, cat, dynamite, rocket, teapot (walks)                                                                     | 56 that can't be lit (17)              |                                                                                                                                               |
| Cat, run                            |                                                                                                                                    |                                        | mouse: the catch is unresolved                                                                                                                |
| Conveyor belt, bounce               | 23 moving parts (lines)                                                                                                            | 39 (11)                                | bullet: a contact response may change every field its rules read                                                                              |
| Electric switch, bounce             | bullet (walk)                                                                                                                      |                                        |                                                                                                                                               |
| Explosion, run                      | 24 (lines and walks)                                                                                                               | 36 (11, 18)                            | brick and wood wall: the split's values aren't known; Mel: his rules read the velocity, whose direction depends on where the two are          |
| Fan, run                            | candle (walk)                                                                                                                      |                                        | 62: the blow's speed reads a table word the type doesn't settle (bullet: a value isn't known; windmill: unresolved)                           |
| Gear, bounce                        | 22 (lines, the balloon a walk); bullet and Mel in part: a contact response may change every field their rules read                 | 39 (11)                                |                                                                                                                                               |
| Jack-in-the-box, run                | 25 (lines and walks)                                                                                                               | 34 (11, 18)                            | bellows, scissors: the value depends on where the box is; electric switch: a test compares the two places; teeter-totter: a value isn't known |
| Mel, bounce                         | Mel in part (walks): turning round reads a table word                                                                              |                                        |                                                                                                                                               |
| Mel's house, run                    | Mel (line)                                                                                                                         |                                        |                                                                                                                                               |
| Pinball bumper, bounce              | 22 moving parts (lines)                                                                                                            | 39 (11)                                | bullet, Mel: their rules read the velocity, whose direction depends on where the two are                                                      |
| Rocket, run                         | as the candle                                                                                                                      | 56 (17)                                |                                                                                                                                               |
| Scissors, bounce                    | balloon (walk)                                                                                                                     |                                        |                                                                                                                                               |
| Teapot, run                         | candle, mouse motor, windmill (walks)                                                                                              | 38 (11, 18)                            | 22 moving parts: the spout's speed reads a table word                                                                                         |
| Teeter-totter, bounce               | 24 moving parts (lines)                                                                                                            | 39 (11)                                |                                                                                                                                               |
| Teeter-totter, run (contact sweeps) |                                                                                                                                    |                                        | 63: what its contact search finds decides the values (see [effect lines with a proved meaning](#effect-lines-with-a-proved-meaning))          |
| Teeter-totter, list consumer        | bellows, dynamite plunger, flashlight, scissors (4 walks each), fish bowl, mouse motor (walks shared with other parts)             |                                        |                                                                                                                                               |
| Thumb tack, bounce                  | balloon (walk)                                                                                                                     |                                        |                                                                                                                                               |
| Trampoline, bounce                  | cat, mouse (walks), Mel (lines and walk); 21 in part: the bounce's `velocityY` reads a table word                                  | 39 (11)                                |                                                                                                                                               |
| Vacuum cleaner, bounce              | 24 (lines, the balloon a walk)                                                                                                     | 39 (11)                                |                                                                                                                                               |
| Vacuum cleaner, run                 |                                                                                                                                    |                                        | 63: the pull compares the two places and some paths are unresolved                                                                            |

In numbers, Even More: 1,090 pairs allowed, 227 described, 46 partly described, 570 ruled out and 247 missing; TIM 1:
621 allowed, 135 described, 17 partly described, 345 ruled out and 124 missing (the teeter-totter's list consumer
gives the six more pairs, all described, see below). Most missing pairs are of four runs
whose values or tests depend on where the parts are (fan, vacuum cleaner, teeter-totter sweeps, bellows and teapot).
Every pair that is neither described nor ruled out has a reason.

**Constant tests.** A path's conditions can keep a test of two constants, like `1 != 0` or `7 >=s 7`. Such a test
reads no object, and the check used to give it the reason "a test depends on something besides the two parts' own
fields". It now works the test out: when it holds it says nothing and the check goes on to the path's values, and when
it fails the code never takes the path, so the path allows no pair. In Even More, missing pairs with that reason go
from 153 to 128: the teapot's 22 now give the table word as their only reason, the jack-in-the-box's bellows and
scissors the value that depends on where the box is, and its teeter-totter a value the analysis doesn't know. TIM 1
goes from 55 to 52, the same three of the jack-in-the-box. The pair counts themselves don't change.

**The teeter-totter's list consumer.** When a teeter-totter tips, its run (Even More, English floppy: calls at
`0x1d49a`, `0x1d4f8` and `0x1d521`; TIM 1, French: four calls to `0x1bf09`) hands an overlap list to the helper at
`0x1d797`. That helper goes through the list and picks by the member's type from a table of six (`0x1d8a4`). It is
now read path by path, and each of the six parts has walks for it, see
[what a teeter-totter's end does to the part lying there](#what-a-teeter-totters-end-does-to-the-part-lying-there).

Ropes, belts, pulleys and gears also reach other parts, through connections rather than touch or search. They are the
next kind of work (see the plan's last section) and this check doesn't count them.

## What a teeter-totter's end does to the part lying there

When a teeter-totter tips, its run searches a small box at each end and hands each list it finds to a helper (Even
More, English floppy: `0x1d797`; TIM 1, French: `0x1bf09`) with two numbers: where the end is, as pixels to add to
the teeter-totter's `positionX` (74 for its right end, 0 for its left end), and a flag. The helper then goes through
the list and, by each part's type:

- starts a mouse motor (`0x1c074`: sets its control value to 1, or to -1 when it is mirrored, and its counter at
  `0x96` to 100);
- breaks a fish bowl (`0x1ad71`): when its frame is below 11 it sets frame 11 and updates its drawing position, size
  and outline;
- sets the control value of a bellows or a scissors to 1, when it lies close enough to the end;
- sets the control value of a dynamite plunger or a flashlight to 1, the same way, but only at the end that gets
  the flag: the left end when the teeter-totter has just come to frame 0 (its previous frame is 0 and the one before
  isn't), the right end when it has just come to frame 2.

"Close enough" is the end minus the part's `positionX`, in pixels, and the range depends on whether the part is
mirrored. In Even More and TIM 1 alike: bellows 0 to 8 (mirrored 54 to 60), scissors 0 to 12 (25 to 37), dynamite
plunger 103 to 135 (0 to 31) and flashlight 5 to 16 (13 to 24). A positive number means the part's `positionX` is
that many pixels left of the end.

How the analysis reads it. The helper is a list consumer: its loop goes over a list its caller hands in. When the
reader finds such a helper, it now also analyses it with that loop read like a run's own list, which gives what it
does to one member, path by path (`memberOutcomes` on the consumer, taken only when the helper's analysis went over
every path within its budget and its paths write every member field of its footprint). At each call that proves the list is fresh and the helper gets the run's own part,
the run puts in its numbers: the helper's arguments become the numbers the call pushes, and the teeter-totter's
fields become their values at the call. A path that needs another number, like the plunger's path at the end without
the flag, is dropped. The member's tests and values stay of its own fields as the helper gets it. What is left becomes
a per-member outcome of the run that names the consumer, and the hits and the pair check use it like any other list.

A test of where the part lies from the end compares two places, which a walk doesn't follow. Such a test, the end
plus a number minus the part's own field of the same kind, is said in words in the walk's name, for example "Hit by a
teeter-totter, when its positionX is 0 to 8 pixels left of the teeter-totter's right end (positionX + 74)", and the
walk keeps the part's own tests, like whether it is mirrored. Walks with different places stay apart. The two points
the teeter-totter measures from are named: `positionX + 74` is its right end and `positionX` its left end, as seen on
screen (decided on 2026-11-07; the code itself doesn't name them). The mouse motor's and the
fish bowl's paths test no place, so they join the walks the alligator, boxing glove, explosion and others already
give. The teeter-totter's own tests on the way to the call (which frame it has just come to, the answer along its
ropes) are its own business and are left out, as for any run's list.

Only the teeter-totter's own field counts as the point of a place test. In its run (Even More `0x1d27a`, TIM 1
`0x1b99d`) some consumer tests read the owner's positionX as the value its list scan leaves behind (at `0x1d451` in Even More), which
only the run knows. Such a test is not where the teeter-totter is, so it is not said as a place: it stays an open test
and that path makes no walk.

Each of the six parts now has walks from the teeter-totter: the bellows, the scissors, the dynamite plunger and the
flashlight 4 each (two ends, mirrored or not), and the mouse motor and fish bowl through their shared walks.
`list-other-part-pairs` counts the six as their own way, "list consumer", described, and no longer lists the helper
as read only as a footprint. A pair counts only the lines of its own way: a touch's lines for a touch, the run's list
lines for its list and none for a consumer (lines never come from one), so a line of the run's own list never makes
its consumer pair described. The counts in both builds stay as they were. Walks that end: 28 more in each build (Even More 1,363 to 1,391, TIM 1 1,179 to
1,207), and none stays open.
The recordings stay at 648 complete in Even More and 552 in TIM 1 with none different, no rule writes an unknown
value and no effect line is vague.

## Effect lines with a proved meaning

23 effect lines in Even More and 14 in TIM 1 said that what a field means "isn't established". Each now says what the
code does with it (addresses in Even More, English floppy):

- **The out-of-play flag** `0x2000` in the drawing flags. The contact dispatch leaves such a part out (its eligibility),
  the contact search passes over it (`0x058c`, `0x0663`) and the overlap searches leave it out (`0x41b9`, `0x430b`,
  `0x44c0`). The bullet, the vacuum cleaner, the cat, the alligator, Mel's house, the dynamite and the wall split set
  it. When a helper call leaves the drawing flags unknown but its only store to them is an `or` with a number, as in
  the explosion's dynamite and wall helpers, the line says it may set those bits.
- **The ran-this-step mark** `0x0040` in the drawing flags. The step's run loop (`0x0e89`) clears it on the list at
  `0x4e1f` and then calls only the runs of parts without it (`0x0eab`, `0x0ee6`, `0x0f15`). Runs set it on their own
  part, and the gear propagation sets it on each gear it moves; the gear's line about the parts its connections reach
  takes the bit from the propagation's relation (`visitedMask`).
- **The goal marks** `0x0080`, `0x0100`, `0x0200` and `0x0400` in field `0x0a`. No part's code tests them. Only the
  puzzle goal checks do: the routine at `0x14ae` calls the one the puzzle number at `0x4ac1` picks from the far
  pointers at `0x201a`, and each goes through the moving list and sets the game mode `0x4a6d` to `0x0200` when every
  part of one type has its mark. Mel's house marks Mel with `0x0080` (checked at `0x24b3`), the vacuum cleaner marks
  with `0x0100` (tennis balls `0x29a3`, mice `0x2b50`), the cat and the alligator mark the mouse with `0x0200`
  (`0x259d`), and the boxing glove marks with `0x0400` (cats `0x256e`, fish bowls `0x28ae`). A linear decode of the
  whole program finds no other test of these bits in any of the eleven builds; TIM 1 has neither the marks nor the
  checks.
- **The contact flag** `0x0001` in the list flags at `0x06`. The contact search sets it after a contact (`0x073f`).
  While it is set, the mover pulls the part 2 pixels further along its gravity each time it moves it (`0x38aa`, by
  the sign of the type record's word at `+0x08`), and the dispatch picks the response at `0x3980` instead of the
  reflection at `0x3c1c` (the dispatch's response selection). The trampoline and the vacuum cleaner clear it.
- **The fine position**, the longs at `0x16` and `0x1a`. The mover adds the velocity to them and sets positionX and
  positionY to them shifted right by 9 (`0x3896` to `0x38f5`), so they hold the position in 1/512 pixels. The
  trampoline and the teeter-totter set the vertical one from positionY.
- **The previous position** at `0x22` and `0x24` (already named in the layout). The teeter-totter sets it 16 pixels
  above and below the part and runs the contact search, which sweeps from the previous position to the position.
- **What a contact search finds.** Those sweeps fill in the part's contact record: the part it touched at `0x84`, the
  side bytes at `0x86` and `0x87` (`0x0db5`, `0x0dcc`, the helper at `0x04b0`), the angle and the edge, and the
  contact flags at `0x06` (`0x09af` to `0x09e7`). Which part the search finds depends on where the others are, so the
  line says the search may change them and that only the run knows what it finds.
- **Rope links and rope records.** The balloon, when it pops, ties the part on its rope link `0x5a` to the rope end it
  makes, in that part's link `0x5a` or `0x5c`. The teeter-totter's rope callback adds 1 to or takes 1 from field
  `0x0e` of the record of the rope it is asked about, its link at `0x66` or `0x68` picked by the callback's rope
  number.

The flag meanings are a table in `describe-effects.ts` (`partFlags`, placed by the game's `partWords`), and the touch lines use them too: "clears its
contact flag 0x0001 in list flags and sets its fine vertical position (the long at 0x1a, in 1/512 pixels) to
positionY × 512". The comparison now counts 0 vague effect lines in both recorded builds.
