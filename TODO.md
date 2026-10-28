# Windows 95 Maze — Browser Reconstruction

This checklist tracks a clean, browser-native reconstruction inspired by the
Windows 95 3D Maze screensaver. The existing GLMaze source is a behavioral and
architectural reference; the browser version should not depend on the native
SDL/OpenGL executable.

## 1. Define the target

- [x] Document the minimum faithful experience: generated maze, automatic
      first-person movement, textured walls/floor/ceiling, and periodic resets.
- [x] Decide which optional scenes and effects belong in the first release
      (start/finish markers, rats, floating shapes, open areas, and inverted
      gravity).
- [x] Define supported browsers, mobile expectations, performance targets, and
      accessibility requirements.
- [x] Record the legal and provenance rules: use original assets only when their
      license permits it; otherwise create new replacements and retain attribution.

## 2. Gather evidence

- [x] Inventory GLMaze's maze generation, walker, camera, rendering, resource,
      and reset behavior (`docs/browser-maze-generation.md`, "Direct observations from GLMaze").
- [x] Capture reference runs with fixed seeds and note observable timing,
      movement, turns, intersections, dead ends, and reset conditions
      (`docs/browser-maze-generation.md`, "Native repeatability"; browser telemetry export
      `npm run telemetry`).
- [x] If a lawful copy of `ssmaze.scr` is available, analyze it with REA's
      read-only Windows/Ghidra workflow (`docs/original-exit-camera-analysis.md`; the
      binary and all extracted material stay outside Git).
- [x] Keep direct observations, derived facts, analyst inferences, and unknowns
      in separate sections of the research notes (O/D/I/C/U labels in the evidence
      matrix and the analysis dossier).
- [x] Create a feature comparison matrix for Windows 95 Maze, GLMaze, and the
      browser reconstruction (`docs/parity-matrix.md`).

## 3. Bootstrap the web application

- [x] Choose and document the browser stack, build tool, renderer, and test
      framework (dependency-free static ESM, WebGL 2, Node's built-in test runner; there
      is deliberately no bundler, so the verified static artifact is the build output).
- [ ] Create the application entry point, development server, production build,
      formatting, linting, and type-checking commands. Partial: entry point
      (`web/index.html`), development server (`npm start`) and syntax check
      (`node --check`) exist, and `npm run build` produces and validates the static
      artifact (the whole production build); no formatter, linter or type checker is
      configured.
- [x] Add a responsive full-window canvas with resize and device-pixel-ratio
      handling.
- [x] Add a deterministic seeded random-number generator and a debug seed input.
- [x] Establish asset folders and an asset-license manifest (`web/assets/ASSETS.md`).

## 4. Build the simulation core

- [x] Port or independently implement maze generation as renderer-independent
      code.
- [ ] Represent cells, walls, passages, special tiles, spawn points, and exits
      with explicit types. Partial: they are documented plain objects validated at
      run time; there are no type definitions.
- [x] Validate generated mazes for reachability, bounds, and deterministic output.
- [x] Implement the automatic walker, including intersection choices, turning,
      collision avoidance, dead-end recovery, and movement timing.
- [x] Implement camera position, heading, pitch, eye height, and smooth turn
      interpolation (recovered edge-entry camera and Euler turn path; the original has
      no pitch).
- [x] Define reset triggers and ensure every run can restart without leaking
      graphics or event resources.

## 5. Reconstruct the look

- [x] Render walls, floor, and ceiling with correct face orientation and texture
      coordinates (`web/tests/webgl-geometry.test.js`).
- [x] Match the original field of view, camera height, corridor proportions, camera path
      and update phase (recovered from the original, adopted 2026-10-22).
- [x] Match the original lighting, texture filtering and movement speed as closely as
      evidence allows (the original looks flat and unfogged; speed is 450 ms per move here).
- [x] Create or source redistributable wall, floor, and ceiling textures.
- [x] Confirm fog behavior: the analysed original does not enable atmospheric
      fog, so the faithful Normal view intentionally leaves it off.
