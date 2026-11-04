import { expect } from "vitest";
import { readRoutineCode } from "../../src/read/behaviour-code.ts";
import { addGearSummaries } from "../../src/read/behaviour-gear.ts";
import type { EngineSummary } from "../../src/read/behaviour-helpers.ts";
import type { BehaviourLayout } from "../../src/read/behaviour-layout.ts";

function assembly(origin: number) {
  const bytes: number[] = [],
    labels = new Map<string, number>(),
    patches: { at: number; label: string; width: number }[] = [];
  return {
    bytes,
    labels,
    emit: (...b: number[]) => bytes.push(...b),
    label: (name: string) => labels.set(name, origin + bytes.length),
    jump(name: string, opcode = 0xe9) {
      bytes.push(opcode);
      const width = opcode === 0xe9 ? 2 : 1;
      patches.push({ at: bytes.length, label: name, width });
      bytes.push(...Array<number>(width).fill(0));
    },
    call(address: number, far = false) {
      if (far) bytes.push(0x9a, address & 255, address >> 8, 0, 0);
      else {
        const d = address - (origin + bytes.length + 3);
        bytes.push(0xe8, d & 255, (d >> 8) & 255);
      }
    },
    finish() {
      for (const p of patches) {
        const d = labels.get(p.label)! - (origin + p.at + p.width);
        if (p.width === 1 && (d < -128 || d > 127)) throw new Error("Synthetic branch is out of range");
        bytes[p.at] = d & 255;
        if (p.width === 2) bytes[p.at + 1] = (d >> 8) & 255;
      }
      return bytes;
    },
  };
}
const state = 0x20,
  delta = 0x22,
  flags = 0x24,
  type = 0x26,
  links = 0x40,
  connection = 0x50;
