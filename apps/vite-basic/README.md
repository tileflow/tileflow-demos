# Tileflow Vite Basic Demo

Standalone React + Vite demo using the published Tileflow alpha packages.

```bash
pnpm install
pnpm dev:vite-basic
```

The Vite plugin serves Tileflow style assets from the local `tileflow.config.ts`
during development and emits static Tileflow artifacts during production builds.

This demo enables `labels()` and `poi()` and points `maps.madrid.icons` at
`./icons/brand`. Tileflow compiles those SVGs into a MapLibre sprite in dev and
build output.

POIs are easiest to inspect around zoom 15:

```text
http://localhost:5173/?lat=40.4168&lng=-3.7038&zoom=15.5
```
