/**
 * The frame list a part's type record keeps at `+0x14` while a level runs, and the frame sizes in it.
 *
 * When the game loads a part's pictures, it builds the name `part<type>.bmp`, loads that sheet with its sheet loader and
 * stores the list the loader returns at `+0x14` of the type record. The loader's reader of the `INF:` chunk builds the
 * list: a word for each frame that points to a ten-byte record, the frame's width at `+6` and its height at `+8`, and a
 * 0 after the last frame. For a sheet with `SCN:` pixels the loader only fills in the other words of the records. The
 * frame size helper reads the width and height of the part's frame from this list, so with the sheet those reads become
 * numbers.
 */
import { readChunks, type Chunk } from "@opentim/resources";
import type { Evidence, Expression, Finding } from "./behaviour.ts";
import { readRoutineCode, type RoutineCode } from "./behaviour-code.ts";
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import {
  frameCountPatterns,
  frameKindPatterns,
  frameSizeReaderPatterns,
  sheetLoaderPatterns,
  sheetStorePatterns,
} from "./behaviour-sheet-frame-patterns.ts";
import type { CodeAddress } from "./x86.ts";

/** The size of one frame of a sheet, as the game's frame list keeps it. */
export interface FrameSize {
  width: number;
  height: number;
}

/** The word of a type record that holds the frame list while the part's pictures are loaded. */
export const FRAME_LIST_WORD = 0x14;
const RECORD_STRIDE = 58;

export const SHEET_FRAME_ASSUMPTION =
  "While a level runs, the frame list at +0x14 of a part's type record is the list the game built when it loaded the part's pictures, from PARTn.BMP of the same build (the name it builds from part, the type number and .bmp), and nothing changes a frame's width and height in it after that. The game's resource routines find that file and its INF:, SCN: and OFF: chunks the way the resource reader does, and fill only their own state and the buffers they are given.";

export interface SheetFrameList extends Finding {
  /** The routine that loads one part's sheet and stores the list, the sheet loader, and its reader of the sizes. */
  store: number;
  loader: number;
  reader: number;
}

type Build = (operator: string, left: Expression, right: Expression, width?: number) => Expression;

/**
 * The frame sizes the game's list gets from a sheet, as its reader of the `INF:` chunk stores them: a count, then the
 * widths, then the heights, each a word. When the chunk has fewer than four bytes for each frame, every frame gets the
 * first width and height. Undefined unless the loader reads the sheet the way it was proved for: one `BMP:` chunk with
 * `INF:`, `SCN:` and `OFF:` chunks large enough for it, and no `RLE:` or `SCL:` chunk, which make it go over the list
 * again with other routines.
 */
export function sheetFrameSizes(data: Uint8Array): FrameSize[] | undefined {
  let chunks: Chunk[];
  try {
    chunks = readChunks(data);
  } catch {
    return undefined;
  }
  const bmp = chunks[0];
  if (chunks.length !== 1 || bmp?.tag !== "BMP:" || bmp.children.some((c) => c.children.length)) return undefined;
  const find = (tag: string) => bmp.children.find((c) => c.tag === tag);
  const inf = find("INF:"),
    off = find("OFF:");
  if (!inf || !off || !find("SCN:") || find("RLE:") || find("SCL:") || inf.data.length < 2) return undefined;
  const view = new DataView(inf.data.buffer, inf.data.byteOffset, inf.data.byteLength);
  const count = view.getUint16(0, true);
  // The reader compares the chunk's size less 2 with the count times 4 as signed numbers; a count below 0x2000 keeps
  // that a plain comparison. The loader reads a four-byte offset for each frame from OFF:.
  if (!count || count >= 0x2000 || off.data.length < count * 4) return undefined;
  const pairs = inf.data.length - 2 >= count * 4 ? count : 1;
  if (inf.data.length < 2 + pairs * 4) return undefined;
  return Array.from({ length: count }, (_, frame) => {
    const at = pairs === count ? frame : 0;
    return { width: view.getUint16(2 + at * 2, true), height: view.getUint16(2 + pairs * 2 + at * 2, true) };
  });
}

/** Where the store of the frame list starts: `call far loader; pop cx; push ax; mov ax,si; mov dx,58; imul dx`. */
const STORE_SITE = [0x59, 0x50, 0x8b, 0xc6, 0xba, RECORD_STRIDE, 0x00, 0xf7, 0xea];
const at = (address: number): CodeAddress => ({ segment: (address >> 16) << 12, offset: address & 0xffff, address });
const evidenceOf = ({ address, bytes, text }: Evidence): Evidence => ({ address, bytes, text });

