# File formats

The byte layout of the game's files, as the readers read them. All numbers are little-endian. The readers are in
`packages/resources/src` unless named; each format has a writer next to its reader where tests need one.

## RESOURCE.00x archives

`readArchive` (`archive.ts`). An archive is just entries one after another, each:

| Bytes | What                                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------- |
| 13    | Name, padded with NUL, like `PART1.BMP`. Letters, digits and `_!&.-` (the `&` is in Toons' `GFSID&AL.BMP`). |
| 4     | Size of the data (u32).                                                                                     |
| size  | The resource itself.                                                                                        |

## RESOURCE.MAP

`readMap` (`map.ts`): the index the game uses to find a resource.

| Bytes | What                      |
| ----- | ------------------------- |
| 4     | Header, not used.         |
| 2     | Number of archives (u16). |

Then per archive: its name (13 bytes, NUL padded), its number of entries (u16), and 8 bytes per entry: a u32 hash of
the resource name and the u32 offset of the entry's header in the archive. Nothing may follow the last archive.

## Chunks

`readChunks` (`chunk.ts`). Most resources (images, palettes, sounds, the sound drivers) are Dynamix chunks: a 4-byte
tag of three characters and a colon (`BMP:`, `INF:`, `VGA:`, …), a u32 size, then the data. When the size has its
high bit set, the chunk is a container and its data is more chunks.

## Palettes (.PAL)

`readPalette` (`palette.ts`): a `VGA:` chunk of 256 colours, 3 bytes each, with 6-bit channels (0 to 63) as the VGA
hardware takes them. The reader scales them to 8 bits.

## Sprite sheets (.BMP) and screens (.SCR)

`decodeImage` (`image.ts`).

**Frame sizes.** A sheet has an `INF:` chunk: a u16 frame count, then all widths (u16 each), then all heights. A screen
has one frame, sized by a `DIM:` chunk (u16 width, u16 height).

**Pixels**, in one of two ways:

- `SCN:` with `OFF:`: `OFF:` holds a u32 offset per frame into `SCN:`, and each frame is drawing commands. The first
  byte is added to every colour. Then each command byte has a 2-bit type and a 6-bit count:
  - 0: down one line and `count` pixels left (the next byte, when 1 to 63, holds the count's high bits; `0x00` goes
    straight down);
  - 1: skip `count` transparent pixels (`0x40`, count 0, ends the frame);
  - 2: repeat the colour in the next byte `count` times;
  - 3: copy `count` colours, two 4-bit colours per byte.
- `BIN:`, with an optional `VGA:`: the low 4 bits of each pixel, two pixels per byte, row by row with each row
  rounded up to whole bytes; `VGA:` holds the high 4 bits the same way. Both chunks start with a compression byte
  (0 none, 1 run-length, 2 LZW) and the u32 unpacked size.
  - Run-length: a byte with its high bit set repeats the next byte; without it, that many bytes follow as they are.
  - LZW: 9 to 12-bit codes, least significant bit first; code 256 resets the dictionary, and after a reset the reader
    skips codes up to a multiple of 8 since the last width change, as the game reads them in groups of 8.

In a sheet, colour 0 is transparent; a screen covers everything.

## TTM scripts (.TTM)

`readTtmFiles` (`ttm.ts`). Toons plays its title, the Dynamix logo, the credits and the finale from TTM scripts, which
`TOONS.EXE` names (`TITLE.TTM`, `DYNAMIX.TTM`, `CREDITS.TTM`, `FINALE.TTM`). A script is chunks: `VER:` (the version,
`4.14`), `PAG:` and `TT3:`, which holds the commands packed like a `BIN:` chunk. A command is a u16 whose low 4 bits
are the number of u16 arguments after it, or 15 for one NUL-terminated name, padded to an even length. Three commands
load files: `F01F` a screen, `F02F` a sprite sheet and `F05F` a palette. What the other commands do isn't read.

The Lab shows an image the scripts load with the palette its script loads (`ttmPalettes`): the last one loaded before
it, or the first one after it, since `TITLE.TTM` loads `TITLE.SCR` before `game.PAL`. So Toons' title screen shows with
`GAME.PAL`, not with `TITLE.PAL`, which nothing in `TOONS.EXE` or the scripts names; `DYNAMXTP.BMP` shows with
`DYNAMIX.PAL`. Every other Toons image gets `GAME.PAL`, the palette `TOONS.EXE` loads for play.

## Fonts (.FNT)

`readFont` (`font.ts`). A font is one `FNT:` chunk: a byte `0xff`, the widest glyph's width, the height, a byte that may
be the baseline (not read), the first character and the number of characters, the unpacked size (u16), then the glyphs
packed like a `BIN:` chunk (a compression byte and the u32 unpacked size first). Unpacked, they are an offset (u16) per
character into the bitmaps, a width (byte) per character, and the bitmaps: one bit a pixel, the high bit leftmost,
each row rounded up to whole bytes. All eight of Toons' fonts read this way. The Lab draws the message machine's
letter with `TUXEDO.FNT`, as TOONS.EXE does.

## Sound banks (.SX)

`readSoundBank` and `decodeSound` (`sound.ts`). A `SND:` container with an `INF:` chunk, a `DAT:` chunk per sound and
a `TAG:` chunk with the names (a u16 count, then per sound its u16 id and a NUL-terminated name).

A `DAT:` chunk holds the sound's u16 id, two bytes of unknown meaning, then the sound packed as a type 3 block (see
the language packages). Unpacked, a sound is a Sierra SCI sound patch:

