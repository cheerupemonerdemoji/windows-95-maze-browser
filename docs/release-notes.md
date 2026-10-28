# Release notes: browser reconstruction 0.1.0 (first playable preview)

Published page: **https://cheerupemonerdemoji.github.io/windows-95-maze-browser/**
Deployed commit: `25e53d79169fa598d7c5a30f6d731c3c16533ff8` on 2026-10-28 (repository `cheerupemonerdemoji/windows-95-maze-browser`, branch `main`;
the `pages` run 40622972536 built, deployed and verified it, and the same checks were re-run from a fresh local browser profile).
Later commits that change only documentation do not redeploy the page.

A first-person, automatically navigated 3D maze in the browser, reconstructed from the behaviour of the Windows NT 4.0 OpenGL Maze
screensaver as recovered by static analysis and Windows 11 captures. It is **not** a claim of complete parity: replacement artwork is used
and several details are unknown (see below).

## What you get

* A 12 x 12 randomized-Kruskal maze, the original's random stream (selectable) and a debug seed; the same seed always gives the same run.
* Automatic walking with the recovered camera: the camera stands on the midpoint of the edge it entered a cell by, turns 5 degrees per
  update, reverses 10 degrees per update in dead ends, and every move takes 18 updates (450 ms at the 25 ms browser step).
* The recovered projection and world: cubic cells, 90 degree vertical field of view at aspect 1.0, walls that grow and shrink at the
  entrance and exit, closed boundary walls, then a new maze without reloading.
* Trigger solids (four regular polyhedra) that roll the scene 180 degrees and are consumed; experimental flags for the Start and exit marker
  artwork, picture walls, logo objects and a rat.
* Controls: Play and Pause, Step, Generate, seed, random generator, render quality (High, Standard, Turbo look at 320 x 200),
  Reduce motion, first-person view or top-down debug map, Fullscreen where the browser offers it, and an evidence JSON export.
* Works without WebGL 2 (debug map), after WebGL context loss, and on phone-sized screens with 44 px touch targets.

## Appearance and themes (added after 0.1.0 was published)

An Appearance tab chooses the textures. **Classic** (the procedural textures) stays the faithful default. **Backrooms-inspired** is an
optional theme of three original images generated for this project (no Microsoft artwork, no copied Backrooms photography), loaded only
when chosen (282 KB). **Custom** lets people pick their own wall, floor and ceiling images (PNG, JPEG or WebP, up to 10 MB and 4096
pixels); images stay in the browser, are never uploaded, and a resized copy is kept in IndexedDB until "Clear stored images" is used.
Custom pictures show seams unless they are seamless squares. Themes are presentation only: they change nothing about the maze,
timing or camera and add no Microsoft Maze evidence.

## Verified

Unit tests, desktop smoke checks, ten visual-regression views, phone-viewport emulation and a static-artifact check run in CI; the same
smoke and phone checks run against the published URL after each deployment. Firefox is checked locally. Details and dates:
`docs/release-checklist.md`.

## Not verified or pending

* Real phones: BrowserStack testing is **pending** (no account) and the owner's physical-phone check is **pending**
  (`docs/phone-acceptance.md`). Emulation is not a phone.
* Safari on macOS and iOS and Chrome on Android hardware have not been run.
* The copyright-holder name for the browser code is **pending**; the zlib-style terms were chosen on 2026-10-27
  (`docs/license-proposal.md`).

## Known differences and unknowns

All of them are listed in `docs/original-exit-camera-analysis.md` section 8; the main ones:

* Textures, the Start sign and the smiley are original procedural stand-ins, not Microsoft's artwork (labelled as such in
  `web/assets/ASSETS.md`).
* Next-maze seeds are derived from the run seed; the original continues one time-seeded stream (reconstruction choice).
* The original's Normal-mode render size and the reason its captured pace is about 25 ms per update rather than the timer's 16 ms are
  unknown.
* The eye is drawn 0.015 cell behind the logical camera so software renderers draw every surface correctly (reconstruction choice).
* Ten sampled exit frames show more dead-end exit cells than the route model predicts (unexplained).

## Security and privacy

No accounts, cookies or network requests beyond loading the page; settings stay in the URL and the browser's local storage. The build
fails if any private evidence file, Microsoft binary or credential-like string is tracked or present in the published files.