/**
 * Proves from the program what the frame list at `+0x14` of a type record holds: finds the routine that stores it, and
 * matches it, the sheet loader it calls, the loader's reader of the sizes and the two small routines it hands the list
 * to against their complete compiler forms. Undefined unless every one matches and their strings are the expected ones.
 */
export function proveSheetFrameList(image: Uint8Array, dataSegment: number, table: number): SheetFrameList | undefined {
  const sites: number[] = [];
  for (let i = 5; i + STORE_SITE.length <= image.length; i++)
    if (image[i - 5] === 0x9a && STORE_SITE.every((byte, n) => image[i + n] === byte)) sites.push(i - 5);
  if (sites.length !== 1) return undefined;
  const site = sites[0]!;
  let entry = site;
  while (entry > site - 0x80 && !(image[entry] === 0x55 && image[entry + 1] === 0x8b && image[entry + 2] === 0xec))
    entry--;
  const text = (offset: number | undefined) => {
    if (offset === undefined) return undefined;
    let value = "";
    for (let n = dataSegment * 16 + offset; image[n] && value.length < 16; n++) value += String.fromCharCode(image[n]!);
    return value;
  };
  const match = (code: RoutineCode, patterns: string[]) => {
    for (const pattern of patterns) {
      const bindings = matchHeapRoutine(code, pattern, new Map());
      if (bindings) return bindings;
    }
  };
  const callee = (code: RoutineCode, address: number | undefined) => {
    const target = code.calls.find((c) => c.target?.address === address)?.target;
    return target && readRoutineCode(image, target, dataSegment);
  };

  const store = readRoutineCode(image, at(entry), dataSegment);
  const stored = match(store, sheetStorePatterns);
  if (!stored || text(stored.get("prefix")) !== "part" || text(stored.get("suffix")) !== ".bmp") return undefined;
  const record = stored.has("frameList")
    ? dataSegment * 16 + stored.get("frameList")! - FRAME_LIST_WORD
    : stored.get("recordSegment")! * 16;
  if (record !== table) return undefined;

  const loaderCode = callee(store, stored.get("loader"));
  const loaded = loaderCode && match(loaderCode, sheetLoaderPatterns);
  const strings = { scn: "BMP:SCN:", off: "BMP:OFF:", vqt: "BMP:VQT:", offAgain: "BMP:OFF:", rle: "BMP:RLE:" };
  if (
    !loaded ||
    Object.entries({ ...strings, scl: "BMP:SCL:" }).some(([key, value]) => text(loaded.get(key)) !== value)
  )
    return undefined;
  const readerCode = callee(loaderCode, loaded.get("reader"));
  const read = readerCode && match(readerCode, frameSizeReaderPatterns);
  // The reader finds and reads its chunk with the same routines as the loader.
  if (
    !read ||
    text(read.get("inf")) !== "BMP:INF:" ||
    ["find", "read", "size"].some((name) => read.get(name) !== loaded.get(name))
  )
    return undefined;
  const kinds = callee(loaderCode, loaded.get("kinds"));
  const count = callee(loaderCode, loaded.get("count"));
  if (!kinds || !match(kinds, frameKindPatterns) || !count || !match(count, frameCountPatterns)) return undefined;

  const evidence = [
    ...store.instructions.filter(
      (i) => i.address === site || (i.operands[0]?.kind === "memory" && i.mnemonic === "mov" && i.address > site),
    ),
    ...readerCode.instructions.filter((i) => {
      const target = i.operands[0];
      return i.mnemonic === "mov" && target?.kind === "memory" && target.base.join() === "di";
    }),
  ].map(evidenceOf);
  return {
    confidence: "inferred",
    assumptions: [SHEET_FRAME_ASSUMPTION],
    evidence,
    store: store.address,
    loader: loaderCode.address,
    reader: readerCode.address,
  };
}

/**
 * Gives the frame size reads of a part of one type the sizes of its sheet. The frame size helper reads the list word
 * `L` at `+0x14` of the type record, tests it against 0, then reads `T[ds:6 + T[ds:k + L + 2·J]]` for the width and
 * the same at 8 for the height, the frame being `J + k/2`. With the sheet loaded, `L` is not 0, and a frame of the
 * sheet has its width and height. A frame that is a number gets that number; a frame that is a value of the part gets
 * the sizes selected by it, and keeps the read for a frame the sheet doesn't have, where the game reads past the list.
 */
