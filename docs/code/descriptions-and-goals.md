# Descriptions, goals, levels and the emulator

The rest of `packages/content/src`: what turns a `BehaviourReport` ([behaviour-reader.md](behaviour-reader.md)) into
sentences and walks, how a puzzle's goal is read, the level files, and the emulator in `src/run`.

## Descriptions: `describeBehaviour`

`describeBehaviour(report, onProgress?)` in `describe-behaviour.ts` gives a `BehaviourDescription`: one
`PartBehaviourDescription` per part. It works only from the report's rules; it never looks at instructions.

Its passes, in order:

1. `effectsFromOthers` (`describe-effects.ts`): what other parts do to a part without changing its frame, as
   "From other parts" lines (`OtherPartEffect`).
2. `hitsFromOthers` (`describe-hits.ts`): what other parts do that can change the frame (`PartHit`). It reports
   progress per source part.
3. `describePart` for each part:
   - the rest after a reset (`restOf`) and the fields after creation (`creationOf`);
   - stable states and effects (`effectsOf`: drawing, counters, related objects, helpers, outlines);
   - the gear (`describeGear`, `describe-gear.ts`);
   - the animations, each a walk from a start: `run-from-reset`, `run-from-creation`, `run-from-stable-N`,
     `callback-…`, `related-…`, `hit-N`, `run-guard-N` (input cases), `hit-N-case-M`, and periodic ones;
   - rests found by walks, uncertainties, the contact description (`describeCollisionDispatch`) and a summary
     sentence.

The main types (in `describe-behaviour.ts`): `PartBehaviourDescription` (rest, creation, stable states, effects,
rules, animations, triggers, uncertainties, effects from others, contact, gear), `RestDescription` (`known`, `saved`,
`sockets` or `unresolved`), `KnownField` (a value with `knownMask`: bits outside the mask are unknown, not zero),
`AnimationDescription`, `AnimationTrigger`, `DescribedEffect`, `FrameVisit`.

### Walks: `walkBehaviourRules`

A walk applies the part's run rules (slot 1) one run call at a time from known fields, symbolically. It keeps what it
knows of each field bit by bit, so unknown bits stay unknown. Each step keeps the rules that can apply to the frame,
works out where they lead, and goes on, splits, or stops with a reason. Splits are child walks that share one
explored tree, so a walk is a tree of conditional walks.

A `BehaviourWalk` ends as `rest`, `loop`, `unresolved`, `limit` or `joins` (it continues where another branch
already went). A stop says why: `condition`, `state`, `effects`, `ambiguity` or `coverage`, with the fields,
evidence, branches and the writers of an unknown field.

