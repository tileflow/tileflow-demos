# Tileflow Demos

Public demos for Tileflow packages.

## Demos

- `apps/vite-basic`: React + Vite map demo using `@tileflow/core`, `@tileflow/react`, and `@tileflow/vite`.
- `apps/next-basic`: React + Next.js map demo using `@tileflow/core`, `@tileflow/react`, and `@tileflow/next`.

## Run

```sh
pnpm install
pnpm dev:vite-basic
pnpm dev:next-basic
```

The demos consume the published Tileflow alpha packages from npm.

## SDK updates and CI

The demos pin every `@tileflow/*` dependency to an exact public npm version. `SDK Sync` checks npm
hourly and uses one reserved pull request to update those pins and `pnpm-lock.yaml`. The pull request
is merged automatically only after `CI / Required` installs the exact graph, tests the sync policy,
typechecks and builds every demo, and validates each `tileflow.config.ts` with the published CLI.

An incompatible or breaking SDK release therefore leaves a failing pull request open; it cannot
change protected `main`. Fix the affected demo or publish a compatible SDK correction and let the
next scheduled run replace and retest the proposal. No npm token, release tag, manual Changeset, or
manual dependency update is part of this repository's normal path.

`main` represents the latest verified source for every demo. This repository does not currently
have a Pages site or another deployment target, so merging does not claim that a hosted demo was
deployed. Add a deployment workflow and receipt before describing `main` as hosted production.
