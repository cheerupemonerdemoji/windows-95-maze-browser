# Release checklist: Windows 95 Maze browser reconstruction, version 0.1.0

This is a **first playable preview of a behavioural reconstruction**, not a claim of complete Windows Maze parity. Evidence classes
used throughout: O observation, D derived, I inference, C reconstruction choice, U unknown (see `docs/parity-matrix.md`).

Last updated 2026-10-27. Items marked **pending** are blocked on a named input and are never reported as done.

## 1. Status

| Gate | Status | Evidence |
| --- | --- | --- |
| Unit tests | done | `npm test`, 87 tests (2026-10-28) |
| Syntax of every module, test and tool | done | CI step `node --check` over `web/` |
| Chrome smoke checks | done | `npm run smoke`, 33 checks, locally on Windows and in CI on Linux (web-ci run 40622972548) |
| Firefox checks | done locally; **not run in CI** (reason in section 6) | `npm run smoke:firefox`, 17 checks including the Appearance tab, Firefox 159.0, 2026-10-28 |
| Visual regression | done | twelve fixed-seed views (ten Classic ones unchanged, plus Backrooms and a synthetic custom texture), `web/tests/visual-baselines/BASELINES.md`; passes on an AMD GPU and under SwiftShader |
| Appearance and themes | done | `npm run smoke:appearance`, 42 checks: uploads, rejections, IndexedDB reload, no upload requests, no file name or image data in exports, context loss, 100+ switches without leaks, semantics, sub-path loading |
| Static artifact validation | done | `npm run build` validates 12 reachable runtime files, no extra files, relative URLs only, no credentials |
| No private or Microsoft material in Git or the artifact | done | `npm run validate:repo`, run in CI and before every Pages deployment |
| Automated phone-viewport checks | done | `npm run smoke:mobile`, 79 checks over three phone profiles in both orientations, including the Appearance tab |
| GitHub Pages URL works in a clean browser | done: https://cheerupemonerdemoji.github.io/windows-95-maze-browser/, deployed from commit 25e53d7 | the `pages` workflow's `verify` job (33 smoke and 73 phone-emulation checks against the published URL) and the same checks from a fresh local Chrome profile on 2026-10-28 |
| BrowserStack real-device test | **pending**: no account or credentials | `docs/phone-acceptance.md` |
| Owner's physical-phone check | **pending**: owner answers needed | `docs/phone-acceptance.md` |
| Licence decision | **partly decided**: the owner chose the root zlib-style terms for `web/` on 2026-10-27; the copyright-holder name is still **pending** and will not be invented | `docs/license-proposal.md` |
| Human motion review | done: the owner reported "The motion looks correct." on 2026-10-23; detailed ratings were not recorded | `docs/human-motion-review.md` |
| `git diff --check` | done | clean before every commit |

## 2. Compatibility matrix

| Browser and platform | Version | Result | Date | Notes |
| --- | --- | --- | --- | --- |
| Chrome, Windows 11, AMD Radeon RX 5700 XT (ANGLE Direct3D 11) | 156.0.8078.48 | unit, smoke 33/33, visual 10/10, mobile 73/73, profile | 2026-10-27 | headless, fresh profile |
| Chrome, SwiftShader software rasteriser | 156.0.8078.48 | visual 10/10 | 2026-10-27 | what a GPU-less CI runner uses |
| Edge, Windows 11 | 155.0.4283.62 | smoke 33/33, visual against the earlier baselines | 2026-10-22 | not re-run on 2026-10-27 |
| Firefox, Windows 11 | 159.0 | 11/11 | 2026-10-27 | headless over WebDriver BiDi; reads WebGL pixels back instead of screenshots |
| Chrome on Linux (GitHub-hosted runner, SwiftShader) | 155.0.8059.39 | smoke 33/33, visual 10/10, phone emulation 73/73, and the same smoke and phone checks against the published URL | 2026-10-28 | web-ci run 40622972548, pages run 40622972536 |
| Safari on macOS and iOS | not tested | **unknown** | | no Apple device or BrowserStack account available |
| Chrome on Android | not tested on a real device | **unknown** | | emulation only |
| Browsers without WebGL 2 | tested by blocking WebGL 2 | debug map shown, first-person button disabled, no errors | 2026-10-27 | Chrome, Edge, Firefox and phone profiles |

## 3. Accessibility checklist