Inside, in order: setup (rules from `splitRules`, countdowns from `countdowns`), the start when the frame is unknown
(`possibleStates`, `nextFromAnyFrame`, a stable hold), branching on values (`valueBranches` from decided control
values or the field's writers, `runValueBranches` after a rope question), `branchesAt` when an unknown input decides
between rules, joining branches that already went the same way (`joined`, `countedJoin`), `widen` at the depth limit,
and the main run loop.

Limits: `BRANCH_DEPTH` 24, `BRANCH_BUDGET` 400 states per tree, `BRANCH_WAYS` 9 ways per split, 256 run calls,
`MAX_INPUT_CASES` 1,024.

### The other describe files

- `describe-effects.ts`: `effectsFromOthers`, and shared helpers the others import: list flags and their
  assumptions, `flagWords`, `nameOf` (a part's name in words), `splitBySource`, `tidyArithmetic`.
- `describe-hits.ts`: `hitsFromOthers`; where the part must be for a hit (`placeTest`, `placeWords`); which lists a
  search walks (`searchTests`, `searchesOnlyMovingList`).
- `describe-created.ts`: the parts a routine makes, where and how fast (`createdPartLines`).
- `describe-gear.ts`: the gear connection relation in words (`describeGear`).
- `describe-outline.ts`: writes to a part's outline points and outline tables in words.
- `describe-touch.ts`: the test algebra and wording all of them share: tests as value ranges (`testsOf`), joining
  paths that differ in one value (`joinPaths`), and `formula`, `compareWords`, `testsInWords`.
- `other-part-pairs.ts`: a coverage check, not used by the Lab: every pair of types that can affect each other, and
  whether it is described, ruled out or missing (`list-other-part-pairs`).

### Wording

Plain sentences. Fields go by the layout's names (`positionX`, `state`); an unnamed one is `field 0x0a`. Frames are
signed ("frame -1"). Time is counted in run calls, never in game steps, because one run per game step isn't proved.
Sentences don't claim that something happens in a level ("This is an input case, not a proved external trigger").
`confidence` takes the weakest of what a line is built from, and `finding` joins assumptions and evidence.

The Lab rewrites these sentences further (words instead of hex): see [lab.md](lab.md).

### Caches

`describe-behaviour.ts` keeps WeakMaps keyed by report objects (`textOf`, `choices`, `stepFindings`, `splitRulesOf`,
…), so they live for one read. `countdownValues` is a plain module-level Map keyed by `type:offset`. `hitsFromOthers`
remembers, within one pass, whether a part's rules can tell the limits of a range apart (`rulesIgnore`); that answer
is worked out for every speed in the range, so it was most of the description's time before.

A cache must not outlive one description: `readLoopsPerType` changes the report between the Lab's two descriptions.
Expressions and tests are never changed once made, so caching by their text (`textOf`) is safe.

## Goals of the puzzles

Goals aren't in the level files: each puzzle has a routine in TIM.EXE.

1. `findGoalTable` (`puzzle-goals.ts`) finds the dispatcher (`call far [bx+table]` indexed by the puzzle word) and
   its table; `findStepCounts` finds the words the run loop counts.
2. `readGoalRoutines` reads a routine and its callees into a small structured form (`GoalStatement`: set, call, if,
   loop, break, return). `runGoal` runs that form over a memory, for checks.
3. `readProgramGoals(program, report)` (`program-goals.ts`) does it for every puzzle and names what it can
   (`goalNames`: fields from the layout, types by id, the parts lists, the game mode word, the step counts). Each
   `PuzzleGoal` has `lines` and a `summary`.
4. `describeGoal` (`describe-goals.ts`) gives `lines`: the routine as indented pseudo-code ("for each X on <lists>:",
   "the goal is met").
5. `summariseGoal` (`goal-conditions.ts`) gives the `summary`: it runs the routine symbolically and gives `ways`, each
   a list of `GoalCondition`s (`every`, `none`, `some`, `first`, `last`, `count`, `word`) that together meet the
   goal, and `remembered`, the words the goal keeps between steps. When a goal doesn't fit, `problem` says why in
   plain words. `conditionText` says one condition in a line.

`check-goals` compares `runGoal` with the game's own routine in the emulator on random worlds (`goal-check.ts`).

## Level files

- `level.ts`: `readLevel(data, { layout, name })` reads TIM 1, Even More and Toons `.LEV`/`.GKC` files. Puzzle or
  freeform isn't stored, so both are tried. A `Level` has the header and the parts (static, moving, bin), and every
  value also as `fields` (key, offset, size) for byte views. TIM 2 levels aren't read.
- `level-loader.ts`: where the game's loader puts each field of a placed part in its record (`LOADED_FIELDS`) and
  each header value in the data segment (`LOADED_HEADERS`, by program hash). Found with the emulator by
  `check-level-fields`; TIM 1 and Even More only.
- `level-frame-check.ts`: checks the frames and control values the levels save against the descriptions
  (`check-level-frames`).
- `tim2.ts`: TIM 2's part names (`readPartNames`) and animations (`readAnimation`, `animationFrames`), for the part
  lists.

## The emulator: `src/run`

Node only and not exported from the package; the scripts import it by path. See
[the level recorder](../research/machine-recorder.md) for what it does and why.

- `program.ts`: `readLzexeProgram` unpacks TIM.EXE with its relocations and start registers.
- `cpu.ts`: `Cpu`, a real-mode 8086 with the 286 forms the game uses. It runs the same decoded instructions as the
  static reader, caches them per address, and is tested against DOSBox results.
- `dos.ts`: `Dos`, just enough DOS, BIOS and PC: read-only files, memory blocks, file handles, int 21h and the
  others, timer ticks through the game's own int 8 handler, keys through int 9.
- `game.ts`: `GAME_BUILDS` (the addresses of the two recorded builds), `startPuzzle` (boot, menu, load a puzzle with
  the game's own loader), `loadPuzzle` (the records right after loading) and `runPuzzle` (step the game's run loop and
  read every part record after each step).
- `goal-check.ts`: `checkGoals`, the random-world comparison of the goal reader with the game.

## The package's exports

`src/index.ts` exports the model and composition, the part lists, the decoder and graphs, the behaviour read and its
sub-analyses and types, validation, descriptions and walks, levels and the loader tables, and the goals. Not
exported (scripts import them by path): `src/run`, `other-part-pairs`, `level-frame-check`, `tim2`, `describeGoal`,
`runGoal`, `readGoalRoutines`, `evaluateBehaviourCondition` and `lzexe`.
