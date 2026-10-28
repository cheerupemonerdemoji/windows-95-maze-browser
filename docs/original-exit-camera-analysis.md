# Original Windows Maze: exit, marker and camera behaviour (static analysis, 2026-10-22)

Scope: which exit mechanism the original really uses, how the Start sign and the smiley are drawn, how the camera and
projection are set up, and how the update loop is timed. Subject: the NT 4.0 OpenGL Maze (`ssmaze.scr`, version 4.00,
SHA-256 `2431be0b…0c946`, 481,552 bytes), the same read-only runtime copy used for the timing captures. This is a
paraphrase of decompiled behaviour and decoded instructions, recorded as evidence. It is **not** Microsoft source and no
Microsoft code or artwork is copied; the browser reimplements the behaviour independently.

Evidence classes: **O** observation (read directly from the binary or a capture), **D** derived (follows from O by
arithmetic or control flow), **I** inference, **C** reconstruction choice in the browser, **U** unknown.
Addresses are image addresses as Ghidra lists them (x86, image base 0x1000000 is part of the number). Private
outputs (decompiler text, instruction listings, hex dumps, captures) stay outside Git, in a private evidence folder that is never
published.

## 1. Conclusion

The original has no special exit structure. The maze is 12 x 12 and the exit cell is column 11 inside it; no extra cell, marker
wall or outside viewpoint exists. The Start sign and the smiley are camera-facing quads ("billboards") centred on the middle of the
entrance cell and of the exit cell at eye height. The camera always stands on the midpoint of the edge through which it entered its
cell, facing into the cell, so the cell-centre billboard is 0.5 cell straight ahead at the start and at the exit, whatever the
arrival direction (O + D). The exit cell's east wall is an ordinary closed boundary wall; the generator closes every outer edge (O).

Confidence: high for the mechanism (five independent decompiled functions agree, and the sizes predicted from the constants match
the captured frames within a few percent, section 6). The one weaker point is the hand-decoded update routine (section 3), which
Ghidra does not list as a function; the update-phase table in section 6a depends on it (medium-high).

Superseded: the browser's earlier inference (a west-facing start and an extra enclosed cell east of the exit) and its capture-fitted
camera (60 degrees, wall height 0.282, cell-centre camera) were withdrawn when this analysis was finished; the browser now uses the
recovered camera and world by default (section 8).

## 2. REA and Ghidra operations

- REA CLI 6.2.0, provider Ghidra 12.1.4 (Java 21), target the read-only runtime copy only. The REA MCP tools were not
  available in this session, so the `rea` command line was the fallback (same provider and operations).
- Import mode `ephemeral-source-immutable`; nothing was written to the target, no annotation or edit command was used,
  the target was never executed. Operations used: `analyze`, `search --kind procedures`, `decompile` (about 35
  functions), `instructions` (0x100203e, 0x1001b98), `read-bytes` (0x1003ad1 for 564 bytes, the two dispatch tables, the
  float constants, the heading and offset tables), `inspect-native-instruction` (0x1003616),
  `resolve-native-call-targets` (0x10020b5, 0x10020ec) and `xrefs` (0x1019d30, 0x101fb40, 0x101fb48).
- `0x1003ad1`, the per-frame update routine, is not a Ghidra function: `0x1003e3d` hands its address to the framework as a
  callback and nothing calls it directly, so `decompile` reports "no procedure". I decoded those 564 bytes by hand and
  cross-checked the decode with the reference addresses (state variable at 7 sites, growth value at 13 sites, roll angle at
  7 sites) and with the earlier REA pass recorded in the private analysis report. Treat the hand decode as medium-high
  confidence and re-check it if any conclusion below becomes load-bearing.

## 3. Functions and data examined

