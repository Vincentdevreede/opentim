# The behaviour reader

`packages/content/src/read` reads what each part type does from TIM.EXE (TIM 1 and Even More) without running it.
The result is a `BehaviourReport`. [descriptions-and-goals.md](descriptions-and-goals.md) covers what turns the report
into words and walks; [the research](../research/behaviour/README.md) says what the reader found, part by part.

Nothing here runs x86: it decodes instructions, builds control-flow graphs and follows each path symbolically. Nothing
hard-codes an address of one build; comments name example addresses "in Even More, English floppy".

## Entry points

- `readBehaviourInSteps(program, parts, onProgress?)` in `behaviour.ts` returns `{ report, readLoopsPerType }`.
  `readLoopsPerType(onProgress?)` does the slow extra step later and changes the report's routines in place.
- `readBehaviour(program, parts)` does both at once.
- `program` is the packed TIM.EXE; `parts` is a `ProgramParts` from `readProgramParts` (`parts.ts`): the part list, the
  58-byte type records, the type table's address and the data segment.

The Lab runs it in a worker (see [lab.md](lab.md)); `extract-behaviour` runs it without the per-type loops, because
those would make a saved report too large.

## The pipeline of `readBehaviourInSteps`

In order (all in `behaviour.ts` unless named):

1. **Unpack**: `unpackLzexe` (`lzexe.ts`) gives the load image. Each type record is checked against it.
2. **Layout**: `discoverBehaviourLayout` (`behaviour-layout.ts`) proves the six callback slots of a type record and
   their roles: 0 bounce, 1 run, 2 reset, 3 flip, 4 resize, 5 rope. It also finds where the object argument sits on
   the stack and names part fields (`type`, `state`, `drawingFlags`, …); `behaviour-fields.ts` names more by how
   they are used. The read stops if this can't be proved.
3. **Timing**: `findBehaviourTiming` (`behaviour-timing.ts`): the PIT setting and the wait loop.
4. **Callbacks**: six `CallbackReference`s per type from the far pointers in its record.
5. **Crawl**: `readRoutineCode` (`behaviour-code.ts`) reads the graph of every callback and follows direct calls, up
   to 1,800 routines.
6. **Engine summaries**: `discoverEngineSummaries` (`behaviour-helpers.ts`) recognises the shared helpers (lists,
   factory, contact, gears, ropes, …) and gives each an `EngineSummary`. See below.
7. **Lifecycle**: `discoverBehaviourLifecycle` and `discoverLifecycleFieldRoles` (`behaviour-lifecycle.ts`): what the
   engine writes at a reset and into the history.
8. **`summarise(address)`**: the memoised driver for one routine. A helper whose summary keeps the part's state
   becomes a `RoutineAnalysis` straight from the summary. Anything else is read by `analyseRoutine`, after its
   callees. A callback whose loop over found parts depends on the found part's type queues a closure that re-reads it
   once per type: that is what `readLoopsPerType` runs.
9. **Frame drawing**: `proveFrameDrawing` (`behaviour-frame-drawing.ts`) proves the frame size and draw position
   helpers.
10. **Ropes**: `addRelayOwnerKeeps` applies decided assumptions 19 and 20; `addRopeDispatch` bounds the rope
    connection query by what the reachable rope callbacks write (`settleRopeDispatch` in `behaviour-rope-dispatch.ts`)
    and then clears the summaries, so the main loop reads everything again with that bound.
11. **Main loop**: `summarise` on the six callbacks of every type, with `onProgress` after each type. Most of the time
    goes here.
12. **Per part**: transitions (the state each path ends in, narrowed per start state by `possible`), counters, reset
    writes, visible effects, triggers, gear runs and connections, uncertainties.
13. **Between parts**: gear scheduling, effects on referenced objects (`relatedObjectEffects`), collision dispatch,
    outline tables, creation defaults, created parts, speed limits, report-wide assumptions.

## The main types

All in `behaviour.ts` unless named.