| Bytes | What                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------- |
| 2     | `84 00`: the patch header.                                                                           |
| …     | Per device: its id byte, then 6 bytes per track (2 unknown, u16 offset, u16 size), ending with `FF`. |
| 1     | `FF`: the end of the devices.                                                                        |

A track is a MIDI channel (its first byte has the channel in its low 4 bits), or a digitized sample when its first
byte is `FE`: then `FE`, a byte, and u16 rate, size, loop start and loop end, followed by unsigned 8-bit mono PCM.

`.RAW` files (TIM 2 and Toons) are unsigned 8-bit mono PCM without a header. TIM 2 plays them at 11,025 Hz:
TIM2.EXE names a file `SX_` and four digits, like the number an animation's sound command gives, and before it plays
one it calls its digital sound driver's rate function (function 6) with a word that holds 11,025 and that nothing else
writes. The digital drivers are the `aud` files in `SX.OVL` (`ASB` for the Sound Blaster, `APS`, `APA`); the Sound
Blaster one turns the rate into the card's time constant, 256 − 1,000,000 ÷ rate, and also starts at 11,025 Hz. For
Toons the rate is still a guess; the Lab plays its files at the same rate.

**TIM 2's music** is in `TIM2.SX`, the same format as TIM 1's bank: 38 sounds, the same in the floppy, the CD and the
demo. Sounds 1000 to 1023 are the songs, and a level's music word is the number of its song (the levels use 1000 to
1021 and 1023). The other 14 are part sounds numbered like their part, such as 5 for the conveyor belt. `MUSIC.RES`
lists the songs by number with the name the game shows, like `1002 New Age`; `MUSIC2.RES` is a shorter list of the
same kind, and `SOUND.RES` names some of the `.RAW` sounds, like `3001 Yeee Haaa!!`.

**Toons' music** is in `TOONS.SX`, the same format: 151 sounds. Sounds 1001 (`toonsthm`), 1002 (`toonsind`) and 1100
to 1128 are the songs, and a level's music word is the number of its song, as in TIM 2: the levels use 1001, 1002 and
1100 to 1127, and three levels have 0. The others are short MIDI sounds (1 to 37), two at 2003 and 2011, and the sounds
from 3001 up, which share their numbers with the `.RAW` files (`SX_3001.RAW` is `fling`). Toons has no list of song
names like TIM 2's `MUSIC.RES`; the bank's own names are short file names like `TS_BEACH`.

