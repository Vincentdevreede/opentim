import { describe, expect, it } from "vitest";
import { writeChunk } from "../src/chunk.ts";
import { compressType3 } from "../src/language.ts";
import { decodeSound, findPatch, readSoundBank, readSoundDrivers, readSoundTracks, soundSample } from "../src/sound.ts";

const u16 = (n: number) => [n & 255, n >> 8];
const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** A sound patch: `84 00`, then the devices with their track entries, then the tracks. */
function patch(devices: { id: number; tracks: number[][] }[]): Uint8Array {
  const list: number[] = [];
  const tracks: number[][] = [];
  const listSize = devices.reduce((n, d) => n + 2 + d.tracks.length * 6, 1);
  let offset = listSize;
  for (const device of devices) {
    list.push(device.id);
    for (const track of device.tracks) {
      list.push(0, 0, ...u16(offset), ...u16(track.length));
      tracks.push(track);
      offset += track.length;
    }
    list.push(0xff);
  }
  list.push(0xff);
  return Uint8Array.from([0x84, 0, ...list, ...tracks.flat()]);
}

const bank = (sounds: { id: number; name: string; data: Uint8Array }[]) =>
  writeChunk("SND:", [
    writeChunk("INF:", Uint8Array.of(2, 0, ...u16(sounds.length), 3)),
    ...sounds.map((s) => writeChunk("DAT:", Uint8Array.from([...u16(s.id), 7, 2, ...compressType3(s.data)]))),
    writeChunk(
      "TAG:",
      Uint8Array.from([...u16(sounds.length), ...sounds.flatMap((s) => [...u16(s.id), ...text(s.name), 0])]),
    ),
  ]);

const midi = [0x02, 0x31, 0x00, 0xc2, 0x44, 0xfc];
const sample = [0xfe, 0x00, ...u16(11025), ...u16(4), ...u16(0), ...u16(4), 0x80, 0xff, 0x00, 0x80];

describe("readSoundBank", () => {
  it("lists the sounds with their names from TAG:", () => {
    const data = bank([
      { id: 1, name: "BELT", data: patch([{ id: 0, tracks: [midi] }]) },
      { id: 1001, name: "TIM", data: patch([{ id: 7, tracks: [midi] }]) },
    ]);
    const { sounds } = readSoundBank(data);
    expect(sounds.map((s) => [s.id, s.name, s.flags])).toEqual([
      [1, "BELT", [7, 2]],
      [1001, "TIM", [7, 2]],
    ]);
    expect(sounds[0]!.offset).toBe(8 + 8 + 5);
  });

  it("rejects data without a SND: container", () => {
    expect(() => readSoundBank(writeChunk("PAL:", [writeChunk("VGA:", new Uint8Array(3))]))).toThrow(/No SND:/);
    expect(() => readSoundBank(writeChunk("SND:", [writeChunk("INF:", new Uint8Array(5))]))).toThrow(/No DAT:/);
  });
});

describe("decodeSound", () => {
  it("unpacks a sound and reads its tracks per device", () => {
    const data = patch([
      { id: 0, tracks: [midi, sample] },
      { id: 0x0c, tracks: [midi] },
    ]);
    const [entry] = readSoundBank(bank([{ id: 19, name: "WHEW", data }])).sounds;
    const sound = decodeSound(entry!);
    expect([...sound.data]).toEqual([...data]);
    expect(sound.devices.map((d) => [d.id, d.tracks.map((t) => t.channel ?? "sample")])).toEqual([
      [0, [2, "sample"]],
      [0x0c, [2]],
    ]);
    expect(sound.devices[0]!.tracks[0]).toMatchObject({ offset: 23, size: 6, header: [0x02, 0x31] });
    const found = soundSample(sound)!;
    expect(found).toMatchObject({ rate: 11025, loopStart: 0, loopEnd: 4 });
    expect([...found.data]).toEqual([0x80, 0xff, 0x00, 0x80]);
  });

  it("reports damaged sounds", () => {
    expect(() => readSoundTracks(Uint8Array.of(0x83, 0, 0xff))).toThrow(/Not a sound patch/);
    expect(() => readSoundTracks(Uint8Array.of(0x84, 0, 0, 0, 0, 0x40, 0, 6, 0, 0xff, 0xff))).toThrow(
      expect.objectContaining({ message: "A track lies outside the sound", offset: 3 }),
    );
    expect(() => readSoundTracks(Uint8Array.of(0x84, 0, 0))).toThrow(/doesn't end/);
    const short = patch([{ id: 0, tracks: [[0xfe, 0, ...u16(11025), ...u16(9), 0, 0, 9, 0, 0x80]] }]);
    expect(() => readSoundTracks(short)).toThrow(/larger than its track/);
    const entry = { id: 1, name: "", offset: 0, flags: [0, 0] as [number, number], packed: Uint8Array.of(2, 0) };
    expect(() => decodeSound(entry)).toThrow(/Couldn't unpack the sound/);
  });
});

describe("readSoundDrivers", () => {
  /** A file of the bundle, stored uncompressed like a `BIN:` chunk. */
  const stored = (data: number[]) => Uint8Array.from([0, ...u16(data.length), 0, 0, ...data]);

  it("unpacks every file of SX.OVL and finds a patch by number", () => {
    const ovl = writeChunk("SSM:", [
      writeChunk("ADL:", stored([0xe9, 1])),
      writeChunk("003:", stored([0x89, 0, 7, 8])),
    ]);
    const files = readSoundDrivers(ovl);
    expect(files.map((f) => [f.name, f.data.length])).toEqual([
      ["ADL", 2],
      ["003", 4],
    ]);
    expect([...findPatch(files, 3)!]).toEqual([7, 8]);
    expect(findPatch(files, 1)).toBeUndefined();
  });

  it("rejects other data", () => {
    expect(() => readSoundDrivers(writeChunk("SND:", [writeChunk("INF:", new Uint8Array(2))]))).toThrow(/No SSM:/);
    const bad = writeChunk("SSM:", [writeChunk("003:", stored([0x84, 0]))]);
    expect(() => findPatch(readSoundDrivers(bad), 3)).toThrow(/doesn't start with 89/);
  });
});
