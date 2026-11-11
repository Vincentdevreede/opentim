# The Lab

`apps/lab` is the research tool: Vue 3 with Vite, Tailwind 4 and the shared theme. The player loads their own game
files; nothing is uploaded. It shows the files byte by byte, sprites, parts with their behaviour, levels with their
goals, and sounds.

## Start and state

- `main.ts` mounts `App.vue` with the router and calls `restore()` to reload the last import.
- `router.ts`: `/` import, `/sprites`, `/parts`, `/levels`, `/files`, `/audio`, `/sandbox`; anything else is the
  missing page.
- `App.vue`: the menu (`FILES`, `RESOURCES`, `TOOLS`), keyboard help (`SHORTCUTS`), drop files anywhere or Ctrl+O, and
  the status bar (version, the behaviour read's progress, "Local only · nothing uploaded").
- `library.ts`: the import. Its `phase` goes `empty`, `reading`, `staged`, `loaded` (or `error`). `importFiles` reads
  and stages files, `confirmImport` checks and saves them, `load` publishes them and starts the behaviour read in the
  background. It holds the resources, the edition and the program; parts are read again per page
  (`readLoadedParts` in `parts.ts`). A `generation` counter cancels work that a newer import made stale.
- `storage.ts`: keeps the files in the browser's private file system (OPFS), one folder per import. Without a secure
  context an import lasts only for the tab.
- `bookmarks.ts`: byte range bookmarks per version, in localStorage. `ui.ts`: shared state in memory (`selectedPart`,
  `behaviourLayout`, `selectedLevel`, …).

## The behaviour read

`readBehaviourInBackground(program, parts)` (in `src/behaviour.ts`) starts `behaviour.worker.ts` once per program
(cached in a WeakMap; a failed read is tried again next time) and returns promises for four results. The worker:

1. reads the report (`readBehaviourInSteps`) and posts `behaviour` (the `summariseBehaviour` summary);
2. reads the goals (`readProgramGoals`) and posts `goals`;
3. describes (`describeBehaviour`) and posts `walks` (walks, effects, rests and doings);
4. reads the per-type loops (`readLoopsPerType`);
5. describes again and posts `per type`, which replaces the first walks.

Every step posts `progress` messages; `read-progress.ts` turns them into the bar, the step text and the time left
(`READ_STEPS` gives each step its share). `ReadProgress.vue` shows it the same way on every tab, and in short in the
status bar. The parts page, the levels page and `load` all share one read.

## `src/behaviour.ts`: from expressions to words

The biggest file of the Lab. In order:

- **Types** the worker sends: `PartSummary`, `Walk`, `OtherEffect`, `Doing`, `RestSummary`, `BehaviourSummary`, …
- **Names**: `PART_FIELDS` (part record offset to name), `LINKS` (what a field points to), `ROPE_ARGUMENTS`,
  `NAMED_TERMS` (the Lab's own names with their raw form and meaning, for tips), `ROPE_FIELDS` (the rope record).
- **Flag bits**: `FLAG_BITS` names every used bit of the three flag words (list flags 0x06, drawing flags 0x08, marks
  0x0a) as set and clear words; `flagWords` and `recordName` use them. The table with what the game does with each
  bit is in [the research](../research/behaviour.md#flag-bits).
- **`tidyWords`**: rewrites the analysis's own sentences without hex (drops `& 0xffff` unless a number is past a word,
  "rounded down to 16", flag tests as names, no code addresses, fields by name, rope record fields).
- **Goals**: `goalMarkSetters` (which parts set which goal mark) and `goalMarkWords` ("marked by cat").
- **`writer(fields, own?, routine?)`**: gives `expression`, `predicate` and `place`, which say an `Expression` or
  `Predicate` in words. It picks a number style per test (`words`, `bits`, `masked`, `signed`, `unsigned`, `angle`)
  and knows the program's tricks: `flagChange` ("drawingFlags with mirrored switched"), `pickOfTwo` ("a if c, else
  b", only when c is a yes or no), `remainderOf` ("mod 4"), signed compares, `ropeTest` ("pull kind 4, not a
  question"), `halfTurn` ("from 270° to 90°").
- **Summaries**: `summarisePart`, `summariseWalks`, `summariseRests`, `summariseDoings`, `summariseEffects`,
  `summariseBehaviour`.
- **The background read**, its message types and `READ_STEPS`.

`behaviour-view.ts` lays one part out for the Behaviour tab (rows by routine, state or walk, folding long lists).
`interactions.ts` builds the pairs of the Interactions tab (`remove`, `mark`, `push`, `make`, `touch`, `change`).

## Pages and components

- **Import** (`components/import/`): start, staged, failed, and the overview of a loaded game.
- **Files**: file list with search (text, bytes, numbers), bookmarks, and a hex view where each byte says what it is
  (`fields.ts`, `inspect.ts`, `structure.ts`, `markers.ts`).
- **Sprites**: images and screens with palettes and frames (`components/sprites/ImageDetail.vue`).
- **Parts**: part cards; `PartDetail.vue` has a stage with frames and sprites, and side tabs Frame or Sprite,
  Behaviour (`BehaviourPanel`, three layouts), Interactions (`InteractionLists`) and Type (`RecordPanel`, the 58-byte
  type record).
- **Levels**: `LevelCanvas` (the level drawn, goal areas), `LevelGoal` (conditions and the goal routine),
  `LevelStructure` (every field, where the loader keeps it, flag words).
- **Audio**: banks and samples, played as samples or as music through emulated Sound Blaster Pro or AdLib FM, in a
  worker.
- **Sandbox**: the engine package's `World` in PixiJS.
- `Lab*.vue`: about 40 small design-system components (layout, lists, controls, status, empty states), each with a
  one-line comment at the top.

## Tests

`apps/lab/tests` (units) and `tests/components` (components). There's no vitest config and no DOM: components are
rendered on the server with `renderToString`, and tests read `visibleText(html)` (`tests/visible-text.ts`) or the raw
HTML for tips. `behaviour.test.ts` covers the writer, `tidyWords` and the summaries; `behaviour-background.test.ts`
fakes the worker. There is no automated browser check; screenshots were made with a headless Chromium over CDP from a
scratch script.

## Conventions

- Words instead of hex in what is shown. Raw values, offsets, addresses and instructions go in the tip (`title`,
  `LabTip`, `LabInfo`). See [the Lab's wording rules](../research/behaviour.md#the-behaviour-tab).
- British spelling, typographic quotes, plain sentences.
- Colours and sizes come from the theme tokens (`text-ink`, `bg-surface`, `text-meta`, confidence colours `decoded`,
  `partial`, `hypothesis`, `error`).

**To add a name**: a part record word goes in `PART_FIELDS` (and `LINKS` when it points somewhere); the analysis's
own field names win in the writer, but `tidyWords` only knows `PART_FIELDS`. A flag bit goes in `FLAG_BITS` and the
flag bits table of the research. A rope record field goes in `ROPE_FIELDS`. Each needs a test in `behaviour.test.ts`.

**To add a tab** to a part: add it to `sideTabs` in `PartDetail.vue` and add its panel branch; `LabTabs` with
`tabPanel()` from `components/tabs.ts` does the keys and ARIA.

**To add a page**: a route in `router.ts`, an item in the menu of `App.vue`, an icon in `icons.ts`.
