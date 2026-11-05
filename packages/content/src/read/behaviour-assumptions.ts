/**
 * The assumptions decided during the behaviour research, where the code alone can't settle a question. Each is stated
 * on every finding that uses it, and explained in docs/behaviour-assumptions.md so it can be rechecked later.
 */
import { INCLUSIVE_LIST_ASSUMPTION } from "./behaviour-list-loops.ts";
import { OUTLINE_SEARCH_ASSUMPTIONS } from "./behaviour-outline-search.ts";
import { ROPE_CUT_ASSUMPTIONS } from "./behaviour-rope-cut.ts";
import { ROPE_ASSUMPTIONS } from "./behaviour-rope-dispatch.ts";
import { CONVEYOR_BELT_ASSUMPTION, GEAR_ASSUMPTION, MONKEY_BIKE_ASSUMPTION } from "./behaviour-saved-frames.ts";

export const DECIDED_ASSUMPTIONS: { title: string; assumptions: string[] }[] = [
  { title: "Ropes", assumptions: ROPE_ASSUMPTIONS },
  { title: "The scissors' rope cut", assumptions: ROPE_CUT_ASSUMPTIONS },
  { title: "The teeter-totter's search", assumptions: [...OUTLINE_SEARCH_ASSUMPTIONS, INCLUSIVE_LIST_ASSUMPTION] },
  { title: "The monkey bike's starting frame", assumptions: [MONKEY_BIKE_ASSUMPTION] },
  { title: "The conveyor belt's starting frame", assumptions: [CONVEYOR_BELT_ASSUMPTION] },
  { title: "The gear's starting frame", assumptions: [GEAR_ASSUMPTION] },
];
