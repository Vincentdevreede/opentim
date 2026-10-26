# opentim

An open-source reimplementation of The Incredible Machine in TypeScript, built for the browser and designed to load original game assets.

## Repository layout

This is a [pnpm](https://pnpm.io) workspace monorepo.

| Path                 | Package              | What it is                                                                           |
| -------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `apps/game`          | `@opentim/game`      | The game client: Vite, TypeScript and PixiJS. Installable as a PWA.                  |
| `apps/web`           | `@opentim/web`       | The website in front of the game: Nuxt, Vue and Tailwind CSS.                        |
| `apps/lab`           | `@opentim/lab`       | Internal dev site: load the original game files, inspect them, and test engine code. |
| `packages/resources` | `@opentim/resources` | Readers for the original game files, starting with the `RESOURCE.00x` archives.      |
| `packages/engine`    | `@opentim/engine`    | The simulation core. No DOM or rendering code, so it also runs headless.             |
| `packages/theme`     | `@opentim/theme`     | The shared look: colours, type scale, logo and app icon.                             |

Each app is built and deployed separately, on its own (sub)domain:

- `opentim.app` is the website
- `play.opentim.app` is the game, installable as a PWA
- `lab.opentim.app` is the lab

## Getting started

Requires Node 24+ and pnpm (`corepack enable`).

```sh
pnpm install
pnpm dev
```

Each app has a default port for its dev server. If that port is already in use, the app starts on the next free port
instead, and prints the address it uses.

- Website: http://localhost:3000
- Game: http://localhost:3001
- Lab: http://localhost:3002

Other commands:

```sh
pnpm dev:game      # game only
pnpm dev:web       # website only
pnpm dev:lab       # lab only
pnpm test          # run all tests
pnpm typecheck     # typecheck all packages
pnpm lint          # lint with ESLint
pnpm format        # format with Prettier (pnpm format:check only checks)
pnpm build         # build all packages
```

CI runs the format check, lint, typecheck, tests and build on every pull request.

`pnpm install` turns on a pre-commit hook that runs the same checks, except the build.

### TypeScript versions

The game and the packages use TypeScript 7. The website, the lab and the linting at the root stay on TypeScript 6,
because `vue-tsc` and `typescript-eslint` don't support TypeScript 7 yet.

## Theme

`packages/theme` holds the shared look. `theme.css` defines the colours and type scale as Tailwind tokens for the
website and the lab; `src/colors.ts` has the same colours for the game and the PWA manifest, and a test keeps them in
sync.

The app icon is `packages/theme/assets/icon.svg`. The apps keep a copy as their favicon (`apps/*/public`). After
changing it, copy it to `apps/game/public/icon.svg` and regenerate the game's PWA icons:

```sh
pnpm --filter @opentim/game generate-pwa-assets
```

## Deployment

Build each app and upload its output folder. All three are static files.

| App     | Domain             | Build                               | Output                    |
| ------- | ------------------ | ----------------------------------- | ------------------------- |
| Website | `opentim.app`      | `pnpm --filter @opentim/web build`  | `apps/web/.output/public` |
| Game    | `play.opentim.app` | `pnpm --filter @opentim/game build` | `apps/game/dist`          |
| Lab     | `lab.opentim.app`  | `pnpm --filter @opentim/lab build`  | `apps/lab/dist`           |

What the server needs to do:

- **Game:** always revalidate `sw.js`, `index.html` and `manifest.webmanifest` (`Cache-Control: no-cache`), so
  installed copies pick up new versions. Files in `assets/` have hashed names and can be cached forever.
- **Lab:** serve `index.html` for every path that isn't a file, because its pages are routed in the browser. It must
  be served over HTTPS, or the browser won't keep the loaded game files between visits.

## Original game files

No original game files are included. The game and the lab read the files of your own copy of The Incredible Machine,
locally in your browser. OpenTIM is not affiliated with the makers of The Incredible Machine.
