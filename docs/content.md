# Content: part lists, sprites and packs

Status: the model and the part lists are built, in `packages/content`. Packs and the composition code are not.

The lab and the game draw the parts of a level: balls, belts, candles. The original games keep what those parts look
like in their RESOURCE files and in their program. OpenTIM should not depend on those files directly, so that a
graphics pack can replace them later. For now the lab only works with imported files; this design keeps the way open.

## Three layers

1. **Part lists** say which parts exist and how each frame of a part is put together from sprites: sprite 0 of sheet
   `PART18` at (0, 0), sprite 9 at (9, 13), on layer 4. There is one list per game, like `tim1` and `evenmore`. They
   don't depend on any files, and the lab and the game both read them.
2. **Sprites** are the images the frames are made of. Today they come from the imported files, decoded with their
   palette. Later a pack can provide them as PNG images.
3. **The choice** of list and sprites. For imported files, the version catalog says which list belongs to the
   version. Later a pack names the list it follows.

## Words

- A **part** is an object of the game, like the cannon.
- A **sprite sheet** is a file of loose pictures, like `PART18.BMP`; a list names it without the extension, `PART18`.
- A **sprite** is one picture in a sprite sheet, like the cannon's barrel or its wheel.
- A **frame** is what a part looks like at one moment: its sprites placed together. The game picks one by number.
- A **layer** is the group a sprite is drawn in; the layers set the order of drawing.
- A **state** is the game's own value for what a part is doing, like an alert cat. In TIM 1 and Even More, state N
  shows frame N. States belong with the part's behaviour, frames with its pictures.
- An **animation**, still to come, is frames in a row with their timing.

## The model

The model is in `packages/content/src/model.ts`; in short:

```ts
interface PartList {
  id: string; // "tim1"
  game: string; // "The Incredible Machine"
  parts: Part[];
}

interface Part {
  id: string; // "bowling-ball": stable, other data will refer to it
  type: number; // the number the original game uses, as in PART18.BMP
  name?: string; // the game's own English name, when it has one: "Bowling Ball" in TIM 2
  sheets: string[]; // the sprite sheets its sprites come from, like "PART18"; empty for parts drawn as lines
  frames: Frame[]; // empty when the program draws the part another way, or the list doesn't know yet
  /** Values from the original program whose meaning isn't known yet. Never used for drawing. */
  raw?: Record<string, number>;
}

interface Frame {
  id: number;
  sprites: Placement[];
}

interface Placement {
  sheet: string; // "PART18": a sprite sheet, not a file name
  sprite: number;
  x: number; // units, relative to the part's origin
  y: number;
  layer: number;
  flip?: "h" | "v" | "hv";
}
```

## Rules

- **Names as ids.** A part's id is a short English name in lowercase with hyphens, like `bowling-ball`. It describes
  the object; it doesn't have to be the game's own name for it, which the games don't store anywhere. The same object
  keeps the same id in every game, so a bowling ball is `bowling-ball` in TIM 1, Even More and TIM 2, and a pack can
  draw it once for all of them.
- **An id names an object, a number names a slot.** The games reuse numbers: number 29 is a light bulb in TIM 1 and a
  lava lamp in TIM 2, and the teeter-totter is 3 in TIM 1 but 139 in TIM 2. So numbers only appear as `type` in each
  game's own list. A redrawn object keeps its id; a different object in the same slot gets its own id, even when it
  does a similar job.
- **Every object is in OpenTIM.** OpenTIM offers the objects of all games, so both the birdcage and the laundry basket.
  A complete graphics pack draws every id; there are no stand-ins.
- **Stable ids.** An id never changes once published, because levels, saves and packs will refer to it. So names are
  chosen with care before the first list is published, from what the part looks like and does in the game. The
  original type number stays in the list as `type`, to read the original levels.
- **One model for every game.** TIM 1 and Even More keep their frames in their program; TIM 2 keeps frames and
  animations in `.ANM` files. Both become frames, and later animations.
