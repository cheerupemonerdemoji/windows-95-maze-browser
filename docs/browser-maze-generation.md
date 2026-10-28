# Browser maze generation and navigation

This note separates source observations from browser-reconstruction decisions.
It is not a claim that GLMaze exactly reproduces Microsoft's original
`ssmaze.scr`.

## Direct observations from GLMaze

- `src/maze.c` creates a 10×10 grid in the default scene and carves passages by
  recursively visiting a random unvisited neighbor until every cell is reached.
- The carving process creates reciprocal passages between adjacent cells.
- The start is `(0, 0)`, the finish is `(width - 1, height - 1)`, and the default
  scene places ten twister objects on otherwise empty cells.
- `src/scene.c` starts the walker at `(0, 0)` facing down.
- `src/walker.c` chooses an available passage in this order: right, forward,
  left, then a 180-degree reverse. A twister rotates the world and is consumed.
- Reaching the finish begins the native scene's two-second wall-collapse reset.
- The original `src/main.c` seeds the C library random generator from the
  current time.

## Native repeatability added in this branch

- GLMaze still uses a time-based seed by default, but now accepts
  `--seed <number>` or a numeric `seed` setting for repeatable evidence runs.
- Each native maze is reseeded before generation from the base run seed and its
  zero-based run index. The generated seed is printed before the maze.
- Repetition is scoped to an unchanged executable, C runtime, platform, and
  configuration because the C standard does not require every platform's
  `rand()` implementation to emit the same sequence.

## Browser implementation decisions

- `web/src/maze.js` now defaults to the recovered 12×12 randomized-Kruskal
  algorithm. It enumerates 264 internal edges, reproduces the original's
  `rand() % i` edge-swap loop, and accepts the 143 edges that join disjoint
  components.
- The default random stream uses the recovered Microsoft CRT recurrence
  `state = state * 214013 + 2531011`, returns bits 16–30, and discards ten
  outputs after seeding. Numeric seeds can therefore drive direct evidence
  comparisons. Text seeds are first reduced to a stable 32-bit hash.
- Entrance and exit rows are drawn independently and placed on the left and
  right boundary cells. The top-down renderer leaves visible openings at those
  two positions.
- The prior portable pseudo-random stream remains available as **Portable debug
  mode** and through `?rng=portable`. It is deterministic but is not intended
  to match the Microsoft stream.
- One additional random draw selects a persistent route rule for each maze.
  Values `0–500` select left → forward → right → reverse; values `501–999`
  select right → forward → left → reverse. `web/src/walker.js` implements both
  branches independently of rendering.
- The browser advances simulation on a fixed 25 ms accumulator. Straight
  movement, quarter-turn arcs, and dead-end reversals each use exactly 18
  updates, for a nominal segment duration of 450 ms. Quarter turns change
  heading by 5 degrees per update; reversals change it by 10 degrees.
- Logical cell traversal remains separate from the interpolated top-down pose.
  Collision and goal tests occur on cells, while the pose supplies continuous
  position and heading for rendering.
- The top-down canvas (`mazeCanvas`) is the evidence/debug view and WebGL
  fallback. First person is a separate `webglCanvas` rendered by
  `web/src/webgl-renderer.js`; both are drawn from the single existing
  `requestAnimationFrame` loop and read `walker.renderPose()` without mutating
  state.
- Trigger solids ("twisters") start an 18-update, 180 degree scene roll, pause
  navigation for those updates, then toggle the persistent `inverted` flag and
  are consumed once (see "Fidelity pass" below).
- A run no longer stops at the exit: the walls shrink for 42 updates, the next maze
  is generated, and its walls grow for 41 updates (the recovered float32 ramp, see "Exit and camera static analysis"), without a page reload. Generate restarts the run from the
  seed; the first maze of a run always reproduces the URL seed exactly.

## Captured evidence

The browser UI records the seed, random-generator mode, entrance, exit, route
handedness, current cell, direction, simulation-update count and time,
move/turn/dead-end counts, twister encounters, elapsed time, world orientation,
and important events. **Export evidence JSON** downloads those values with the
canonical maze serialization and validation result.

