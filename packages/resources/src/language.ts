export interface PackedFile {
  /** Upper-case DOS file name, e.g. `RESOURCE.002`. */
  name: string;
  data: Uint8Array;
}

const MAX_BLOCK_SIZE = 32 * 1024 * 1024;
const MAX_TOTAL_SIZE = 128 * 1024 * 1024;
const MAX_FILES = 1024;

const SYMBOL_COUNT = 314;
const TREE_SIZE = 627;
const ROOT = 626;
const RING_SIZE = 4096;
const RING_START = 4036;

export const isLanguagePackageName = (name: string) => /^(FRENCH|GERMAN)\.RES$/i.test(name);

const readUint32 = (data: Uint8Array, offset: number) =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);

/**
 * The adaptive Huffman tree of LZHUF. Nodes are stored in pairs of siblings; `children` points at the first of a
 * node's two children, or holds a leaf as symbol + TREE_SIZE. The tree adapts after every symbol.
 */
function huffmanTree() {
  const frequencies = new Uint32Array(TREE_SIZE + 1);
  const children = new Uint16Array(TREE_SIZE);
  const parents = new Uint16Array(TREE_SIZE + SYMBOL_COUNT);
  for (let i = 0; i < SYMBOL_COUNT; i++) {
    frequencies[i] = 1;
    children[i] = i + TREE_SIZE;
    parents[i + TREE_SIZE] = i;
  }
  for (let i = SYMBOL_COUNT, j = 0; i < TREE_SIZE; i++, j += 2) {
    frequencies[i] = frequencies[j]! + frequencies[j + 1]!;
    children[i] = j;
    parents[j] = i;
    parents[j + 1] = i;
  }
  frequencies[TREE_SIZE] = 0xffff;
  parents[ROOT] = 0;

  const rebuild = () => {
    let next = 0;
    for (let i = 0; i < TREE_SIZE; i++) {
      if (children[i]! >= TREE_SIZE) {
        frequencies[next] = (frequencies[i]! + 1) >>> 1;
        children[next] = children[i]!;
        next++;
      }
    }
    for (let j = SYMBOL_COUNT, i = 0; j < TREE_SIZE; j++, i += 2) {
      const frequency = frequencies[i]! + frequencies[i + 1]!;
      let position = j - 1;
      while (position >= 0 && frequency < frequencies[position]!) position--;
      position++;
      frequencies.copyWithin(position + 1, position, j);
      children.copyWithin(position + 1, position, j);
      frequencies[position] = frequency;
      children[position] = i;
    }
    for (let i = 0; i < TREE_SIZE; i++) {
      const child = children[i]!;
      parents[child] = i;
      if (child < TREE_SIZE) parents[child + 1] = i;
    }
  };

  const update = (symbol: number) => {
    if (frequencies[ROOT] === 0x8000) rebuild();
    let current = parents[symbol + TREE_SIZE]!;
    do {
      const frequency = ++frequencies[current]!;
      let next = current + 1;
      if (frequency > frequencies[next]!) {
        while (frequency > frequencies[next + 1]!) next++;
        frequencies[current] = frequencies[next]!;
        frequencies[next] = frequency;
        const first = children[current]!;
        const second = children[next]!;
        parents[first] = next;
        if (first < TREE_SIZE) parents[first + 1] = next;
        parents[second] = current;
        if (second < TREE_SIZE) parents[second + 1] = current;
        children[next] = first;
        children[current] = second;
        current = next;
      }
      current = parents[current]!;
    } while (current !== 0);
  };

  /** Reads a symbol, taking one bit per level of the tree. */
  const decode = (readBit: () => number) => {
    let node = children[ROOT]!;
    while (node < TREE_SIZE) node = children[node + readBit()]!;
    return node - TREE_SIZE;
  };

  /** The bits of a symbol, from the root down. A node's bit is its place in the pair of siblings. */
  const encode = (symbol: number) => {
    const bits: number[] = [];
    for (let node = parents[symbol + TREE_SIZE]!; node !== ROOT; node = parents[node]!) bits.unshift(node & 1);
    return bits;
  };

  return { update, decode, encode };
}

