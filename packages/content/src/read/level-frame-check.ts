/**
 * Checks the frames shipped levels save against what the behaviour description allows (step E1 of
 * docs/behaviour-plan.md). A level stores each part's saved frame and control value; the level reset starts the part
 * from them. The check needs no game code: it reads the description and the level files.
 */
import { CONTROL_VALUES, LEVEL_FRAMES } from "./behaviour-saved-frames.ts";
import type { PartBehaviourDescription } from "./describe-behaviour.ts";
import type { LevelPart } from "./level.ts";

/** The frames a level may save a part on, by the description, and why. Without `frames` nothing limits them. */
export interface AllowedFrames {
  frames?: number[];
  /** The one frame a part of a width starts on, when a decided assumption ties the frame to the width. */
  fromWidth?: (width: number) => number;
  basis: "decided assumption" | "own frames" | "no frame list and no decided assumption";
}

export function allowedSavedFrames(part: PartBehaviourDescription, frameCount: number | undefined): AllowedFrames {
  // A decided assumption names the frames for a part the program draws itself, or narrows its frame list.
  const decided = LEVEL_FRAMES.get(part.id);
  if (decided)
    return {
      frames: decided.frames,
      ...(decided.fromWidth ? { fromWidth: decided.fromWidth } : {}),
      basis: "decided assumption",
    };
  // Every other part is saved on one of its own frames (decided assumption 13).
  if (frameCount) return { frames: [...Array(frameCount).keys()], basis: "own frames" };
  return { basis: "no frame list and no decided assumption" };
}

/**
 * The frame the level reset leaves, when the description gives it without the part's plugs: a known reset frame, or
 * the saved frame when the reset keeps it. A reset that sets bits from the sockets (`sockets`) isn't worked out here.
 */
export function startFrame(part: PartBehaviourDescription, saved: number): number | undefined {
  if (part.rest.status === "known") return part.rest.state;
  if (part.rest.status === "saved") return saved;
  return undefined;
}

export interface LevelFrameRow {
  type: number;
  id: string;
  allowed: AllowedFrames;
  /** How many parts are saved on each frame, over every level and group (board and bin). */
  saved: Map<number, number>;
  /**
   * Saved frames the description doesn't allow, as `level #index frame`, or `level #index frame, width` when the frame
   * isn't the one the part's width gives. These are the disagreements.
   */
  outside: string[];
  /** Saved control values outside the decided ones (decided assumption 9), as `level #index control`. */
  controls: string[];
  /**
   * Start frames that aren't among the part's resting frames, with how many parts start there. Not a disagreement:
   * a part can start moving, like Mel Schlemming walking from frame 0.
   */
  notResting: Map<number, number>;
}

export interface CheckedLevel {
  name: string;
  parts: Pick<LevelPart, "index" | "type" | "state" | "size">[];
}

/** One row per part type of the description that a level saves, in type order. */
export function checkLevelFrames(
  parts: { description: PartBehaviourDescription; frameCount?: number }[],
  levels: CheckedLevel[],
): LevelFrameRow[] {
  const rows: LevelFrameRow[] = [];
  for (const { description, frameCount } of [...parts].sort((a, b) => a.description.type - b.description.type)) {
    const allowed = allowedSavedFrames(description, frameCount);
    const control = CONTROL_VALUES.get(description.id);
    // Frames are words: a resting frame of 65535 is the saved frame -1.
    const resting = new Set(description.stableStates.map((state) => state.state & 0xffff));
    const row: LevelFrameRow = {
      type: description.type,
      id: description.id,
      allowed,
      saved: new Map(),
      outside: [],
      controls: [],
      notResting: new Map(),
    };
    for (const level of levels)
      for (const part of level.parts) {
        if (part.type !== description.type) continue;
        const [frame, value] = part.state;
        row.saved.set(frame, (row.saved.get(frame) ?? 0) + 1);
        if (allowed.frames && !allowed.frames.includes(frame))
          row.outside.push(`${level.name} #${part.index} frame ${frame}`);
        else if (allowed.fromWidth && allowed.fromWidth(part.size.width) !== frame)
          row.outside.push(
            `${level.name} #${part.index} frame ${frame}, width ${part.size.width} gives ${allowed.fromWidth(part.size.width)}`,
          );
        if (control && !control.values.includes(value & 0xffff))
          row.controls.push(`${level.name} #${part.index} control ${value}`);
        const start = startFrame(description, frame);
        if (start !== undefined && resting.size && !resting.has(start & 0xffff))
          row.notResting.set(start, (row.notResting.get(start) ?? 0) + 1);
      }
    if (row.saved.size) rows.push(row);
  }
  return rows;
}