For native evidence, startup output records `run_seed` and `seed_source`. Every
maze generation records `maze_run` and `maze_seed`. A base run seed produces a
stable sequence; a printed maze seed reproduces that maze as the first maze of
a new run in the same native environment.

## Automated checks

`npm test` verifies that:

- the Microsoft-compatible LCG's post-warm-up sequence;
- a fixed numeric seed's edge order and boundary-row draws;
- identical seeds serialize identically in both RNG modes and different seeds
  differ;
- all 144 cells are reachable;
- every passage has a reciprocal passage;
- the 12×12 perfect maze contains exactly 143 passage edges;
- fixed seeds deterministically select both handedness branches;
- serialization retains size, RNG mode, seed, entrance, exit, and handedness
  metadata;
- a movement segment completes on update 18 at 450 ms of simulation time;
- the recovered float32 ramps (41 up, 42 down), the original camera path, the markers mode (camera on the entry edge, billboard
  0.5 straight ahead at start and exit, stillness and persistence during the exit, shrink then regrowth sequence) and the
  deterministic telemetry export;
- quarter-turn arcs change heading by 5 degrees per update and dead-end
  reversals change heading by 10 degrees per update;
- start, finish, and the drawn 0-8 trigger solids do not overlap; and
- both left-hand and right-hand walkers reach the finish without crossing a
  closed wall for a set of fixed seeds.

## Unknown or not yet implemented

- The new generator and random stream are based on static evidence from the
  separately preserved Windows 95 Maze sample; runtime comparison remains to
  be performed.
- The procedural artwork is an original replacement rather than copied Microsoft
  material. Normal-mode render size and historical Windows 95/98 timing remain unknown.
- Browser scheduling can delay wall-clock playback in throttled or overloaded
  tabs, but it does not change the fixed simulation step or update counts.

## First-person WebGL renderer

Evidence status: the 18-update movement and rotation structure is supported by
static analysis and Windows 11 WoW64 capture. The 25 ms browser step is a
reconstruction choice that gives a 450 ms transition, matching two WoW64 runs
whose measured medians were about 434–467 ms. The captured original speed mode
was not identified, and historical Windows 95/98 timing remains unverified.
The camera, projection, world proportions, texture sampling and solid-object light below are recovered from the original scene
renderer (see "Exit and camera static analysis"). The artwork and the 25 ms step are **browser reconstruction choices**.

- Modules: `webgl-geometry.js` (pure maze → buffers), `mat4.js` (matrices),
  `procedural-textures.js` (original textures), `webgl-renderer.js` (context,
  shaders, camera, draw). Geometry is rebuilt/uploaded only in `setMaze`.
- Coordinates: world X = cell x, Z = cell y, floor Y = 0, ceiling Y = 1, cubic cells. Camera
  eye = `(pose.x + 0.5, 0.5, pose.y + 0.5)`; forward = `(sin h, 0, -cos h)`. The pose is the recovered edge-entry pose
  (the camera stands on the midpoint of the edge it entered its cell by). The renderer does no smoothing of its own.
- Tunables live in `CAMERA_CONFIG` / `LIGHT_CONFIG`: 90° vertical FOV, aspect 1.0 (the picture is stretched to the window),
  eye height 0.5, near 0.01 and far 100. Textures repeat with nearest-neighbour filtering and no mipmaps. Textured walls,
  floor, ceiling and billboards are unlit; solid trigger objects use the recovered positional light at original `(6,6,10,1)`,
  mapped to browser `(6,10,6)`. No `GL_FOG` path exists in the analysed renderer, so the browser adds no atmospheric fog.
- Walls are emitted once per closed boundary and drawn double-sided (culling off,
  normal flipped via `gl_FrontFacing`); floors/ceilings are single-sided with
  back-face culling. The entrance and exit boundary walls are closed, as in the original; only the top-down debug map shows them as openings.
- Inverted (twister) world: the scene rolls 180° while navigation pauses. The
  former purple fog treatment was removed because the original has no fog path.
- Context loss: the app switches to the debug map, announces it, and returns to
  first person after restore (resources and geometry are recreated).
- Size for a default 12×12 maze: counts are reported by
  `buildMazeGeometry`; seed 1 has 457 quads (169 walls including the two closed boundary walls), 1828 vertices, 2742 indices.