## The sound drivers (SX.OVL)

`readSoundDrivers` (`sound.ts`): an `SSM:` container with a chunk per file, each packed like a `BIN:` chunk. The
three-letter files are the drivers (`ADL` AdLib, `M32` MT-32, `GMD` General MIDI and more); the numbered ones are SCI
patch resources (a 2-byte header `89 00`), like `003` with the AdLib instruments. `packages/sound` plays music with
them.

TIM 2's and Toons' `ADL` drivers are the same file as TIM 1's, byte for byte, so `packages/sound` plays TIM 2's and Toons' songs as the
games do, each with its own instruments from its patch `003`. Toons' Sound Blaster Pro driver (`SBP`) is TIM 1's too. Even More's `ADL` is 50 bytes longer: when a note starts, it
first looks for a free voice that last played the channel's instrument, and only then takes the free voice used
longest ago, as TIM 1 and TIM 2 do.

## Language packages (FRENCH.RES, GERMAN.RES)

`unpackLanguagePackage` and `installLanguage` (`language.ts`). On the installation media of the French and German
releases. A package is `OPN:` chunks; each holds a type 3 block with a NUL-terminated file name followed by the file.

A type 3 block is a type byte, the u32 unpacked size, then LZHUF: adaptive Huffman coding over a 4,096-byte window.
Installing does what the game's installer did: it adds the package's `RESOURCE` files and gives the language's own
copies the usual names (`RESOURCE.F03` becomes `RESOURCE.003`, `RESOURCE.FAP` becomes `RESOURCE.MAP`).

## Level files (.LEV, .TIM, .GKC)

