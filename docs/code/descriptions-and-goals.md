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

`check-goals` compares `runGoal` with the game's own routine in the emulator on random worlds (`goal-check.ts`). It
checks every game it is given the same way and prints the same lines for each: TIM 1 and Even More by `checkGoals`,
Toons by `checkToonsGoals` and TIM 2 by `checkTim2Goals` (below).
`runGoal` gives a far word (`FAR_WORDS` and up) to its memory as it is, and a break in a loop's test part leaves the
loop.

Toons' goals (`toons-goals.ts`): `findToonsGoalTable` finds the dispatcher, its table and the level names in TOONS.EXE
laid out with its overlays (`readToonsMemory`), and `readToonsGoals` reads the routines with `readGoalRoutines` (with
`resolve` for the overlay stubs and `farWords` for words reached through `es`, kept as `FAR_WORDS` plus segment and
offset) and says them with `describeGoal`, which says a call to `GoalNames.finder` as the part it finds. A goal without
a value in `GoalNames.mode` is met by any write of the mode word: Toons' countdown.

`summariseGoal` takes Toons' goals through options of `GoalNames` that only `readToonsGoals` sets, so TIM's summaries
don't change:

- `finder`: a `find` statement gives the part `{ kind: "nth", type, nth, lists }`, said as the condition kind `nth`.
- `firstStep` (the step count word): the goal's `if the step count = 0` setup is run on its own (`runSetup`), and
  `keptWords` sorts the words it sets in three passes. A word set to a found part and never written in the steps keeps
  that part. A word set to a number and, in the steps, only to one other number when a test holds is a latch: read
  before this step's writes it is the formula `ever` with `before`, after them `ever` "so far" (the `end` value it is
  compared with is the pass's own, with the word as the step left it). Reading any other set up word doesn't fit,
  because the steps are read without the setup.
- `countedLoops`: a loop whose test is decided in every round is run round by round (`unroll`, at most 64 rounds),
  and where branches meet, a count that is the same on several ways becomes one test (`joinIte`).
