# Phone acceptance (owner's physical-phone check)

**Status: pending.** Nothing on this page has been answered by a person holding a phone. Desktop emulation is *not* a physical-phone
test and is recorded separately below. Please fill in the table after opening the published page on a real phone.

Published page: **https://cheerupemonerdemoji.github.io/windows-95-maze-browser/** (the same URL for every device; use a fresh private tab).

## How to run the check (about 7 minutes)

1. Open the page in a private or incognito tab. Note the device, OS version, browser and browser version.
2. Do not touch anything for a few seconds, then press **Play**. Watch the first maze (walls grow, the camera walks, turns and
   reverses in dead ends). Add `?seed=2017` to the address to get the same run as the desktop review.
3. Press **Fullscreen** (it is expected to be greyed out on iPhone: Safari on iPhone does not offer the Fullscreen API for pages).
4. Rotate the phone to landscape and back while playing.
5. Leave it playing for five minutes with the screen on. Note whether the phone becomes warm and the battery percentage used.
6. Try Pause, Generate, the Render quality list (High, Standard, Turbo look) and the Reduce motion checkbox.

## Owner answers (all pending)

| Question | Answer |
| --- | --- |
| Device and OS version | pending |
| Browser and version | pending |
| Page loads without an error | pending |
| Play works (the maze animates after one tap) | pending |
| Fullscreen result (works / greyed out / error) | pending |
| Motion smoothness (stutter, jumps, tearing; High and Turbo) | pending |
| Controls fit the screen and are comfortable to tap | pending |
| Orientation change (layout, canvas size, run continues) | pending |
| Heat or battery concern after five minutes (warm? percent used?) | pending |
| Visual artefacts (flat-coloured walls, flicker, black areas other than the void above the shrinking walls) | pending |

## Evidence recorded so far (none of it is a physical phone)

| Check | Status | Where |
| --- | --- | --- |
| Desktop Chrome emulation of iPhone 16 (393 x 852, DPR 3), iPhone SE (375 x 667, DPR 2) and Pixel 9 (412 x 915, DPR 2.625), portrait and landscape, touch on: layout, no horizontal overflow, canvas resize on rotation, 44 px touch targets, Play and Pause, Generate, two exits and regenerations, reduce-motion from the system setting, fullscreen availability, WebGL 2 fallback | automated, 73 checks passing on 2026-10-27 | `npm run smoke:mobile` (`web/tests/smoke/mobile.mjs`); also run against the published URL after each deployment |
| Real iPhone and Android devices through BrowserStack | **pending**: no BrowserStack account or credentials were available to the assistant on 2026-10-27. If an account is created, store the username and access key only as GitHub repository secrets (`BROWSERSTACK_USERNAME`, `BROWSERSTACK_ACCESS_KEY`), never in files, and test Mobile Safari on a recent iPhone and Chrome on a recent Pixel or Samsung device against the published URL | not run |
| Mobile GPU behaviour | unknown: the visual baselines were taken on a desktop AMD GPU and checked against Chrome's software rasteriser; no phone GPU has been tried | pending |

Known emulation limits: it cannot show touch latency, the on-screen keyboard, real Safari behaviour, thermal throttling or mobile GPU
rendering differences.