- **References, not files.** A placement names a sprite sheet and a sprite. The imported files resolve `PART18` to
  `PART18.BMP`; a pack can resolve it to a PNG. Lists never contain file formats, palettes or archive names.
- **Units, not pixels.** One unit is one pixel of the original game. A pack drawn at a higher resolution scales its
  images; the lists stay the same.
- **Drawing apart from everything else.** Values that may turn out to be physics stay in `raw` until they are
  understood, and then belong to the engine.
- **Composition only needs images.** The code that puts a frame together asks a sprite source for the size and image
  of a sprite. It never sees decoded pixels or palettes, which stay inside the source for imported files.
- **Not inside an app.** The lists, the model and the composition code live in a package without Vue,
  `@opentim/content`, even while only the lab uses them.

## Where the lists come from

The lists are in `packages/content/src/lists`. A script writes them from local copies of the games; the lists are
committed, the games are not. Anyone with the games can run it to check or regenerate them. Give it every build you
have; the builds of one list must agree:

```sh
pnpm --filter @opentim/content extract-parts --tim1 <folder> --tim1 <folder> --evenmore <folder> --tim2 <folder>
```

The ids are chosen by hand, in `packages/content/src/part-ids.ts`; everything else comes from the games. The readers
are in `packages/content/src/read`. The lab, a research tool, uses them too: it reads the parts from the files it
loads, `TIM.EXE` included, and compares them with the committed list.

- **TIM 1 and Even More** keep a table with a 58-byte record per part type in their program, `TIM.EXE`. The script
  unpacks the program (LZEXE 0.91), finds its data segment and searches the table: the place where the frames use
  only sprites that each type's sheet has. A record can point to its type's frames at `0x16`; a frame is a chain of
  pieces that each put up to four sprites on one layer. The bytes `0x1c` and `0x1d` are the layers the type is drawn
  on, `0xff` when unused, and every piece is on one of them.
- A type without pieces shows sprite N as frame N on its one layer. Its record then points at `0x18` to a position
  per frame, or the sheet has a single sprite at the origin. The program draws the remaining types its own way, like
  walls and pipes from tiles and the gear and pulley in code, so they have no frames yet.
- **TIM 2** names every part in `INFO.RES`, so the `tim2` list takes its numbers and names from there and doesn't need
  the program. Each part's `.ANM` animation names its sheets. The frames are left out for now: the `.ANM` frames and
  sequences become frames and animations together with the animation work.

| Version                       | List       | Status                                                            |
| ----------------------------- | ---------- | ----------------------------------------------------------------- |
| TIM 1 English, French, German | `tim1`     | Checked: the same 51 parts in all four builds                     |
| Even More, all five builds    | `evenmore` | Checked: the same 63 parts in every build, the demo included      |
| The Add-On Disk               | `evenmore` | Assumed: same sheets as Even More; its program isn't LZEXE-packed |
| TIM 2 floppy and CD           | `tim2`     | Checked: the same 149 parts; frames not yet                       |
| TIM 2 demo                    | `tim2`     | Same numbers and names, but most sheets are missing               |
| TIM 1 demo                    | none yet   | Different table layout, not checked                               |

TIM 1 has records for types 51–54 but no sheets; Even More fills them in, so they are only in `evenmore`. In both
games, sheets 55–57 are title and credits pictures, not parts. TIM 2 continues the numbers: its parts 0–65 fill the
same slots, and 66–148 are new. Its sheets `PART149` to `PART294` have no entry in `INFO.RES`: scenery like
mountains, planets and paintings.

What is a guess is marked as one, in the lists and in the lab: how frames follow each other and how fast, and for
TIM 2 the meaning of the flip flags and sequence numbers.

## Not decided yet

- The pack format and how the lab and the game load a pack.
- Mixing a pack with imported files, and scaling.
- Where physics lives. It differs per game, so it likely belongs to each game's list as a ruleset that the level
  chooses, apart from the pack that the player chooses.
- Whether TIM 2's scenery sheets become parts.
