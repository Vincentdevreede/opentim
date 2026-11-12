import evenmore from "./lists/evenmore.json" with { type: "json" };
import names from "./lists/names.json" with { type: "json" };
import tim1 from "./lists/tim1.json" with { type: "json" };
import tim2 from "./lists/tim2.json" with { type: "json" };
import type { PartList } from "./model.ts";

export type { Frame, Part, PartList, Placement } from "./model.ts";
export {
  compose,
  coverSprites,
  drawOrder,
  type Bounds,
  type Composition,
  type Placed,
  type SpriteOf,
} from "./compose.ts";
export {
  GAMES,
  readProgramParts,
  readTim2Parts,
  type SpriteCount,
  type SheetData,
  type ListId,
  type ProgramParts,
  type TypeRecord,
} from "./read/parts.ts";
export { RECORD_FIELDS, RECORD_SIZE, type RecordField } from "./read/type-table.ts";

/** Every part list, by id. The version catalog says which list belongs to a version of a game. */
export const PART_LISTS: Record<string, PartList> = Object.fromEntries(
  ([tim1, evenmore, tim2] as PartList[]).map((list) => [list.id, list]),
);

/**
 * The English name of each part, by id. The names are the game's own, from TIM 2's `INFO.RES`; the same object has the
 * same id in every list, so a TIM 1 part gets the name of the same object in TIM 2. A part TIM 2 doesn't have has none.
 */
export const PART_NAMES: ReadonlyMap<string, string> = new Map(names.names.map((n) => [n.id, n.name]));

/** The part with this number in a list, if the list has one. */
export const partOfType = (list: PartList, type: number) => list.parts.find((part) => part.type === type);

export { decodeInstruction, operandText, type CodeAddress, type Instruction, type Operand } from "./read/x86.ts";
export { readRoutineCode, type RoutineCode } from "./read/behaviour-code.ts";
export {
  readBehaviour,
  readBehaviourInSteps,
  type ReadProgress,
  analyseRoutine,
  choiceOf,
  type BehaviourReport,
  type PartBehaviour,
  type RoutineAnalysis,
  type CallbackReference,
  type Confidence,
  type Evidence,
  type Expression,
  type Predicate,
  type FieldWrite,
  type Transition,
  type Counter,
  type Trigger,
} from "./read/behaviour.ts";
export { findBehaviourTiming, type BehaviourTiming } from "./read/behaviour-timing.ts";
export { discoverBehaviourLayout, type BehaviourLayout } from "./read/behaviour-layout.ts";
export { measuredClips, validateMeasuredPart, type MeasurementCoverage } from "./read/behaviour-validation.ts";

export {
  describeBehaviour,
  walkBehaviourRules,
  type BehaviourDescription,
  type PartBehaviourDescription,
  type BehaviourWalk,
  type AnimationDescription,
  type AnimationTrigger,
  type RestDescription,
  type KnownField,
  type FrameVisit,
  type DescribedEffect,
} from "./read/describe-behaviour.ts";
export { type OtherPartEffect, type OtherPartSetting } from "./read/describe-effects.ts";
export {
  discoverEngineSummaries,
  type EngineSummary,
  type EngineWrite,
  type EngineReturn,
  type EnginePointer,
} from "./read/behaviour-helpers.ts";
export { discoverBehaviourLifecycle, type BehaviourLifecycle } from "./read/behaviour-lifecycle.ts";
export { discoverCountedLoops, type LoopSummary } from "./read/behaviour-loops.ts";
export type { RoutineOutcome } from "./read/behaviour.ts";
export type { LayoutField, FieldContext, CallbackObjectSource } from "./read/behaviour-layout.ts";

export { compareMeasuredWalks, type WalkMatch } from "./read/behaviour-walk-validation.ts";
export { discoverListLoops, type ListLoopSummary } from "./read/behaviour-list-loops.ts";
export { discoverLifecycleFieldRoles } from "./read/behaviour-lifecycle.ts";
export {
  validateDescribedWalks,
  type DescribedWalkCoverage,
  type DescribedWalkMatch,
} from "./read/behaviour-walk-validation.ts";
export { createEvidenceWriter, restoreEvidenceDocument, EVIDENCE_ENCODING } from "./read/behaviour-evidence.ts";
export { discoverCreationDefaults, type CreationDefault, type CreationField } from "./read/behaviour-creation.ts";

export type { GearPropagationRelation, GearAdvanceRelation, GearConflictValue } from "./read/behaviour-gear-model.ts";
export type { GearRunContract } from "./read/behaviour-gear-run.ts";
export { describeGear, type GearDescription, type GearDriverDescription } from "./read/describe-gear.ts";
export { pickOutlineTable, type OutlineTableChoice, type OutlineTables } from "./read/behaviour-outline-tables.ts";
export type { GearScheduling } from "./read/behaviour-gear-scheduling.ts";
export type { GearConnections } from "./read/behaviour-gear-connections.ts";
export type { ContactBounds } from "./read/behaviour-contact-bounds.ts";
export type { ContactSearch, ContactObjectWrite } from "./read/behaviour-contact-effects.ts";
export type { ContactSegmentTest } from "./read/behaviour-contact-segment.ts";
export type { ContactArithmetic } from "./read/behaviour-contact-arithmetic.ts";
export type { ContactSelection } from "./read/behaviour-contact-selection.ts";
export type { EmptyContactReturn } from "./read/behaviour-contact-empty.ts";
export type {
  ContactOutline,
  OutlineFormulae,
  OutlineContext,
  OutlinePoint,
} from "./read/behaviour-contact-outline.ts";
export type { ContactSmallRelation } from "./read/behaviour-contact-small.ts";
export type { ContactMotionAngle } from "./read/behaviour-contact-motion-angle.ts";

export type {
  CollisionDispatch,
  CollisionTarget,
  CollisionResponseDescription,
} from "./read/behaviour-collision-dispatch.ts";

export type { ContactResponse } from "./read/behaviour-contact-response.ts";

export {
  LEVEL_MAGIC,
  LevelError,
  PULLEY,
  TIM2_LEVEL_MAGIC,
  readLevel,
  type Level,
  type LevelField,
  type LevelGoalEntry,
  type LevelKind,
  type LevelLayout,
  type LevelNote,
  type LevelPart,
  type PartGroup,
  type RopeSlot,
} from "./read/level.ts";
export {
  EVEN_MORE_FLOPPY_EXE,
  GEAR_TYPE,
  LOADED_FIELDS,
  LOADED_HEADERS,
  TIM_FRENCH_EXE,
  type LoadedHeader,
  type LoadedKey,
  type LoadedPlace,
} from "./read/level-loader.ts";

export type { ContactRotation, RotationScalar } from "./read/behaviour-contact-rotation.ts";
export type { ContactResponseFirst, FirstResponseFormula } from "./read/behaviour-contact-response-first.ts";

export type {
  ContactResponsePair,
  PairResponseOperation,
  PairResponseFormula,
  PairCentreAngle,
} from "./read/behaviour-contact-response-pair.ts";
export { readProgramGoals, type ProgramGoals, type PuzzleGoal } from "./read/program-goals.ts";
export {
  conditionText,
  summariseGoal,
  type GoalArea,
  type GoalCondition,
  type GoalSummary,
} from "./read/goal-conditions.ts";
