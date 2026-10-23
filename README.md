# opentim

An open-source reimplementation of The Incredible Machine in TypeScript, built for the browser and designed to load original game assets.

## Repository layout

This is a [pnpm](https://pnpm.io) workspace monorepo.

| Path              | Package           | What it is                                                                      |
| ----------------- | ----------------- | ------------------------------------------------------------------------------- |
| `apps/game`       | `@opentim/game`   | The game client: Vite, TypeScript and PixiJS. Installable as a PWA.             |
| `apps/web`        | `@opentim/web`    | The website in front of the game: Nuxt, Vue and Tailwind CSS.                   |
| `packages/engine` | `@opentim/engine` | The simulation core. No DOM or rendering code, so it also runs headless.        |

The two apps are built and deployed separately, each on its own (sub)domain:

- `example.com` is the website
- `play.example.com` is the game, installable as a PWA

## Getting started

Requires Node 24+ and pnpm (`corepack enable`).

```sh
pnpm install
pnpm dev          # website on http://localhost:3000 (or the next free port), game on http://localhost:5174
```

Other commands:

```sh
pnpm dev:game     # game only
pnpm dev:web      # website only
pnpm test         # run all tests
pnpm typecheck    # typecheck all packages
pnpm build        # build all packages
```

To regenerate the PWA icons after changing `apps/game/public/icon.svg`:

```sh
pnpm --filter @opentim/game generate-pwa-assets
```

## Deployment

Build each app and upload its output folder:

| App     | Build                                                                 | Output                    |
| ------- | --------------------------------------------------------------------- | ------------------------- |
| Website | `pnpm --filter @opentim/web build`                                    | `apps/web/.output/public` |
| Game    | `pnpm --filter @opentim/game build`                                   | `apps/game/dist`          |

Both outputs are static files. See [`deploy/nginx.conf.example`](deploy/nginx.conf.example) for an nginx setup, including the cache headers the PWA needs to update properly.
