/**
 * Unpacks a DOS program packed with LZEXE 0.91, as `TIM.EXE` of The Incredible Machine and Even More are. The packed
 * code starts at the load image; a bit stream says per step whether a byte is copied as is or a run of earlier bytes
 * is repeated.
 */

/** The unpacked load image of a program packed with LZEXE 0.91: its code and data, without the EXE header. */
export function unpackLzexe(exe: Uint8Array): Uint8Array {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  if (view.getUint16(0, true) !== 0x5a4d) throw new Error("Not a DOS program: no MZ header");
  if (String.fromCharCode(...exe.subarray(0x1c, 0x20)) !== "LZ91") throw new Error("Not packed with LZEXE 0.91");
  let pos = view.getUint16(8, true) * 16;
  const out: number[] = [];

  const byte = () => {
    if (pos >= exe.length) throw new Error("The packed data ends too early");
    return exe[pos++]!;
  };
  const word = () => byte() | (byte() << 8);
  let bits = word();
  let left = 16;
  const bit = () => {
    const b = bits & 1;
    if (--left === 0) {
      bits = word();
      left = 16;
    } else bits >>= 1;
    return b;
  };

  for (;;) {
    if (bit()) {
      out.push(byte());
      continue;
    }
    let length: number;
    let span: number;
    if (!bit()) {
      length = ((bit() << 1) | bit()) + 2;
      span = byte() - 0x100;
    } else {
      const lo = byte();
      const hi = byte();
      span = (lo | ((hi & 0xf8) << 5)) - 0x2000;
      length = (hi & 7) + 2;
      if (length === 2) {
        length = byte();
        if (length === 0) break;
        if (length === 1) continue;
        length += 1;
      }
    }
    if (out.length + span < 0) throw new Error("The packed data refers back before its start");
    for (let i = 0; i < length; i++) out.push(out[out.length + span]!);
  }
  return Uint8Array.from(out);
}