/**
 * Decompresses a type 3 block: adaptive Huffman coding over an LZ window of 4096 bytes (LZHUF). The block starts with
 * the type byte and the little-endian u32 size of the output.
 */
export function decompressType3(payload: Uint8Array): Uint8Array {
  if (payload.length < 5 || payload[0] !== 3) throw new Error("Expected a type 3 block");
  const outputSize = readUint32(payload, 1);
  if (outputSize > MAX_BLOCK_SIZE) throw new Error("Unpacked block exceeds the 32 MiB limit");

  const input = payload.subarray(5);
  let bitOffset = 0;
  const readBits = (count: number) => {
    if (bitOffset + count > input.length * 8) throw new Error("Truncated compressed data");
    let value = 0;
    for (let i = 0; i < count; i++, bitOffset++) {
      value = value * 2 + ((input[bitOffset >>> 3]! >>> (7 - (bitOffset & 7))) & 1);
    }
    return value;
  };

  const tree = huffmanTree();

  // The upper 6 bits of a match distance, coded with 3 to 8 bits.
  const positionCodes = new Uint8Array(256);
  const positionLengths = new Uint8Array(256);
  for (let symbol = 0, offset = 0; symbol < 64; symbol++) {
    const length = symbol < 1 ? 3 : symbol < 4 ? 4 : symbol < 12 ? 5 : symbol < 24 ? 6 : symbol < 48 ? 7 : 8;
    const count = 1 << (8 - length);
    positionCodes.fill(symbol, offset, offset + count);
    positionLengths.fill(length, offset, offset + count);
    offset += count;
  }

  const ring = new Uint8Array(RING_SIZE).fill(0x20, 0, RING_START);
  const output = new Uint8Array(outputSize);
  let ringPosition = RING_START;
  let outputPosition = 0;
  const emit = (value: number) => {
    output[outputPosition++] = value;
    ring[ringPosition] = value;
    ringPosition = (ringPosition + 1) & (RING_SIZE - 1);
  };

  while (outputPosition < outputSize) {
    const symbol = tree.decode(() => readBits(1));
    tree.update(symbol);
    if (symbol < 256) {
      emit(symbol);
      continue;
    }
    let prefix = readBits(8);
    const high = positionCodes[prefix]! << 6;
    const extraBits = positionLengths[prefix]! - 2;
    for (let i = 0; i < extraBits; i++) prefix = (prefix << 1) | readBits(1);
    const start = (ringPosition - (high | (prefix & 63)) - 1) & (RING_SIZE - 1);
    const length = symbol - 253;
    if (outputPosition + length > outputSize) throw new Error("Unpacked data exceeds the size in the header");
    for (let i = 0; i < length; i++) emit(ring[(start + i) & (RING_SIZE - 1)]!);
  }
  return output;
}

/**
 * Compresses bytes into a type 3 block, as literals only; the inverse of {@link decompressType3}, without the LZ
 * matches that make it smaller. Used by tests and tools.
 */
export function compressType3(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const tree = huffmanTree();
  const bits: number[] = [];
  for (const byte of data) {
    bits.push(...tree.encode(byte));
    tree.update(byte);
  }
  const out = new Uint8Array(5 + Math.ceil(bits.length / 8));
  out[0] = 3;
  new DataView(out.buffer).setUint32(1, data.length, true);
  bits.forEach((bit, i) => (out[5 + (i >>> 3)]! |= bit << (7 - (i & 7))));
  return out;
}

/**
 * Unpacks a `FRENCH.RES` or `GERMAN.RES` language package from the installation media of the French and German
 * releases. The package is a sequence of `OPN:` chunks: the tag, a little-endian u32 length, then a type 3 block that
 * holds a NUL-terminated file name followed by the file's bytes.
 */
