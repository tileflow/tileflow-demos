# The World in Characters — short film

The film opens on the rotating globe, follows a printed asterisk across Spain and the Mediterranean, descends to Rialto and pulls back over Italy. It runs for 32 seconds at 1920 × 1080 and 30 fps. The map source in the parent directory is the web application photographed by these scripts.

## Photograph and render

Install Node 24+, Chrome with WebGL 2, FFmpeg with libx264, and Python with Pillow and NumPy. From the challenge directory:

```sh
npm install --prefix scripts/qa
python3 -m venv .venv
. .venv/bin/activate
python -m pip install pillow numpy
python film/render.py
```

The runner serves the checked-in release on loopback port 8526. Chrome fetches worldwide streets from Tileflow. Each plate waits for its vector tiles at the prescribed geographic camera. Allow several gigabytes for the generated frames. The output is `film/renders/The-World-in-Characters-v4.mp4`. Set `FFMPEG` to the full path of an FFmpeg executable if it is outside PATH. To reassemble existing takes, run `python film/cut.py`.

## What the sources contain

- `orbit/`, `med/` and `camera/` control the initial rotation, the globe-to-atlas registration and all positions along the flight.
- `atlas/` composes one broad regional map at a fixed geographic resolution. Its enhanced gazetteer is included for repeatable regional lettering. The optional `east.py` regenerates it from the Natural Earth archives documented in the challenge's `SOURCES.md`.
- `ink/` draws the trail and its asterisk with Noto Sans. The accompanying font is licensed under SIL OFL.
- `landing/`, `venice/` and `return/` capture the detailed Veneto sheets, the streets near Rialto and the final pullback. `compose.py` registers these impressions to the geographic camera.
- `brand/` holds the approved cover lettering, paper plate and 75-frame Tileflow animated signature used for this challenge series.
- `music/typesetters-waltz.m4a` is the original AAC audio stream from the approved film. `music/score.py` is the original composition and synthesis program. To generate its WAV from scratch, install the GarageBand Upright Jazz Bass and Logic Acoustic Guitar libraries listed in the score. The AAC recording is ready for normal editing on all platforms.

The registered cameras, score, title and end card are part of the film source. Street data are read from the live Tileflow catalogue, so a later capture can show updated names or roads. Font rasterization may differ between Chrome and operating-system versions.