- Still unknown: the original texture pixels and Normal-mode render size. The
  procedural textures remain clean-room stand-ins.

## Fidelity pass: evidence matrix

Classes: **D** direct observation, **M** mechanically derived, **I** analyst
inference, **C** browser reconstruction choice, **U** unknown. Windows 11 WoW64
timing is kept separate from historical Windows 95/98 timing.

| Topic | Value in the browser | Class | Basis |
| --- | --- | --- | --- |
| Update count per move, turn, reversal | 18 | D | static analysis of the original route code |
| Heading step per update | 5 degrees (turn), 10 degrees (reversal) | D | static analysis; the capture pans 10.25 px per 5 degree update at 240 px width, matching |
| Wall-clock per update | 25 ms (450 ms per transition) | M/C | two WoW64 captures: straight about 434-442 ms, quarter turn about 458 ms, reversal about 459-467 ms; the exact step is a choice |
| Chrome 155 playback, headless, 144 Hz | 600 updates in 15 s; segment medians about 451 ms (frame-quantised to 6.9 ms) | D | `phase1-cadence-450ms` in the private browser-acceptance evidence |
| Pose continuity and wall crossing | no jump above 0.09 cell or 10 degrees per update, never leaves the maze or the two cells of its move | M | `walker-continuity.test.js`, 7 seeds |
| Capture speed mode | Turbo-style 320x200 render | M/I | the captured frames are made of 6 px wide blocks at 1920 px (320 columns); settings live in `control.ini` `[3D Maze (OpenGL)]`, no such file exists so defaults apply and the static default is `TurboMode=1`. The dialog has no Turbo control. Normal was not captured: writing `C:\Windows\control.ini` needs administrator rights and was not attempted |
| Vertical field of view and aspect | 90 degrees, aspect 1.0, near 0.01, far 100 | O | constants passed to the projection call in the scene renderer 0x100203e. Replaces the earlier fit (60 degrees at the display aspect, withdrawn): it reproduced the measured pan (156.6 px focal length; the recovered 160 px agrees within 2.4%) only because the vertical scale was free. See `camera.test.js` |
| Eye height | 0.5 of a cell whose floor is 0 and ceiling 1.0 | O | camera call 0x100203e and the floor and ceiling quads 0x1001e88; agrees with the symmetric floor and ceiling edges in the captures |
| Wall height | 1.0 (cubic cells), scaled by the growth value | O | wall quads 0x1001922 span z 0 to the growth value. The earlier 0.282 fit assumed a cell-centre camera and is withdrawn; the measured 540 px wall straight ahead is what a 1.0 wall one cell away gives at 90 degrees (540 of 1080 px) |
| Brick mapping | one brick texture per 1 x 1 wall, about 2.5 bricks x 5 courses | O (repeat count 1) / D (bricks per wall) | the original maps its brick texture once per wall; the captures show bricks 3.5 times wider than tall on the stretched screen, which a 2.5 x 5 layout gives; course pitch about 115 px against a 540 px wall (about 4.7 courses); uncertainty about 10% |
| Lighting and fog | textured geometry unlit; trigger solids use positional `GL_LIGHT0`; no atmospheric fog | O/D | initialiser 0x1003f5c and painter 0x1001b98; no `glFog*` calls or `GL_FOG` enable in the analysed renderer |
| Brick, tile, ceiling look | original procedural textures | C | no Microsoft assets are used |
| Exit transition | the float 0.025 per update stored as a float32: exit 42 updates (1.025 to -0.025), next maze generated on the following update, then a 41-update entrance (0 to 1.025); 40 + 1 + 40 was the earlier reading | D | decoded update routine 0x1003ad1 and a float32 simulation (`run.test.js`); the compare precision does not change the counts. The captures cannot separate 40 from 41/42 updates (+-0.1 s) |
| What the entrance transition draws | the walls grow vertically from the floor over 41 updates (40 before the float32 ramp was recovered); floor and ceiling stay full | D | the 2026-10-21 long capture: the scene appears at full brightness and the walls grow, so it is not a fade; the ramp length is only roughly measured (about 1 s, +-0.2 s) |
| What the exit transition draws | the walls shrink linearly to zero height over about 0.97 s (floor and ceiling stay full), the camera is still | D | six-minute capture, seven exit-and-reset events in the saver clip and three more in the earlier clip; hand-measured on two (0.97 s each), the rest show the same brick-fraction pattern |
| Reset | the next maze appears in the very next presented frame, upright (any inversion cleared), walls at about zero height and growing for about 1.1 s | D | same events: no black period, no fade, a gap under about 50 ms; total about 0.97 s + under one frame + 1.1 s, consistent with 40 + 1 + 40 updates at 24-25 ms |
| Start sign | a camera-facing billboard at the entrance cell centre, 0.5 straight ahead of the camera, which starts on that cell's west edge facing east (O); in all ten sampled starts it is straight ahead, about 0.62 of the wall width by 0.6 of the wall height when a wall is 1.0 behind it (a 1/3-wide quad at half the distance), squashing with the walls; the original is a Microsoft artwork and is not reproduced | O + D | decoded 0x10010d9 and 0x1001b98; the six-minute and earlier captures (frames about 0.5 s into each start) |
| Exit smiley | a camera-facing billboard at the exit cell centre, 0.5 straight ahead of the camera, which stops on the entry edge of that cell (O); in all ten sampled exit transitions it is straight ahead, about 0.44 by 0.57 of the wall when a wall is 1.0 behind it, squashing with the walls; a wall behind it in 18 of 20 viewed start and exit frames and an open corridor in 2 | O + D | the same decode and the ten exit events (frames 0.7 s before each reset) |
| Marker mechanism | billboards at the entrance and exit cell centres plus the edge-entry camera; the artwork is the only optional part (an experimental flag, off by default, procedural stand-ins) | O | static analysis (0x10010d9, 0x10044bf, 0x10045e6, 0x1001b98); the earlier west-facing start and extra-cell inference is withdrawn. Hiding the artwork never changes the camera or the world (`original-camera.test.js`) |
| Floor and ceiling look | warm brown wood grain floor, grey stipple ceiling, generated procedurally | D for the look, C for the mapping | same capture |
| Next maze seed | derived from the run seed and maze index | C | the original continues one time-seeded CRT stream across mazes |
| Trigger count and look | 0-8 solids (rand % 9); icosahedron, octahedron, dodecahedron or tetrahedron; white; original vertical-Z spin 2-7, then X spin 0-4 degrees per update (browser Y then X after axis mapping) | O | lifecycle initialiser 0x10037a2 and painter 0x1001b98 |
| Placement and random-draw order | maze/pictures; remove entrance and exit; triggers; logos; rats; camera hand | O | lifecycle initialiser 0x10037a2; object cells use the 144-cell pool without replacement via 0x10036f4 |
| Trigger effect | 18-update, 10 degree per update roll, navigation paused, then the object is consumed | D | static analysis; the roll direction is a choice |
| Solid size | radius 0.25 cell, centre height 0.25 (resting on the floor), height squashed with the walls | O | placement record in 0x10037a2 and the object painter 0x1001b98; the earlier 0.07 radius followed the withdrawn 0.282 wall height |
| Start and exit markers | optional experimental artwork (see the rows above): billboards at the cell centres | O for mechanism, size and place; C for the artwork | one entrance and one exit marker exist (observed object records); Start sign and smiley identities from resource order and the captures |
| Picture walls | 1-5 random wall-record draws with replacement, textured with an original painted scene, experimental flag off by default | O/C | selection loop 0x10010d9; browser artwork is an original stand-in |
| Logo objects | none for half of the mazes, otherwise 1-3, placed on unused random cells, camera-facing 0.667 x 0.66 cell billboards centred at height 0.5, experimental flag off by default | O/C | count, pool placement, billboard mechanism and size are observed; browser artwork is an original ring emblem |
| Rats | RatCount (default 1) rats on unused random cells, each with its own hand and the same route rules; camera-facing 0.5 x 0.25 cell billboard centred 0.125 above the floor, experimental flag off by default | O/C | cell-pool placement, per-rat hand, route and billboard size are observed; browser artwork is an original stand-in |
| Camera constants test | wall fraction 0.49 and 10.25 px pan reproduced | M | `camera.test.js` against numbers measured from private captures |
| Reduced motion | simulation unchanged; view shows the logical cell, no roll, no wall growth, solids still | C | accessibility choice |