- [x] Add special objects and their behaviors one at a time, with evidence notes
      and feature flags (trigger solids, picture walls, logos, rats, marker artwork).
- [x] Add an optional retro presentation mode without making it a requirement for
      correct simulation behavior (the Turbo 320 x 200 look).

## 6. Add browser controls and resilience

- [x] Start animation only after an explicit user action when browser policy
      requires it (the run starts paused; Play starts it).
- [x] Provide pause/resume, regenerate, seed, quality, volume, fullscreen, and
      reduced-motion controls where applicable (volume is not applicable: there is
      no audio).
- [x] Pause or reduce work while the page is hidden and recover cleanly after
      WebGL context loss.
- [x] Support keyboard operation and visible focus states for every control.
- [x] Provide a useful fallback when WebGL is unavailable.
- [x] Keep settings in the URL or local storage without collecting personal data.

## 7. Test and compare

- [x] Unit-test seeded generation, connectivity, walker decisions, collision
      handling, resets, and settings serialization.
- [x] Add deterministic simulation tests that run without a graphics context.
- [x] Add browser smoke tests for startup, resize, pause, fullscreen, regeneration,
      and context restoration (Chrome and Edge over the DevTools protocol, Firefox over
      WebDriver BiDi).
- [ ] Capture visual-regression images at fixed seeds and viewport sizes. Partial: ten
      fixed-seed views at one desktop viewport (`web/tests/visual-baselines/BASELINES.md`);
      mobile viewport images are not captured.
- [x] Compare representative browser runs against the evidence matrix and label
      any intentional differences (`docs/parity-matrix.md`).
- [ ] Profile startup, frame time, memory, draw calls, and asset size on target
      desktop and mobile hardware. Partial: desktop profile only (`npm run profile`);
      no physical-phone measurement yet (`docs/phone-acceptance.md`).

## 8. Document and release

- [x] Add browser development, test, build, and deployment instructions to the
      README.
- [ ] Document controls, configuration, known differences, evidence confidence,
      licenses, and acknowledgements. Partial: all but the final licence text, which
      waits for the owner's copyright-holder decision (`docs/license-proposal.md`).
- [x] Add continuous integration for checks, tests, and a production build
      (`.github/workflows/web-ci.yml`: Node 20 and 22 unit tests, syntax, repository and
      artifact checks; Chrome smoke, visual and phone-emulation checks on Linux;
      Firefox stays a documented local check).
- [x] Publish a static preview and verify it from a clean browser session
      (https://cheerupemonerdemoji.github.io/windows-95-maze-browser/; the `pages` workflow
      deploys it and re-runs the smoke and phone checks against the published URL).
- [ ] Complete a release checklist covering accessibility, compatibility,
      performance, asset provenance, and license notices. Partial
      (`docs/release-checklist.md`): pending the owner's physical-phone answers, a
      BrowserStack run and the copyright-holder name.

## Definition of done for the first playable release

- [ ] A visitor can open the page and immediately start a deterministic,
      automatically navigated 3D maze run. Partial: one press of Play starts it (browsers
      require a user action); confirmed on desktop and in phone emulation, not yet on a
      physical phone.
- [x] The maze is always traversable, movement does not cross walls, and resets
      work repeatedly without reloading the page (unit tests over many seeds and 30
      consecutive resets).
- [ ] The experience remains smooth at the documented target resolution and
      hardware tier. Partial: the desktop profile meets the target; no phone has been
      measured.
- [x] Tests and production builds pass in continuous integration (GitHub Actions on
      the `fork` remote, run 40622972548 on commit 25e53d7).
- [ ] All shipped assets and borrowed code have compatible licenses and recorded
      attribution. Partial: the assets are all original procedural artwork and
      attributed; the browser copyright-holder name is still pending.
- [x] Differences from observed Windows 95 Maze behavior are documented rather
      than presented as verified facts (`docs/original-exit-camera-analysis.md`
      section 8 and `docs/parity-matrix.md`).
