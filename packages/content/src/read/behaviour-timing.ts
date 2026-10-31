/** Finds the PIT programming and the wait on its counter by instruction structure, without executing code. */
import { readRoutineCode } from "./behaviour-code.ts";
import { decodeInstruction } from "./x86.ts";

export interface TimingEvidence {
  address: number;
  bytes: number[];
  text: string;
}

export interface BehaviourTiming {
  pit?: {
    installer: number;
    parameter: number;
    divisor: number;
    interruptHandler: number;
    counter: number;
    confidence: "inferred";
    evidence: TimingEvidence[];
    assumptions: string[];
  };
  cycle?: {
    counter: number;
    waitSites: number[];
    simulationWaitSites: number[];
    reset: number;
    minimumInterrupts: number;
    minimumPeriodMilliseconds: number;
    confidence: "inferred";
    evidence: TimingEvidence[];
    assumptions: string[];
  };
  diagnostics: string[];
}

const word = (image: Uint8Array, at: number) => image[at]! | (image[at + 1]! << 8);

/** A structural signature; null marks an instruction operand whose value is read from the image. */
export function matchesInstructions(image: Uint8Array, at: number, pattern: (number | null)[]): boolean {
  return at >= 0 && at + pattern.length <= image.length && pattern.every((b, i) => b === null || image[at + i] === b);
}

/** Decode every byte of a matched instruction window so reports retain bytes as well as readable evidence. */
export function instructionEvidence(image: Uint8Array, start: number, end: number): TimingEvidence[] {
  const evidence: TimingEvidence[] = [];
  const segment = Math.floor(start / 0x10000) * 0x1000;
  for (let at = start; at < end;) {
    const instruction = decodeInstruction(image, at, segment);
    if (at + instruction.size > end)
      throw new Error(`Instruction window ends inside an instruction at 0x${at.toString(16)}`);
    evidence.push({ address: at, bytes: instruction.bytes, text: instruction.text });
    at += instruction.size;
  }
  return evidence;
}

/**
 * The nominal PC PIT clock is an external hardware assumption. The executable proves the divisor computation and
 * the counter wait, but does not prove that each object receives one run callback in each game cycle.
 */