## Exit and camera static analysis (2026-10-22; adopted as the default 2026-10-22)

The original exit mechanism was traced with REA 6.2.0 and Ghidra 12.1.4 on the read-only runtime copy; the full dossier
(functions, constants, classes O/D/I/C/U, the update-phase table, conflicts, unknowns, remaining differences) is in
[original-exit-camera-analysis.md](original-exit-camera-analysis.md). Result in one paragraph: the exit is an ordinary cell of the
12 x 12 maze; the Start sign and the smiley are camera-facing billboards at the centres of the entrance and exit cells, and the
camera always stands on the midpoint of the edge through which it entered its cell, facing into the cell, so the billboard is 0.5
straight ahead at the start and at the exit. The browser now uses the recovered camera, world and update phase **by default**: the
edge-entry camera for every run, the Euler movement and turn path (decision call, 17 integration calls, snap), cubic cells, 90
degrees vertical FOV at aspect 1.0, closed entrance and exit boundary walls, 0.25-cell trigger solids and the 41/42-update float32
ramps. The marker artwork (Start sign, smiley; procedural stand-ins) stays an experimental flag that only shows or hides the
billboards. The previous capture-fitted model was withdrawn rather than kept as a comparison.

### Deterministic per-update telemetry

`node web/tools/telemetry.mjs --seed 2017 --updates 5000 > run.ndjson` (or `npm run telemetry -- --seed 2017`) writes one
meta line and one JSON record per 25 ms simulation update, independent of the display frame rate: update number and time,
run seed, maze seed, RNG mode, maze index, run phase and phase update, current and destination cell, camera X and Z in cell
units (world), heading, scene roll, inversion, move kind and move-update index (0 decision, 1 to 17 integration; the snap is
reported as 0 of the next move), wall-growth value, exit state (none, shrinking, regenerating), marker mode (artwork shown or not),
the update event and the object event (touch, rolling, consumed). Format version 2. Floating-point fields are rounded to nine decimals. `web/tests/telemetry.test.js` proves that seed 2017 gives byte-identical output in
repeated runs in both modes, that the module uses no clock or random source, and that every record is complete and inside the
maze. Options: `--seed`, `--updates`, `--rng microsoft|portable`, `--markers`, `--no-objects`, `--rats`, `--out`.

