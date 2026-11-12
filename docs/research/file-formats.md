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

## The sound drivers (SX.OVL)

`readSoundDrivers` (`sound.ts`): an `SSM:` container with a chunk per file, each packed like a `BIN:` chunk. The
three-letter files are the drivers (`ADL` AdLib, `M32` MT-32, `GMD` General MIDI and more); the numbered ones are SCI
patch resources (a 2-byte header `89 00`), like `003` with the AdLib instruments. `packages/sound` plays music with
them.

TIM 2's `ADL` driver is the same file as TIM 1's, byte for byte, so `packages/sound` plays TIM 2's songs as the game
does, with TIM 2's own instruments from its patch `003`. Even More's `ADL` is 50 bytes longer: when a note starts, it
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

A part link is the index of a part in the file, `0xFFFF` for none. Toons parts have a tunnel link (type 46), and an
unknown word (and from version `0x106` a byte before it). What the game's loader does with each field is in
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

To mirror a whole frame, the game flips each sprite's flags and measures its position from the other side of the
animation's width or height. All 433 animations of the floppy, CD and demo read to their last byte this way.