export function sheetFrameSizeForType(
  e: Expression,
  listWord: number,
  dataSegment: number,
  frames: FrameSize[],
  build: Build,
  used: { sheet: boolean },
): Expression {
  const constant = (value: number, width = 16): Expression => ({ kind: "constant", value, width });
  const isList = (x: Expression) =>
    x.kind === "table" &&
    x.width === 16 &&
    x.index.kind === "constant" &&
    x.index.value === 0 &&
    x.segment * 16 + x.offset === listWord;
  /** The frame a frame pointer read `T[ds:k + L + 2·J]` reads. */
  const frameOf = (p: Expression): Expression | undefined => {
    if (p.kind !== "table" || p.width !== 16 || p.segment !== dataSegment || p.offset % 2) return undefined;
    const first = constant(p.offset / 2);
    if (isList(p.index)) return first;
    if (p.index.kind !== "binary" || p.index.operator !== "+") return undefined;
    const other = isList(p.index.left) ? p.index.right : isList(p.index.right) ? p.index.left : undefined;
    const twice =
      other?.kind === "binary" &&
      ((other.operator === "<<" && other.right.kind === "constant" && other.right.value === 1) ||
        (other.operator === "*" && other.right.kind === "constant" && other.right.value === 2))
        ? other.left
        : undefined;
    if (!twice) return undefined;
    return p.offset ? build("+", twice, first, 16) : twice;
  };
  const sizeOf = (read: Expression, frame: Expression, key: keyof FrameSize): Expression => {
    if (frame.kind === "constant") {
      const size = frames[frame.value];
      if (!size) return read;
      used.sheet = true;
      return constant(size[key]);
    }
    const byValue = new Map<number, number[]>();
    frames.forEach((size, n) => byValue.set(size[key], [...(byValue.get(size[key]) ?? []), n]));
    let selected: Expression = constant(0);
    for (const [value, list] of byValue) {
      if (!value) continue;
      const holds = list.map((n) => build("==", frame, constant(n), 16)).reduce((a, b) => build("|", a, b, 16));
      const term = build("*", holds, constant(value), 16);
      selected = selected.kind === "constant" && selected.value === 0 ? term : build("+", selected, term, 16);
    }
    // All ones for a frame the sheet has, 0 for any other: the selected size there, the read itself elsewhere.
    const inSheet = build("*", build("<", frame, constant(frames.length), 16), constant(0xffff), 16);
    used.sheet = true;
    return build(
      "|",
      build("&", selected, inSheet, 16),
      build("&", read, build("^", inSheet, constant(0xffff), 16), 16),
      16,
    );
  };
  const visit = (x: Expression): Expression => {
    if (x.kind === "table") {
      if (x.width === 16 && x.segment === dataSegment && (x.offset === 6 || x.offset === 8)) {
        const frame = frameOf(x.index);
        if (frame) return sizeOf(x, frame, x.offset === 6 ? "width" : "height");
      }
      const index = visit(x.index);
      return index === x.index ? x : { ...x, index };
    }
    if (x.kind !== "binary") return x;
    // The list is set while the sheet is loaded.
    if (
      (x.operator === "!=" || x.operator === "==") &&
      ((isList(x.left) && x.right.kind === "constant" && x.right.value === 0) ||
        (isList(x.right) && x.left.kind === "constant" && x.left.value === 0))
    ) {
      used.sheet = true;
      return constant(x.operator === "!=" ? 1 : 0, x.width);
    }
    const left = visit(x.left),
      right = visit(x.right);
    if (left === x.left && right === x.right) return x;
    const zero = (y: Expression) => y.kind === "constant" && y.value === 0;
    const one = (y: Expression) => y.kind === "constant" && y.value === 1;
    if (x.operator === "*" && (zero(left) || zero(right))) return constant(0, x.width);
    if (x.operator === "*" && one(left)) return right;
    if (x.operator === "*" && one(right)) return left;
    if (x.operator === "+" && zero(left)) return right;
    if ((x.operator === "+" || x.operator === "-") && zero(right)) return left;
    return build(x.operator, left, right, x.width);
  };
  return visit(e);
}

/** Where the frame list word of a type's record is. */
export const frameListWord = (table: number, type: number) => table + type * RECORD_STRIDE + FRAME_LIST_WORD;