| Address | Role (paraphrased) | Class |
| --- | --- | --- |
| 0x1003e3d | installs three callbacks: GL init 0x1003f5c, per-frame update 0x1003ad1, reshape 0x1003d22; Turbo mode selects a fixed 320 x 200 render size (0x1003ec6) and nothing else | O |
| 0x1003d22 | reshape: stores width / height as a float; the only use I found is the optional overlay map (0x1002280); the 3D projection call uses constants, not this value | O |
| 0x1003ad1 | update routine, state variable at 0x1019d30: 0 initialise, 1 entrance ramp, 2 walk, 3 exit ramp, 4 trigger roll | O (hand decode) |
| 0x10037a2 | lifecycle initialiser: builds the maze, places 0-8 triggers, 0-3 logos, rats, starts the camera route at the entrance, selects state 1 | O |
| 0x10010d9 | maze set-up: calls the generator, emits wall records, picks the entrance cell (column 0, row rand % 12) and the exit cell (column 11, row rand % 12), creates the Start and smiley records at cell centre + 0.5, closes 1-5 picture walls | O |
| 0x1004280 | randomized Kruskal on 12 x 12; every outer boundary edge is closed unconditionally | O |
| 0x10044bf, 0x10045a0, 0x10045e6 | route set-up, edge-pose snap, per-update route step | O |
| 0x100203e | scene render: projection, camera, floor and ceiling, painter-sorted walls and objects | O |
| 0x1001e88 | floor (z = 0) and ceiling (z = 1.0) quads, 12 x 12 | O |
| 0x1001922 / 0x100187f / 0x1001472 | wall quad from z = 0 to the growth value; depth key; paint-list entry | O |
| 0x1001b98 | object painter: type 0 is the camera-facing textured quad (markers, logo, rat), type 1 is a solid | O |
| 0x1003622 | end-of-update housekeeping: clears the colour buffer only while the growth value is below 1 | O |
| 0x1023238 / 0x1023250 / 0x1023268 / 0x1023280 / 0x1023298 | fixed texture records in the order Start (resource 103), smiley (104), rat (105), logo (106), picture (107); the rat, logo and picture uses are visible in 0x10037a2, so the Start and smiley mapping follows from the order and the captures | O for rat, logo and picture, D for Start and smiley |

## 4. Exit state (O unless marked)

- Detection: when the route is idle (it has just snapped to an edge pose) it compares its current cell with each goal
  record. The exit record is the first goal. A match makes the route step return that record; the update routine
  compares the returned address with the exit record and selects state 3. Any other goal record selects state 4.
- Camera at exit start: the entry-edge pose of the exit cell, facing the direction of the last move. World position is
  (cell x, cell y + 0.5) when entering from the west, (cell x + 0.99999994, cell y + 0.5) from the east,
  (cell x + 0.5, cell y) from the north and (cell x + 0.5, cell y + 0.99999994) from the south. The 0.99999994 is the
  float just under 1 that the original uses for the east and south edges.
- Maze dimensions: 12 x 12, no extra cell. The exit cell is column 11 and always has its east wall.
- The walker does not change cells during the collapse: state 3 only lowers the growth value; the route is not stepped.
- Navigation is blocked in states 1, 3 and 4 (the route is stepped only in state 2).
- Growth value: state 1 adds the float 0.025 per update to a float, state 3 subtracts it. The compare happens before the
  float32 store. **D:** forty float additions reach 0.99999958, so the entrance takes **41** updates and ends at
  1.025; the exit takes **42** updates and ends at -0.025. Both compare precisions give the same counts
  (`web/tests/run.test.js`). The wall quads span z = 0 to the growth value, so the 2.5% overshoot hides behind the
  ceiling and the last negative frame hides under the floor.
- Reset: when the exit ramp is no longer above zero the state becomes 0; the next update zeroes the growth value and the
  scene roll (so an inverted view is upright again) and runs the lifecycle initialiser, which selects state 1. The next
  maze is therefore seen at zero height in the very next frame, matching the captures.

## 5. Marker rendering (O unless marked)

- Two records are created by 0x10010d9 at (cell x + 0.5, cell y + 0.5) of the entrance and exit cells: height 0.5,
  half-width 0.16666667 (float 0x3e2aaaab), half-height 0.166 (0x3e29fbe7), texture record 0x1023238 (Start) and 0x1023250
  (smiley). Both are type 0 objects.
- The painter builds the quad from the camera heading: its horizontal axis is perpendicular to the view direction, so the
  quad always faces the camera (heading only, vertical stays upright). The centre height and the half-height are both
  multiplied by the growth value, so the marker squashes with the walls, which is what the captures show.
- They are painter-sorted with the walls and drawn with texture blending enabled; they are not part of the wall or floor
  geometry and have no special floor or ceiling. D: what is seen behind a marker is whatever wall or opening lies 0.5 beyond it.

## 6. Camera and projection (O for constants, D for what they imply)

- Projection: vertical FOV **90.0 degrees**, aspect **1.0**, near 0.01, far 100.0 (constants pushed to the GLU call at
  0x10020b5; the aspect is a constant, not the window aspect). The window or the 320 x 200 render buffer is simply
  stretched, so the horizontal FOV is also 90 degrees.
- Camera: eye (x, y, 0.5), looking along (cos h, -sin h) at the same height, up = +z, h = 0 meaning +x. The scene roll is
  a rotation about the view axis applied to the projection (0 or 180 degrees, 10 per update during a roll).
