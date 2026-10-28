# Parity matrix: Microsoft specimen, native GLMaze and the browser

Sources: **Microsoft specimen** = static analysis of `ssmaze.scr` (NT 4.0 version 4.00) plus two Windows 11 WoW64
captures; **native GLMaze** = the comparison recorded in the private analysis report dated 2026-10-21 (not
re-verified in this pass); **browser** = this repository. Classes: O observation, D derived, I inference, C browser
choice, U unknown. Rows written before 2026-10-22 and not rewritten use D for direct observation and M for derived; read them as O and D.

| Feature | Microsoft specimen | Native GLMaze | Browser now | Parity |
| --- | --- | --- | --- | --- |
| Maze | 12x12 randomized Kruskal (D) | 10x10 recursive depth-first | 12x12 Kruskal with recovered edge order | match |
| Random stream | Microsoft CRT LCG, 10-value warm-up (D) | platform `rand()` | Microsoft LCG (default), portable debug mode | match for numeric seeds |
| Entrance and exit | random rows on opposite sides (D) | fixed corners | random rows on opposite sides | match |
| Route rule | per-route left or right priority, 501/1000 (D) | always right | recovered | behavioural match |
| Movement | 18 updates per move, turn or reversal: a decision call, 17 Euler integration calls, a snap that is the next decision call (O, hand decode); about 440-460 ms measured on Windows 11 (D) | 1 s interpolation | the same phases and constants; 25 ms x 18 = 450 ms (C from M) | update phase and path match; pace matches on the captured machine |
| Camera | 90 degrees vertical, aspect 1.0 (stretched to the window), near 0.01, far 100, eye at z 0.5; the camera stands on the midpoint of the edge it entered the cell by (O, static analysis 2026-10-22; replaces the earlier 60 degree fit) | n/a | the same, by default, for every run | match (artwork aside) |
| Proportions | cubic cells: floor z 0, ceiling z 1.0, walls 0 to the growth value (O); brick texture once per wall (O) | n/a | cubic cells, brick mapped once per wall (about 2.5 bricks x 5 courses, D) | match; the measured 540 px wall straight ahead is reproduced (540 of 1080 px) |
| Render size | 320x200 buffer in the captures (D) | window size | Turbo look option, other levels (C) | optional |
| Trigger solids | 0-8, four solids, white, radius 0.25 at height 0.25, vertical-Z then X spin, 19-update touch-to-consumption roll (touch call plus 18 roll calls), consumed (O) | exactly 10 pyramids | same counts, shapes, radius, height, spin axes and roll phase | match; solid artwork/lighting remains an approximation |
| Exit and reset | 42 + 1 + 41 updates from the float32 ramp (D); exit detected in the snap call, camera still on the exit cell's entry edge (O); next maze in the very next frame, upright, walls growing (O) | 2 s collapse, 2 s growth | the same sequence, tested update by update | match (captures cannot separate 40 from 41/42) |
| Start and exit markers | one each: camera-facing billboards at the entrance and exit cell centres, eye height, half-size 1/6 x 0.166, scaled with the wall growth (O); straight ahead 0.5 from the entry-edge camera at the start and the exit (D) | none | the same billboards (procedural stand-ins), shown only with the experimental artwork flag; hiding them never changes the camera or the world | mechanism matches; artwork differs |
| Picture walls, logo objects, rats | 1-5 picture-wall draws with replacement; 0-3 logos and RatCount rats on unused cells; logo and rat are camera-facing quads sized 0.667 x 0.66 at height 0.5 and 0.5 x 0.25 at height 0.125 (O) | none | recovered placement and billboard behavior behind experimental flags | behavior matches; replacement artwork differs |
| Lighting, filtering and fog | nearest repeating textures without mipmaps; textured geometry unlit; positional light on solids; no fog (O) | shader effects | same Normal-mode rendering state | match apart from replacement texture pixels |
| Screensaver modes | `/c`, `/s`, `/p` and others (D) | `/c`, `/p`, `/s` partial | not applicable | n/a |
