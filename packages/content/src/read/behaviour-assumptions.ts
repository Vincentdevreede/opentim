/**
 * The assumptions decided during the behaviour research, where the code alone can't settle a question. Each is stated
 * on every finding that uses it, and explained in docs/behaviour-assumptions.md so it can be rechecked later.
 */
import { INCLUSIVE_LIST_ASSUMPTION } from "./behaviour-list-loops.ts";
import { FIXED_LIST_ASSUMPTION, SCREEN_DIRECTION_ASSUMPTION } from "./describe-effects.ts";
import { OUTLINE_SEARCH_ASSUMPTIONS } from "./behaviour-outline-search.ts";
import { PART_COPY_ASSUMPTIONS } from "./behaviour-part-copy.ts";
import { ROPE_CUT_ASSUMPTIONS } from "./behaviour-rope-cut.ts";
import { ROPE_ASSUMPTIONS } from "./behaviour-rope-dispatch.ts";
import {
  CONTROL_VALUE_ASSUMPTION,
  CONVEYOR_BELT_ASSUMPTION,
  ELECTRIC_MOTOR_ASSUMPTION,
  GEAR_ASSUMPTION,
  MONKEY_BIKE_ASSUMPTION,
  MONKEY_BIKE_REACTION_ASSUMPTION,
  MOUSE_MOTOR_ASSUMPTION,
  TEETER_TOTTER_END_ASSUMPTION,
} from "./behaviour-saved-frames.ts";

export const DECIDED_ASSUMPTIONS: { title: string; assumptions: string[] }[] = [
  { title: "Ropes", assumptions: ROPE_ASSUMPTIONS },
  {
    title: "The scissors' rope cut and the part copy",
    assumptions: [...ROPE_CUT_ASSUMPTIONS, ...PART_COPY_ASSUMPTIONS],
  },
  { title: "The teeter-totter's search", assumptions: [...OUTLINE_SEARCH_ASSUMPTIONS, INCLUSIVE_LIST_ASSUMPTION] },
  { title: "The monkey bike's starting frame", assumptions: [MONKEY_BIKE_ASSUMPTION] },
  { title: "The conveyor belt's starting frame", assumptions: [CONVEYOR_BELT_ASSUMPTION] },
  { title: "The gear's starting frame", assumptions: [GEAR_ASSUMPTION] },
  { title: "The mouse motor's starting frame", assumptions: [MOUSE_MOTOR_ASSUMPTION] },
  { title: "The electric motor's starting frame", assumptions: [ELECTRIC_MOTOR_ASSUMPTION] },
  { title: "Control values", assumptions: [CONTROL_VALUE_ASSUMPTION] },
  { title: "The teeter-totter's ends", assumptions: [TEETER_TOTTER_END_ASSUMPTION] },
  { title: "Parts on the fixed list", assumptions: [FIXED_LIST_ASSUMPTION] },
  { title: "Screen directions", assumptions: [SCREEN_DIRECTION_ASSUMPTION] },
  { title: "The monkey bike's reaction", assumptions: [MONKEY_BIKE_REACTION_ASSUMPTION] },
];