- `partSize` (Toons' 0xb3) for which offsets are fields, and `valueName` for Al's and Sid's actions and frames.
- `linkName`: a field that holds a part (Al's angel at 0xb1) is followed to that part, a `via` part; its tests go
  with the part that holds it ("angel's type is al-e-cat"). Without it a read through a field doesn't fit.
- `fixedWords`: the data segment's first words (Borland's copyright text), which a read through a 0 part finds, as
  numbers. With them a search that may end with 0 (LOON7) still reads.
- `exactSums`: the reader's test of a sum's sign with its own test for -32768 is one test of the sum without
  overflow (`exactSum`, a test with `exact`): "positionY + height < 0".

`keptWords` sorts the words the setup sets to a number and the steps change into `Latch` kinds: a `latch` (set to one
number when a test holds: "at some step so far"), a `stamp` (set to the step count: "last held 30 steps ago"), a
`tally` (1 added: "at exactly 2 steps so far"), a `link` (set to the part a field holds: "the kept angel of …", true
only when the test that kept it tested the part's type, `isPart`) and a `state` (a few numbers by what happened in
which order, `stateAfter`: BRAN8's switch word is 2 when the switch is off and was on at some step before). A word set
to something worked out from the parts and never written after is kept as it is, like a count of the parts. "Never"
(an `ever` turned round) is its own literal, and a way that needs something both to have held and not is dropped.

Two loop shapes whose rounds depend on the parts: `enumerate`, a loop that finds the next part of a type each round
and leaves at the end of the list or when a test of the part holds (HARD18's message machines, LOON7's balloon with a
rope), run for two rounds and checked to do the same to each part; after it a word that held the part holds the first
part of the type that passes the test (a `first` part of a walk over the parts of that type), a word counted by 1
holds how many there are, and a table the rounds filled is known. `overTable` is a loop over such a table from 0 up to
that count, said as a walk (`walkOver` with a counter, `index`), so "all of them pass" becomes "every message machine".
A break leaves the loop a round runs in (`breaks`); elsewhere it still doesn't fit.

`readGoalRoutines` also takes shapes only Toons' goals have (TIM's read the same): byte locals and bytes in memory
(`setByte`, `byteLocals`), `mov al, byte; mov ah, 0` as one load (`skip`), loops whose test leaves them with a `jmp`
back after it or calls a routine (`loopAt`), and an ordered branch after `add` or `sub` as the sum or difference without
overflow (`branchTest`, with a first test for -32768).

When a Toons goal has too many ways, `byPart` tries it as one way with a condition per found part, the tests all its
ways share and then "one of: …". A condition with `once` says the tests held at some step ("so far" or "before"),
with `never` at no step, with `steps` at how many steps, and `ago` says the last step they held at. `via` says the
condition is about the part a field of the n-th part holds.

`toonsListOrder` (`toons-goals.ts`) puts a Toons level's list in TOONS.EXE's order, so the Lab can say which level part
"the 1st al-e-cat on the moving list" is; `readToonsListKinds` reads the type table's word it sorts by.
`toonsPuzzleStart` follows TOONS.EXE's puzzle setup (`0x25829`) call by call, with both sort words of TOONS.EXE's type
table, and says where it leaves each part (a pulley read before its rope in the file has no rope over it, as the
level loader leaves it): in
the bin every part without the fixed bit with the ropes and belts tied to it, taken off (`gone`) the other end of a
tunnel it puts in the bin, and on the board the rest, ropes and belts between two parts that stay included. It also
gives the bin in TOONS.EXE's order (`binOrder`: sorted by the word `readToonsBinKinds` reads, a type's parts in the
order the setup puts them there), the plugs it pulls out (`unplugged`, `plugs`) and the states it leaves on the board
(`states`, for the electric switch and the anvil, whose routines are read) and the rope places it unties on the board
(`untied`). TOONS.EXE's own loader and puzzle start agree in all 100 puzzles (`check-puzzle-start --toons`). `toonsRopePlaces` says which rope places of
each part hold a rope, as the level reader puts each rope's record in both parts it ties, and with a `start` leaves out
the ropes the setup puts in the bin. `toonsGoalParts` places a condition on the level as the puzzle starts, on the
lists less the parts in the bin: the n-th part, the first part whose rope places and type pass `where` (LOON7's
balloon with a rope), whether tests of only the rope places and the type hold then (`holds`), and `player` when parts
from the bin could come before it (`bin`) or it depends on the ropes, whose ends the player may take off and tie
elsewhere (`ropes`). It reads the condition's `where` and `tests`
texts ("rope1 ≠ 0", "type isn't balloon"), and leaves a condition with any other test undecided.

## Level files

- `level.ts`: `readLevel(data, { layout, name })` reads TIM 1, Even More and Toons `.LEV`/`.GKC` files. Puzzle or
  freeform isn't stored, so both are tried. A `Level` has the header and the parts (static, moving, bin), and every
  value also as `fields` (key, offset, size) for byte views. A TIM 2 level (magic `0xACEF`) is read in its own layout
  (`readTim2`) whatever the layout says, with its notes and goal entries in `level.tim2`.
- `level-loader.ts`: where the game's loader puts each field of a placed part in its record (`LOADED_FIELDS`) and
  each header value in the data segment (`LOADED_HEADERS`, by program hash). Found with the emulator by
  `check-level-fields`; TIM 1 and Even More only (what the script finds for TIM 2 and Toons is in
  [the levels research](../research/levels.md)).
- `puzzle-start.ts`: `puzzleStart(level, { solution, sort })` says what a puzzle starts with in every game: the bin in
  the game's order, the parts taken off, and the states, plugs, rope places and belts the start changes on the board.
  TIM 1 keeps the file's bin; TIM 2 follows `tim2PuzzleStart` with TIM2.EXE's tables (`tim2-start.ts`, below), or
  without them puts the parts without bit 0x40 in the bin in the file's order; Toons follows `toonsPuzzleStart`,
  filtered to the board.
- `tim2-start.ts`: `readTim2StartTables` reads from TIM2.EXE the lists' sort word and the third flag bits of each type
  and the bin's table of types; `tim2ListOrder` and `tim2BinInsert` keep a list and the bin as TIM2.EXE's insertion
  routine does, and `tim2PuzzleStart` follows its puzzle start: the bin, the belts, ropes and remote controls that go
  with a part, the explosives taken off, the plugs pulled out and the states the type routines of the unplugged parts
  set (`unpluggedState`, read for the five types the shipped puzzles unplug). The Lab lays its puzzles out with it
  (`levelStart` in `apps/lab/src/levels.ts`), and `check-puzzle-start` compares it with the games.