## Controls and settings

Play/Pause, Step 25 ms, Generate and seed, Random generator, Render quality
(High, Standard, Turbo look), Reduce motion (follows the system setting until
changed), Trigger solids (turning it off restarts the run with none), Start and
exit markers, Picture walls, Logo objects and Rat (all experimental, off by default; the rat
and the markers restart the run), First person / Debug map,
Fullscreen, and Export evidence JSON. Settings are kept in
`localStorage` under `glmaze.settings.v1` (quality, view, reduced motion
and the object flags only). URL parameters win over saved settings: `seed`, `rng`,
`quality`, `view`, `objects=0`, `markers=1`, `pictures=1`, `logos=1`, `rats=1`, `reduced=1|0`. The export keeps its original
fields and adds `run` and `settings`.

## Tests and checks

`npm test` runs the Node unit tests (generator, walker, pose continuity, run
lifecycle, settings, geometry, solids, matrices). `npm run smoke` drives a local
Chrome or Edge over the DevTools protocol (dev tool, not CI): play, pause,
step, regenerate, view switching, quality, reduced motion (the view holds still
during a transition), persistence, keyboard Tab order and focus outlines,
fullscreen enter and exit, context loss and restore, the trigger flag and the
WebGL-unavailable fallback.
GL object creation stayed constant over 300 maze changes and 6 context
loss/restore cycles (soak result kept in the private evidence folder).

## Development, tests and static preview

No build step, bundler, linter or type checker exists: the app is dependency-free
ES modules served as static files (Node 20 or newer for the tools).

