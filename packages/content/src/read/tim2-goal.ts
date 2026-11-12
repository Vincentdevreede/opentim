/**
 * The goal of a TIM 2 puzzle. TIM 2 keeps it in the level file, after the parts (`level.tim2.goal`), and one routine
 * of TIM2.EXE tests it for every puzzle. That routine, as read from the program:
 *
 * - The goal is never met when the first word is 0.
 * - It isn't met while one of its parts is in the parts bin.
 * - Each of the eight entries with a part must hold. An entry is the part, two state limits, a count and an area
 *   (x, y, width, height). For a moving part with an area width other than 0 it tests the part's middle (its position
 *   plus half its base size): strictly inside the area, or, with a width of -1, off the screen, outside 0 to 640
 *   across and 0 to 400 down. Otherwise it tests the part's state, from the first limit to the second.
 * - With a count of 0 the entry is about its own part. With a count of N, N parts of that part's type on the same list
 *   must pass.
 * - The goal counts as met only from the routine's Nth check on, N being the last word. The run loop sets the count
 *   back to 0 when the machine starts and runs the routine once a step, so N is a number of steps.
 * - Once the routine says the goal is met, the run loop goes on for 30 more steps and then ends the puzzle as solved,
 *   whatever the routine says in those steps.
 */

import type { GoalCondition, GoalSummary } from "./goal-conditions.ts";
import type { Level } from "./level.ts";

/** TIM2.EXE's screen in the off the screen test: a part is off it when its middle is outside these. */
export const TIM2_SCREEN = { width: 640, height: 400 };

export interface Tim2Goal {
  /** The stored words, one line per entry that has a part, for showing them as they are. */
  lines: string[];
  summary: GoalSummary;
}

/** The goal of a TIM 2 level as conditions, or undefined for a level without one. */
export function summariseTim2Goal(level: Level, nameOf: (type: number) => string): Tim2Goal | undefined {
  const goal = level.tim2?.goal;
  if (!goal) return undefined;
  const lines = [`first word ${goal.first}, last word ${goal.last}`];
  const conditions: GoalCondition[] = [];
  goal.entries.forEach((entry, i) => {
    if (entry.part === null) return;
    const [low = 0, high = 0, count = 0, x = 0, y = 0, width = 0, height = 0] = entry.values;
    lines.push(`entry ${i + 1}: part #${entry.part}, ${entry.values.join(", ")}`);
    const part = level.parts[entry.part];
    if (!part) return;
    const type = { type: part.type, name: nameOf(part.type) };
    const moving = part.group === "moving";
    const condition: GoalCondition = { kind: "part", part: part.index, types: [type], tests: [] };
    let test: string;
    if (moving && width === -1) test = `its middle off the screen (${TIM2_SCREEN.width} × ${TIM2_SCREEN.height})`;
    else if (moving && width !== 0) {
      test = `its middle inside x ${x} to ${x + width}, y ${y} to ${y + height}`;
      // The area of the part's position that puts its middle inside, as the drawing shows goal areas.
      const halfX = part.baseSize.width >> 1;
      const halfY = part.baseSize.height >> 1;
      condition.area = {
        x: { min: x - halfX + 1, max: x + width - halfX - 1 },
        y: { min: y - halfY + 1, max: y + height - halfY - 1 },
      };
    } else test = low === high ? `state ${low}` : `state ${low} to ${high}`;
    // Parts without bit 0x40 of the third flag word start in the parts bin (see the levels research).
    const fromBin = ((part.flags[2] ?? 0) & 0x40) === 0;
    if (count) {
      Object.assign(condition, {
        kind: "count",
        lists: moving ? "the moving list" : "the static list",
        where: [test],
        count: { op: ">=", value: count },
      });
      delete condition.part;
      if (fromBin) condition.tests.push(`#${part.index} out of the parts bin`);
    } else {
      condition.tests.push(test);
      if (fromBin) condition.tests.push("out of the parts bin");
    }
    conditions.push(condition);
  });
  const ways: GoalCondition[][] = [];
  if (goal.first !== 0) {
    if (goal.last > 0)
      conditions.push({ kind: "word", tests: [`at least ${goal.last} steps after the machine starts`] });
    ways.push(conditions);
  }
  return { lines, summary: { ways, remembered: [], ...(goal.first ? {} : { problem: "the first word is 0" }) } };
}
