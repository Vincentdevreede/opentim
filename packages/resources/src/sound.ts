import { FormatError, readChunks, type Chunk } from "./chunk.ts";
import { decodeBin } from "./image.ts";
import { decompressType3 } from "./language.ts";

/** One sound of a sound bank, before it is unpacked. */
export interface SoundEntry {
  id: number;
  /** The name in the bank's `TAG:` chunk, like `TIM_FUNK`. Empty when the bank has no name for it. */
  name: string;
  /** Position of the sound's `DAT:` chunk header in the bank. */
  offset: number;
  /** The two bytes after the id. Their meaning isn't known yet. */
  flags: [number, number];
  /** The packed sound: a type 3 block. */
  packed: Uint8Array;
}

export interface SoundBank {
  sounds: SoundEntry[];
}

/** A MIDI channel or digitized sample of a sound, for one device. */
export interface SoundTrack {
  /** Where the track starts in the unpacked sound, after its 2-byte patch header. */
  offset: number;
  size: number;
  /** The track's bytes, with its 2-byte header. */
  data: Uint8Array;
  /** Set for a digitized sample, which starts with `0xFE`. */
  sample?: Sample;
  /** The MIDI channel, the low 4 bits of the track's first byte. Undefined for a sample. */
  channel?: number;
  /** The track's first two bytes, as they are. */
  header: [number, number];
}

/** The tracks a sound has for one sound device, like an AdLib or MT-32 driver. */
export interface SoundDevice {
  id: number;
  tracks: SoundTrack[];
}

/** Unsigned 8-bit mono PCM. */
export interface Sample {
  rate: number;
  data: Uint8Array;
  /** The loop points, in samples. */
  loopStart: number;
  loopEnd: number;
}

export interface Sound {
  /** The unpacked sound, with its 2-byte patch header. */
  data: Uint8Array;
  devices: SoundDevice[];
}

const CHUNK_HEADER = 8;
const DAT_HEADER = 4;
/** The 2-byte header of a SCI sound patch: the resource type 4 with the high bit set, then 0. */
const PATCH_HEADER = 2;
const SOUND_PATCH = 0x84;
const END = 0xff;
const DIGITAL = 0xfe;
const SAMPLE_HEADER = 10;

const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);

/**
 * Reads the index of a sound bank (`.SX`): a `SND:` container with an `INF:` chunk, a `DAT:` chunk per sound and a
 * `TAG:` chunk with the names. A `DAT:` chunk holds the u16 id of the sound, two bytes of unknown meaning, then the
 * sound as a type 3 (LZHUF) block. The sounds are unpacked by {@link decodeSound}.
 *
 * Errors are {@link FormatError}s with the offset in `data` where reading stopped.
 */
export function readSoundBank(data: Uint8Array): SoundBank {
  const [root] = readChunks(data);
  if (!root || root.tag !== "SND:" || !root.children.length) throw new FormatError("No SND: container", 0);
  const names = readNames(root.children.find((c) => c.tag === "TAG:"));
  const sounds = root.children
    .filter((c) => c.tag === "DAT:")
    .map((chunk): SoundEntry => {
      if (chunk.data.length < DAT_HEADER + 5) throw new FormatError("Truncated DAT: chunk", chunk.offset);
      const id = view(chunk.data).getUint16(0, true);
      return {
        id,
        name: names.get(id) ?? "",
        offset: chunk.offset,
        flags: [chunk.data[2]!, chunk.data[3]!],
        packed: chunk.data.subarray(DAT_HEADER),
      };
    });
  if (!sounds.length) throw new FormatError("No DAT: chunks with sounds", root.offset);
  return { sounds };
}

/** The `TAG:` chunk: a u16 count, then per sound its u16 id and a NUL-terminated name. */
function readNames(tag: Chunk | undefined): Map<number, string> {
  const names = new Map<number, string>();
  if (!tag) return names;
  const at = (i: number) => tag.offset + CHUNK_HEADER + i;
  if (tag.data.length < 2) throw new FormatError("Truncated TAG: chunk", tag.offset);
  const count = view(tag.data).getUint16(0, true);
  let i = 2;
  for (let n = 0; n < count; n++) {
    if (i + 2 > tag.data.length) throw new FormatError("Truncated TAG: chunk", at(i));
    const id = view(tag.data).getUint16(i, true);
    const end = tag.data.indexOf(0, i + 2);
    if (end < 0) throw new FormatError("A name in TAG: doesn't end", at(i));
    names.set(id, String.fromCharCode(...tag.data.subarray(i + 2, end)));
    i = end + 1;
  }
  return names;
}

/**
 * Unpacks a sound of a bank. It is a sound resource of Sierra's SCI engine, saved as a patch file: the bytes `84 00`,
 * then per device its id byte and a 6-byte entry per track (two unknown bytes, the u16 offset and the u16 size of the
 * track), each list ending with `0xFF`, and the whole list ending with another `0xFF`. A track is a MIDI channel, or a
 * digitized sample when its first byte is `0xFE`.
 *
 * Errors are {@link FormatError}s. Their offset is in the unpacked sound, or 0 when unpacking failed.
 */
