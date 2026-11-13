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
a near pointer at 0x84).

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

Numbers from `extract-behaviour` and one read per build, without the loops read once per found type. A part counts as
read fully when all six of its callbacks are; a routine is read fully when its status is `complete`. No routine stops
the read in any build (none has the status `error`).

| Build                      | Parts | Parts read fully | Routines | Read fully | Read in part | Helpers recognised |  Time |
| -------------------------- | ----: | ---------------: | -------: | ---------: | -----------: | -----------------: | ----: |
| Even More, English CD      |    63 |               63 |      940 |        210 |          730 |                159 |  12 s |
| Toons, English             |    75 |                6 |     1046 |        178 |          868 |                 96 | 140 s |
| TIM 2, multilingual CD     |   149 |                0 |     1182 |        179 |         1003 |                 68 |  12 s |
| TIM 2, multilingual floppy |   149 |                0 |      554 |        118 |          436 |                 45 |   8 s |
| TIM 2, English demo        |   149 |                0 |     1138 |        175 |          963 |                 68 |  11 s |

In Even More most routines read in part are bounded by a helper's summary (700 of the 730), which is why all its parts
read fully. In Toons and TIM 2 the reasons are different:

| Reason the reader gives (times, over all routines)                            | Even More CD | Toons | TIM 2 CD |
| ----------------------------------------------------------------------------- | -----------: | ----: | -------: |
| A call's effects are not fully resolved (the callee is read in part)          |           20 |  3151 |     2650 |
| A loop (back edge) without a proved invariant                                 |            5 |   397 |      450 |
| The path budget runs out                                                      |            1 |   126 |      123 |
| The part pointer is lost at a write to a variable in the code segment (`cs:`) |            0 |   183 |      207 |
| An instruction with no rule (`int`, `rcl`, `rcr`, `in`, `out`, string moves)  |            3 |   302 |      367 |
| An indirect call or jump without a proved target or table bound               |           17 |   124 |      185 |

The TIM 2 floppy build reaches fewer routines than the CD and the demo: in those two, the tipsy trailer's run callback
reaches a routine with a far call to `0:0`, the program's start, and the reader follows it into most of the
program. The floppy build's run callback doesn't.

## What is left

- **The helpers.** TIM.EXE's shared helpers (lists, contact, gears, ropes, the factory, …) are recognised by their
  instruction forms, written for a 58-byte record, TIM.EXE's part offsets and near part pointers. Toons has the same
  compiler and near parts, but other offsets and 70-byte records, so few forms match; TIM 2 passes parts as far
  pointers, so almost none do. Each recogniser needs the forms of these programs, ideally found from the code (the
  offsets from the layout, the record size from the profile) rather than added by hand. Most of the "call's effects"
  count follows from this.
- **The loops.** The counted, find-first and list loops are recognised in TIM.EXE's forms; the same goes for them.
- **The part fields.** The layout names only the type and state in TIM 2, and the type, state, flags and a few more in
  Toons; TIM.EXE's other field names (position, speed, size, contact, outline) come from its helpers. A Toons field
  named "previous state" (0x0c) by TIM.EXE's rule may be Al's and Sid's action word instead.
- **The bounce callback of the part itself.** Both programs call the bounce callback for the part itself as well as for
  the part it touches. The reader reads only the calls for the touched part and says so in an assumption.
- **Callers without a proved owner.** In TIM 2 the reset, flip and resize callbacks have calls whose owner the layout
  can't tell, as in TIM.EXE for reset and flip. In Toons, reset, flip and resize.
- **TIM 2's other routines.** The draw routine (+0x18) and the set-up routine (+0x1c) are found but not read.
- **Goals and frames.** The goals of TIM 2 and Toons are checked by their own readers; the reader's frame drawing,
  outline tables, collision dispatch and gear scheduling still only know TIM.EXE's forms.
