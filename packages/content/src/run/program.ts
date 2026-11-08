/**
 * A DOS program as DOS loads it: the unpacked load image, the places in it that hold a segment and so move with the
 * segment it is loaded at, and where it starts. `TIM.EXE` is packed with LZEXE 0.91, whose unpacking stub keeps the
 * original entry point and stack in its first words and the original relocation table, packed, at 0x158.
 */
import { unpackLzexe } from "../read/lzexe.ts";

export interface DosProgram {
  image: Uint8Array;
  /** Offsets in the image of the words that hold a segment, relative to the image. */
  relocations: number[];
  /** Entry point and stack, with segments relative to the image. */
  cs: number;
  ip: number;
  ss: number;
  sp: number;
}

/** Reads a program packed with LZEXE 0.91. */
export function readLzexeProgram(exe: Uint8Array): DosProgram {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const header = view.getUint16(8, true) * 16;
  const stub = header + view.getUint16(0x16, true) * 16;
  const word = (at: number) => view.getUint16(at, true);
  const ip = word(stub),
    cs = word(stub + 2),
    sp = word(stub + 4),
    ss = word(stub + 6);
  const relocations: number[] = [];
  let at = stub + 0x158,
    segment = 0,
    offset = 0;
  for (;;) {
    let span = exe[at++]!;
    if (span === 0) {
      span = word(at);
      at += 2;
      if (span === 0) {
        segment += 0x0fff;
        continue;
      }
      if (span === 1) break;
    }
    offset += span;
    segment += offset >> 4;
    offset &= 0x0f;
    relocations.push(segment * 16 + offset);
  }
  return { image: unpackLzexe(exe), relocations, cs, ip, ss, sp };
}