| Type                                     | What it is                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Finding`                                | The base of almost everything: `confidence`, `assumptions` (full sentences) and `evidence`.                                                                  |
| `Confidence`                             | `checked` (a direct fact of the instructions), `inferred` (needs the stated assumptions) or `unresolved`.                                                    |
| `Evidence`                               | One decoded instruction: `address`, `bytes`, `text`.                                                                                                         |
| `Expression`                             | `constant`, `field` (`object`, `offset`, `width`, maybe `unresolved`), `binary`, `table` or `unknown` (with a `reason`).                                     |
| `Predicate`                              | `true`, `compare` (`operator`, `left`, `right`, `signed`), `and` or `unknown`.                                                                               |
| `FieldWrite`                             | A write to `object` at `offset`, with its `value` and `condition`.                                                                                           |
| `Transition`                             | `from` (start states or null), `to` (the state it ends in), `condition`, `updates` (no globals), maybe `runValues`.                                          |
| `RoutineOutcome`                         | One path's result: `condition`, final `fields` (globals too), `returnValue`. Callers compose these.                                                          |
| `IterationOutcome`                       | What one pass of a loop does to one found member.                                                                                                            |
| `RoutineAnalysis`                        | `analyseRoutine`'s result: `RoutineCode` plus writes, transitions, outcomes, loops, joins, the work it took.                                                 |
| `PartBehaviour`                          | One part type: its callbacks, transitions, counters, reset, effects, triggers, uncertainties.                                                                |
| `BehaviourReport`                        | The whole read: layout, timing, helpers, lifecycle, creation, parts, routines, assumptions, type table, collision dispatch, outline tables, gear scheduling. |
| `RoutineCode` (`behaviour-code.ts`)      | A routine's graph: instructions, edges (`next`, `taken`, `not-taken`, `jump`, `jump-table`, `return`, …), calls, `status` (`complete`, `partial`, `error`).  |
| `Instruction`, `Operand` (`x86.ts`)      | A decoded 16-bit instruction.                                                                                                                                |
| `EngineSummary` (`behaviour-helpers.ts`) | What a shared helper does, bounded: `kind`, `writes`, `returns`, `footprint`, and a payload per kind.                                                        |

Expressions are compared by their JSON text in many places, so object literals keep a fixed key order. The small
builders (`constant`, `field`, `binary`, `compare`, …) and operand tests (`isRegister`, `isMemory`, …) are shared in
`behaviour-terms.ts`; use those instead of a local copy. Note that `binary` there builds as given, while the exported
`binary` of `behaviour.ts` folds constants and enforces a size budget (`SIZE_BUDGET_REACHED`, 96 nodes by default).
Choices are encoded as `(test) * then + (not test) * else` by `choose` and read back by `choiceOf`.

### Names of objects

What a `field` expression's `object` means:

- `part`: the owner, the stack argument at the layout's argument offset. `collider`: in a bounce callback, the part that
  touched it. `argument`: other stack arguments. `data`: globals in the data segment. `stack`: locals.
- `referenced-by(<object>+0xNN)`: what a pointer field leads to; it nests.
- Values only the run knows, named after where they come from: `answer of the query at 0x…`, `member found by the loop
at 0x…`, `overlap candidate at 0x…`, `nullable allocation result at 0x…`, `centre angle answer at 0x…`, and so on.
  `RUN_VALUE` lists those that count as one value for a rule (`Transition.runValues`).
- After a call the reader can't follow: `<object> after unresolved write at 0x…`.

## Inside `analyseRoutine`

`analyseRoutine(image, entry, options)` is one big function (about 3,900 lines). It follows every acyclic path of a
routine's graph with an abstract state per path (registers, memory keyed by `object:offset:width`, conditions, flags)
and never runs a loop: a back edge loses what it knew, unless a loop recogniser proved that loop first. Its options
(`RoutineOptions`) include the graphs, the layout, the summaries of callees, `maxVisits` (4,000 by default; the driver
gives callbacks 12,000) and `foundType` for the per-type re-read.

Find your way by these inner names:

| Inner name                                       | What it does                                                                                                                                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (setup at the top)                               | Reads the graph, finds the gear run, and proves counted, find-first and list loops before the walk.                                                                                                             |
| `registerRead`, `registerWrite`                  | Registers, with byte halves and tracked pointers.                                                                                                                                                               |
| `location`, `readUnrefined`, `read`, `write`     | Memory: which object a memory operand is, reading and writing it.                                                                                                                                               |
| `finding`                                        | The confidence rule of a path, and the two default assumptions.                                                                                                                                                 |
| `formalObject`, `formalValue`, `formalPredicate` | Put a callee's results in the caller's terms.                                                                                                                                                                   |
| `applyEngine`                                    | Applies a helper's `EngineSummary` at a call (lists, contact, ropes, factory, arithmetic, …).                                                                                                                   |
| `flagPredicate`                                  | The test a conditional jump makes from the last compare.                                                                                                                                                        |
| `enqueue`                                        | The worklist. Joins two queued paths when they differ only by one test and its opposite.                                                                                                                        |
| `unresolvedExit`, `recordIteration`, `finish`    | End a path: unknown, one member of a list loop, or a return (outcomes and transitions).                                                                                                                         |
| (main loop)                                      | One instruction at a time: proved loops, sparse switches, data moves, arithmetic, calls (factory, engine summaries, callee outcomes, else everything the call may touch becomes unknown), returns and branches. |

After the loop, results are deduplicated; `mergeTransitions` and `markConditional` tidy the transitions.

## Engine summaries

`discoverEngineSummaries` classifies every complete routine (`read-only`, `call-wrapper`, `unclassified`) and then
runs the recognisers in a fixed order: lists, insertion, factory and allocation; buffers, node pools and
constructors; return conventions and the connection query; overlap producer; gears; forwarders; constructors that
succeed or own their cleanup; angles; contact (bounds, scalars, small, response, segment, effects, outline, motion
angle, centre angle, selection, rotation, directed velocity, first and pair responses); connections; rope cut; outline
search; part copy; list masks. A later recogniser can build on an earlier one's summary, so the order matters.

## Pattern matching

Many recognisers match a routine against instruction patterns kept as text, one per compiler form found in the
builds (the `behaviour-*-patterns.ts` files are only that data). The matcher is `matchHeapRoutine(code, pattern,
bindings)` in `behaviour-heap-release.ts`, and `matchFirst(code, patterns)` in `behaviour-terms.ts` tries a list.

- One instruction per line, in decode order; the count and every edge must match.
- Operands: register names, `#n` for an immediate (decimal), memory as `width:segment[base+…+displacement]`, like
  `16:ss[bp+6]`.
