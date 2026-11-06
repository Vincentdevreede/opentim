/**
 * Searching inside files. The Files search field reads a query as a search of the bytes when it is written like one:
 * `"text"` for letters, `ED AC` for bytes in hex, or `=408` for a number stored as little-endian bytes.
 */

export interface ContentQuery {
  kind: "text" | "bytes" | "value";
  /** The bytes to find. */
  pattern: Uint8Array;
  /** Letters match without regard to case. */
  fold: boolean;
}

const upper = (v: number) => (v >= 0x61 && v <= 0x7a ? v - 0x20 : v);

/** The little-endian bytes of a number: two for a u16 or i16, four above that. */
function valueBytes(n: number): Uint8Array | undefined {
  if (!Number.isInteger(n) || n < -0x8000 || n > 0xffffffff) return undefined;
  if (n < 0) n += 0x10000;
  return n <= 0xffff
    ? Uint8Array.of(n & 0xff, n >> 8)
    : Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24);
}

/** Reads a query as a search of the bytes, or undefined when it is a plain name filter. */
export function parseQuery(query: string): ContentQuery | undefined {
  const q = query.trim();
  const text = /^"([^"]+)"?$/.exec(q);
  if (text) {
    const letters = [...text[1]!].map((c) => c.charCodeAt(0));
    if (letters.some((c) => c > 0xff)) return undefined;
    return { kind: "text", pattern: Uint8Array.from(letters, upper), fold: true };
  }
  if (/^[0-9a-f]{2}(\s+[0-9a-f]{2})+$/i.test(q))
    return { kind: "bytes", pattern: Uint8Array.from(q.split(/\s+/), (b) => parseInt(b, 16)), fold: false };
  const value = /^=\s*(-?)(0x[0-9a-f]+|\d+)$/i.exec(q);
  if (value) {
    const n = Number(value[2]) * (value[1] ? -1 : 1);
    const pattern = valueBytes(n);
    return pattern && { kind: "value", pattern, fold: false };
  }
  return undefined;
}

/** Where the pattern starts in the data, at most `limit` times. */
export function findAll(data: Uint8Array, { pattern, fold }: ContentQuery, limit = 10_000): number[] {
  const hits: number[] = [];
  const first = pattern[0]!;
  const last = data.length - pattern.length;
  for (let at = 0; at <= last && hits.length < limit; at++) {
    if ((fold ? upper(data[at]!) : data[at]) !== first) continue;
    let i = 1;
    while (i < pattern.length && (fold ? upper(data[at + i]!) : data[at + i]) === pattern[i]) i++;
    if (i === pattern.length) hits.push(at);
  }
  return hits;
}
