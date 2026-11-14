# TIM2.EXE and TOONS.EXE

What the behaviour reader needs to know about the programs of The Incredible Machine 2 and Sid & Al's Incredible
Toons, compared with TIM.EXE. Addresses are those of the English Toons build and the multilingual TIM 2 CD build;
image addresses are linear offsets into the load image, with the overlays laid out after it (see below).

## How the programs are built

TIM.EXE is packed with LZEXE 0.91. TIM2.EXE and TOONS.EXE are not packed: their load image is the bytes after the EXE
header, up to the size the header gives (`loadImage` in `packages/content/src/read/toons.ts`). Both carry the same
linker mark, `FB 50 6A 72` at 0x1c of the header, where TIM.EXE has LZEXE's. The code of all three looks the same:
the same prologue (`push bp; mov bp, sp`, then `sub sp, n` and `push si; push di`), far routines that end in `retf`,
and calls to a routine of the same segment written as `push cs; call near` (often after a `nop`).

Both TIM2.EXE and TOONS.EXE keep most of their part code in overlays, after the load image, with `FBOV` in front, as
[the file formats](../file-formats.md#toonsexe) describe for Toons. TIM 2 is built the same way:

| Build                      | Segments | Overlays | Overlay bytes |
| -------------------------- | -------: | -------: | ------------: |
| TIM 2, multilingual CD     |       94 |       34 |       0x1b780 |
| TIM 2, multilingual floppy |       90 |       34 |       0x1ab50 |
| TIM 2, English demo        |       92 |       34 |       0x1a5b0 |
| Toons, English             |      121 |       68 |       0x21040 |

A far pointer to a routine in an overlay points into the overlay's stub segment: at the entry, `int 3Fh` and the
routine's offset in the overlay. When the overlay manager has loaded an overlay it writes a far jump over each of
those entries, so a call through a stub goes on to the routine. A record's callback, a far call in the code and a far
pointer in the data can all point at a stub. For reading, `readToonsMemory` lays every overlay after the load image;
the reader then leads every far pointer that points into a stub to the routine itself (see "Reading the overlays"
below).

The data segment is the one the entry code loads first (`mov dx, segment`); the most common `mov ds` of the code gives
the same segment in all four builds, as it does for TIM.EXE.

## TOONS.EXE

**Records.** 85 types, one 70-byte record each, in a segment of their own: the table is at offset 0xf2 of segment
0x3b6a (image 0x3b792), not at the start of a segment as in TIM.EXE. The six callbacks are far pointers from 0x2e, in
TIM.EXE's order (TIM.EXE has them from 0x22).

**Calling a callback.** The code finds the record as TIM.EXE does when the table is in a segment of its own, with 70
for 58, and the callback's place in the record plus 0xf2 as the displacement:

```
push si                 ; the part
mov ax, [si+0x04]       ; its type
mov dx, 70
imul dx
mov dx, 0x3b6a          ; the table's segment
mov bx, ax
mov es, dx
call far es:[bx+0x124]  ; 0xf2 + 0x32, the run callback
```

| Field | Callback (TIM.EXE's name) | Calls |
| ----- | ------------------------- | ----: |
| 0x2e  | bounce                    |     3 |
| 0x32  | run                       |     5 |
| 0x36  | reset                     |    22 |
| 0x3a  | flip                      |    10 |
| 0x3e  | resize                    |    11 |
| 0x42  | rope                      |     7 |

The run calls all push the part (`push si`) and take its type from `[si+0x04]`, as in TIM.EXE.

**Parts.** A part is a near pointer into the data segment, the first word of the routine's arguments (`mov si,
[bp+6]`), as in TIM.EXE. Its fields are packed: some words are at odd offsets (`[si+0x1f]`, `[si+0x45]`, `[si+0x8d]`).
What is known so far:

| Offset | What                                                                          | TIM.EXE |
| ------ | ----------------------------------------------------------------------------- | ------- |
| 0x04   | Type: the run calls take it to find the record.                               | 0x04    |
| 0x06   | Flags: bit 0x40 draws the part as tiles.                                      |         |
| 0x08   | Flags: bit 0x1000 draws the frame from pieces, as TIM.EXE's drawing flags do. | 0x08    |
| 0x0e   | State: the frame drawing indexes the record's positions (+0x1c) with it.      | 0x0c    |

The frame drawing routine (image 0x17d79) is TIM.EXE's with a far record: it reads the record through a far pointer it
builds from the table (`add ax, 0xf2` and segment 0x3b6a), takes the positions' far pointer from +0x1c and adds twice
the state, and with bit 0x1000 takes the piece from +0x18 at four times the state.

The other fields the reader names are in [The part fields](#the-part-fields) below.

## TIM2.EXE

**Records.** 281 types. The data segment has a table of near pointers, one per type, to 72-byte records in the same
segment (at 0x4ba in the CD build, 0x302 on the floppy, 0x280 in the demo). The first 128 records follow each other;
after that most types point at one shared record.

A record starts with eight far pointers to routines, 4 bytes each from 0x00. The code calls each through the table of
pointers, with the part's type at part offset 0x08:

```
push word [bp+0x08]     ; the part, a far pointer: segment
push word [bp+0x06]     ;                          offset
les bx, [bp+0x06]
mov bx, es:[bx+0x08]    ; the part's type
add bx, bx
mov bx, [bx+0x4ba]      ; its record
call far [bx+0x04]
```

| Field | Calls | What it seems to be                                                      |
| ----- | ----: | ------------------------------------------------------------------------ |
| 0x00  |     3 | Bounce (TIM.EXE's first callback has 2 calls)                            |
| 0x04  |     7 | Run (6)                                                                  |
| 0x08  |    23 | Reset (16); the caller then copies the state (0x10) to 0xa8              |
| 0x0c  |    11 | Flip (6); the caller then copies the flags (0x0c) to 0xac                |
| 0x10  |    12 | Resize (13)                                                              |
| 0x14  |     4 | Rope (2)                                                                 |
| 0x18  |     1 | Draw: most types share one routine that draws the part's animation frame |
| 0x1c  |     3 | Optional (null for many types): called when a part is set up, 0 stops it |

The names of the first six follow TIM.EXE's order; the counts fit, but no single call proves a role.

**Parts.** A part is a far pointer, two words of arguments: the routine loads it with `les bx, [bp+6]` and reads
every field through `es`. The fields found so far are TIM.EXE's, 4 bytes further on:

| Offset | What                                                  | TIM.EXE |
| ------ | ----------------------------------------------------- | ------- |
| 0x08   | Type                                                  | 0x04    |
| 0x0c   | Flags: 0x10 mirrors left to right, 0x20 top to bottom | 0x08    |
| 0x10   | State: the draw routine passes it on to the animation | 0x0c    |
| 0x22   | x, less the screen's scroll                           | 0x1e    |
| 0x24   | y                                                     | 0x20    |
| 0x44   | Width the mirroring uses                              | 0x40    |
| 0x46   | Height the mirroring uses                             | 0x42    |

Pointers in a part are far too: the bounce callbacks read another part's far pointer from 0x9a and 0x9c (TIM.EXE has
a near pointer at 0x84). The fields the reader names now are in [The part fields](#the-part-fields) below.

**Drawing.** A part's frame comes from its `.ANM` animation (see [the file formats](../file-formats.md#tim-2)), not
from pieces in the record, so TIM.EXE's way of proving the state field (the drawing indexes the record's frame
positions with it) has nothing to find. Instead, the routine most records point to for drawing reads the state
(`mov ax, es:[bx+0x10]`) and passes it as the second argument of the animation routine, which checks it against the
animation's count of steps (`cmp es:[bx+0x0c], di; ja`) and picks the step's word with it. That is how the reader
proves the state field of TIM 2.

## What this means for the reader

- **Loading.** TIM.EXE is unpacked; TIM2.EXE and TOONS.EXE are laid out with their overlays.
- **Records.** Toons: 70 bytes, in a table at an offset of a segment. TIM 2: 72 bytes, reached through a table of
  near pointers, and not one after the other.
- **Callbacks.** Toons: six from 0x2e. TIM 2: six from 0x00, then the draw routine and the optional set-up routine.
- **Parts.** Toons: near, like TIM.EXE, with other offsets. TIM 2: far, so every field is read through `es` after
  `les`, and the routines pass a part on as two words. TIM.EXE's helpers were all recognised by their near-pointer
  code, so in TIM 2 they need their own forms.
- **State field.** Toons: proved by the frame drawing, as in TIM.EXE but with a far record. TIM 2: proved by the draw
  routine handing it to the animation routine as the step to show.

## Reading the overlays

The reader lays out the program as the overlay manager would with every overlay loaded (`readToonsMemory`), and then
points every far call and far jump that goes to a stub straight at the overlay's routine, and writes a far jump over
every stub entry, as the overlay manager does when it loads an overlay. A record's callback pointer is followed
through the stub the same way. This is the program as it runs once all overlays are in memory; which overlays are in
memory at a time only changes speed, not what the code does.

## What the reader reads so far

Numbers from one read per build, without the loops read once per found type. A part counts as read fully when all six
of its callbacks are; a routine is read fully when its status is `complete`. No routine stops the read in any build
(none has the status `error`). Fewer routines than in the first read: a call to the program's start (0:0) is no longer
followed (see below), so the reader no longer reads the whole program as a callee. TIM 2's routines include the
set-up routines (see below).

| Build                      | Parts | Parts read fully | Routines | Read fully | Read in part | Helpers recognised |  Time |
| -------------------------- | ----: | ---------------: | -------: | ---------: | -----------: | -----------------: | ----: |
| Even More, English CD      |    63 |               63 |      940 |        210 |          730 |                159 |  12 s |
| Toons, English             |    75 |                6 |      454 |        120 |          334 |                 69 | 110 s |
| TIM 2, multilingual CD     |   149 |                0 |      667 |        169 |          498 |                 80 |  23 s |
| TIM 2, multilingual floppy |   149 |                0 |      654 |        169 |          485 |                 80 |  23 s |
| TIM 2, English demo        |   149 |                0 |      654 |        168 |          486 |                 80 |  22 s |

In Even More most routines read in part are bounded by a helper's summary (700 of the 730), which is why all its parts
read fully. In Toons and TIM 2 the reasons are different:

| Reason the reader gives (times, over all routines)                           | Even More CD | Toons | TIM 2 CD |
| ---------------------------------------------------------------------------- | -----------: | ----: | -------: |
| A call's effects are not fully resolved (the callee is read in part)         |           20 |   643 |      823 |
| A loop (back edge) without a proved invariant                                |            5 |   102 |      162 |
| The path budget runs out                                                     |            1 |    18 |       30 |
| The part pointer is lost at a write through an address it can't place        |            0 |    31 |       31 |
| An instruction with no rule (`int`, `rcl`, `rcr`, `in`, `out`, string moves) |            3 |    63 |       72 |
| An indirect call or jump without a proved target or table bound              |           17 |    15 |       15 |

With the larger path budget for helpers (below), the reader gets further into more routines, so it meets more calls and
loops it can't settle; the counts above are of those notes, not of routines.

### What changed the counts

- **Calls to the program's start.** TOONS.EXE and TIM2.EXE (CD and demo) have calls that reach the program's start,
  0:0, and following them read the whole program as a callee. The reader stops there and says so in the routine's
  notes. TIM.EXE has such calls too, through code pointers that are still 0 when the game starts (for example the
  driver pointer at `cs:0x1ed` in Even More); its reads still follow them, because changing that would change its
  checked results (`stopAtProgramStart` in the profile).
- **Switch tables.** TIM2.EXE doubles a switch's index with `add bx, bx` where TIM.EXE uses `shl bx, 1`; the reader
  takes both. This opened up most of TIM 2's type switches (unbounded indirect jumps went from 185 to 15).
- **Confined loops.** A loop that changes only registers and private locals, makes no calls and has no other stores is
  gone past: those registers and locals are forgotten and the code goes on where the loop leaves
  (`CONFINED_LOOP_ASSUMPTION`). It is on for TIM 2 and Toons only (`confinedLoops` in the profile), for the same reason
  as above.
- **Code segment variables.** A store to a fixed address in the code segment (`mov cs:[x], ax`, the overlay manager's
  and the drivers' variables) is a variable apart from the parts (`CODE_VARIABLE_ASSUMPTION`), so the part stays known.
  TIM.EXE has no such stores, so this holds for all games.

## Settled from the programs

Addresses are image addresses of the TIM 2 CD build and the English Toons build.

**TIM 2's animation loader keeps the parts.** The loader (`0x36500`) takes one argument, the animation's number, which
it only pushes on. Its callees (147 routines with it, all read completely) store only:

- on their own stack;
- into globals at fixed places of the data segment;
- into a fixed table of 500 slots of 8 bytes in segment `0x4340`;
- into blocks the resource system reaches from its own globals and allocations: the heap's block headers, expanded
  memory (`int 67h`) and file data (`int 21h`).

Twice it calls a handler through a table whose far pointer is the global at `ds:0x66ac`. The table is allocated and
filled by the routine at `0x137a4`, whose four callers register the handlers of the resource caches (`2f91:0a5d`,
`33d1:0531`, `33d1:09a4`, `35e3:00fe`). Those store in the same places; the stores at `+0x70` to `+0x76` that look like
part fields are into the fixed table in `0x4340`. No store goes through a part pointer. So such a loader is read with
TIM.EXE's resource service assumption (`SCALAR_SERVICE_ASSUMPTION`), and the handler table with
`HANDLER_TABLE_ASSUMPTION` (`behaviour-scalar-loaders.ts`, the profile's `scalarLoaders`, on for TIM 2 and Toons). TIM 2
has eight such loaders. The routines they call now count as bounded by the loader, as in Even More, so fewer routines
count as read fully, while unresolved calls went from 1134 to 1058 and loops from 164 to 135. The frame chain behind the
loader was then still blocked one step up; see "A helper whose first argument is a number" below.

**The bounce calls by the passed part's own type.** TIM2.EXE's dispatcher (`0x511f5`) first calls the bounce code of the
part's own type, when bits 0x06 of its flag byte at `+0x0a` are set and it is a cupid, Mel Schlemming, super ball or
blimp (types 33, 54, 59 and 109); then, with bit 0x02, the bounce code of the type of the part it touches (its link at
`+0x9a`). TOONS.EXE (`0x2281`) does the same with bits 0x06 of the flag word at `+0x06`, for any type, and the link at
`+0x8d`. Both calls pass the same part, and the bounce code finds its owner through that part's link either way. So it is
one code path: the existing reading holds for both, with the passed part as the collider and the part it touches as
the owner. What the self call adds is that, for those parts, their own bounce code also runs when they touch something,
and it acts on the part they touch. The bounce callback's assumption now says so.

**What the self call does, under the touching part's own type.** Neither dispatcher uses what the self call returns:
TIM2.EXE drops it and reads the part's flags again (`0x5122d`), TOONS.EXE pops the argument and goes on (`0x229d`).
The profile lists the types (`selfBounce`: the four types in TIM 2, every type in Toons), since the reader doesn't read
the dispatcher's type tests. The descriptions now give such a type `ownBounce` lines: what its own bounce sets on the
part itself, from the same bounce paths as the touch lines, with its own type settling its tests and the part it
touches standing in for the owner ("When it touches a part, its own bounce runs on it too and sets +0x16 to 4. Only
when its field 0x0c & 0x0010 is 0."). A touch line leaves out a write to a field the part's rules read, since a walk
follows it; no walk starts from the self call, so these lines keep such a write and say it can change the frame. In
the TIM 2 CD build only the blimp gets lines (it sets its field 0x16 to 4 or 3 by its field 0x0c bit 0x10). The super
ball's and Mel's bounces also set fields of the touching part from field relations the reader doesn't work out, so
those paths give no line, and the cupid's bounce, read only in part, sets no field of the touching part on the paths
it reads. In Toons 8 types get 35 lines. The missile sets its own stateDelta to 1 when it touches a part that isn't one
of nine types and |its field 0x39| is above 2560; the yellow ball, the piano, the balloon and Eunice the elephant have
lines like it. The gear (24 lines), the conveyor belt (5) and the vacuum get lines too, though such parts may never
move: the reader doesn't know which Toons types stay on the fixed list, so it can't leave them out, as for their touch
lines. TIM 1 and Even More read and describe the same as before: the profile lists no types for TIM.EXE, and Even
More's self call of Mel's bounce (see [contact](contact.md)) is read from its dispatcher and keeps its own handling.

**TIM 2's set-up routine.** The routine at record `+0x1c` (11 routines, 20 types) is read like a callback, as
`PartBehaviour.setUp`, with the ways it answers 0. With a part, it allocates the part's extra data and stores its pointer
in the part. The inclines, the pulley, the conveyor belt, the phazer, the rope end, Mel's house and the message computer
never answer 0. The rope, the steel cable and the belt answer 0 when the allocation fails. The lasers, the laser mixer
and the programmable ball test the far pointer they built from the allocation and the data segment, which can't be 0, so
they never refuse a part either. The reader shows that test as `(… | 17877) == 0`, 17877 being the data segment.

**Toons' word at 0x0c isn't the previous state.** Three places copy the state into it, but the run code of many parts
counts with it: the baseball, the soccer ball, the bomb, the pistol, the balloon, the cushion, the ant motor and others
add 1 to it, set it to 0 and to small numbers, and wrap it. Al and Sid read it as what they are doing. TIM.EXE's state
history rule doesn't name it in Toons (`stateHistory` in the profile); the field roles name it a counter, as for other
counted words. The previous state is 0x10: TOONS.EXE's history update copies the state there (see
[The part fields](#the-part-fields)).

**TIM 1 and Even More with the two new rules.** Measured with both rules on (stop at the program's start, go past
confined loops), not committed:

- Even More, English CD: 940 routines become 463. 477 were reached only through calls to 0:0, through code pointers that
  are still 0 when the game starts, like the driver pointer at `cs:0x1ed`. 210 stay read fully. 21 routines read
  differently: 3 more are read fully through confined loops and 3 fewer. Every part gets one more note.
- TIM 1, English: 830 routines become 273, with 181 read fully either way, and the same 21 differences.
- The teeter-totter reads much worse: 118 of 141 transitions unresolved instead of 6 of 38. The birdcage's visible effects
  and the balloon's transitions change too.

So the rules don't make TIM.EXE read better as a whole; they stay off for it.

**A helper whose first argument is a number.** The reader takes the first argument of every far routine that isn't a
part's callback for a part. TIM2.EXE's frame box routine (`0x3621c`) gets the animation number there, and passes it on
to the animation loader. For TIM 2 and Toons (`numberArguments` in the profile) a routine whose code only compares that
argument with a number or passes it on as the first argument of a resource service, and never loads it as a pointer, is
read as taking no part (`numberFirstArgument` in `behaviour-scalar-loaders.ts`). The far buffer such a routine fills
(`les bx, [bp+n]`) is now mapped to what the caller passed there, and helpers in TIM 2 and Toons may take 4,000 steps
instead of 800 (`helperPaths`), since TIM2.EXE's frame size helper switches over many types in one routine. With that,
TIM 2's frame chain opens: the frame box routine, the frame size helper (`0x1d6d6`) and the frame position helper
(`0x1d637`, about 90 callers) are read in full, and TIM 2's routines read fully go from 137 to 169 (CD). Toons moves
from 118 to 120.

## The part fields

TIM.EXE's part fields are named from its frame drawing (`behaviour-layout.ts`) and from what its helpers do with them
(`behaviour-fields.ts`), all recognised in TIM.EXE's near-pointer forms, so for TIM 2 and Toons the layout named only
the type, the state and a few flags. Both programs have the same routines as TIM.EXE, written in their own forms: TIM
2's through a far part pointer (`les bx, [bp+6]` and `es:`), Toons' through a near one at other offsets. Each game's
profile now lists those routines as forms (`fieldForms`, `behaviour-field-forms.ts`): the routine's bytes, with the
field offsets as the places to read. A form names a field only where it is found, and the offsets come from the
matched bytes. Each form is found exactly once in every build (TIM 2 CD, floppy and demo, and Toons) and gives the same
offsets in all three TIM 2 builds. A name that two forms give must have the same offset in both, and a form that
disagrees with a field the layout already proved (the type, the state) names nothing.

The names are TIM.EXE's where the routine is TIM.EXE's, so a description says `positionX` in every game. Addresses
are image addresses of the TIM 2 CD build and the English Toons build.

| Field                     |    TIM.EXE |      TIM 2 |                  Toons | Shown by                                                                                                                                                                                                                                                                              |
| ------------------------- | ---------: | ---------: | ---------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| positionX, Y              | 0x1e, 0x20 | 0x22, 0x24 |             0x1f, 0x21 | The frame position helper (TIM 2 `0x1d637`, Toons `0x61e9`) copies them into the drawing origin. The level loader puts the file's place there (`check-level-fields`).                                                                                                                 |
| drawX, Y                  | 0x2a, 0x2c | 0x2e, 0x30 |             0x2b, 0x2d | The same helper: the position, plus the frame's offset, or with a mirror bit the extent less the offset and the frame size.                                                                                                                                                           |
| drawingFlags              |       0x08 |       0x0c |         0x08 (already) | The same helper tests bit 0x10 (`horizontalFlip`) and 0x20 (`verticalFlip`) to mirror; Toons' frame size helper (`0x6212`) does.                                                                                                                                                      |
| horizontal/verticalExtent | 0x40, 0x42 | 0x44, 0x46 |             0x41, 0x43 | What a mirrored frame's offset is reflected by in the same helper (TIM 2) and in the frame size helper (Toons `0x6340`).                                                                                                                                                              |
| frameWidth, Height        | 0x44, 0x46 | 0x48, 0x4a |             0x4d, 0x4f | Subtracted in the reflection; the frame size helper sets them (TIM 2 `0x1d6d6`, Toons `0x6212`).                                                                                                                                                                                      |
| frameOffsetX, Y           |            |            |             0x45, 0x47 | Toons only: the frame size helper keeps the frame's offset, reflected when mirrored, in the part; the frame position helper adds it to the position.                                                                                                                                  |
| baseWidth, Height         | 0x50, 0x52 | 0x54, 0x56 |             0x59, 0x5b | The frame size helper copies them into the frame size for the types it names (TIM 2 `0x1d803`; Toons `0x624d`, parts drawn as tiles and types 0 and 40). TIM 2's goal routine reads the middle as position plus half of them; the Toons level loader puts the file's base size there. |
| previousX, Y              | 0x22, 0x24 | 0x26, 0x28 |             0x23, 0x25 | The motion helper (TIM 2 `0x1df8a`, Toons `0x7b3f`) subtracts them from the position; the history update (TIM 2 `0x1eba5`, Toons `0x88bc`) copies the position into them.                                                                                                             |
| velocityX, Y              | 0x36, 0x38 | 0x3a, 0x3c |             0x37, 0x39 | The motion helper sets them to the position less the previous one, shifted left by 9 less its argument, as TIM.EXE's does.                                                                                                                                                            |
| previousState             |       0x0e |       0x12 |                   0x10 | The history update copies the state into it, after it copies it into olderState.                                                                                                                                                                                                      |
| olderState                |       0x10 |       0x14 |                   0x12 | The same history update.                                                                                                                                                                                                                                                              |
| stateDelta                |       0x12 |       0x16 |         0x14 (already) | TIM 2: the one routine that adds a field to the state (`0x237c0`, in `0x2374c`), as TIM.EXE's rule finds it.                                                                                                                                                                          |
| savedPositionX, Y         | 0x8c, 0x8e | 0xa4, 0xa6 | 0x95, 0x97 (lifecycle) | TIM 2: the level reset (`0x1ed1a`, which then calls each part's reset callback) puts them back into the position. Toons: the reader's lifecycle names them once positionX is named.                                                                                                   |
| savedState                |       0x90 |       0xa8 |         0x99 (already) | TIM 2: the same level reset puts it back into the state.                                                                                                                                                                                                                              |
| savedDrawingFlags         |       0x94 |       0xac |         0x9d (already) | TIM 2: the same level reset puts it back into the drawing flags.                                                                                                                                                                                                                      |
| contactPart               |       0x84 | 0x9a (far) |                   0x8d | The contact producer (TIM 2 `0x506ec`, Toons `0x1c51`) stores the part it found; the bounce dispatchers follow it.                                                                                                                                                                    |
| contactAngle              |       0x88 |       0xa0 |                   0x91 | The same producer stores the edge's angle plus 0x8000.                                                                                                                                                                                                                                |
| contactEdge               |       0x8a |       0xa2 |                   0x93 | The same producer stores its loop index less 1.                                                                                                                                                                                                                                       |
| outlinePointCount         |       0x80 |       0x96 |                   0x87 | The same producer's walk along the other part's outline stops at it.                                                                                                                                                                                                                  |

"Already" means the layout named the field before. Not named, though the same routines show them:

- **The outline points.** TIM 2 keeps a near pointer at 0x98 and Toons a far one at 0x89, both to records of 6 bytes
  (x, y and the edge's angle as words). TIM.EXE's `outlinePoints` is a near pointer to records of 4 bytes with byte
  coordinates, and the outline tables and the constructor reads take it as that, so the name would mislead them.
- **The older values of the history update**: the position, the drawing origin and the frame size one step further
  back (TIM 2 0x2a to 0x38 and 0x4c to 0x52, Toons 0x27 to 0x35 and 0x51 to 0x57). TIM.EXE's layout doesn't name
  them either.
- **Links, plugs, ropes, the belt and the extra word.** The level loader shows where they are (see
  [the levels research](../levels.md)), but TIM.EXE's layout doesn't name them, and the descriptions read them by
  their own rules.
- **The contact side bytes** (TIM 2 0x9e and 0x9f, Toons 0x8f and 0x90) and the mass the TIM 2 pair response
  weights the motion with (0x3e, in `0x4f89d`).

**The fine position** follows positionX: TIM.EXE keeps the longs in 1/512 pixels at 0x16 and 0x1a, 8 and 6 bytes
before positionX and positionY. TIM 2's level reset sets 0x1a and 0x1e from the position shifted left by 9
(`0x1eda1`), and in Toons a routine next to the contact producer (`0x17fe`) sets 0x17 and 0x1b from positionX
and positionY the same way (`0x1ac6`). The descriptions named those
words by TIM.EXE's offsets, so TIM 2's stateDelta at 0x16 read as a fine position; they now place them by positionX
(`finePosition` in `describe-effects.ts`), which gives TIM.EXE's offsets for TIM.EXE.

**What it changes.** The read counts stay the same: TIM 2 CD 169 of 667 routines and 0 of 149 parts read fully, Toons
120 of 454 and 6 of 75. TIM.EXE's helper recognisers that look fields up by name are written for its near forms and its
offsets, and none of them starts to match in TIM 2 or Toons. The descriptions read the fields by their names now.
Counted over each part's description texts (each text once), the places that give a field by its offset (`field 0x37`,
`+0x37`) go from 571 to 310 in the TIM 2 CD build and from 59,438 to 283 in Toons. For example, Toons' conveyor belt
touched by a gear: "adds 4096 to field 0x37 in 4 cases: (1) when the gear's state - the gear's field 0x10 is -1, and
(its field 0x93 + 4) & 0x0007 is 0" now reads "adds 4096 to velocityX in 4 cases: (1) when the gear's state - the gear's
previousState is -1, and (its contactEdge + 4) & 0x0007 is 0". TIM 2's blimp: "its own bounce runs on it too and sets
+0x16 to 4. Only when its field 0x0c & 0x0010 is 0" now reads "sets stateDelta to 4. Only when it is not mirrored". TIM
1 and Even More read and describe the same as before: their profile has no forms.

**The walks with the new names.** Toons' walks are the same, frame for frame; only their trigger words now use the
names. TIM 2 CD's change in two ways. The flashlight's walk from its reset now rests at frames 0 and 1 where it joined
an earlier branch: with previousState named, the walk can tell a frame that stays from one it comes back to. And 321
more walks start from input cases on the named fields (the mandrill motor's "state-control value is not 0" and the
like), each of which stops at its first frame because the effects of the run there aren't resolved; they claim nothing
new, but they make the list longer.

**TIM.EXE's words by place.** Some words the descriptions know from TIM.EXE's routines but not from the layout: the
list flags at 0x06 (the list bits, the contact flags and the bits the descriptions name), the bits they name in the
drawing flags at 0x08 and the goal and lightable marks at 0x0a, the contact search's side bytes at 0x86 and 0x87, the
rope links (0x5a to 0x60), the rope places (0x6a, 0x6c), the rope and belt records (0x66, 0x68, 0x54), the plugs (0x62,
0x64), the rope ends (0x96, 0x9c), the relay's value (0x14), the found list's link (0x78), and the type record as 58
bytes with the words TIM.EXE writes while it runs and its speed limit at +0x0a. They were applied to every game, so a
Toons part's word at 0x0a read as TIM.EXE's goal marks ("sets its goal mark 0x0100 in field 0x0a"), and a Toons type's
record words were read 58 bytes apart instead of 70. They are now TIM.EXE's profile's `partWords`, and the descriptions
and the per-type re-read use them only when the profile has them: for TIM 2 and Toons they say nothing of those words,
the decided assumptions about them (the fixed list, the bullet, the lightable parts) don't apply, and type record words
aren't settled. TIM 1 and Even More read and describe the same as before. The part factory's starting list flags
(which types are fixed) and the flag bits the descriptions name follow the same words, so TIM 2 and Toons no longer
take them from 0x06, 0x08 and 0x0a either.

**In the Lab.** The lab's own names for TIM.EXE's words (the history, links, sockets, ropes, belt, fuse, found list,
flag bits, rope records and rope callback words) follow the same rule: only a game with `partWords` gets them. A TIM 2
or Toons word reads by the name from the fields above, or by its offset. See
[names by game](in-the-lab.md#names-by-game).

## What is left

- **The helpers.** TIM.EXE's shared helpers are recognised by the shape of their code, written for its 58-byte records,
  its part offsets and near part pointers. Toons recognises 20 of the 50 kinds Even More has (lists, insertion, field
  relations and updates, wide arithmetic, angle helpers), but not the ones that reach a part's outline or another part
  through a far pointer in the part (Toons keeps the outline points' far pointer at 0x89, TIM.EXE a near one at 0x82),
  nor the factory, the frame position or the contact searches. TIM 2 recognises only the kinds that don't touch a
  part (wrappers, read-only, field relations, buffers, wide arithmetic): every helper that takes a part gets it as a far
  pointer, and the lists return far pointers in DX:AX where the list loops expect a near one in AX. The biggest single
  blockers:
  - TIM 2: the animation loader (CD `0x36500`, 373 instructions, reads `.ANM` files through the resource service), which
    the frame size and frame position helpers call, and through them about 90 routines. In TIM.EXE this is the
    "scalar resource service" kind, with its own assumption that the service never touches a live part.
  - Toons: an outline crossing test (`0xdfe4`, 31 callers) over the far outline points, and Al's and Sid's action code
    (`0x5f5c0` and `0x5f74e`, about 20 callers each), which has no TIM.EXE counterpart.
- **The loops.** The counted, find-first and list loops are recognised in TIM.EXE's forms. TIM 2's list loops walk far
  pointers, so the list machinery (list head and next helpers, the members a loop finds) needs a far form first.
- **The part fields.** Position, motion, size, drawing, history, the saved fields and the contact record are named in
  both games now (see [The part fields](#the-part-fields)). Still unnamed: the outline points (records of another
  size than TIM.EXE's), the links, plugs, ropes and belt, and words only some types use. The descriptions know some
  of TIM.EXE's words by their place rather than by the layout (see "TIM.EXE's words by place" above); for TIM 2 and
  Toons they say nothing of them until those words are named.
- **The touching part's own bounce.** Its findings are now shown under the touching part's own type (`ownBounce`, see
  "What the self call does, under the touching part's own type"). Still open: walks that start from it, and the
  writes from field relations, like the super ball's bounce.
- **Goals and frames.** The goals of TIM 2 and Toons are checked by their own readers; the reader's frame drawing,
  outline tables, collision dispatch and gear scheduling still only know TIM.EXE's forms.