| Command | Purpose |
| --- | --- |
| `npm start` | local dev server at `http://127.0.0.1:8080` (set `PORT` to change) |
| `npm test` | Node unit tests (the CI check) |
| `npm run smoke` | headless Chrome or Edge behaviour checks (`CHROME_PATH` to choose a browser) |
| `npm run smoke:firefox` | headless Firefox checks over WebDriver BiDi with a fresh profile (`FIREFOX_PATH` to override) |
| `npm run visual` | fixed-seed screenshots compared with `web/tests/visual-baselines/` (`-- --update` rewrites them) |
| `npm run profile` | local startup, geometry, draw-call, CPU, allocation and cadence profile |

Local static preview: `npm start`, or serve the `web/` folder with any static
file server that sends `.js` as `text/javascript`; `web/tests/` is not needed
at runtime.

Deployment (prepared, not performed): copy `web/` (without `web/tests/`) to any
static host over HTTPS. Nothing is published by this repository, and no private
capture, original screensaver or credential is needed or may be added.

## Compatibility and performance results (2026-10-21, one Windows 11 machine)

| Target | What was exercised | Not exercised |
| --- | --- | --- |
| Chrome 155.0.8059.85 (headless) | after the original-camera parity pass (2026-10-22): unit 70/70, smoke 33/33, visual 10/10 (baselines regenerated), profile (40.0 updates per second); earlier: soak, acceptance checks | a human watching a visible window |
| Edge 155.0.4283.62 (headless) | after the parity pass: smoke 33/33, visual 10/10 against the Chrome baselines | visible window |
| Firefox 158.0.1 (headless, WebDriver BiDi, fresh profile; `npm run smoke:firefox`) | 11/11: WebGL 2 first person renders lit brick pixels (buffer readback), Tab reaches all 16 controls, the stylesheet defines the 3px focus outline, reduced motion holds the view still and normal motion moves it, narrow DPR 2 and wide DPR 1 resize, context loss and restore, the WebGL-unavailable fallback, no console errors | `:focus-visible` rendering (headless Firefox never gets system focus, so only the rule is verified), fullscreen, a visible window, and pixel comparison: its headless screenshot of the WebGL canvas is black while readback is correct, a capture limitation not a rendering failure |
| Mobile | Chrome emulation at 420 px and DPR 2 (backing store = CSS size x 2, no horizontal overflow) | a real phone or touch input |
| No WebGL 2 | debug map shown and first-person button disabled (Chrome, Edge and Firefox) | a browser that truly lacks WebGL 2 |

Profile (headless Chrome, 900x600 canvas, seed 1): page load 228 ms; 13
requests, 80 KB (70 KB script); geometry 1,828 vertices and 2,742 indices
(167 walls, 144 floor, 144 ceiling, 2 boundary-wall quads drawn with the markers flag); markers are 2 sprite draws; 5 indexed draws plus 2
solid draws per frame at most; `render()` CPU 0.1 ms p95; no net JS allocation
per frame in the renderer (the app builds one small options object and the
walker pose copy per frame); 39.98 updates per second against the 40 expected;
animation frames at 6.9 ms median on the 144 Hz display. GPU time and a visible
real-time review were not measured.

## Known differences and unknowns

- Normal rendering now follows the recovered unlit-texture, nearest-filter and solid-light state; the original speed mode was not identified. The camera path, projection, world
  proportions, marker mechanism, update phase and ramps are the recovered original (see the evidence matrix and
  docs/original-exit-camera-analysis.md section 8 for every remaining difference).
- The previous capture-fitted camera (60 degrees at the display aspect, wall height 0.282, cell-centre camera) was withdrawn, not
  kept as a debug comparison: it assumed a centre camera and matched the captures at one distance only.
- Rats, picture walls and logo objects exist only as experimental flags with
  original replacement sprites and pictures. Their placement, sizes and billboard facing match the recovered records; artwork remains a choice.
- The trigger solid looks dark grey with lighter facets in the one captured frame that shows
  one (direct, a single sample), while the browser draws it white and lit; lighting of the
  solids is unresolved.
- Timing was measured on Windows 11 WoW64, not on Windows 95 or 98, and the
  analysed binary is the NT 4.0 sibling (version 4.00).
- The next maze seed is derived from the run seed; the original continues one
  time-seeded stream.

## Provenance, licences and acknowledgements

- All browser code under `web/` is original work for this project. No Microsoft
  code, texture, mesh, sound or other asset is copied or embedded; the preserved
  `ssmaze.scr`, captures and credentials stay outside Git.