| Item | Status | Evidence |
| --- | --- | --- |
| Every control reachable and operable by keyboard, 16 controls in the Tab order | verified | `npm run smoke` (Tab order), `npm run smoke:firefox` |
| Visible focus on every control: 3 px solid outline | verified | smoke checks and the stylesheet |
| Touch targets of at least 44 x 44 CSS px on touch devices and small screens (including the Appearance tab; a radio or checkbox is operated through its 44 px label row) | verified in emulation | `npm run smoke:mobile` |
| Appearance tab: ARIA tabs (roving tabindex, arrow keys, Home), labelled file inputs, text alternatives for the previews, polite status and announcements for loading, rejection, success and fallback, visible 3 px focus, no focus trap | verified in Chrome and Firefox; not tested with a screen reader | `npm run smoke:appearance`, `npm run smoke:firefox` |
| Reduce motion honours the system setting and a checkbox: the view holds still, wall growth and roll are skipped, simulation timing unchanged | verified | smoke checks, phone profiles |
| The 3D image has a text alternative and the state is available as text (Live evidence panel, event log, polite live announcements) and as a top-down debug map | present; not tested with a screen reader | canvas `aria-label`, `#announcement` live region |
| Content works without WebGL 2 | verified | fallback checks |
| Colour contrast of the interface | **not measured** | |
| Scene roll (a 180 degree rotation over 18 updates when a solid is collected) and flashing | the roll is a smooth rotation, not a flash; no formal photosensitivity test was run | the original behaves the same way (O) |
| Zoom and text resizing | not tested beyond the phone viewport checks | |

## 4. Performance results

Measured on one Windows 11 desktop (Chrome 156, AMD Radeon RX 5700 XT, 144 Hz display) with `npm run profile`, 2026-10-27, 1,500 frames
with every experimental flag on (worst case):

| Metric | Result |
| --- | --- |
| Page load | 239 ms, 13 requests, 102,510 bytes transferred (91,348 bytes of script) |
| Static artifact | 17 runtime files, 415,940 bytes (102,501 before the themes): Classic users download about 133 KB; the three theme images (282,144 bytes) are fetched only when chosen |
| Geometry | 1,852 vertices, 2,778 indices (169 walls, 144 floor quads, 144 ceiling quads, picture overlays) |
| Draw calls per frame | at most 5 indexed and 10 array draws |
| Render CPU time | median under 0.1 ms, p95 0.1 ms, max 1.7 ms |
| Simulation | 39.97 updates per second against the 40 expected (25 ms step); animation frames 6.9 ms median, 7.1 ms p99 |
| Memory | heap growth about 100 to 130 bytes per frame in the profile runs (the app allocates one small options object and one pose copy per frame); no per-frame GL allocation |

Not measured: GPU time, any phone, battery or thermal behaviour, memory on a long soak (an earlier soak found constant GL object counts over 300
maze changes and 6 context-loss cycles).

Theme costs (`npm run smoke:appearance`, 2026-10-28, same machine): switching themes 15 ms median for Backrooms (fetch from cache and decode three images), 1.3 ms for
Custom, 5 ms for Classic, worst 17 ms; decoding the built-in images 14.7 ms first and 13.9 ms warm; a theme holds 3 MiB of GPU texture
memory; 102 switches left the live WebGL texture count at 9 and grew the heap 21 KB; frames stayed at 6.9 ms median before and after
selecting Backrooms; the simulation held 40 updates per second while switching.

## 5. Asset provenance, licence, acknowledgements, known differences

* Assets: `web/assets/ASSETS.md`. The Classic view ships no image files: every texture, the Start sign, the smiley, the emblem, the rat
  and the solids are generated in code and are original project artwork, not Microsoft's. The only binary files are the three optional
  Backrooms-inspired theme textures (WebP, 282,144 bytes, original images generated for this project, hashes in
  `web/assets/themes/backrooms/manifest.json`), loaded only when that theme is chosen. People's own custom images never enter the
  repository or the published files. No Microsoft asset or
  anything extracted from `ssmaze.scr` is in Git or in the published artifact; `npm run validate:repo` and the artifact validator fail the
  build if such files appear.
* Licence: `docs/license-proposal.md` (terms decided, holder name pending).
* Acknowledgements: README (ultitech's GLMaze, whose structure and tests inspired the project) and `docs/browser-maze-generation.md`.
* Known differences from the original and every unknown: `docs/original-exit-camera-analysis.md` section 8 and `docs/parity-matrix.md`.
  Headline items: replacement artwork, browser-derived maze-to-maze seeds, the original's Normal render size and 25 ms versus 16 ms timer
  pacing are unknown, and the rendering is checked against captures only at the points recorded in `docs/browser-maze-generation.md`.

## 6. Why Firefox is a local check

`npm run smoke:firefox` starts a headless Firefox with a fresh profile and drives it over WebDriver BiDi. It was written and verified on
the owner's Windows machine (Firefox 158 and 159). A GitHub-hosted run would need the runner's Firefox build, its BiDi support and its
sandbox behaviour to match, none of which has been verified, and a flaky check that is allowed to fail would only hide real failures.
Run it locally before each release: `npm run smoke:firefox`.

## 7. Release steps

1. `npm test`, `npm run validate:repo`, `npm run build`, `npm run smoke`, `npm run visual`, `npm run smoke:mobile`, `npm run smoke:firefox`.
2. `git diff --check`.
3. Push to the release branch (`main` of the `fork` remote; never to `origin`, which is upstream); the `web-ci` workflow runs the same checks on Linux and the `pages` workflow deploys.
4. Read the `verify` job (smoke and mobile checks against the published URL), then open the URL on a phone and fill in
   `docs/phone-acceptance.md`.
5. Record the URL and deployment commit in `docs/release-notes.md`.
