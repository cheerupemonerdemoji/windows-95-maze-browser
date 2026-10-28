# Web assets

The browser build ships **no image, texture, font or binary assets**. Everything
shown in the first-person view is generated in code.

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
