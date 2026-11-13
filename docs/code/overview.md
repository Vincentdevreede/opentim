# The code at a glance

OpenTIM is a pnpm workspace: three apps and five packages, all TypeScript, all private. Packages export their source
directly (`"exports": { ".": "./src/index.ts" }`); nothing is compiled, and `build` in a package is a type check.
Imports carry their `.ts` extension.

## Packages and apps

| Where                | What it is                                                                                                                                                                                                       | Used by                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `packages/resources` | Reads the DOS game files: `RESOURCE.00x` archives and `RESOURCE.MAP`, tagged chunks, `.BMP`/`.SCR` images, palettes, `.SX` sound banks, and the LZHUF language packs. No DOM, no dependencies.                   | everything that reads game files |
| `packages/content`   | Part lists and sprite composition (`model.ts`, `compose.ts`, `lists/*.json`), and the research readers: the static behaviour reader of TIM.EXE (`src/read`), and an emulator of the game (`src/run`, Node only). | the Lab, its own scripts         |
| `packages/sound`     | The game's music: a re-creation of the AdLib driver from `SX.OVL`, an OPL2 emulation, SCI MIDI tracks.                                                                                                           | the Lab's audio pages            |
| `packages/theme`     | The shared look: Tailwind 4 `@theme` tokens in `theme.css`, the same colours in `src/colors.ts` (a test keeps them equal), the logo and icon.                                                                    | all apps                         |
| `packages/engine`    | A placeholder physics `World` (bodies, gravity, fixed 60 ticks per second). Not the real TIM simulation yet: that research is in `content`.                                                                      | `apps/game`, the Lab's sandbox   |
| `apps/lab`           | The research tool (Vue 3, Vite): load your own game files and see sprites, parts, levels, sounds and the behaviour read from TIM.EXE. See [lab.md](lab.md).                                                      |                                  |
| `apps/game`          | The future game: today a PixiJS sandbox that drops balls into an engine `World`, as a PWA.                                                                                                                       |                                  |
| `apps/web`           | The landing page (Nuxt 4, generated static).                                                                                                                                                                     |                                  |

The behaviour reader is the biggest part by far (about 60,000 lines in `packages/content/src/read`). It has its own
maps: [behaviour-reader.md](behaviour-reader.md) for the report and [descriptions-and-goals.md](descriptions-and-goals.md)
for what turns it into words, the goals, the levels and the emulator.

## Commands and checks

- `pnpm dev:lab` (port 3002), `pnpm dev:game` (3001), `pnpm dev:web` (3000), or `pnpm dev` for all.
- `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`; `pnpm --filter <package> test` for one package.
- The pre-commit hook (`.husky/pre-commit`) runs `format:check`, `lint`, `typecheck` and `test`. A commit that fails
  one is refused; run `pnpm format` and stage again when only formatting failed.
- CI (`.github/workflows/ci.yml`) runs the same plus `build`, on pushes to `main` and on every pull request.
- Prettier: print width 120, with the Tailwind plugin. `.prettierignore` skips the generated assumption list.
- TypeScript: `tsconfig.base.json` is strict with `noUncheckedIndexedAccess`, `noUnused*` and `verbatimModuleSyntax`.
  The packages and the game use TypeScript 7; the Lab, the web app and the root lint stay on 6 because `vue-tsc` and
  `typescript-eslint` don't support 7 yet (see the README).
- Node 24 (`.nvmrc`) runs `.ts` files directly, which is how the scripts run.
- CodeRabbit reviews every pull request, also stacked ones (`.coderabbit.yaml`), and approves once its comments are
  resolved. `main` needs an approval.

## Game files

No game files are in the repo. The apps read the player's own copy in the browser. Tests never need game files: they
build their inputs by hand (assembled x86 bytes, synthetic archives), except `run-cpu-dosbox.test.ts`, which compares
with committed DOSBox results, and the tests that read a doc (`behaviour-assumptions.test.ts`) or `theme.css`.

Checking the analysis against the real games is done with the scripts below and real game folders. A game folder holds
`TIM.EXE`, with the `RESOURCE.*` files there or one folder up (the French and German builds of TIM 1 have the
language in a subfolder). The research uses the five TIM 1 and six Even More builds; the two with recordings and emulator support are Even More (English floppy) and TIM 1 (French).

## Scripts of the content package

Run them as `pnpm --filter @opentim/content <name> …`. Most read builds side by side on worker threads through
`scripts/builds.ts` (`--jobs n`; one build takes up to a minute and about 1.7 GB).

| Script                      | What it does                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `extract-parts`             | Writes the committed part lists `src/lists/*.json` from the builds (also TIM 2).                               |
| `extract-behaviour`         | Writes behaviour reports (without the per-type loops) and a cross-build comparison to `--out`.                 |
| `compare-behaviour`         | Compares saved reports with a baseline and the descriptions with the saved recordings (the v25 oracle).        |
| `validate-behaviour`        | Checks saved reports against v25's callback measurements.                                                      |
| `fingerprint-behaviour`     | Hashes everything one build's read gives; same hashes before and after a change mean same results.             |
| `list-assumptions`          | Writes (`--out`) or checks (`--check`) `docs/assumptions/behaviour-assumptions-all.md`.                        |
| `list-other-part-pairs`     | Lists which part types can affect which; fails on a pair left out for a reason it can't name.                  |
| `check-level-frames`        | Checks the frames and control values the shipped levels save against the descriptions.                         |
| `list-goals`, `check-goals` | Says each puzzle's goal in words; checks the goal reader against the game's routine in the emulator.           |
| `record-level`              | Records a shipped puzzle running in the emulated game ([the level recorder](../research/machine-recorder.md)). |
| `check-level-fields`        | Finds where the level loader puts each field of a level file.                                                  |
| `check-moving-list`         | Checks decided assumption 22 in the game's own run.                                                            |
| `record-cpu-cases`          | Runs CPU test programs in DOSBox and saves the results the emulator's tests compare with.                      |

The emulator scripts (`record-level`, `check-level-fields`, `check-moving-list`, `check-goals`) only know the two
recorded builds (`GAME_BUILDS` in `src/run/game.ts`). `check-level-fields` and `check-moving-list` run one emulator
at a time unless `--jobs` says more. Run `check-level-fields` one build at a time and in the background: a run with
`--jobs 4` once took the machine down.

## Deploy

Each app has a `Dockerfile` (built from the repo root with `pnpm fetch` and an offline install) and an `nginx.conf`.
The README has the domains and the Coolify setup.
