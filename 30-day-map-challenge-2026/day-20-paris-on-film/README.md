# Paris on Film

Day 20, Hexagons, for the 2026 #30DayMapChallenge. Explore [Paris on Film](https://maps.tileflow.dev/paris-on-film/) or follow [John Wick 4](https://maps.tileflow.dev/paris-on-film/?title=John%20Wick%204).

The map groups 15,827 geocoded outdoor shoot records from 2016–2025 into hexagons with a 119-metre radius. The mix of feature film versus television and web records determines the colour. The total record count determines its intensity. Locations and titles come from [Ville de Paris](https://opendata.paris.fr/explore/dataset/lieux-de-tournage-a-paris/) under the Open Database License. A single production can have several records at the same address.

Run `pnpm --filter @tileflow-demos/paris-on-film dev` from the repository root. Both development and production generate the 3D meshes from the bundled Tileflow vector tiles, tree positions and landmark geometry. The map credits OpenStreetMap contributors and includes the individual landmark credits under **Reading the map**. The font licences accompany the font files.
