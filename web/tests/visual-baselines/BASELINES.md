# Visual baselines: record of accepted changes

All images come from this project's own procedural textures, its original generated theme images or synthetic textures; none contains Microsoft artwork. `environment.json` (written by
`npm run visual -- --update`) records the browser, GPU backend, viewport and device pixel ratio of the accepted set.

Accepted set of 2026-10-27: Chrome 156.0.8078.48 headless, ANGLE on an AMD Radeon RX 5700 XT (Direct3D 11), WebGL 2.0, viewport
1000 x 640, device pixel ratio 1, quality `standard`, seed 1 with trigger solids off, screenshots clipped to the canvas at half scale
(283 x 258 px). The canvas shell is pinned to an exact 568 x 518 px at the top-left of the page and the DOM view-switch overlay is
hidden, so the images are pure canvas pixels and do not depend on operating-system fonts, scrollbars or page layout. Comparison limits: mean absolute difference below 4 and under 3% of pixels more than 48 levels off. The same set
passes under Chrome's software rasterizer (SwiftShader, `GLMAZE_BROWSER_ARGS="--use-angle=swiftshader --enable-unsafe-swiftshader"`)
with mean differences of at most 1.3, and under Edge 155 on the same machine (2026-10-22 set).

## First Linux CI run (2026-10-28)

The first run on a GitHub-hosted runner (Chrome 155.0.8059.39, SwiftShader, Ubuntu 24.04) failed 9 of 10 views with mean differences of 6 to 10.
The frames were identical except for a vertical sub-pixel offset of the picture (best alignment at a 0 to 1 px shift): the canvas rect
differed by a fraction of a pixel because page layout (fonts, scrollbars) differs between Windows and Linux. Test hygiene, not a rendering
defect: the capture now pins the canvas shell to an exact size and position. The baselines were regenerated with the same renderer and the
same views; the images are visually identical to the previous set.

## Diagnosis of the 0/10 failure of 2026-10-27

The baselines of 2026-10-22 were captured before three intended changes landed on 2026-10-23 to 2026-10-27. No generator or
renderer regression was found. Evidence (diff sheets were kept privately in the session scratchpad):

| Cause | Class | Evidence | Views affected |
| --- | --- | --- | --- |
| Texture sampling and lighting state: nearest-neighbour repeating textures without mipmaps, unlit textured geometry, no fog, black clear colour | intended (observation of the original's GL state at 0x1003f5c; `docs/original-exit-camera-analysis.md` section 8 item 7) | frames whose pose does not depend on the route (the two entrance frames and the start-marker frame) are identical in geometry and differ only in texel sharpness, fog and sky colour; PSNR 19.7 to 22.3 dB | all ten |
| Recovered random-draw order: the camera's hand is now drawn after the rats, so seed 1 has a left-hand route instead of a right-hand one | intended (observation of 0x10037a2; `docs/browser-maze-generation.md` placement row) | the maze topology and entrance and exit rows are identical for 200 seeds; the hand differs for 96 of them (seed 1: right to left). Re-rendering the old right-hand route with the new renderer reproduces all six old motion views pose for pose (only texture sharpness differs) | the six route-dependent views and the exit view |
| Fixed update indices of the old route | incorrect test timing, repaired | the exit view (2846) and the others pointed at poses of the old route; the indices were re-chosen on the new route (finish update 2400, so the exit view is 2414) | all route-dependent views |
| Software-rasterizer artefact: near surfaces drew flat | **real defect, repaired** | under SwiftShader the surfaces touching the camera plane (the camera stands on cell edges) lost their texture coordinates, in the old mipmapped renderer too; drawing the eye 0.015 cell behind the logical pose (`CAMERA_CONFIG.eyeSetback`, a reconstruction choice) fixes it: GPU versus SwiftShader PSNR rose from 11 to 25 dB (before) to 35 to 69 dB (after) | the views with nearby walls |
| Eye setback side effect: the setback put the eye 0.015 cell behind the closed entrance wall at the start, so the double-sided wall filled the view and hid the Start sign | **defect introduced by the fix above, caught by the marker smoke check and repaired before any baseline was accepted** | the two boundary walls are now a separate range drawn single-sided (invisible from outside), and a picture on a boundary wall gets only its inward face (`web/tests/webgl-geometry.test.js`); the smoke check enters the exit cell through an open passage | start frames |

## Accepted baselines and reasons

| Baseline | Update (seed 1, objects off) | Reason for the 2026-10-27 change |
| --- | --- | --- |
| entrance-growth-half | 20 | nearest texture sampling, no fog, black clear colour, eye setback |
| entrance-facing-wall | 41 | same |
| quarter-turn-mid | 51 | same, and the first move is now a left turn (left-hand route) |
| quarter-turn-done | 60 | same; the snap after the first move |
| reversal-mid | 69 | route change: the second move is now the dead-end reversal |
| straight-mid | 87 | route change: first straight move at update 87 |
| second-turn-mid | 105 | route change |
| open-corridor | 159 | route change |
| start-markers | 22 (markers on) | texture state and eye setback; marker artwork unchanged |
| exit-markers-shrinking | 2414 (markers on) | route change: the exit is detected at update 2400 and this is 14 updates into the 42-update shrink |

Reviewed by eye on 2026-10-27: every frame shows the intended content (walls growing during the entrance, quarter turn, snap, reversal
in a dead end, straight corridor, the Start sign low in the growing maze, the smiley low in the shrinking maze with the black void
above the shrunken walls).

## Theme baselines added 2026-10-28

Two baselines were added without touching the ten Classic ones (the Classic rendering does not change, so `git` shows only two new files):

| Baseline | What it shows | Notes |
| --- | --- | --- |
| `backrooms-straight` | the Backrooms-inspired theme at update 87 of seed 1 (same pose as `straight-mid`), objects off | the three built-in WebP textures; the capture waits for the theme status before stepping |
| `custom-synthetic` | the Custom theme with three deterministic synthetic 512 x 512 PNGs generated in the page (grids and squares from integer geometry, brick red wall, blue floor, green ceiling) at the same pose | goes through the real upload path (file input, validation, decode, upload); no private or user image is ever used or committed |

Both were captured on the environment recorded in `environment.json` (Chrome 156.0.8078.48, AMD Radeon RX 5700 XT) and pass under SwiftShader (mean difference 0.78 and 0.34). Every view now loads with an explicit `theme=` parameter so a stored theme can never leak into a baseline.
