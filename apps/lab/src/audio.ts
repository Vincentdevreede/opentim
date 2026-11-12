/** The sounds of the loaded files, for the Audio page: the sounds in each sound bank (`.SX`) and the `.RAW` samples. */

import {
  FormatError,
  decodeSound,
  findPatch,
  readSoundBank,
  readSoundDrivers,
  soundSample,
  type Sample,
  type Sound,
  type SoundEntry,
} from "@opentim/resources";
import { hasAdlibTracks, prefersSameInstrument, readAdlibBank, type Pcm } from "@opentim/sound";
import type { Resource } from "./importer.ts";

export type AudioItem =
  | { key: string; type: "bank"; resource: Resource; entry: SoundEntry }
  | { key: string; type: "raw"; resource: Resource };

export interface AudioSection {
  /** The bank's file name, or "Samples" for the `.RAW` files. */
  title: string;
  items: AudioItem[];
  /** Set when a bank can't be read. */
  error?: { message: string; offset?: number };
}

export type DecodedSound =
  /** `adlib` is true when the sound has MIDI tracks for the AdLib, which play on the emulated chip. */
  | { status: "decoded"; sound: Sound; sample?: Sample; adlib: boolean }
  /** `offset` is in the unpacked sound, when known. */
  | { status: "error"; message: string; offset?: number };

/**
 * The rate the `.RAW` files of TIM 2 and Toons are played at by default. They have no header, so this is a guess: the
 * rate of most samples inside the sound banks.
 */
export const RAW_RATE = 11025;
export const RATES = [8000, 11025, 22050];

/**
 * Names of sound devices by the id a sound lists its tracks under, from the drivers in `SX.OVL`: each reports its id
 * when asked for its details. The AdLib, Sound Blaster Pro and Pro AudioSpectrum drivers all play the AdLib tracks.
 * No driver uses ids 0x03, 0x06 and 0x0B.
 */
const DEVICES: Record<number, string> = {
  0x00: "AdLib",
  0x07: "General MIDI",
  0x0c: "Roland MT-32",
  0x12: "PC speaker",
  0x13: "PS/1 Audio",
};

export const deviceName = (id: number) => DEVICES[id];

const isBank = (r: Resource) => r.group === "sound" && r.name.endsWith(".SX");
const isRaw = (r: Resource) => r.group === "sound" && r.name.endsWith(".RAW");

const banks = new WeakMap<Resource, AudioSection>();
const decoded = new WeakMap<SoundEntry, DecodedSound>();

function bankSection(resource: Resource): AudioSection {
  let section = banks.get(resource);
  if (!section) {
    try {
      const { sounds } = readSoundBank(resource.data);
      const items = sounds.map((entry): AudioItem => ({
        key: `${resource.name}#${entry.id}`,
        type: "bank",
        resource,
        entry,
      }));
      section = { title: resource.name, items };
    } catch (error) {
      const offset = error instanceof FormatError ? error.offset : undefined;
      section = { title: resource.name, items: [], error: { message: (error as Error).message, offset } };
    }
    banks.set(resource, section);
  }
  return section;
}

/** The sounds of the loaded files: a section per sound bank, then one with the `.RAW` samples. */
export function audioSections(resources: readonly Resource[]): AudioSection[] {
  const sections = resources.filter(isBank).map(bankSection);
  const raws = resources.filter(isRaw).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  if (raws.length)
    sections.push({ title: "Samples", items: raws.map((resource) => ({ key: resource.name, type: "raw", resource })) });
  return sections;
}

/** The first sound the Audio page lists from this resource: the bank's first sound, or the sample file itself. */
export function firstSoundOf(resource: Resource, resources: readonly Resource[]): string | undefined {
  return audioSections(resources)
    .flatMap((s) => s.items)
    .find((item) => item.resource.name === resource.name)?.key;
}

