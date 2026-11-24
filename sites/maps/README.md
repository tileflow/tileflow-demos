# maps.tileflow.dev

Maps published from this repository, one folder each: `maps.tileflow.dev/<map-name>/`. The name is
the map's public address and never changes once shared. The bare domain redirects to tileflow.dev.

`build.mjs` lists the maps and builds each app with its Vite `base` set to `/<map-name>/` (through the
`MAP_BASE` variable). `wrangler.jsonc` serves the result as static assets on the custom domain. For Helsinki Live it also relays HSL's public vehicle and arrival feeds at two fixed paths below `/helsinki-live/api/`.

```bash
node sites/maps/build.mjs
```

The `Deploy maps` workflow deploys `main` when run by hand.

To add a map, make its app read `MAP_BASE` as its Vite `base`. Load the Tileflow manifest relative to
`import.meta.env.BASE_URL`. Then add the app to `maps` in `build.mjs`.
