import { compressType3, writeChunk } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import { samplePcm } from "@opentim/sound";
import {
  adlibPatch,
  audioSections,
  decodeEntry,
  duration,
  firstSoundOf,
  itemName,
  matches,
  rawSample,
  wavFile,
} from "../src/audio.ts";
import type { Resource } from "../src/importer.ts";
import { markersOf } from "../src/markers.ts";

const u16 = (n: number) => [n & 255, n >> 8];

function resource(name: string, data: Uint8Array): Resource {
  return { name, kind: "audio", group: "sound", archive: "RESOURCE.001", offset: 0, data };
}

/** A sound with one device and one track: a MIDI channel, or a sample when it starts with FE. */
const sound = (track: number[]) =>
  compressType3(Uint8Array.from([0x84, 0, 0, 0, 0, ...u16(9), ...u16(track.length), 0xff, 0xff, ...track]));

const midi = [0x02, 0x31, 0x00, 0xc2, 0x44];
const sample = [0xfe, 0, ...u16(22050), ...u16(2), 0, 0, 2, 0, 0x00, 0xff];

const bank = writeChunk("SND:", [
  writeChunk("INF:", Uint8Array.of(2, 0, 2, 0, 3)),
  writeChunk("DAT:", Uint8Array.from([1, 0, 7, 2, ...sound(midi)])),
  writeChunk("DAT:", Uint8Array.from([19, 0, 7, 0, ...sound(sample)])),
  writeChunk("TAG:", Uint8Array.from([1, 0, 1, 0, ...Array.from("BELT", (c) => c.charCodeAt(0)), 0])),
]);

describe("audioSections", () => {
  it("lists the sounds of each bank, then the RAW samples in number order", () => {
    const sections = audioSections([
      resource("SX_3010.RAW", Uint8Array.of(128)),
      resource("TIM.SX", bank),
      resource("SX_3002.RAW", Uint8Array.of(128)),
    ]);
    expect(sections.map((s) => [s.title, s.items.map(itemName)])).toEqual([
      ["TIM.SX", ["BELT", "#19"]],
      ["Samples", ["SX_3002.RAW", "SX_3010.RAW"]],
    ]);
  });

  it("opens a bank at its first sound and a sample file at itself", () => {
    const tim = resource("TIM.SX", bank);
    const raw = resource("SX_3002.RAW", Uint8Array.of(128));
    const all = [raw, tim];
    expect(firstSoundOf(tim, all)).toBe(audioSections(all)[0]!.items[0]!.key);
    expect(firstSoundOf(raw, all)).toBe("SX_3002.RAW");
    expect(firstSoundOf({ ...raw, name: "OTHER.BIN", group: "other" }, all)).toBeUndefined();
  });

  it("reports a bank it can't read", () => {
    const [section] = audioSections([resource("TIM.SX", writeChunk("PAL:", new Uint8Array(4)))]);
    expect(section).toMatchObject({ title: "TIM.SX", items: [], error: { message: "No SND: container" } });
  });

  it("finds sounds by name or id", () => {
    const [section] = audioSections([resource("TIM.SX", bank)]);
    const [belt, whew] = section!.items;
    expect([matches(belt!, "bel"), matches(belt!, "1"), matches(whew!, "#19"), matches(whew!, "BELT")]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

describe("decodeEntry", () => {
  it("finds the sample of a sound, and none in MIDI", () => {
    const [section] = audioSections([resource("TIM.SX", bank)]);
    const [belt, whew] = section!.items.map((i) => (i.type === "bank" ? decodeEntry(i.entry) : undefined));
    expect(belt).toMatchObject({ status: "decoded", sample: undefined });
    expect(whew).toMatchObject({ status: "decoded", sample: { rate: 22050, loopEnd: 2 } });
  });
});

describe("wavFile", () => {
  it("writes 16-bit mono PCM, converting the game's 8-bit samples without loss", async () => {
    const pcm = samplePcm(rawSample(resource("SX_3001.RAW", Uint8Array.of(0, 128, 255)), 11025));
    const wav = new Uint8Array(await wavFile(pcm).arrayBuffer());
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4), ...wav.subarray(8, 12))).toBe("RIFFWAVE");
    expect([view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true)]).toEqual([1, 11025, 16]);
    expect([...new Int16Array(wav.buffer, 44)]).toEqual([-32768, 0, 127 * 256]);
  });

  it("interleaves the channels of stereo audio", async () => {
    const pcm = {
      rate: 49716,
      samples: Float32Array.of(0.5, 0),
      right: Float32Array.of(-0.5, 1),
      loopStart: 0,
      loopEnd: 2,
    };
    const wav = new Uint8Array(await wavFile(pcm).arrayBuffer());
    const view = new DataView(wav.buffer);
    expect([view.getUint16(22, true), view.getUint32(28, true), view.getUint16(32, true)]).toEqual([2, 49716 * 4, 4]);
    expect([...new Int16Array(wav.buffer, 44)]).toEqual([16384, -16384, 0, 32767]);
  });
});

describe("decodeEntry and AdLib", () => {
  it("tells sounds with AdLib MIDI apart", () => {
    const [section] = audioSections([resource("TIM.SX", bank)]);
    const [belt, whew] = section!.items.map((i) => (i.type === "bank" ? decodeEntry(i.entry) : undefined));
    expect([belt, whew].map((d) => d?.status === "decoded" && d.adlib)).toEqual([true, false]);
  });
});

describe("adlibPatch", () => {
  it("finds the AdLib instruments in SX.OVL, or says why not", () => {
    const patch = Uint8Array.from([0x89, 0, ...new Uint8Array(1344)]);
    const bin = Uint8Array.from([0, ...u16(patch.length), 0, 0, ...patch]);
    const ovl = writeChunk("SSM:", [writeChunk("003:", bin)]);
    expect(adlibPatch([resource("SX.OVL", ovl)])).toMatchObject({ status: "found", data: { length: 1344 } });
    expect(adlibPatch([])).toMatchObject({ status: "missing" });
    const empty = writeChunk("SSM:", [writeChunk("001:", Uint8Array.of(0, 2, 0, 0, 0, 0x89, 0))]);
    expect(adlibPatch([resource("SX.OVL", empty)])).toMatchObject({ status: "missing", message: /no patch 003/ });
  });
});

describe("duration", () => {
  it("shows minutes and seconds", () => {
    expect([duration(0), duration(1.044), duration(75.5)]).toEqual(["0:00.00", "0:01.04", "1:15.50"]);
  });
});

describe("markersOf a sound bank", () => {
  it("marks the chunks of the bank", () => {
    const { markers } = markersOf(resource("TIM.SX", bank));
    expect(markers.map((m) => m.label)).toEqual(["SND:", "INF:", "DAT:", "DAT:", "TAG:"]);
    expect(markers[1]!.detail).toMatch(/^sound ids/);
  });

  it("explains that RAW files have no chunks", () => {
    expect(markersOf(resource("SX_3001.RAW", Uint8Array.of(128))).note).toMatch(/no header/);
  });
});
