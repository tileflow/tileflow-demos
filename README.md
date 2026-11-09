# Tileflow Demos

Public demos for Tileflow packages.

## Demos

- `apps/vite-basic`: React + Vite map demo using `@tileflow/core`, `@tileflow/react`, and `@tileflow/vite`.
- `apps/next-basic`: React + Next.js map demo using `@tileflow/core`, `@tileflow/react`, and `@tileflow/next`.
- [Linha Coffee](apps/locator/README.md) — find a Lisbon shop by neighborhood, amenity or distance.
- [Headlands Field Guide](apps/field/README.md) — choose a walk and inspect its waypoints and elevation.
- [Dispatch Territories](apps/territories/README.md) — compare Portland delivery areas by volume or punctuality.

## Run

```sh
pnpm install --frozen-lockfile

# Start one demo
pnpm dev:locator       # http://localhost:5181
pnpm dev:field         # http://localhost:5182
pnpm dev:territories   # http://localhost:5183
pnpm dev:vite-basic
pnpm dev:next-basic
```

Run these commands from the workspace root. The solution demos include sample data and need no service credential. The basemap needs network access. The locator and field READMEs explain how to enable live services on localhost. Static builds keep the sample data.

Build a single demo with `pnpm --filter @tileflow-demos/locator build` (substitute `field` or `territories`). Run `pnpm validate:configs` to check every map. Each solution has a desktop capture scene. With its dev server running, use e.g. `pnpm --filter @tileflow-demos/locator exec tileflow capture locator-desktop --app-origin http://localhost:5181 --out-dir /tmp/locator-capture`.

## SDK updates and CI

The demos pin every `@tileflow/*` dependency to an exact public npm version. `SDK Sync` checks npm
hourly and uses one reserved pull request to update those pins and `pnpm-lock.yaml`. The pull request
is merged automatically only after `CI / Required` installs the exact graph, tests the sync policy,
typechecks and builds every demo, and validates each `tileflow.config.ts` with the published CLI.
CI then serves each production build and requests its HTML, Tileflow manifest and declared light style.
The Next demo checks both static output and its route handler. Manual CI runs can also capture all
three solution apps and save their PNGs, receipts or failure diagnostics.

An incompatible or breaking SDK release therefore leaves a failing pull request open; it cannot
change protected `main`. Fix the affected demo or publish a compatible SDK correction and let the
next scheduled run replace and retest the proposal. No npm token, release tag, manual Changeset, or
manual dependency update is part of this repository's normal path.

`main` represents the latest verified source for every demo. This repository does not currently
have a Pages site or another deployment target, so merging does not claim that a hosted demo was
deployed. Add a deployment workflow and receipt before describing `main` as hosted production.
