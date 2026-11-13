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

Numbers from one read per build, without the loops read once per found type. A part counts as read fully when all six
of its callbacks are; a routine is read fully when its status is `complete`. No routine stops the read in any build
(none has the status `error`). Fewer routines than in the first read: a call to the program's start (0:0) is no longer
followed (see below), so the reader no longer reads the whole program as a callee.

| Build                      | Parts | Parts read fully | Routines | Read fully | Read in part | Helpers recognised |  Time |
| -------------------------- | ----: | ---------------: | -------: | ---------: | -----------: | -----------------: | ----: |
| Even More, English CD      |    63 |               63 |      940 |        210 |          730 |                159 |  12 s |
| Toons, English             |    75 |                6 |      454 |        118 |          336 |                 67 | 140 s |
| TIM 2, multilingual CD     |   149 |                0 |      655 |        143 |          512 |                 55 |   9 s |
| TIM 2, multilingual floppy |   149 |                0 |      642 |        142 |          500 |                 55 |   9 s |
| TIM 2, English demo        |   149 |                0 |      642 |        141 |          501 |                 55 |   9 s |

In Even More most routines read in part are bounded by a helper's summary (700 of the 730), which is why all its parts
read fully. In Toons and TIM 2 the reasons are different:

| Reason the reader gives (times, over all routines)                           | Even More CD | Toons | TIM 2 CD |
| ---------------------------------------------------------------------------- | -----------: | ----: | -------: |
| A call's effects are not fully resolved (the callee is read in part)         |           20 |   622 |     1134 |
| A loop (back edge) without a proved invariant                                |            5 |    87 |      164 |
| The path budget runs out                                                     |            1 |    31 |       55 |
| The part pointer is lost at a write through an address it can't place        |            0 |    31 |       31 |
| An instruction with no rule (`int`, `rcl`, `rcr`, `in`, `out`, string moves) |            3 |    67 |       78 |
| An indirect call or jump without a proved target or table bound              |           17 |    15 |       15 |

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
- **The part fields.** The layout names only the type and state in TIM 2, and the type, state, flags and a few more in
  Toons; TIM.EXE's other field names (position, speed, size, contact, outline) come from its helpers.
- **Open decisions** (unchanged): the bounce callback for the part itself (only the calls for the touched part are
  read), TIM 2's draw and set-up routines (found, not read), and the Toons field 0x0c named "previous state" by
  TIM.EXE's rule. Also new: whether TIM.EXE's reads should stop at calls to the program's start and go past confined
  loops too, which would change their results.
- **Goals and frames.** The goals of TIM 2 and Toons are checked by their own readers; the reader's frame drawing,
  outline tables, collision dispatch and gear scheduling still only know TIM.EXE's forms.
