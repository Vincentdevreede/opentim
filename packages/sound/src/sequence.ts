/** Reading the MIDI tracks of a SCI sound resource. */

export interface MidiEvent {
  /** When the event happens, in ticks from the start of the sound. */
  tick: number;
  status: number;
  a: number;
  b: number;
}

/** SCI plays sounds at 60 ticks per second. */
export const TICKS_PER_SECOND = 60;

const DELAY = 0xf8;
const DELAY_TICKS = 240;
const END = 0xfc;
const SYSEX = 0xf0;
const SYSEX_END = 0xf7;

/**
 * Reads the events of one track, without its 2-byte channel header. Each event starts with its delay in ticks: a byte,
 * after any number of `0xF8` bytes that add 240 ticks each. Then comes a MIDI message, with running status. `0xFC` ends
 * the track. Returns the events and the tick the track ends at.
 */
export function readTrackEvents(data: Uint8Array): { events: MidiEvent[]; end: number } {
  const events: MidiEvent[] = [];
  let i = 0;
  let tick = 0;
  let running = 0;
  const next = () => {
    if (i >= data.length) throw new Error(`The track ends without 0xFC at byte ${i}`);
    return data[i++]!;
  };
  for (;;) {
    let delay = next();
    while (delay === DELAY) {
      tick += DELAY_TICKS;
      delay = next();
    }
    tick += delay;
    let status = next();
    if (status === END) return { events, end: tick };
    if (status === SYSEX) {
      while (next() !== SYSEX_END);
      continue;
    }
    if (status < 0x80) {
      if (!running) throw new Error(`Data byte without a status at byte ${i - 1}`);
      status = running;
      i--;
    } else if (status >= 0xf0) throw new Error(`Unknown event ${status.toString(16)} at byte ${i - 1}`);
    running = status;
    const a = next();
    const type = status & 0xf0;
    const b = type === 0xc0 || type === 0xd0 ? 0 : next();
    events.push({ tick, status, a, b });
  }
}

/** Merges the events of several tracks in time order, keeping the order of the tracks for events at the same tick. */
export function mergeTracks(tracks: MidiEvent[][]): MidiEvent[] {
  return tracks
    .flatMap((events, track) => events.map((event, index) => ({ event, track, index })))
    .sort((x, y) => x.event.tick - y.event.tick || x.track - y.track || x.index - y.index)
    .map((x) => x.event);
}