export function decodeSound(entry: SoundEntry): Sound {
  let data: Uint8Array;
  try {
    data = decompressType3(entry.packed);
  } catch (error) {
    throw new FormatError(`Couldn't unpack the sound: ${(error as Error).message}`, 0);
  }
  return { data, devices: readSoundTracks(data) };
}

/** Reads the devices and tracks of an unpacked sound. See {@link decodeSound}. */
export function readSoundTracks(data: Uint8Array): SoundDevice[] {
  if (data.length < PATCH_HEADER + 1 || data[0] !== SOUND_PATCH)
    throw new FormatError("Not a sound patch: it doesn't start with 84", 0);
  const body = data.subarray(PATCH_HEADER);
  const devices: SoundDevice[] = [];
  let i = 0;
  const byte = () => {
    if (i >= body.length) throw new FormatError("The device list doesn't end", PATCH_HEADER + i);
    return body[i]!;
  };
  while (byte() !== END) {
    const device: SoundDevice = { id: body[i++]!, tracks: [] };
    while (byte() !== END) {
      const at = PATCH_HEADER + i;
      if (i + 6 > body.length) throw new FormatError("Truncated track entry", at);
      const offset = view(body).getUint16(i + 2, true);
      const size = view(body).getUint16(i + 4, true);
      if (size < 2 || offset + size > body.length) throw new FormatError("A track lies outside the sound", at);
      device.tracks.push(readTrack(body.subarray(offset, offset + size), offset, PATCH_HEADER + offset));
      i += 6;
    }
    i++;
    devices.push(device);
  }
  return devices;
}

function readTrack(track: Uint8Array, offset: number, at: number): SoundTrack {
  const header: [number, number] = [track[0]!, track[1]!];
  if (header[0] !== DIGITAL) return { offset, size: track.length, data: track, header, channel: header[0] & 15 };
  // A sample: FE, a byte, then the u16 rate, size, loop start and loop end.
  if (track.length < SAMPLE_HEADER) throw new FormatError("Truncated sample header", at);
  const v = view(track);
  const size = v.getUint16(4, true);
  if (SAMPLE_HEADER + size > track.length) throw new FormatError("The sample is larger than its track", at + 4);
  const sample = {
    rate: v.getUint16(2, true),
    data: track.subarray(SAMPLE_HEADER, SAMPLE_HEADER + size),
    loopStart: v.getUint16(6, true),
    loopEnd: v.getUint16(8, true),
  };
  return { offset, size: track.length, data: track, header, sample };
}

/** The first digitized sample of a sound, on any device. */
export const soundSample = (sound: Sound): Sample | undefined =>
  sound.devices.flatMap((d) => d.tracks).find((t) => t.sample)?.sample;

/** A file of the sound driver bundle `SX.OVL`, unpacked: a driver like `ADL` or a SCI patch like `003`. */
export interface DriverFile {
  /** The chunk's tag without its colon, like `ADL` or `003`. */
  name: string;
  /** Position of the chunk's header in the bundle. */
  offset: number;
  data: Uint8Array;
}

/** The 2-byte header of a SCI patch resource: the resource type 9 with the high bit set, then 0. */
const PATCH_RESOURCE = 0x89;

/**
 * Reads the sound driver bundle `SX.OVL`: an `SSM:` container with a chunk per file, each packed like a `BIN:` chunk.
 * The three-letter files are the drivers (`ADL` AdLib, `M32` MT-32, `GMD` General MIDI and more); the numbered ones are
 * SCI patch resources, like `003` with the AdLib instruments.
 *
 * Errors are {@link FormatError}s with the offset in `data` where reading stopped.
 */
export function readSoundDrivers(data: Uint8Array): DriverFile[] {
  const [root] = readChunks(data);
  if (!root || root.tag !== "SSM:") throw new FormatError("No SSM: container", 0);
  return root.children.map((chunk) => {
    try {
      return { name: chunk.tag.slice(0, 3), offset: chunk.offset, data: decodeBin(chunk.data) };
    } catch (error) {
      if (error instanceof FormatError)
        throw new FormatError(`${chunk.tag} ${error.message}`, chunk.offset + CHUNK_HEADER + (error.offset ?? 0));
      throw error;
    }
  });
}

/** The data of SCI patch `number` in a driver bundle, without its 2-byte header, or undefined when it isn't there. */
export function findPatch(files: DriverFile[], number: number): Uint8Array | undefined {
  const file = files.find((f) => f.name === String(number).padStart(3, "0"));
  if (!file) return undefined;
  if (file.data[0] !== PATCH_RESOURCE) throw new FormatError(`Patch ${file.name} doesn't start with 89`, file.offset);
  return file.data.subarray(PATCH_HEADER);
}