- `level-frame-check.ts`: checks the frames and control values the levels save against the descriptions
  (`check-level-frames`).
- `tim2-goal.ts`: `summariseTim2Goal` says a TIM 2 level's goal entries as `GoalCondition`s, with the new kind
  `part` for an entry about one part. `runTim2Goal` tests the entries on given parts lists as TIM2.EXE's one goal
  routine does, quirks and all, and `findTim2GoalRoutine` finds that routine and the words it reads in TIM2.EXE laid
  out with its overlays (`readToonsMemory`).
- `tim2-program.ts`: `readTim2Types` finds TIM2.EXE's type table (72-byte records); `tim2Drawing` says which types it
  draws as walls, tile patterns or colour blocks. Nothing stands in for it: the Lab needs TIM2.EXE.
- `tim2.ts`: TIM 2's part names (`readPartNames`) and animations (`readAnimation`, `animationFrames`), for the part
  lists.
- `toons.ts`: Toons' program (`loadImage`), its type table of 70-byte records (`findToonsTypeTable`,
  `readToonsTypes`, `TOONS_RECORD_FIELDS`) and Al's and Sid's actions (`readToonsActions`); `readToonsParts` in
  `parts.ts` makes the `toons` list from it.
- `toons-drawing.ts`: TOONS.EXE with its overlays laid out (`readToonsMemory`) and the drawing code of the Toons types
  that have their own, with its tables (`readToonsDrawing`).

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
- `toons-goal-check.ts`: `checkToonsGoals`, the same for Toons, with TOONS.EXE's memory loaded straight into a `Cpu`
  (no DOS), parts of 0xb3 bytes, and the far segment compared too; `toonsLists` reads the parts lists from the list
  head routine. Run by `check-goals --toons`.
- `tim2-goal-check.ts`: `checkTim2Goals`, the same for TIM 2: each level's goal entries and made-up parts lists laid
  into TIM2.EXE's memory, the goal routine run on a `Cpu` (no DOS) next to `runTim2Goal`, and the answer and every
  word compared. `madeUpTim2Goals` gives goals with what no shipped level has. Run by `check-goals --tim2`.
- `level-start.ts`: `GameMachine`, TOONS.EXE or TIM2.EXE laid out with its overlays on a `Cpu` (no DOS: they ask for
  EMS memory, so they don't start under `Dos`), the overlays 64 KB above the data segment so its heap stays free. It
  runs the game's own level loader on a level and then the routines of its puzzle start (`run`), and gives the lists,
  the loader's table of parts (in the file's order) and every record after each (`GameParts`). It stands in for the
  game's `fopen` (a C library file with an empty buffer, so the library's own `fread` and `getc` read the level
  through int 21h), the near `calloc`, the far allocation and their `free`, DOS's memory blocks and the overlay
  manager's int 3Fh; any other request is noted in `unknown`. `heapStart` finds the heap past the start-up stack.
- `level-start-find.ts`: `findGameStart` finds all that in the program, from the level loader (the one routine that
  compares the first word with the magic): the library routines from the loader's calls, the table of parts, the
  puzzle start (the routine that calls the loader; for Toons also the routine and the level reset its caller runs
  after it, and the start-up routine that writes the bin's sort words), and TIM 2's store of part records. The lists
  come from the goal readers (`scripts/game-machine.ts`). `tim2Solution` starts a TIM 2 puzzle for the solution.
- `start-check.ts`: `gameStartResult` reads what a start did from the records before and after it (`StartFields`:
  the state, plugs, rope records and belt record of `TOONS_START_FIELDS` and `TIM2_START_FIELDS`), and
  `startDifferences` says each way it differs from `puzzleStart`. Run by `check-puzzle-start`, which for TIM 1 and Even
  More compares with `loadPuzzle` instead.

## The package's exports

`src/index.ts` exports the model and composition, the part lists, the decoder and graphs, the behaviour read and its
sub-analyses and types, validation, descriptions and walks, levels and the loader tables, and the goals. Not
exported (scripts import them by path): `src/run`, `other-part-pairs`, `level-frame-check`, `tim2`, `describeGoal`,
`runGoal`, `readGoalRoutines`, `evaluateBehaviourCondition` and `lzexe`.