export function unpackLanguagePackage(input: Uint8Array): PackedFile[] {
  if (input.length > MAX_TOTAL_SIZE) throw new Error("Language package exceeds the 128 MiB limit");
  const files: PackedFile[] = [];
  const names = new Set<string>();
  let offset = 0;
  let total = 0;
  while (offset < input.length) {
    if (input.length - offset < 8) throw new Error(`Truncated chunk header at offset ${offset}`);
    const tag = String.fromCharCode(...input.subarray(offset, offset + 4));
    if (tag !== "OPN:") throw new Error(`Unsupported chunk ${JSON.stringify(tag)} at offset ${offset}`);
    const length = readUint32(input, offset + 4);
    const start = offset + 8;
    if (length < 5 || length > input.length - start) throw new Error(`Invalid chunk length at offset ${offset}`);
    const payload = input.subarray(start, start + length);
    total += readUint32(payload, 1);
    if (total > MAX_TOTAL_SIZE || files.length >= MAX_FILES) throw new Error("Language package exceeds the limits");

    const decoded = decompressType3(payload);
    const end = decoded.indexOf(0);
    if (end < 1 || end > 12) throw new Error(`Invalid file name in the chunk at offset ${offset}`);
    const name = String.fromCharCode(...decoded.subarray(0, end)).toUpperCase();
    if (!/^[A-Z0-9_-]{1,8}(\.[A-Z0-9_-]{1,3})?$/.test(name)) throw new Error(`Unsupported file name ${name}`);
    if (names.has(name)) throw new Error(`${name} is in the package twice`);
    names.add(name);
    files.push({ name, data: decoded.slice(end + 1) });
    offset = start + length;
  }
  if (!files.length) throw new Error("Empty language package");
  return files;
}

/** Builds a language package from files; the inverse of {@link unpackLanguagePackage}. Used by tests and tools. */
export function writeLanguagePackage(files: PackedFile[]): Uint8Array<ArrayBuffer> {
  const chunks = files.map(({ name, data }) =>
    compressType3(Uint8Array.from([...name].map((c) => c.charCodeAt(0)).concat(0, ...data))),
  );
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + 8 + c.length, 0));
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(
      [..."OPN:"].map((c) => c.charCodeAt(0)),
      offset,
    );
    view.setUint32(offset + 4, chunk.length, true);
    out.set(chunk, offset + 8);
    offset += 8 + chunk.length;
  }
  return out;
}

/** The letter that marks a language's own copy of a file on the installation media, like `RESOURCE.F03`. */
const LETTERS: Record<string, string> = { FRENCH: "F", GERMAN: "G" };

/**
 * Installs a language from the installation media, like the game's installer: `language` is the name of the package
 * without `.RES`, e.g. `FRENCH`. The RESOURCE files in its package are added, and the language's own copies get the
 * usual names (`RESOURCE.F03` becomes `RESOURCE.003`, `RESOURCE.FAP` becomes `RESOURCE.MAP`). The packages and the
 * other languages' copies are left out. Files that aren't changed are returned as they were given.
 */
export function installLanguage<T extends PackedFile>(files: T[], language: string): (T | PackedFile)[] {
  const pack = files.find((f) => f.name === `${language}.RES`);
  const letter = LETTERS[language];
  if (!pack || !letter) throw new Error(`No language package for ${language}`);
  const installed = new Map<string, T | PackedFile>();
  const copies: PackedFile[] = [];
  for (const file of files) {
    const copy = /^RESOURCE\.([A-Z])(\d\d|AP)$/.exec(file.name);
    if (isLanguagePackageName(file.name)) continue;
    if (copy && Object.values(LETTERS).includes(copy[1]!)) {
      const usual = `RESOURCE.${copy[2] === "AP" ? "MAP" : `0${copy[2]}`}`;
      if (copy[1] === letter) copies.push({ name: usual, data: file.data });
    } else {
      installed.set(file.name, file);
    }
  }
  const unpacked = unpackLanguagePackage(pack.data).filter((f) => f.name.startsWith("RESOURCE."));
  for (const file of [...copies, ...unpacked]) installed.set(file.name, file);
  return [...installed.values()].sort((a, b) => a.name.localeCompare(b.name));
}
