import { describe, expect, it } from "vitest";
import { findBehaviourTiming } from "../src/read/behaviour-timing.ts";

function timerImage(parameter = 13): Uint8Array {
  const image = new Uint8Array(0x400);
  image.set([0xb8, parameter, 0, 0x50, 0x9a, 0, 0, 0x10, 0], 0x20);
  image.set([0x55, 0x8b, 0xec], 0x100);
  image.set(
    [
      0x2b, 0xc0, 0x8b, 0xd0, 0x8b, 0x5e, 6, 0x81, 0xfb, 0xff, 0, 0x7f, 0x3c, 0x0b, 0xdb, 0x74, 0x38, 0x48, 0x89, 0x1e,
      0x43, 0, 0x89, 0x1e, 0x45, 0, 0xf7, 0xf3, 0x8b, 0xd8, 0xa3, 0x41, 0, 0xfa, 0xb0, 0x36, 0xe6, 0x43, 0x8a, 0xc3,
      0xe6, 0x40, 0x8a, 0xc7, 0xe6, 0x40, 0x1e, 0x8c, 0xc8, 0x8e, 0xd8, 0xba, 0, 1, 0xb8, 8, 0x25, 0xcd, 0x21,
    ],
    0x120,
  );
  image.set([0xb8, 0x30, 0, 0x8e, 0xd8, 0xa1, 0x40, 0, 0x48, 0x99, 0x33, 0xc2, 0xa3, 0x40, 0], 0x200);
  image.set([0xb8, 0x10, 0x27, 0x2b, 6, 0x40, 0, 0x3d, 8, 0, 0x7c, 0xf4, 0xc7, 6, 0x40, 0, 0x10, 0x27], 0x300);
  return image;
}

describe("static timer discovery", () => {
  it("links the installer, caller, interrupt counter and backward wait", () => {
    const timing = findBehaviourTiming(timerImage());
    expect(timing.diagnostics).toEqual([]);
    expect(timing.pit).toMatchObject({ installer: 0x100, divisor: 5041, interruptHandler: 0x200, counter: 0x40 });
    expect(timing.cycle).toMatchObject({ minimumInterrupts: 8, waitSites: [0x300] });
    expect(timing.cycle!.minimumPeriodMilliseconds).toBeCloseTo(33.7987);
    expect(timing.pit!.evidence.some((e) => e.text === "div bx")).toBe(true);
  });

  it("links the simulation wait to an actual call of the run dispatcher", () => {
    const image = new Uint8Array(0x500).fill(0x90);
    image.set(timerImage());
    image.fill(0x90, 0x2e0, 0x300);
    image.set([0x55, 0x8b, 0xec, 0xe8, 0x1a, 0x01], 0x2e0);
    image[0x312] = 0xcb;
    image.set([0x55, 0x8b, 0xec, 0xff, 0x1e, 0, 0, 0xcb], 0x400);
    const timing = findBehaviourTiming(image, [0x403]);
    expect(timing.cycle!.simulationWaitSites).toEqual([0x300]);
    expect(timing.cycle!.evidence.some((e) => e.address === 0x403)).toBe(true);
  });

  it("reads the parameter instead of assuming the measured divisor", () => {
    expect(findBehaviourTiming(timerImage(7)).pit!.divisor).toBe(Math.floor(65535 / 7));
  });

  it("rejects a wait on a different counter", () => {
    const image = timerImage();
    image[0x305] = 0x41;
    const timing = findBehaviourTiming(image);
    expect(timing.cycle).toBeUndefined();
    expect(timing.diagnostics[0]).toContain("waits and resets");
  });

  it("reports a missing timer instead of guessing", () => {
    const timing = findBehaviourTiming(new Uint8Array(200));
    expect(timing.pit).toBeUndefined();
    expect(timing.diagnostics[0]).toContain("found 0");
  });
});
