import { describe, expect, it } from "vitest";
import type { PartBehaviourDescription, RestDescription } from "../src/read/describe-behaviour.ts";
import { allowedSavedFrames, checkLevelFrames, startFrame } from "../src/read/level-frame-check.ts";

const finding = { confidence: "checked" as const, assumptions: [], evidence: [] };
const part = (
  type: number,
  id: string,
  rest: Partial<RestDescription> & Pick<RestDescription, "status">,
  resting: number[] = [],
): PartBehaviourDescription =>
  ({
    ...finding,
    type,
    id,
    summary: "",
    rest: { description: "", fields: [], ...finding, ...rest },
    stableStates: resting.map((state) => ({ state, fields: [], origins: [], ...finding })),
    effects: [],
    rules: [],
    animations: [],
    triggers: [],
    uncertainties: [],
    effectsFromOthers: [],
  }) as PartBehaviourDescription;
const level = (name: string, ...parts: [type: number, frame: number, control?: number, width?: number][]) => ({
  name,
  parts: parts.map(([type, frame, control = 0, width = 16], index) => ({
    index,
    type,
    state: [frame, control] as [number, number],
    size: { width, height: 16 },
  })),
});

describe("saved frames in shipped levels", () => {
  it("takes the frames from a decided assumption, the part's own frames, or nothing", () => {
    expect(allowedSavedFrames(part(5, "conveyor-belt", { status: "saved" }), undefined)).toEqual({
      frames: [0, 7, 14, 21, 28],
      basis: "decided assumption",
    });
    expect(allowedSavedFrames(part(26, "generator", { status: "sockets" }), 16).frames).toEqual([0, 4, 8, 12]);
    expect(allowedSavedFrames(part(12, "cat", { status: "saved" }), 3).frames).toEqual([0, 1, 2]);
    const incline = allowedSavedFrames(part(2, "wood-incline", { status: "saved" }), undefined);
    expect(incline).toMatchObject({ frames: [-1, 0, 1, 2, 3], basis: "decided assumption" });
    expect([0, 15, 16, 40, 64].map((width) => incline.fromWidth!(width))).toEqual([-1, -1, 0, 1, 3]);
    expect(allowedSavedFrames(part(40, "windmill", { status: "saved" }), undefined)).toEqual({
      basis: "no frame list and no decided assumption",
    });
  });

  it("starts from the reset's frame or the saved one, and leaves a reset from the sockets open", () => {
    expect(startFrame(part(1, "brick-wall", { status: "known", state: 0 }), 3)).toBe(0);
    expect(startFrame(part(12, "cat", { status: "saved" }), 2)).toBe(2);
    expect(startFrame(part(21, "electric-switch", { status: "sockets" }), 4)).toBeUndefined();
  });

  it("reports frames and control values outside the allowed ones, and starts that don't rest", () => {
    const rows = checkLevelFrames(
      [
        { description: part(14, "gear", { status: "saved" }, [0, 1, 2, 3]) },
        { description: part(54, "mel-schlemming", { status: "saved" }, [30]), frameCount: 31 },
        { description: part(2, "wood-incline", { status: "saved" }, [0xffff, 0, 1, 2, 3]) },
        { description: part(9, "basketball", { status: "known", state: 0 }, [0]), frameCount: 1 },
      ],
      [
        level("L1.LEV", [14, 0], [14, 4], [54, 0], [2, -1, 0, 0]),
        level("L2.LEV", [14, 1, -1], [14, 2, 2], [2, 3, 0, 64], [2, 1, 0, 64], [2, 4, 0, 80]),
      ],
    );
    expect(rows.map((row) => row.id)).toEqual(["wood-incline", "gear", "mel-schlemming"]);
    const [incline, gear, mel] = rows;
    // An incline is saved on the frame its width gives, and on one of frames -1 to 3.
    expect(incline!.outside).toEqual(["L2.LEV #3 frame 1, width 64 gives 3", "L2.LEV #4 frame 4"]);
    // Frame -1 rests as the word 65535; frame 4 doesn't rest.
    expect([...incline!.notResting]).toEqual([[4, 1]]);
    expect([...incline!.saved]).toEqual([
      [-1, 1],
      [3, 1],
      [1, 1],
      [4, 1],
    ]);
    expect(gear!.outside).toEqual(["L1.LEV #1 frame 4"]);
    expect(gear!.controls).toEqual(["L2.LEV #1 control 2"]);
    expect([...gear!.notResting]).toEqual([[4, 1]]);
    expect(mel!.outside).toEqual([]);
    expect([...mel!.notResting]).toEqual([[0, 1]]);
  });
});