`readLevel` (`packages/content/src/read/level.ts`). TIM 1, Even More and Toons here; TIM 2 has
[its own layout](#tim-2-levels). Nothing says whether a file is a puzzle or freeform, so the reader tries both and keeps the one that ends at
the last byte. Texts are NUL-terminated.

**Header**

| Field                | Size   | Notes                                                          |
| -------------------- | ------ | -------------------------------------------------------------- |
| magic                | 2      | `0xACED` or `0xACEE`.                                          |
| version              | 2      | Like `0x105`.                                                  |
| title, goal          | text   | Puzzles only. Freeform files from version `0x104` have a goal. |
| bonus                | 2 × 2  | Puzzles of TIM 1 and Even More only.                           |
| airPressure, gravity | 2 each |                                                                |
| scroll               | 2 × 2  | Puzzles only.                                                  |
| music                | 2      |                                                                |
| static, moving, bin  | 2 each | Part counts; no bin in Toons.                                  |

Then the static parts, the moving parts, from version `0x105` a `binFlag` word, and the parts in the bin.

**Each part**

| Field          | Size                                  | Notes                                                                                                         |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| type           | 2                                     |                                                                                                               |
| flags          | 2 × 2, or 3 × 2 after version `0x100` | The list flags, drawing flags and marks of the part record.                                                   |
| state          | 2 × 2                                 | Signed: the saved frame and the control value.                                                                |
| size, baseSize | 2 × 2 each                            |                                                                                                               |
| position       | 2 × 2                                 | Signed.                                                                                                       |
| extra          | 2                                     |                                                                                                               |
| belt           | 2 + 2 + 2                             | Whether it has one, its place (2 bytes), its width; then two part links when it has one.                      |
| ropes          | 2 slots                               | Each: whether it has a rope (2), its place (2 bytes), then two part links and two slot bytes when it has one. |
| links          | 2 × 2                                 | Part links.                                                                                                   |
| plugs          | 2 × 2                                 | After version `0x100`.                                                                                        |
| pulley         | 2                                     | Only for the pulley (type 7; 17 in Toons).                                                                    |
| outline        | 2 + 2 per point                       | Before version `0x102`, not in Toons.                                                                         |

A part link is the index of a part in the file, `0xFFFF` for none. Toons parts have a tunnel link (type 46, the
tunnel: the tunnel at its other end), from version `0x106` a byte with the plug place (which of the plugged part's
two plug places the part takes), and a word with the part's setting, like the timer's time or the message machine's
letter ([the levels](levels.md#toons-levels)). What the game's loader does with each field is in
[the levels](levels.md#what-the-loader-keeps).

### TIM 2 levels

`readLevel` reads a file with magic `0xACEF` in TIM 2's layout (`readTim2` in `level.ts`), as TIM2.EXE's loader does.
All numbers are words unless said otherwise.

| Field                | Size                 | Notes                                                                                                               |
| -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| magic, version       | 2 each               | `0xACEF`; the version is `0x111` to `0x113` in the shipped levels.                                                  |
| two bytes            | 1 each               | From version `0x113`. Not known yet.                                                                                |
| title, goal          | text                 | Always there.                                                                                                       |
| notes                | 2, then 8 notes      | From version `0x110`. A note: x, y, from version `0x112` a third word, and text.                                    |
| airPressure, gravity | 2 each               |                                                                                                                     |
| two words            | 2 each               | Where TIM 1 has the scroll limits. The game reads them and sets them to 0.                                          |
| music                | 2                    |                                                                                                                     |
| static, moving       | 2 each               | Part counts.                                                                                                        |
| a third count        | 2                    | Read and not kept; 0 in every shipped level.                                                                        |
| parts                |                      | The static parts, then the moving parts.                                                                            |
| goal                 | 2, 8 × 16 (or 14), 2 | From version `0x107`: a word, eight entries of a part link and seven words (six up to version `0x109`), and a word. |

A part is laid out as in TIM 1 from version `0x102`, with signed sizes, and the programmable ball (87) adds six words
from version `0x111`. Versions `0x108` and `0x109` keep the notes after the goal instead of in the header. What the
game does with the fields is in [the levels](levels.md#tim-2-levels).

## TIM.EXE

- **Packing**: LZEXE 0.91. `unpackLzexe` (`packages/content/src/read/lzexe.ts`) gives the load image; `src/run/program.ts`
  also decodes the relocations for the emulator.
- **Type table**: one 58-byte record per part type, found in the data segment by `findTypeTable`
  (`packages/content/src/read/type-table.ts`; `RECORD_FIELDS` names them). It starts with density, mass, bounciness,
  friction, acceleration, terminal velocity, the size limits, the frame lists (`0x14` to `0x1a` are pointers) and the
  outline points, and ends with six far pointers to the part's callbacks, 4 bytes each from `0x22`: bounce, run, reset, flip, resize and rope.
  The Lab's Type tab shows a record field by field.
- **Part records**: in memory, each placed part is a `0xA0`-byte record. Its words are named in `PART_FIELDS`
  (`apps/lab/src/behaviour.ts`), its flag bits in [flag bits](behaviour/in-the-lab.md#flag-bits).
- **Goals**: each puzzle's goal is a routine in TIM.EXE, not in the level file; see [the levels](levels.md).

## TOONS.EXE

Sid & Al's Incredible Toons' program isn't packed. Its load image is the bytes after the EXE header, up to the size the
header gives (`loadImage` in `packages/content/src/read/toons.ts`); what follows is the Borland overlay data (`FBOV`).
Far pointers in it are segment and offset as in the image, before DOS relocates them.

**Type table.** One 70-byte record per type, 85 types. `findToonsTypeTable` finds it where the code reaches it:
`mov dx, 70; imul dx; add ax, start; mov [bp+n], segment` (TOONS.EXE does this in every routine that looks at a type's
record), and the count where the routines that walk every type stop (`cmp si, 85`). The record is TIM 1's with far
pointers, so the fields after them move up (`TOONS_RECORD_FIELDS`):

| Offset | Size | What                                                                                                                    |
| ------ | ---- | ----------------------------------------------------------------------------------------------------------------------- |
| 0x00   | 2×6  | Density, mass, bounciness, friction, acceleration and terminal velocity, as in TIM 1. One loop works out 0x08 and 0x0a. |
| 0x0c   | 2×4  | Size limits, as in TIM 1 (a guess from TIM 1; walls have 640 × 400 and 32 × 32).                                        |
| 0x14   | 4    | 0 in the file: TOONS.EXE puts the loaded `PART` sheet here.                                                             |
| 0x18   | 4    | Frames: a far pointer per frame to a chain of pieces, or 0.                                                             |
| 0x1c   | 4    | Positions: two signed bytes per state, or 0.                                                                            |
| 0x20   | 4    | Sizes: a width and height word per state, or 0. The program sets a part's size from it, else from the state's sprite.   |
| 0x26   | 1×2  | The layers the type is drawn on, 0xff when unused.                                                                      |
| 0x2a   | 2    | Sorts the bin: TOONS.EXE writes the type's place in a table here at start (the file has mostly the type's number).      |
| 0x2c   | 2    | How many middle tiles take turns when the part is drawn as tiles (the low byte).                                        |
| 0x2e   | 4×6  | Far pointers to the type's code, most into the overlay stubs, where TIM 1 has its six callbacks.                        |

A piece is 17 bytes: a far pointer to the next piece (0 ends the frame), the layer, four sprite numbers (0xff ends
them) and a signed x and y byte per sprite. The frame list has no count; the positions and sizes follow it in every
record that has them, so the reader ends it there.

**Drawing.** TOONS.EXE loads the sheet of type N as `part` + N + `.bmp`, except for 36 and 37, Al and Sid, whose
sheets it loads by what they are doing (`catwalk`, `sidrun`, …). It draws a part:

- as tiles when bit 0x40 of its first flag word is set: tiles 16 high and 16 wide (32 for the ladder, type 45). A row
  starts with the sprite of the state, takes the middle sprites (state + 1 up to state + middles) in turn and ends with
  state + middles + 1; a column starts with state + middles + 2, takes the next middles in turn and ends with state + 2
  × middles + 3. A part both wider and taller repeats the state.
- with its own code for types 0 (conveyor belt), 1 (belt), 14 (rope), 36 and 37 (Al and Sid), 38 (timer), 39
  (counter), 40 (thumpulator) and 42 (message machine); 76 isn't drawn (see below);
- else from the frame list when bit 0x1000 of its drawing flags is set, and else as sprite N for state N, at the
  record's position for N or at the origin. In the shipped levels every part of a type with a frame list has the
  bit, except the teeter-totter, whose list and positions give the same picture, and the thumpulator, which has its own
  code.

**Own drawing code.** The routine that draws a part (file offset `0x1e310`) draws a part with bit 0x40 of its first
flag word as tiles, and else looks its type up in a table of ten types that follows it, with the code for each. The
belt and the rope are drawn by the main program (`0x1d85a`, `0x1dc0d`), type 76 not at all, Al and Sid as described
below, and five types by code in an overlay of their own. Each is followed by the Lab:

- **The conveyor belt** (`0x6fd8d`) is a row of 16-pixel tiles as wide as the part, from its own sheet. Three tables
  of 6 bytes from `0x3eb10` give, by the part's state, the sprite of the first tile (1, 1, 2, 2, 0, 0), the last (7,
  7, 8, 8, 9, 9) and the ones between (3, 3, 4, 4, 6, 6). Between, sprite 4 is 5 on every other tile, and sprite 6
  moves 1 pixel down on every other tile; the last tile keeps the place of the tile before it. It draws no frame and
  isn't mirrored.
- **The timer** (`0x53a9f`) draws its frame, but first puts sprite 13 for sprite 12 in it when the part is mirrored
  (and 12 for 13 when it isn't), so the face reads the right way round.
- **The counter** (`0x5401d`) draws its frame, then two lights over it, sprite 21 at 21, 9 and sprite 22 at 66, 12,
  the other way round while it counts up, and then its count's ones and tens, each the sprite of its digit, at a
  place per digit from two tables of 10 pairs (`0x3be2c` and `0x3be40`), 1 pixel further across. The lights and the
  digits aren't mirrored.
- **The thumpulator** (`0x54c62`) draws itself from its setting, not its state: a top piece (sprite 0, or sprite 1 five
  pixels lower when bit 0x100 is set), then from 17 pixels down a section of 65 pixels for each of bits 4 to 7, and a
  bottom piece (sprite 7, or 6 with bit 0x200, at 21 across, or 19 with bit 0x100). Each section shows frame 0, or for
  the section bits 0 to 3 name, the frame in bits 10 to 12, and one of three pieces in turn from a table at `0x3c139`
  (a place and a sprite: 57, 22 with sprite 13, 63, 27 with 14, 56, 14 with 15), moved across by a number per frame
  (`0x3c142`: 0, 0, 10, 20, 30, 40, 20). Mirrored, every piece is mirrored in the part's width.
- **The message machine** (`0x55595`) draws sprite 0, then its setting as text centred on 26, 30, then its frame over
  both. The text is in `tuxedo.fnt` (loaded at `0x25f65`): each letter outlined in black one pixel left, right, up and
  down, with a black shadow 2 pixels left and down, in a colour from a list of five (4, 10, 14, 15 and 12, at
  `0x4d4dc`) picked by the letter's code and its place on the screen, never colour 12 (the background it is set to)
  nor the colour of the letter before (`0x6942b`). In the shipped levels the frame of state 0 covers the letter.

`readToonsDrawing` (`packages/content/src/read/toons-drawing.ts`) finds the drawing routine by its search through the
ten types, follows each case to its code (through the overlay manager's stubs, see below) and reads the tables each
routine reads, in the order it reads them. The numbers in the code itself, like the counter's light places, are
constants in the Lab (`apps/lab/src/toons-drawing.ts`).

**Overlays.** Most of TOONS.EXE's part code is in Borland overlays. The overlay data after the load image starts with
`FBOV`, its size, the file offset of a segment table (8 bytes a segment: the segment, a word, its flags and a word) and
the number of segments. A segment with flags 3 is an overlay's stub: `int 3Fh` at 0, the file offset of the overlay's
code from the end of the `FBOV` header at 4, its size at 8, the size of its fixups (after the code) at 10, and from 0x20
an `int 3Fh` and the routine's offset per routine, 5 bytes each. A fixup is a place in the code that holds a segment as
8 times its entry in the segment table. `readToonsMemory` lays every overlay after the load image with its fixups
applied, as the overlay manager would load it, and leads a far pointer into a stub to the overlay's routine.

**Al and Sid.** Before it draws Al or Sid (file offset `0x3027f`), TOONS.EXE looks up the part's action (the word at
record offset `0x0c`) in a table of near pointers, Al's at `0x4569d` and Sid's at `0x49894`, to a 12-byte entry in
the data segment (from `0x4e642` and `0x4eafe`): the action's frame count, the number of its sheet, and four words
that aren't read. It loads that sheet, named in a list of 9-byte names (`0x4e8e2` and `0x4ed9e`, like `catroot`) with
`.bmp` added, puts it in the type's record as the sheet, and draws the frame of the part's state from the type's own
frame list, as for any part. The frame list holds every frame of every action, one action after another: a second
table (`0x3f0a0` and `0x403c0`, 6 bytes an action) gives each action's first frame (stored negative for some; without the sign it lines up with the frame
counts) and a far pointer to the action's code. Al has 60 actions and 520 frames, Sid 56 and 485. Some
actions have no entry or no name, so their frames have no sheet (Al's `catjump` and a few other sheets are in the
files but named nowhere). `readToonsActions` (`packages/content/src/read/toons.ts`) finds the four tables by the code
that reads them, and the `toons` part list gives each of Al's and Sid's frames the sheet of its action.

## TIM 2

TIM 2 has one archive, `RESOURCE.001`. Its sheets and screens are read like those of TIM 1, and it draws them with
`TIM.PAL` (TIM2.EXE loads `tim.pal`; `TIM2.PAL` has the same colours). Its part names are in `INFO.RES`, one line per
part: the number with a dot, a tab, the name, a tab and the help text.

### Animations (.ANM)

`readAnimation` (`packages/content/src/read/tim2.ts`). Every part has one, `PART<n>.ANM`, and so do the screens and the
help pictures. An animation is an `ANM:` chunk and a `TAG:` chunk. The `TAG:` chunk names the sheets: a u16 count, then
per sheet its u16 number and its NUL-terminated file name, like `1` and `part18x.BMP`.

The `ANM:` chunk, as TIM2.EXE's loader reads it:

| Bytes          | What                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 2              | `TB`.                                                                                                                                     |
| 2              | Version: 1000 or 1001. The game refuses a higher one.                                                                                     |
| 2 × 4          | The number of steps, frames and sequences, and the size of the commands in bytes.                                                         |
| 2 × 2          | Width and height: the box the game mirrors a whole frame in.                                                                              |
| 2 per step     | The frame the step shows. Without steps, step N shows frame N.                                                                            |
| 10 per frame   | The frame's box (x, y, width, height, signed, from the animation's origin) and where its commands start, in words from the first command. |
| 4 per sequence | The step the sequence starts at and its number. The game finds a sequence by its number and the other way round.                          |
| size           | The commands.                                                                                                                             |

A frame is commands, each a u16 number followed by its words, and ends with a 0. TIM2.EXE keeps the length of each in a
table and draws a frame by running them in order. Positions are from the frame's top left corner.

| Command | Words | What                                                                                                                                                                                                                                               |
| ------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0       | 1     | The end of the frame.                                                                                                                                                                                                                              |
| 1       | 1     | Nothing. The shipped files end their commands with one.                                                                                                                                                                                            |
| 2       | 6     | A sprite: sheet number, sprite, x, y, flags. Flag 2 mirrors it left to right, flag 1 top to bottom.                                                                                                                                                |
| 3       | 7     | A box: x, y, width, height, an outline colour and a fill word. When bit 15 of the fill word is set, the game fills the box with the fill word's low byte, and draws the outline unless it has the same colour. Screens use it, and the coffee pot. |
| 4       | 6     | A line: x1, y1, x2, y2 and its colour, a palette index in the low byte.                                                                                                                                                                            |
| 5       | 2     | Plays a sound, like 3019 for `SX_3019.RAW`.                                                                                                                                                                                                        |
| 6       | 2     | Calls the sound code like command 5 does, with its word. No shipped file uses it.                                                                                                                                                                  |

The Lab draws the boxes and lines with the sprites, in the order the frame has them, with the colours of the
palette; it draws a line as a straight run of pixels from end to end, not by the game's own line routine.

**Still open.** What a sequence's number stands for (the program asks for a sequence by it); what command 6 does
(it calls the sound code with its word, and no file uses it); and the `.PAR` files' words besides the type and the
largest size (`PROPI`, a byte 1, the type, then properties that look like TIM 1's physics and size limits, and an
outline). The Lab draws a line as a straight run of pixels, not by the game's own line routine.

**Speed.** TIM2.EXE sets the PC's timer to 65,535 ÷ 13 = 5,041 counts, 236.7 ticks a second, and has the timer count
a step timer down every 4 ticks, 59.2 times a second. Its run loop waits until the step timer is 0 and sets it to 2
before each step of the machine, so a step takes at least 33.8 ms: at most 29.6 steps a second. The steps of an
animation repeat a frame to hold it (the cannon's step list shows frame 12 five times in a row), which only makes sense if
a part moves one state a step; that each part's run routine does so is read from the step lists, not from every run
routine. The Parts page plays a sequence at that speed (`TIM2_STEP_MS`).

To mirror a whole frame, the game flips each sprite's flags and measures its position from the other side of the
animation's width or height. All 433 animations of the floppy, CD and demo read to their last byte this way.
