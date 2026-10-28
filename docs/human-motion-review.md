# Human motion review (completed 2026-10-23)

Automated checks confirm the 25 ms x 18 update cadence, the update phase and that the pose is continuous. On 2026-10-23 the project
owner watched the visible browser build and reported: **“The motion looks correct.”** This closes the subjective motion item. Browser
version, display refresh rate and separate ratings for cadence, smoothness, similarity, roll and reset were not recorded, so this is
a human acceptance observation rather than a new numerical measurement. Since 2026-10-22 the browser uses the recovered original camera by default (the camera
stands on the cell edge, 90 degree vertical FOV stretched to the window, cubic cells), so earlier impressions of the capture-fitted
view no longer apply.

Setup: open `http://127.0.0.1:8080/?seed=2017&rng=microsoft` (run `npm start` first) in a normal visible Chrome, Edge or Firefox
window, leave Reduce motion off and quality on High, then press Play. Seed 2017 shows every case within about 15 seconds:

| Time after Play | What to watch |
| --- | --- |
| 0-1 s | the walls grow up from the floor (observed in the original) |
| after 1.1 s | straight moves and quarter turns, each 18 updates (about 450 ms) |
| about 3.3 s | trigger solid: the camera waits for one update, then the scene rolls 180 degrees over 18 updates |
| about 6.5 s | dead-end reversal (a 180 degree turn in place) |
| about 10 s | the exit: the walls shrink for about 1 s with the camera still (observed in the original), then a new maze appears at once and its walls grow for about 1 s |

For any future repeat review, record the browser and version, display refresh rate, quality, and answer separately:

1. Cadence: does one move or turn take about half a second? (measured value: 450 ms)
2. Smoothness: any stutter, jump, wall clip or corner flash?
3. Similarity to the original: if you run the original screensaver yourself, is the pace and turn feel similar? (the original
   measured 440-460 ms per move on Windows 11)
4. Roll direction and reset look (both are reconstruction choices).

The 2026-10-23 statement is the recorded human decision. A future reviewer can use the questions above for a more detailed pass.

Optional second pass: repeat the first 15 seconds with `&markers=1` added to the address. This adds the experimental Start sign and
smiley artwork (procedural stand-ins) in front of the camera at the start and at the exit; the camera, the projection and the world
do not change. Please add a fifth answer: do the start and the exit view look like the original (sign or smiley in front of the camera,
squashing with the walls)? The optional marker-artwork comparison remains separate from motion acceptance.