/** Unpacks a sound of a bank once; later calls return the same result. */
export function decodeEntry(entry: SoundEntry): DecodedSound {
  let result = decoded.get(entry);
  if (!result) {
    try {
      const sound = decodeSound(entry);
      result = { status: "decoded", sound, sample: soundSample(sound), adlib: hasAdlibTracks(sound.data) };
    } catch (error) {
      const offset = error instanceof FormatError ? error.offset : undefined;
      result = { status: "error", message: (error as Error).message, offset };
    }
    decoded.set(entry, result);
  }
  return result;
}

/** The sound driver bundle, which holds the AdLib instruments as SCI patch 3. */
export const DRIVERS = "SX.OVL";

export type AdlibPatch =
  | {
      status: "found";
      data: Uint8Array;
      /** True when the `ADL` driver gives a new note a free voice with the channel's instrument first. */
      sameInstrumentFirst: boolean;
    }
  | { status: "missing"; message: string }
  | { status: "error"; message: string };

const patches = new WeakMap<Resource, AdlibPatch>();

/** The AdLib instruments of the loaded files, from patch 3 in `SX.OVL`. */
export function adlibPatch(resources: readonly Resource[]): AdlibPatch {
  const file = resources.find((r) => r.name === DRIVERS);
  if (!file) return { status: "missing", message: `The loaded files have no ${DRIVERS} with the AdLib instruments.` };
  let patch = patches.get(file);
  if (!patch) {
    try {
      const drivers = readSoundDrivers(file.data);
      const data = findPatch(drivers, 3);
      if (data) readAdlibBank(data);
      const adl = drivers.find((d) => d.name === "ADL");
      patch = data
        ? { status: "found", data, sameInstrumentFirst: adl ? prefersSameInstrument(adl.data) : false }
        : { status: "missing", message: `${DRIVERS} has no patch 003 with the AdLib instruments.` };
    } catch (error) {
      patch = { status: "error", message: `${DRIVERS}: ${(error as Error).message}` };
    }
    patches.set(file, patch);
  }
  return patch;
}

/** A `.RAW` file as a sample: unsigned 8-bit mono PCM without a header. */
export const rawSample = (resource: Resource, rate: number): Sample => ({
  rate,
  data: resource.data,
  loopStart: 0,
  loopEnd: resource.data.length,
});

/** The name shown for an item: the bank's name for the sound, or the file name. */
export const itemName = (item: AudioItem) =>
  item.type === "raw" ? item.resource.name : item.entry.name || `#${item.entry.id}`;

/** Finds items by name, id or file name. */
export function matches(item: AudioItem, query: string): boolean {
  const q = query.trim().toUpperCase();
  if (!q) return true;
  if (item.type === "raw") return item.resource.name.includes(q);
  return item.entry.name.toUpperCase().includes(q) || String(item.entry.id) === q.replace(/^#/, "");
}

/** The length of a sample, like `0:01.04`. */
export function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, "0")}`;
}

/** Audio as a WAV file: 16-bit PCM, mono or stereo. The game's 8-bit samples convert to it without loss. */
export function wavFile(pcm: Pcm): Blob {
  const channels = pcm.right ? [pcm.samples, pcm.right] : [pcm.samples];
  const data = new Int16Array(pcm.samples.length * channels.length);
  // Stereo samples are interleaved: left, then right.
  channels.forEach((samples, c) =>
    samples.forEach(
      (v, i) => (data[i * channels.length + c] = Math.max(-32768, Math.min(32767, Math.round(v * 32768)))),
    ),
  );
  const header = new DataView(new ArrayBuffer(44));
  const text = (offset: number, s: string) => [...s].forEach((c, i) => header.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  header.setUint32(4, 36 + data.byteLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, channels.length, true);
  header.setUint32(24, pcm.rate, true);
  header.setUint32(28, pcm.rate * 2 * channels.length, true);
  header.setUint16(32, 2 * channels.length, true);
  header.setUint16(34, 16, true);
  text(36, "data");
  header.setUint32(40, data.byteLength, true);
  return new Blob([header, data], { type: "audio/wav" });
}