- World: floor z = 0, ceiling z = 1.0, walls 0 to 1.0 when fully grown. Cells are cubes.
- Per update (route step 0x10045e6): straight move 1/18 cell; quarter turn: advance 1.5707964 x 0.027777778 (about 0.04363)
  along the current heading, then turn 5 degrees (0.08726647 rad), 18 updates for 90 degrees; reversal: turn 10 degrees
  (0.17453294 rad) per update, no translation. A move is 18 calls: a decision call with no motion and 17 integration
  calls; the next call snaps the pose to the exact edge pose of the destination cell and is itself the next decision call.
  The cell index advances at the start of a move, the pose at the end.
- Start pose: direction table index 2: west edge midpoint of the entrance cell, heading 0 (east), facing into the maze.
- Timer: previous pass (same toolchain): `SetTimer(…, 16 ms)`, one update per `WM_TIMER`, 62.5 updates per second
  nominal; no catch-up loop; Turbo selects the 320 x 200 render only. The Windows 11 WoW64 captures measured 433-467 ms
  per 18-update move (about 24-26 ms per update), not 16 ms; the reason (timer granularity or the machine) is **U**.
- Check against the captures (D): a 1 x 1 wall straight ahead at distance 1.0 spans 540 of 1080 px at 90 degrees, as
  measured (540 px); the Start sign and smiley are 0.333 wide at 0.5, i.e. 0.33 of the frame width, measured about 0.31-0.32
  by eye on one tile of each private montage (a rough check, not a measurement series). The earlier browser fit (60 degrees, wall 0.282) reproduced only the
  wall-at-0.5 measurement because it assumed the camera stood at the cell centre.

## 6a. Update-phase table (O for the order of events, medium-high for the hand decode)

Every update call runs the update routine once. State 2 steps the camera route (0x10045e6) first; the route step decrements its
move counter, snaps the pose when the counter reaches zero, and then, in the same call, falls through to its idle branch (goal check,
choose the next move). The browser implements exactly this order (`web/src/walker.js`, `web/tests/update-phase.test.js`).

| Update call (u = a decision call) | Original | Browser event and pose | Class |
| --- | --- | --- | --- |
| u | counter is 0: idle branch. Goal check of the current cell against the goal list; if none, choose the move by the route rule, advance the cell index to the destination, set counter 18. Pose unchanged. | `transition`, move update 0, pose unchanged | O |
| u+1 to u+17 | counter 17 down to 1; one Euler integration step (straight 1/18; turn 1.5707964 x 0.027777778 then 5 degrees; reversal 10 degrees in place) | `transition`, move update 1 to 17, pose changes every call | O |
| u+18 | counter reaches 0: pose snapped to the exact entry-edge pose of the destination cell; idle branch in the same call: goal check at the new cell, then the next move is chosen | `move` (or `finish` / `roll` when a goal is found), move update 0 of the next move, pose = edge pose | O |
| exit detected (u+18 of the last move) | the route step returns the exit record; the same call selects state 3; the growth value is still 1.025 | `finish` with `moved: true`; the next update is the first shrink | O |
| exit shrink | 42 calls: growth 1.025 down to -0.025; the camera is not stepped; the 42nd sets state 0 | 42 `exiting` updates, then state `regenerate` | D |
| regenerate | state 0: growth and roll set to 0, lifecycle initialiser runs, state 1 | `regenerated` (growth 0, new maze, upright) | O |
| entrance | 41 calls: growth 0 up to 1.025; the camera is not stepped; the 41st sets state 2 | 40 `entering`, then `entered` | D |
| first decision after the entrance | the first route step: call 0 of the first move, no motion | `transition`, move update 0 | O |
| trigger touched (a decision call, u) | the route step returns the trigger record; state 4 is selected with counter 0; **no roll is added in this call** | `roll` with roll update 0, roll angle unchanged | O |
| trigger roll | 18 calls, +10 degrees each; the 18th removes the object from its cell and the goal list and normalises the angle to 0 or 180 | `roll` 1 to 17, then `twister` at 18 | O |
| after the roll | the next call is a route decision at the same cell (the goal is gone): call 0 of the next move | `transition`, move update 0 | O |

Consequences, all D: a move spans 18 calls from decision to decision (450 ms at 25 ms); the snapped pose is on screen for exactly one
call; a roll spans 19 calls from the touch to the consumption (the touch call plus 18); the detection call of the exit is also the call
that snaps into the exit cell, so no extra update separates arrival and shrink; from detection to the first decision of the next
maze there are 85 calls (1 + 42 + 1 + 41), 2.125 s at 25 ms.

Earlier browser differences, resolved by this change: the browser used to merge the decision call with the first integration step (a
one-update lead inside every move), to emit the exit one update after the snap, and to start the roll angle at the touch call.