export const gearFields = { state, delta, flags, type, links, connection };
const fact = { confidence: "inferred" as const, evidence: [], assumptions: [] };
export function gearFixture(options: { shift?: number; far?: boolean; nop?: boolean } = {}) {
  const shift = options.shift ?? 0,
    rootAddress = 0x100 + shift,
    propAddress = 0x400 + shift,
    advanceAddress = 0x600 + shift,
    peerAddress = 0x800 + shift;
  const r = assembly(rootAddress),
    p = assembly(propAddress),
    a = assembly(advanceAddress),
    peer = assembly(peerAddress);
  peer.emit(0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x7e, 6, 0x8b, 0x45, connection, 0x8b, 0xf0, 0x0b, 0xc0);
  peer.jump("A", 0x74);
  peer.emit(0x39, 0x7c, 0);
  peer.jump("B", 0x75);
  peer.emit(0x8b, 0x44, 2);
  peer.jump("C");
  peer.label("B");
  peer.emit(0x8b, 0x44, 0);
  peer.jump("C");
  peer.label("A");
  peer.emit(0x33, 0xc0);
  peer.label("C");
  peer.emit(0x5f, 0x5e, 0x5d, 0xcb);

  p.emit(0x55, 0x8b, 0xec, 0x83, 0xec, 6, 0x56, 0x57, 0x8b, 0x7e, 6, 0x8b, 0x76, 8, 0x83, 0x7c, delta, 0);
  p.jump("A", 0x74);
  p.emit(0x83, 0x7e, 10, 1);
  p.jump("B", 0x75);
  p.emit(0x8b, 0x44, delta, 0x3b, 0x45, delta);
  p.jump("B", 0x74);
  p.emit(0xc7, 0x46, 12, 1, 0);
  p.jump("C");
  p.label("B");
  p.emit(0x83, 0x7e, 10, 2);
  p.jump("C", 0x75);
  p.emit(0x8b, 0x44, delta, 0x3b, 0x45, delta);
  p.jump("C", 0x75);
  p.emit(0xc7, 0x46, 12, 1, 0);
  p.jump("C");
  p.label("A");
  p.emit(0x83, 0x7e, 10, 1);
  p.jump("D", 0x75);
  p.emit(0x8b, 0x45, delta);
  p.jump("E");
  p.label("D");
  p.emit(0x33, 0xc0, 0x2b, 0x45, delta);
  p.label("E");
  p.emit(0x89, 0x44, delta);
  p.label("C");
  p.emit(0x83, 0x7c, type, 14);
  p.jump("F", 0x75);
  p.emit(0xf7, 0x44, flags, 64, 0);
  p.jump("F", 0x75);
  p.emit(0x83, 0x4c, flags, 64, 0xc7, 0x46, 0xfe, 0, 0);
  p.jump("G");
  p.label("K");
  p.emit(0x83, 0x7e, 0xfe, 4);
  p.jump("H", 0x75);
  p.emit(0x56);
  p.call(peerAddress, true);
  p.emit(0x59, 0x89, 0x46, 0xfa, 0xc7, 0x46, 0xfc, 1, 0);
  p.jump("I");
  p.label("H");
  p.emit(0x8b, 0x5e, 0xfe, 0xd1, 0xe3, 0x8b, 0x40, links, 0x89, 0x46, 0xfa, 0xc7, 0x46, 0xfc, 2, 0);
  p.label("I");
  p.emit(0x83, 0x7e, 0xfa, 0);
  p.jump("J", 0x74);
  p.emit(0x8b, 0x5e, 0xfa, 0xf7, 0x47, flags, 0, 8);
  p.jump("J", 0x75);
  p.emit(0xff, 0x76, 12, 0xff, 0x76, 0xfc, 0x53, 0x56, 0x0e);
  p.call(propAddress);
  p.emit(0x83, 0xc4, 8, 0x89, 0x46, 12);
  p.label("J");
  p.emit(0xff, 0x46, 0xfe);
  p.label("G");
  p.emit(0x83, 0x7e, 0xfe, 5);
  p.jump("K", 0x7c);
  p.label("F");
  p.emit(0x8b, 0x46, 12, 0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);

  a.emit(
    0x55,
    0x8b,
    0xec,
    0x83,
    0xec,
    2,
    0x56,
    0x57,
    0x8b,
    0x76,
    6,
    0x8b,
    0x44,
    delta,
    0x01,
    0x44,
    state,
    0x83,
    0x7c,
    state,
    0xff,
  );
  a.jump("A", 0x75);
  a.emit(0xc7, 0x44, state, 3, 0);
  a.jump("B");
  a.label("A");
  a.emit(0x83, 0x7c, state, 4);
  a.jump("B", 0x75);
  a.emit(0xc7, 0x44, state, 0, 0);
  a.label("B");
  a.emit(0xc7, 0x44, delta, 0, 0, 0xc7, 0x46, 0xfe, 0, 0);
  a.jump("C");
  a.label("H");
  a.emit(0x83, 0x7e, 0xfe, 4);
  a.jump("D", 0x75);
  a.emit(0x56);
  a.call(peerAddress, true);
  a.emit(0x59, 0x8b, 0xf8);
  a.jump("E");
  a.label("D");
  a.emit(0x8b, 0x5e, 0xfe, 0xd1, 0xe3, 0x8b, 0x78, links);
  a.label("E");
  a.emit(0x0b, 0xff);
  a.jump("F", 0x74);
  a.emit(0x83, 0x7d, delta, 0);
  a.jump("F", 0x74);
  a.emit(0xf7, 0x45, flags, 0, 8);
  a.jump("F", 0x75);
  a.emit(0x83, 0x7e, 8, 0);
  a.jump("G", 0x74);
  a.emit(0xc7, 0x45, delta, 0, 0);
  a.label("G");
  a.emit(0x83, 0x7d, type, 14);
  a.jump("F", 0x75);
  a.emit(0xff, 0x76, 8, 0x57, 0x0e);
  a.call(advanceAddress);
  a.emit(0x59, 0x59);
  a.label("F");
  a.emit(0xff, 0x46, 0xfe);
  a.label("C");
  a.emit(0x83, 0x7e, 0xfe, 5);
  a.jump("H", 0x7c);
  a.emit(0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);

  const rootCall = (target: number) => {
    if (options.nop) r.emit(0x90);
    if (!options.far) r.emit(0x0e);
    r.call(target, options.far);
  };
  r.emit(0x55, 0x8b, 0xec, 0x83, 0xec, 4, 0x56, 0x57, 0x8b, 0x76, 6, 0x83, 0x7c, delta, 0);
  r.jump("done", 0x74);
  r.emit(0x83, 0x4c, flags, 64, 0x33, 0xff, 0xc7, 0x46, 0xfe, 0, 0);
  r.jump("header");
  r.label("body");
  r.emit(0x8b, 0x5e, 0xfe, 0xd1, 0xe3, 0x8b, 0x40, links, 0x89, 0x46, 0xfc, 0x0b, 0xc0);
  r.jump("latch", 0x74);
  r.emit(0x57, 0xb8, 2, 0, 0x50, 0xff, 0x76, 0xfc, 0x56);
  rootCall(propAddress);
  r.emit(0x83, 0xc4, 8, 0x8b, 0xf8);
  r.label("latch");
  r.emit(0xff, 0x46, 0xfe);
  r.label("header");
  r.emit(0x83, 0x7e, 0xfe, 4);
  r.jump("body", 0x7c);
  r.emit(0x0b, 0xff);
  r.jump("advance", 0x74);
  r.emit(0xc7, 0x44, delta, 0, 0);
  r.label("advance");
  r.emit(0x57, 0x56);
  rootCall(advanceAddress);
  r.emit(0x59, 0x59);
  r.label("done");
  r.emit(0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
  const image = new Uint8Array(0x1000 + shift);
  for (const [origin, b] of [
    [rootAddress, r],
    [propAddress, p],
    [advanceAddress, a],
    [peerAddress, peer],
  ] as const)
    image.set(b.finish(), origin);
  const codes = new Map(
    [rootAddress, propAddress, advanceAddress, peerAddress].map((address) => [
      address,
      readRoutineCode(image, { address, segment: 0, offset: address }, 0),
    ]),
  );
  const layout: BehaviourLayout = {
    ...fact,
    objectArgument: { ...fact, offset: 6 },
    callbacks: [],
    diagnostics: [],
    fields: [
      ["state", state],
      ["stateDelta", delta],
      ["drawingFlags", flags],
      ["type", type],
    ].map(([name, offset]) => ({ ...fact, name: name as string, offset: offset as number })),
  };
  const summaries = new Map<number, EngineSummary>();
  addGearSummaries(codes, summaries, layout);
  expect([...codes.values()].every((c) => c.status === "complete")).toBe(true);
  expect(summaries.size).toBe(2);
  return {
    image,
    code: codes.get(rootAddress)!,
    codes,
    summaries,
    helpers: summaries,
    layout,
    labels: r.labels,
    propAddress,
    advanceAddress,
    peerAddress,
  };
}