- `{name}` binds a number and must be the same everywhere it appears. `label: ` names an instruction and
  `jxx @label` must jump there. `call $name` binds a call target.
- `matchInstructionRegion` matches part of a routine (`@exit` is where the region leaves).

## The files by role

**Core**: `lzexe.ts` (unpack), `x86.ts` (decoder), `type-table.ts` and `parts.ts` (data segment, type records, part
lists), `behaviour-code.ts` (graphs), `behaviour.ts` (pipeline, `analyseRoutine`, expression algebra),
`behaviour-terms.ts` (shared small helpers), `behaviour-layout.ts`, `behaviour-fields.ts`, `behaviour-timing.ts`,
`behaviour-scalars.ts`, `behaviour-geometry-relations.ts`.

**Helpers in general**: `behaviour-helpers.ts` (`discoverEngineSummaries`, `EngineSummary`), `behaviour-forwarders.ts`,
`behaviour-buffer-effects.ts`, `behaviour-owner-paths.ts`, `behaviour-node-pools.ts`, `behaviour-heap-release.ts`
(also the pattern matcher), `behaviour-angle.ts`, `behaviour-angle-gate.ts`, `behaviour-speed-limits.ts`.

**Contact and collision**: `behaviour-collision-dispatch.ts`, `behaviour-contact-*.ts` (bounds, scalars, arithmetic,
segment, selection, small, effects, empty, outline, motion angle, rotation, response, response first, response pair),
`behaviour-centre-angle.ts`, `behaviour-directed-velocity.ts`, `behaviour-overlap-producer.ts`,
`behaviour-outline-search.ts`.