- All visuals are generated at run time (`web/assets/ASSETS.md`): brick, tile and
  ceiling textures, the start sign, the smiley and the polyhedra.
- There are no third-party runtime dependencies and no fonts or binary assets.
  The visual baselines in `web/tests/visual-baselines/` are screenshots of this
  project's own procedural output.
- The repository carries the zlib-style licence of GLMaze (`LICENSE.txt`). The
  browser code was written as a behavioural reconstruction from recovered
  behaviour rather than from GLMaze source; whether to state a separate licence
  for `web/` is a decision for the project owner.
- Thanks to ultitech for GLMaze and to Microsoft for the screensaver that
  inspired it.

## Fidelity investigations (source, method, uncertainty, conclusion)

Private evidence: the two WoW64 captures in the runtime-timing folder (outside Git).

| Question | Sample | Method | Result and uncertainty | Class |
| --- | --- | --- | --- | --- |
| Vertical FOV and aspect | 24 quarter turns, pan per unique frame | FFT phase correlation of a 240x135 copy; 10.25 px per 5 degree update | 156.6 render px focal length, +-0.2 px; the earlier 60 degree reading is superseded by the recovered 90 degrees at aspect 1.0 (160 px, 2.4% above) | D, superseded by O |
| Wall proportion | 14 turn starts facing a wall, full-resolution frames | brick-coloured band at the centre strip; wall width from the brick run; | wall band about 1,880 x 540 px, frame fraction 0.489; the recovered 1.0 high wall one cell ahead gives 0.5 (540 px); the earlier 0.282 wall height is withdrawn | D, superseded by O |
| Eye height | 36 turn starts | floor and ceiling edges about the horizon | symmetric within 1-2 px of 135 | derived |
| Brick size | the same frames | mortar rows and brick runs along strips | about 4.7 courses, about 4.5-5 bricks across; +-10% | derived |
| Straight-motion interpolation | static analysis (1/18 cell per update, linear) | not independently re-measured here; an earlier depth-slope measurement was inconclusive | linear | D (analysis only) |
| Quarter-turn heading path | 24 turns | uniform 10.25 px per update | constant 5 degrees per update; the translation arc between cells was not measured | D for heading, U for the arc |
| Entrance and exit transition appearance | long captures, saver start and ten resets | 8-frame montages; brightness and brick fraction over time; hand-measured ramps | walls grow (about 1.1 s) and shrink (about 0.97 s) linearly from and to the floor, scene at full brightness at once, no fade; +-0.1 s | D |
| Start sign and smiley size and place | ten starts and ten exits | sign and smiley extent against the wall ahead | 0.62 x 0.6 and 0.44 x 0.57 of the wall (a billboard at half the wall distance, 0.333 wide, matches), marker straight ahead 20/20; +-10% | D |
| Start heading and exit arrival | the same twenty frames | side walls flanking the marker; the wall behind it | replaced by the static analysis: the camera starts facing east on the entrance cell edge and stops on the exit cell edge; the marker is straight ahead 20/20 and an open corridor lies behind it in 2 of 20 | D, replaced by O |
| Solid size and draw order | no clear frame of a solid found; placement and lifecycle records decoded | static analysis | radius 0.25 cell at height 0.25; placement/draw order recovered | O |
| Normal vs Turbo | block structure of captured frames | horizontal gradient period | 320-column render observed; mode setting not confirmed | D for render size, U for setting |

## Performance target

Target (defined here, desktop tier): page load under 1 s, under 200 KB transferred, 40 simulation updates per second held within 1, render
CPU time under 2 ms at the 95th percentile, no net per-frame renderer allocation, a handful of draw calls. Measured headless on one
machine (Radeon RX 5700 XT, 144 Hz): load 287 ms, 93 KB (83 KB script), 39.98 updates per second, CPU render 0.1 ms p95, at most
6 indexed and 6 array draws with every experimental flag on, geometry 1,836 vertices and 2,754 indices for seed 1. Not measured: GPU frame
time, integrated-graphics or phone hardware, and smoothness in a visible window, so the "smooth at the target hardware tier" criterion is
not closed.
