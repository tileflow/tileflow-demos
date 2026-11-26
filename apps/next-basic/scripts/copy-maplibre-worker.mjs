import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const { version } = createRequire(import.meta.url)("maplibre-gl/package.json");
const output = new URL(`../public/maplibre/${version}/`, import.meta.url);
await mkdir(output, { recursive: true });

for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  await copyFile(new URL(import.meta.resolve(`maplibre-gl/dist/${file}`)), new URL(file, output));
}
