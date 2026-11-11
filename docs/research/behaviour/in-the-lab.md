# In the Lab

## The Behaviour tab

The lab shows each part's routines, changes and walks in three layouts (by routine, by state, by walk), and under
them what comes with the walks: short lines with the analysis's own words in a tip and, where a line is cut short,
the rest when it is opened.

- **Rest.** "placed" says how the reset leaves the frame: one frame, "keeps the saved frame" (the level gives it) or
  "from its plugs" (the sockets give it), with the frames it can be, or "unresolved". "rests on" lists the frames the
  part comes to rest on; its tip says how many walks end on each or that a run keeps it, and opened it gives the
  first condition on the way to each, with how many more walks rest there ("and others" when the analysis keeps the
  conditions of only the first 8). A frame a walk reaches with no test reads "always", with no condition as needed,
  like the teeter-totter's frame 0. A frame the program keeps as a word reads signed, so the wood incline's
  frame 65535 reads -1, here and in the walks.
- **From other parts** (in the Interactions tab since 2026-11-10, opened under the part that does it). A bit with a proved meaning reads by its name, like "contact flag cleared",
  "out-of-play flag set" or "goal mark set", both words of the fine position read as one ("fine Y
  positionY × 512"), and a number added or a halving reads in words. Lines of one part that say the same are one
  row with how many ways give it, and each way's condition when the row is opened: the analysis keeps a line for
  each test its source makes, so the jack-in-the-box's push on the cat is two rows of 5 ways (mirrored and not)
  instead of ten. In Even More the 1,192 lines become 875 rows. A formula the source adds reads as a sum, like the
  fan's "velocityX + 16 * (256 - |overlapX|), kept within its speed limit", and a velocity the source only keeps
  within the part's speed limit says so. A condition too long for a chip, like where the part must be ("its centre X is
  left of the teeter-totter's centre X (positionX + frameWidth / 2)"), is a line under the row that wraps. A row whose
  source then runs the contact search on the part, like the teeter-totter's launch, has a "then contact search" chip,
  and its tip names the fields that search may change.
- **Creates** (in the Interactions tab too, under the part it makes). Each way a part makes another one, like the cannon's cannonball, is the analysis's sentence with
  where the new part starts and how fast it moves. The lab keeps its own name for part 43 elsewhere.
- **To itself and others.** Closed at first: what the part does to other parts (the relay's byte, found lists,
  goal marks, contact flags) and its own flags with a proved meaning (out of play, ran this step), one line per
  sentence with how many ways give it.
- **When it does it.** Under each line of "Creates" and "To itself and others" stands the condition of its first way,
  like the gun's two bullets ("not mirrored" and "mirrored"), with how many more ways there are and each of
  them when the line is opened; "always" when a way has no test. So the teeter-totter's out-of-play flag, the explosion's
  (only for type 19) and the bullet's (only at state 2) no longer read as if they always happen.
- **Walks.** A trigger with more than 12 rows folds them by where they start ("running from 3"), so the
  jack-in-the-box's 156 input cases and the monkey bike's 154 open a frame at a time. Walks from a touch are
  named like the hits, "touching a trampoline"; what the touch needs of the part stays in the condition and the
  tip. A hit walked from an input case shows both in its condition: the case and the hit's own tests, so the
  bullet's "touching a trampoline" rows also read "contactEdge == 0" and the speed the touch needs.
- **Numbers in conditions.** A frame, a speed, a position or a control value reads signed in decimal
  ("velocityX != -12288"), a mask in hex with what it keeps compared in hex too, also from 0x8000 up ("stateDelta & 0x18 == 0x10";
  a mask below 10 and what it keeps as numbers, and a mask of a mask as one), a mask of low bits that isn't a flag word as the rest after
  dividing ("state mod 4 == 3" for `state & 3`), a direction in degrees ("collider.contactAngle <
  315°") and a test of its top bit as the half of the turn it is in ("collider.contactAngle from 270° to 90°" for
  `(collider.contactAngle - 16384) & 0x8000 != 0`), and an unsigned test's number as it is. The absolute value of another part's field reads "|found.overlapX|".
  The analysis's own sentences next to them say a frame, a speed and the control value signed too: the wood
  incline's walk "Shows state -1" and the bullet's case "a part-specific value is -12288".
- **Flag bits in conditions.** A test of one bit reads as words, by the names in [Flag bits](#flag-bits): every bit
  the program uses on a part has one, like "mirrored", "in a bucket" or "placed by the puzzle". Another part's bit
  starts with its name, "collider on the moving list", and a bit flipped before the test reads the other way. Masks of
  more than one bit keep the form above. The analysis's sentences name a flag without its bit
  ("its out-of-play flag is clear"), and a field they call by its offset gets the lab's name for it ("its olderY",
  and in what a part sets on a part it makes, "sets link0 to its link0 … and changes its lists, fineX"), with the
  fields the level loader fills (`marks` at `0x0a`, the belt's and rope slots' places, `extra`), the relay's byte
  (`relayByte` at `0x14`), the fine position and the fuse. A field of a rope record reads by its name: the parts at its
  ends (`end0`, the one that holds it, and `end1`), their slots and their points (`end0X` to `end1Y` at `0x14` to
  `0x1a`, as `0x7996` reads them). In the sentences too a test of one flag bit reads as its name ("drawingFlags &
  0x0200 is 0" as "not held this step"), a value kept to a word loses the mask, a position masked with `0xfff0` reads
  "rounded down to 16", and the address of an allocation is left out. A goal mark another part sets reads "goal mark
  set" in that part's row.
- **Numbers in formulas.** A number in a formula reads in decimal and signed ("/ 28000", "-2048"), a mask in hex. A
  word taken as signed (`(x ^ 0x8000) - 0x8000`) and a value kept to a word (`x & 0xffff`) read as the value, and
  `x & 0xfff0` as "x rounded down to 16". A table in the program reads "table[…]" and a value a query, a call or a
  loop leaves reads by what it is, "the query's answer", without the address: the instructions in the tip have it. A
  flag word with bits set, cleared or switched reads by their names ("drawingFlags with mirrored switched" for
  `drawingFlags ^ 0x10`), the low bits of a number as "mod" ("state mod 4"), and the program's way to pick one of two
  values without a jump, `(a & (c * -1)) | (b & ((c * -1) ^ 0xffff))`, as "a if c, else b". In Even More (English
  floppy) the Behaviour tab's three views show no number in hex for any of the 63 parts, down from 158, and neither do its
  folded findings (20 before) or the Interactions tab with every row open (1,906 before). In TIM 1 (English) 4 are
  left, all in folded findings: the solar panel's search tests the run loop's step count, a word of the data segment
  (`ds:0x4ea7`) the formulas don't name yet, and the magnifying glass has a term the analysis leaves raw.
- **Rope callbacks.** Their walks and changes name what the rope code passes them: `otherEnd` (the part at the other
  end of the rope), `ropeSlot` (which of its two rope links), `ropeKind` (the kind of pull, with 0x8000 when it only
  asks), `pullMomentum`, and `askedRope`, the record of the rope it is asked about (decided assumption 1). A test of
  the kind reads "pull kind 4, not a question": the rope code (`0x7996`) gives kind 1, 2 or 4, with 8 or 16 for the
  side of the rope, which the callbacks mask off, and the teeter-totter adds 0x8000 when it only asks (`0x1d2a5`). The tip
  gives each name's raw form. In Even More this leaves 22 of the 7,768 conditions the tab shows with raw terms, down
  from 311: the rope callback's argument on two parts' resting frames, the flip's argument on part 47 and a table
  with an unknown index on part 4.
- **Run values.** A value the run finds itself reads by what it is: "stateDelta after the query", "found",
  "reached" (a part through a rope, belt or pulley), "the centre angle", "the gear jam", "next in the list after
  the insertion", and a value a test picks as "3 if state == 2, else 5".

## Flag bits

A part has three flag words: the list flags at `0x06`, the drawing flags at `0x08` and the marks at `0x0a`. Of their
48 bits the program uses 40 on parts; each has a name in the lab (`FLAG_BITS` in `apps/lab/src/behaviour.ts`). The
level file keeps all three words and the loader puts them back ([what the loader keeps](../levels.md#what-the-loader-keeps)),
so a level shows the bits as they were saved. The bits were found by going over every test, set and clear of the three
words in the routines the analysis decodes and the routines they call, with the starting words of the part factory,
the constructors and the shipped levels. Addresses are Even More (English floppy); TIM 1 (French) has the same tests
at its own addresses, but not the editor lock and the goal marks.

The list flags:

| Bit      | Name                      | What the program does with it                                                                                                                                                                                                                                                                              |
| -------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x0001` | in contact                | Set by the contact search after a contact (`0x073f`); the mover pulls the part 2 pixels further along its gravity while it is set.                                                                                                                                                                         |
| `0x0002` | hit a fixed part          | The contact search clears `0x0002` and `0x0004` (`0x09af`) and sets this one when the touched part is a fixed kind or either part touches like a fixed part (`0x09dd`). The contact dispatch then runs the reflection or the response (`0x1071`).                                                          |
| `0x0004` | hit a moving part         | Set by the contact search otherwise (`0x09e7`), and always when the touched part is a pool ball. The dispatch runs the contact pair exchange (`0x10b5`, `0x3df7`).                                                                                                                                         |
| `0x0008` | hit handled this step     | Set on both parts by the contact pair exchange (`0x3e0c`, `0x3e10`); the dispatch passes over a part with it (`0x1044`), so a pair is handled once. Cleared with the other contact bits (`0x11c4`).                                                                                                        |
| `0x0010` | made during the run       | Set on a part another part makes while the machine runs and puts on the moving list: the balloon's, cannon's, gun's and plunger's runs, and a cut rope (`0x192ee`, `0x19bc3`, `0x1b3bc`, `0x1c3d9`, `0x1cb9e`). The reset to the start takes such a part off its list and frees it (`0x894f`).             |
| `0x0020` | slides with more friction | The first response takes 32 off the speed along a slope instead of 2 (`0x3aed`). Constructors give it to the balloon, birdcage, bucket, dynamite, candle and teapot.                                                                                                                                       |
| `0x0040` | drawn as tiles            | The level file's tiles bit: walls drawn from tiles, read by the frame size helper (`0x695a`).                                                                                                                                                                                                              |
| `0x0200` | can be turned upside down | The editor offers the upside down flip (`0x53b9`, the type's flip callback with 2): the wood incline, switch, eye hook, light bulb and curved pipe.                                                                                                                                                        |
| `0x0400` | can be mirrored           | The editor offers the left to right flip (`0x5355`, the flip callback with 1): 24 types, from the cat to the teapot.                                                                                                                                                                                       |
| `0x0800` | in the parts bin          | The third list, the parts bin.                                                                                                                                                                                                                                                                             |
| `0x1000` | on the moving list        | The list of moving parts.                                                                                                                                                                                                                                                                                  |
| `0x2000` | on the fixed list         | The list of fixed parts.                                                                                                                                                                                                                                                                                   |
| `0x4000` | fixed kind                | Every fixed type starts with it (the factory's starting words, a wall `0x4800`), also in the parts bin; the contact search counts a touched part with it as fixed.                                                                                                                                         |
| `0x8000` | placed by the puzzle      | When a level is set up (`0x13f83`), the parts on the fixed and moving lists get it while the word at `0x508c` is set (`0x13f3a`) and the parts in the bin lose it (`0x13f2c`): the mouse can't pick such a part up (`0x50eb`). Every static and moving part of a shipped level has it, no part in the bin. |

`0x0080` and `0x0100` are never tested or set.

The drawing flags:

| Bit      | Name                         | What the program does with it                                                                                                                                                                        |
| -------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x0001` | takes a belt                 | A belt end can be put on it (`0x5854`): the conveyor belt, mouse motor, jack-in-the-box, gear, generator, monkey bike, windmill and electric motor.                                                  |
| `0x0002` | has a belt on                | Set when a belt is put on it (`0x10eb6`) and cleared when the belt goes (`0x5f1c`); a belt end can't go on a part with it.                                                                           |
| `0x0004` | takes a rope                 | A rope end can be tied to it (`0x5176`).                                                                                                                                                             |
| `0x0008` | takes a rope at either end   | The teeter-totter: the rope goes to the nearer of its two rope places (`0x517d`).                                                                                                                    |
| `0x0010` | mirrored                     | The level file's mirror bit (`horizontalFlip` in the layout).                                                                                                                                        |
| `0x0020` | upside down                  | The level file's upside down bit (`verticalFlip`).                                                                                                                                                   |
| `0x0040` | ran this step                | The run loop clears it first and calls no run of a part that has it.                                                                                                                                 |
| `0x0080` | can be stretched sideways    | The editor offers the width handles (`0x5341`): walls, the wood incline, the conveyor belt and the grass floor.                                                                                      |
| `0x0100` | can be stretched up and down | The editor offers the height handles (`0x534b`): the walls and the grass floor.                                                                                                                      |
| `0x0200` | held this step               | The teeter-totter only: its rope connections answered that it can't tip, so its bounce and the connection query answer at once (`0x1d06e`, `0x1d638`). The run loop clears it every step (`0x0e97`). |
| `0x0400` | known free this step         | The teeter-totter only: it asked and may tip, so it doesn't ask again that step (`0x1d27a`). Cleared with `0x0200`.                                                                                  |
| `0x0800` | turns by itself              | The mouse motor, monkey bike and windmill: the gear chain doesn't drive a part with it (`0x1b2ac`, `0x1b32f`), and the electric motor doesn't turn it through a belt (`0x1a4e6`).                    |
| `0x1000` | drawn from pieces            | The part's picture for its state is a frame of pieces from its type's frame list (`0x18d8f`); without it the state is one picture.                                                                   |
| `0x2000` | out of play                  | The contact dispatch, the contact search and the overlap searches pass over it.                                                                                                                      |
| `0x8000` | touches like a fixed part    | Only the cat's and the mouse's constructors set it; a part that touches one bounces off it as off a fixed part (`0x09af`).                                                                           |

`0x4000` is never tested or set.

The marks:

| Bit                  | Name                  | What the program does with it                                                                                                                                                                                                                                 |
| -------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x0001`             | has a plug            | The fan, electric motor and vacuum cleaner: placing one looks for a socket to plug into (`0x112dc`, `0x5d14`).                                                                                                                                                |
| `0x0002`             | has sockets           | The switch, generator and solar panel, with their two sockets at `0x62` and `0x64`: a plug looks for one with a free socket (`0x5d69`), and placing one runs the plugging again (`0x112ee`, `0x5e2f`).                                                        |
| `0x0004`             | lightable             | The cannon, dynamite, rocket and candle: a flame looks for its fuse, the point `fuseX`, `fuseY` at `0x72`, `0x73` (`0x44c7`).                                                                                                                                 |
| `0x0008`             | placed freely         | A part with it goes where the mouse puts it; one without it snaps to the 16 pixel grid (`0x111c3`).                                                                                                                                                           |
| `0x0010`             | in a bucket           | The bucket marks each moving part falling into or lying in it (`0x4617`); the run loop clears it every step (`0x0fba`). The goals "A baseball in every pot" and the like test it, and a candle or rocket in a bucket is drawn cut off at its rim (`0x18f3e`). |
| `0x0020`             | in the drawing layers | Set when the part is linked into the screen's layer lists (`0x184df`) and cleared when they are taken down (`0x1857f`).                                                                                                                                       |
| `0x0040`             | locked in the editor  | Switched by a key in the editor while the word at `0x538d` is 2 (`0x10cb2`): the part gets no handles (`0x5337`) and the mouse treats it like a puzzle part (`0x5110`). One wood wall in the shipped levels has it.                                           |
| `0x0080` to `0x0400` | goal mark             | Only the goal checks test them; who sets each is in the level's goal.                                                                                                                                                                                         |

`0x0800` to `0x8000` are never tested or set on a part.

## Reading in the background

The lab reads the behaviour on a worker after the files load, in five steps: the parts' code (type by type), the
goals, the walks (a pass over every part as the source of hits, then each part), the loops read per type, and the
walks again. Each step tells the page how far it has come, and every place that waits for it (the Behaviour and
Interactions tabs, a level's goal) shows the same progress block: a bar over the whole read, the step and what it is at,
and about how long is left. The status bar shows "Reading behaviour" and the bar on every page until the read ends, with the step, the share
and the time left in its tip. The bar weighs the steps
by how long they took on Even More, English floppy (13, 0.2, 95, 25 and 99 seconds in Node); the time left is the time
so far over the share done, so it settles as the read goes on, and the slow parts (the vacuum cleaner's walks take 14
seconds) make it jump a little.

## The Interactions tab

A part on the Parts page has its tabs Frame, Behaviour, Interactions and Type (the part type's record in the type
table). The Interactions tab is what the part does to other parts and what they do to it, one row per other part,
from what the walks say other parts do to each part and the parts a part makes. A row says whether the part touches the other or reaches it (a fan's wind, a
vacuum's pull), or both, and has a square for each thing it does: takes it out of play, sets a goal mark, pushes or
moves it, makes it, marks a contact, changes another field. A row opens in place to each way, with the
rows "From other parts" and "Creates" had in the Behaviour tab before. The loops read per type come last and add rows, like the vacuum cleaner's pull.

## Words for the Behaviour tab

Step A6 of the plan makes "From other parts" readable at a glance on the fan, the vacuum cleaner and the
teeter-totter, checked in a browser on the balloon.

- A source that redraws itself and then reads its own frame width reads the value the frame-position helper
  (`0x68aa` in Even More) writes in frameWidth: a word of its frame list picked by its state, or its baseWidth. The
  lines say that value by its name when it is the helper's value with each of the part's fields standing for the same
  value throughout, so the teeter-totter, which steps its frame before it redraws, reads at the frame it stepped to.
  Its launch then says "its centre X is left of the teeter-totter's centre X (positionX + frameWidth / 2)" instead of
  the frame list formula. A source whose callback is its type's alone has its type folded in its tests, and products
  by the 1 or 0 that leaves drop out.
- The words drop a division by 1 (a push divided by a mass of 1) and a low-word mask inside 16-bit arithmetic that
  wraps anyway, so the vacuum cleaner's pull reads "velocityY - (48 * (80 - |overlapY|))". Before a shift right, a
  division or a comparison the mask stays, since there the high word of a 32-bit product would count:
  `((48 * x) & 0xffff) >> 1` is not `24 * x` once 48 × x passes 32,767.
- A place at least 1 pixel to one side reads "left of" or "below", not "at least 1 pixels".
- The lab reads a formula added, a velocity only kept within the speed limit, long conditions as lines, and the
  contact search after a launch, as "The Behaviour tab" says.
