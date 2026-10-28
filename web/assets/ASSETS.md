# Web assets

The Classic view ships **no image, texture, font or binary assets**: everything shown in the first-person view is generated in
code. The only binary files are the three optional Backrooms-inspired theme textures listed under "Optional theme" below; they are
loaded only when a person chooses that theme.

| Asset | Origin | Source module | Notes |
| --- | --- | --- | --- |
| Wall texture (red brick) | Original procedural asset | `web/src/procedural-textures.js` → `createBrickTexture` | Hash-noise pixel math; 128×128 RGBA8 |
| Floor texture (brown wood grain) | Original procedural asset | `web/src/procedural-textures.js` → `createWoodTexture` | 128×128 RGBA8 |
| Ceiling texture (grey stipple) | Original procedural asset | `web/src/procedural-textures.js` → `createStippleTexture` | 128×128 RGBA8 |
| Entrance sign (green panel, chevron, bars; no lettering) | Original procedural asset | `web/src/procedural-textures.js` → `createStartSignTexture` | 192×64; shown only when the experimental markers flag is on |
| Exit smiley (yellow disc, eyes, smile) | Original procedural asset | `web/src/procedural-textures.js` → `createSmileyTexture` | 64×64; experimental flag |
| Picture wall (sky, sun, hills, tree, frame) | Original procedural asset | `web/src/procedural-textures.js` → `createPictureTexture` | 128×128; experimental flag |
| Logo object (multicolour ring emblem, no lettering) | Original procedural asset | `web/src/procedural-textures.js` → `createEmblemTexture` | 64×64 RGBA with cut-out; experimental flag |
| Rat sprite (grey silhouette) | Original procedural asset | `web/src/procedural-textures.js` → `createRatTexture` | 64×32 RGBA with cut-out; experimental flag |
| Trigger solids (white icosahedron, octahedron, dodecahedron, tetrahedron) | Original generated geometry | `web/src/solids.js` | Regular polyhedra computed from their vertices; flat shaded; white 2x2 texture from `createWhiteTexture` in `web/src/procedural-textures.js` |

Their appearance is a reconstruction choice, not derived from Microsoft's Maze
textures. No Microsoft asset, and nothing extracted from `ssmaze.scr`, is used.

The native `res/Textures` files are deliberately **not** copied into `web/`:
`wall.jpg` has no clear attribution in `res/Textures/LICENSE.TXT`.

## Optional theme: Backrooms-inspired textures

Three images in `web/assets/themes/backrooms/` (wall wallpaper, floor carpet, ceiling tile with fluorescent panels). They were
**generated specifically for this project without reference images**; they use **no Microsoft artwork**, contain **no copied
Backrooms photography or other third-party imagery**, and are an **optional presentation choice** (the Classic procedural textures
stay the faithful default). They add no Microsoft Maze evidence. The generated source images stay outside the repository and were
not modified.

| Runtime file | Source (outside Git) | Transformation | Final | SHA-256 of the runtime file |
| --- | --- | --- | --- | --- |
| `wall.webp` | `backrooms-wallpaper.png`, 1254 x 1254 RGB, 2,875,743 bytes, SHA-256 `e99ce8a8…cbf3` | cropped to a 1226 px square (offset 24, 12) chosen for the best edge match, mirror cross-fade over 8% at the seams, Lanczos resize | 512 x 512, WebP (quality 92), 65,220 bytes | `1b536b694def7fe300acafc9d9012b6d76f437e0685564718671f7807a2ea7a7` |
| `floor.webp` | `backrooms-carpet.png`, 1254 x 1254 RGB, 3,903,689 bytes, SHA-256 `4fde65dc…63f2` | full image (no crop improved the edge match), mirror cross-fade over 8% at the seams, Lanczos resize | 512 x 512, WebP (quality 92), 133,392 bytes | `23b414056c7f1078577eab45a3521d189fc0c10077c298713957949e3c4e670c` |
| `ceiling.webp` | `backrooms-ceiling.png`, 1254 x 1254 RGB, 3,067,039 bytes, SHA-256 `9873ae99…3305` | cropped to a 1226 px square (offset 12, 0), mirror cross-fade over 8% at the seams, Lanczos resize | 512 x 512, WebP (quality 92), 83,532 bytes | `c1192a2280fe3f3aec3229c427bf50347d6c23d96664ee361df404c281e5a9b9` |

Why this format and size: WebP at quality 92 measured 46 dB PSNR against the lossless 512 px PNG (visually lossless) at 282,144 bytes in
total, against 1,477,398 bytes for the PNGs and about 9.8 MB for the sources. 512 px is as large as one wall appears on screen, so the
repeated nearest-neighbour sampling keeps its detail. Seam measure (mean edge difference divided by the mean difference of neighbouring
lines; 1.0 means the edge looks like any other line): source 1.39 / 1.91 / 1.37, best crop 1.02 / 1.91 / 1.08, runtime copy 0.04 / 0.07 /
0.04 after the cross-fade (below 1 because the blend smooths the seam). Reproduce with `node web/tools/prepare-textures.mjs <source dir>
web/assets/themes/backrooms --size 512 --format webp --report web/assets/themes/backrooms/manifest.json` (needs ffmpeg).
`manifest.json` lists the exact numbers; the packaging check refuses any published image whose SHA-256 is not in it.

### Custom textures (people's own images)

Never part of the repository or the published files. Selected in the Appearance tab, decoded in the page, resized to 512 x 512 and
kept only in the visitor's browser (IndexedDB). See `docs/browser-maze-generation.md`, "Appearance themes".