export function findBehaviourTiming(image: Uint8Array, runDispatchSites: number[] = []): BehaviourTiming {
  const result: BehaviourTiming = { diagnostics: [] };
  const ports = [0xb0, 0x36, 0xe6, 0x43, 0x8a, 0xc3, 0xe6, 0x40, 0x8a, 0xc7, 0xe6, 0x40];
  const setup = [
    0x2b,
    0xc0,
    0x8b,
    0xd0,
    0x8b,
    0x5e,
    0x06,
    0x81,
    0xfb,
    0xff,
    0x00,
    0x7f,
    null,
    0x0b,
    0xdb,
    0x74,
    null,
    0x48,
    0x89,
    0x1e,
    null,
    null,
    0x89,
    0x1e,
    null,
    null,
    0xf7,
    0xf3,
    0x8b,
    0xd8,
    0xa3,
    null,
    null,
    0xfa,
  ];
  const candidates: NonNullable<BehaviourTiming["pit"]>[] = [];
  for (let at = setup.length; at + ports.length < image.length; at++) {
    if (!matchesInstructions(image, at, ports) || !matchesInstructions(image, at - setup.length, setup)) continue;
    let entry = at - setup.length;
    while (entry >= Math.max(0, at - 160) && !matchesInstructions(image, entry, [0x55, 0x8b, 0xec])) entry--;
    if (entry < Math.max(0, at - 160)) continue;
    const callers: { at: number; parameter: number; segment: number }[] = [];
    for (let p = 0; p + 9 <= image.length; p++) {
      if (!matchesInstructions(image, p, [0xb8, null, null, 0x50, 0x9a, null, null, null, null])) continue;
      const segment = word(image, p + 7);
      if (segment * 16 + word(image, p + 5) === entry) callers.push({ at: p, parameter: word(image, p + 1), segment });
    }
    const parameters = new Set(callers.map((c) => c.parameter));
    if (parameters.size !== 1 || !callers.length) continue;
    const caller = callers[0]!;
    if (caller.parameter < 1 || caller.parameter > 255) continue;
    let handler = -1;
    let vector = -1;
    for (let p = at + ports.length; p < Math.min(image.length - 12, at + 80); p++) {
      if (
        !matchesInstructions(image, p, [0x1e, 0x8c, 0xc8, 0x8e, 0xd8, 0xba, null, null, 0xb8, 0x08, 0x25, 0xcd, 0x21])
      )
        continue;
      handler = caller.segment * 16 + word(image, p + 6);
      vector = p;
      break;
    }
    if (handler < 0) continue;
    let irq = -1;
    for (let p = handler; p < Math.min(image.length - 16, handler + 32); p++) {
      if (
        !matchesInstructions(image, p, [
          0xb8,
          null,
          null,
          0x8e,
          0xd8,
          0xa1,
          null,
          null,
          0x48,
          0x99,
          0x33,
          0xc2,
          0xa3,
          null,
          null,
        ])
      )
        continue;
      if (word(image, p + 6) === word(image, p + 13)) {
        irq = p;
        break;
      }
    }
    if (irq < 0) continue;
    candidates.push({
      installer: entry,
      parameter: caller.parameter,
      divisor: Math.floor(0xffff / caller.parameter),
      interruptHandler: handler,
      counter: word(image, irq + 6),
      confidence: "inferred",
      evidence: [
        ...instructionEvidence(image, at - setup.length, at + ports.length),
        ...callers.flatMap((c) => instructionEvidence(image, c.at, c.at + 9)),
        ...instructionEvidence(image, vector, vector + 13),
        ...instructionEvidence(image, irq, irq + 15),
      ],
      assumptions: [
        "The matched direct callers supply the timer installation parameter on the first word stack argument.",
        "The PIT uses the nominal IBM PC compatible input clock of 1,193,182 Hz; this value is not encoded in the executable.",
        "DOS interrupt 21h function 25h installs the matched address as interrupt vector 8.",
      ],
    });
  }
  if (candidates.length !== 1) {
    result.diagnostics.push(
      `Expected one PIT installation linked to its caller and interrupt counter; found ${candidates.length}.`,
    );
    return result;
  }
  result.pit = candidates[0]!;
  const waits: NonNullable<BehaviourTiming["cycle"]>[] = [];
  for (let at = 0; at + 12 < image.length; at++) {
    if (!matchesInstructions(image, at, [0xb8, null, null, 0x2b, 0x06, null, null, 0x3d, null, null, 0x7c, 0xf4]))
      continue;
    if (word(image, at + 5) !== result.pit.counter) continue;
    const reset = word(image, at + 1);
    const minimumInterrupts = word(image, at + 8);
    if (!minimumInterrupts || minimumInterrupts >= reset) continue;
    for (let p = at + 12; p < Math.min(image.length - 6, at + 48); p++) {
      if (!matchesInstructions(image, p, [0xc7, 0x06, null, null, null, null])) continue;
      if (word(image, p + 2) !== result.pit.counter || word(image, p + 4) !== reset) continue;
      waits.push({
        counter: result.pit.counter,
        waitSites: [at],
        simulationWaitSites: [],
        reset,
        minimumInterrupts,
        minimumPeriodMilliseconds: (1000 * minimumInterrupts * result.pit.divisor) / 1193182,
        confidence: "inferred",
        evidence: instructionEvidence(image, at, p + 6),
        assumptions: [
          "The installed IRQ handler advances this countdown once per PIT channel 0 interrupt.",
          "The PIT input clock is the nominal IBM PC compatible 1,193,182 Hz.",
          "This is a lower bound between cycle ends, not a duration for a state or a guarantee of one run callback per cycle.",
        ],
      });
      break;
    }
  }
  if (
    waits.length &&
    waits.every((w) => w.reset === waits[0]!.reset && w.minimumInterrupts === waits[0]!.minimumInterrupts)
  ) {
    result.cycle = {
      ...waits[0]!,
      waitSites: waits.flatMap((w) => w.waitSites),
      evidence: waits.flatMap((w) => w.evidence),
    };
    for (const wait of result.cycle.waitSites) {
      let entry = wait;
      while (entry >= Math.max(0, wait - 1024) && !matchesInstructions(image, entry, [0x55, 0x8b, 0xec])) entry--;
      if (entry < Math.max(0, wait - 1024)) continue;
      const segment = Math.floor(entry / 0x10000) * 0x1000;
      const code = readRoutineCode(image, { address: entry, segment, offset: entry - segment * 16 }, 0);
      if (!code.instructions.some((i) => i.address === wait)) continue;
      for (const call of code.calls) {
        if (!call.target) continue;
        const dispatcher = readRoutineCode(image, call.target, 0);
        const sites = dispatcher.instructions.filter((i) => runDispatchSites.includes(i.address));
        if (!sites.length) continue;
        result.cycle.simulationWaitSites.push(wait);
        result.cycle.evidence.push(
          ...call.evidence,
          ...sites.map((i) => ({ address: i.address, bytes: i.bytes, text: i.text })),
        );
        break;
      }
    }
    result.cycle.assumptions.push(
      result.cycle.simulationWaitSites.length
        ? "The identified simulation wait belongs to a routine that directly calls a dispatcher containing the discovered run callback calls. Object lists and flags still decide which callbacks run."
        : "The matched waits share a timing base; identifying the simulation loop among them requires callback-dispatch linkage.",
    );
  } else
    result.diagnostics.push(
      `Expected consistent waits and resets of the installed timer counter; found ${waits.length} candidates.`,
    );
  return result;
}
