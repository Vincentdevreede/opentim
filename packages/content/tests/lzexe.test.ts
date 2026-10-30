import { describe, expect, it } from "vitest";
import { unpackLzexe } from "../src/read/lzexe.ts";

/** Writes an LZEXE 0.91 stream the way the unpacker reads it: bit words placed where the next bits are needed. */
function pack(ops: (bw: { bits: (...b: number[]) => void; bytes: (...b: number[]) => void }) => void): Uint8Array {
  const out: number[] = [0, 0];
  let word = 0;
  let filled = 0;
  const bits = (...values: number[]) => {
    for (const b of values) {
      const at = word + (filled >> 3);
      if (b) out[at] = out[at]! | (1 << (filled & 7));
      if (++filled === 16) {
        word = out.length;
        out.push(0, 0);
        filled = 0;
      }
    }
  };
  ops({ bits, bytes: (...b) => out.push(...b) });
  const header = new Uint8Array(32);
  header.set([0x4d, 0x5a]);
  header[8] = 2; // two paragraphs of header
  header.set(
    [..."LZ91"].map((c) => c.charCodeAt(0)),
    0x1c,
  );
  return Uint8Array.from([...header, ...out]);
}

const end = (w: { bits: (...b: number[]) => void; bytes: (...b: number[]) => void }) => {
  w.bits(0, 1);
  w.bytes(0, 0, 0);
};

describe("unpackLzexe", () => {
  it("copies literal bytes", () => {
    const exe = pack((w) => {
      for (const c of "TIM") {
        w.bits(1);
        w.bytes(c.charCodeAt(0));
      }
      end(w);
    });
    expect(String.fromCharCode(...unpackLzexe(exe))).toBe("TIM");
  });

  it("repeats earlier bytes with short and long references", () => {
    const exe = pack((w) => {
      for (const c of "ABC") {
        w.bits(1);
        w.bytes(c.charCodeAt(0));
      }
      // Short: 0 0, length - 2 in two bits, then the distance back as one byte.
      w.bits(0, 0, 0, 1);
      w.bytes(0x100 - 3);
      // Long: 0 1, then 13 bits of distance and 3 bits of length - 2.
      w.bits(0, 1);
      w.bytes((0x2000 - 6) & 0xff, (((0x2000 - 6) >> 5) & 0xf8) | 2);
      end(w);
    });
    expect(String.fromCharCode(...unpackLzexe(exe))).toBe("ABCABCABCA");
  });

  it("refuses programs it can't unpack", () => {
    expect(() => unpackLzexe(new Uint8Array(32))).toThrow("MZ");
    const other = pack(end);
    other[0x1f] = 0x30; // "LZ90"
    expect(() => unpackLzexe(other)).toThrow("LZEXE");
  });
});