**Gears**: `behaviour-gear.ts`, `behaviour-gear-model.ts` (types), `behaviour-gear-run.ts`,
`behaviour-gear-connections.ts`, `behaviour-gear-scheduling.ts`.

**Ropes, belts, pulleys**: `behaviour-connection-relay.ts`, `behaviour-connection-bypass.ts`,
`behaviour-rope-dispatch.ts`, `behaviour-rope-cut.ts`, `behaviour-part-copy.ts`, `behaviour-empty-connections.ts`.

**Lists and loops**: `behaviour-loops.ts` (counted), `behaviour-search-loops.ts`, `behaviour-list-loops.ts`,
`behaviour-find-first-loops.ts`, `behaviour-list-consumers.ts`, `behaviour-list-calls.ts`, `behaviour-list-masks.ts`
(which global lists a search walks).

**Making parts**: `behaviour-constructor-effects.ts`, `behaviour-constructor-failure.ts`,
`behaviour-successful-constructors.ts`, `behaviour-owned-constructors.ts`, `behaviour-creation.ts`,
`behaviour-created-parts.ts`, `behaviour-lifecycle.ts`.

**Frames and outlines**: `behaviour-frame-drawing.ts`, `behaviour-sheet-frames.ts`, `behaviour-outline-tables.ts`,
`behaviour-outline-run.ts` (a small runner for outline copies), `behaviour-saved-frames.ts` (decided frame facts:
`LEVEL_FRAMES`, `CONTROL_VALUES`, `IMPOSSIBLE_STATES`, `REACTION_FIELDS`).

**Checking and saving**: `behaviour-validation.ts` and `behaviour-walk-validation.ts` (against recordings),
`behaviour-build-comparison.ts` (an address-free form to compare builds), `behaviour-evidence.ts` (saved JSON),
`behaviour-assumptions.ts` and `behaviour-assumption-list.ts`.

## Assumptions

Every finding states its assumptions as sentences. A decided assumption is an exported constant named
`…_ASSUMPTION` or `…_ASSUMPTIONS` in the module that uses it, grouped in `DECIDED_ASSUMPTIONS`
(`behaviour-assumptions.ts`) and explained, numbered, in
[the decided assumptions](../assumptions/behaviour-assumptions.md); a test checks the wording is the same. A new
decided assumption needs the user's yes first. Every other assumption is collected into the generated
[list](../assumptions/behaviour-assumptions-all.md): after a change to the analysis, run `list-assumptions --check`
with all builds. Taking an assumption out makes its findings unresolved again, which is always safe.

## Checking a change

- Tests: `packages/content/tests` has about 80 `behaviour-*.test.ts` files, mostly one per module, built on
  hand-assembled bytes. `behaviour.test.ts` and the soundness, summaries, joins and refinement tests cover the engine.
- Same results: for a change that should keep every result (a cleanup or a speed-up), run `fingerprint-behaviour`
  before and after on Even More (English floppy) and TIM 1 (French), with `--loops`. Run the "before" from a separate
  worktree of the old commit, so editing doesn't mix into it. The Lab's tests cover its own summaries.
- Changed results: `extract-behaviour` before and after, then `compare-behaviour --baseline`. Reports are large;
  keep them out of the repo.
- Time: the Lab's step shares (`READ_STEPS` in `apps/lab/src/behaviour.ts`, seconds in Node on Even More, English
  floppy) show where it goes: the read 10, the goals 0.2, the descriptions 11, the per-type loops 12 and the
  descriptions again 15. In a description, the parts' walks take about six tenths, `effectsFromOthers` three tenths
  and `hitsFromOthers` a tenth. What is left is spread thin: no function takes more than a twentieth of the whole.
  Profile with `node --cpu-prof` on a script that runs these steps.