## 7. Inferences, conflicts and unknowns

- **I** Start corresponds to resource 103 and the smiley to 104 (table order, strengthened by the captures).
- **Conflict, resolved:** the earlier browser note "the wall is straight ahead in all ten starts and exits" came from reading the
  montages as marker-on-wall. Re-reading them (private, by eye): the marker is straight ahead 20 of 20; a wall directly behind it in
  18 of 20; an open corridor behind it in 2 of 20 (start tile 7 and exit tile 7). A structure that always closes the view behind
  the marker cannot leave an open corridor there; a cell-centre billboard can. This is direct evidence for the billboard mechanism.
- **U (open, statistical tension):** 9 of the 10 sampled exit frames look like dead-end cells (wall ahead, both side walls
  closed). The browser port of the generator and route predicts about 42% (1,000 seeds), so 9 of 10 has probability near
  0.3% if independent. Candidates: a misreading of the frames, an unlucky sample, or a detail not yet recovered. More exit
  samples would settle it; this does not affect the mechanism, which does not depend on the cell's openings.
- **U** the meaning of the per-texture constants set by 0x10040ba (0.42, 0.40, 0.40), the exact x87 control word
  (the 41/42 counts hold in both precisions), why captured updates are about 25 ms, the Normal render size (needs the
  separate `control.ini` experiment, not authorised), the original texture pixels and the RNG continuity across resets.
- **U** the original's RNG continuity across mazes (the browser derives each maze's seed from the run seed, a choice).

## 8. What the browser now does, and what still differs

Implemented by default (flags off): the edge-entry camera for every run and every rat (rats start on their cell's east edge facing
west, O); the recovered Euler movement and turn path with the decision, integration and snap phases of section 6a; cubic cells (floor
0, ceiling and walls 1.0, eye 0.5); 90 degrees vertical FOV, aspect 1.0, near 0.01, far 100; the closed entrance and exit boundary
walls; the 41-update and 42-update float32 ramps; trigger solids of radius 0.25 cell resting on the floor and squashing with the
walls (O: placement record, painter scale); a brick texture mapped once per 1 x 1 wall (O: repeat count 1; D: about 2.5 bricks
across and 5 courses). The Start sign and smiley billboards are drawn only when the marker artwork flag is on; turning it off hides
only the artwork and never changes the camera, the projection or the world (`web/tests/original-camera.test.js`).

The previous capture-fitted model (60 degrees at the display aspect, wall height 0.282, cell-centre camera) was not kept: it
assumed a centre camera and matched the captures only at one distance, so it would only mislead as a comparison. It remains in the
Git history and in the fidelity table of browser-maze-generation.md as a withdrawn derivation.

Still different (each is a known difference, not a claim of parity):

1. Artwork: procedural stand-ins for the brick, floor, ceiling, Start sign and smiley textures; the sign is unlettered (C).
2. Logo and rat sprites: the original records are camera-facing quads with half sizes 1/3 x 0.33 (logo, height 0.5) and 1/4 x 1/8
   (rat, height 1/8). The browser uses both recovered sizes and keeps both sprites facing the camera without independent spin.
   Picture walls are selected with replacement; logos and rats take unused random cells from the recovered pool. Their artwork
   remains a reconstruction choice (C).
3. Solid spin axes: the browser maps the original vertical-Z then X rotations to browser vertical-Y then X (O).
4. Next-maze seeds are derived from the run seed; the original continues one time-seeded stream (C).
5. Normal-versus-Turbo size: the browser offers a 320 x 200 Turbo look and other sizes; the original's Normal size is unknown (U).
6. Update period: 25 ms per update reproduces the measured 450 ms moves on the captured machine; the original timer asks for 16 ms
   and the reason for the measured 24 to 26 ms is unknown (U).
7. Rendering state: textured geometry is unlit, textures use nearest repeating sampling without mipmaps, only trigger solids use
   positional `GL_LIGHT0`, and no atmospheric fog is enabled (O). Browser texture pixels remain replacement artwork (C).
8. The top-down debug map draws the entrance and exit as openings, as a debug view (C).
9. The sample of ten exit frames shows more dead ends than the route model predicts (section 7, U).
10. Subjective motion review was accepted by the project owner on 2026-10-23: “The motion looks correct.” Detailed browser and
    display metadata were not recorded.
11. Eye setback: the drawn eye is 0.015 cell behind the logical camera (`CAMERA_CONFIG.eyeSetback`), because the original camera stands exactly on cell edges and software rasterizers (SwiftShader) draw the surfaces that touch the camera plane flat. The two closed boundary walls are single-sided so the eye can sit behind the entrance wall at the start. No simulation, pose or telemetry value changes (C).
