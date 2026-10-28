import test from "node:test";
import assert from "node:assert/strict";
import { CAMERA_CONFIG, LIGHT_CONFIG, OBJECT_CONFIG, SPRITE_CONFIG, billboardAngle, composeModel, scaleHeight, wallGrowthMatrix } from "../src/webgl-renderer.js";
import { WORLD, markerBillboards } from "../src/webgl-geometry.js";
import { generateMaze } from "../src/maze.js";

// The projection and the world are the constants recovered from the original scene renderer (0x100203e, 0x1001e88,
// 0x1001922): 90 degrees vertical, aspect 1.0, near 0.01, far 100, eye at z 0.5, floor z 0, ceiling z 1.0, walls 0 to the
// growth value. The checks below compare what those constants predict with numbers measured from private Windows 11 WoW64
// captures of the original (the captures stay outside Git; only the measured numbers are recorded here).
//   measured: 36 turn starts, 21 of them facing a wall: the wall band is 62-68 px of the 135 px frame (modal 66,
//     fraction 0.489); floor and ceiling edges sit within 1-2 px of symmetric about the horizon.
//   measured: a 5 degree update pans the 240 px wide frame by 10.25 px (render buffer 320 x 200, 6 px blocks at 1920).
//   measured by eye on one tile of each montage: the Start sign and the smiley are about 0.31-0.32 of the frame width.
// They show agreement with the measurements, not proof that the original used these exact numbers.

const MEASURED = { wallFraction: 0.489, panPxPerFiveDegrees: 10.25, frameWidth: 240, renderWidth: 320, renderHeight: 200, markerWidthFraction: 0.315 };

test("the projection and world constants are the recovered ones", () => {
  assert.equal(CAMERA_CONFIG.fovYDegrees, 90);
  assert.equal(CAMERA_CONFIG.aspect, 1);
  assert.equal(CAMERA_CONFIG.near, 0.01);
  assert.equal(CAMERA_CONFIG.far, 100);
  assert.deepEqual({ ...WORLD }, { floorY: 0, wallHeight: 1, ceilingY: 1 });
  assert.equal(CAMERA_CONFIG.eyeHeight, 0.5);
  assert.deepEqual([...CAMERA_CONFIG.turboSize], [MEASURED.renderWidth, MEASURED.renderHeight]);
});

test("Normal rendering uses the recovered fixed-function light and no atmospheric fog", () => {
  assert.deepEqual({ ...LIGHT_CONFIG }, { ambient: 0.04, diffuse: 0.8, position: [6, 10, 6], fog: false });
});

test("trigger rotations map original vertical Z rotation to browser Y, followed by original X", () => {
  const out = new Float32Array(16);
  const transform = (m, x, y, z) => [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ].map((v) => Math.abs(v) < 1e-6 ? 0 : Math.round(v * 1e6) / 1e6);
  composeModel(out, 0, 0, 0, Math.PI / 2, 0, 1);
  assert.deepEqual(transform(out, 1, 0, 0), [0, 0, -1], "vertical spin is around browser Y");
  composeModel(out, 0, 0, 0, 0, Math.PI / 2, 1);
  assert.deepEqual(transform(out, 0, 1, 0), [0, 0, 1], "second spin is around browser X");
  assert.deepEqual(transform(out, 0, 0, 1), [0, -1, 0]);
});

test("a wall straight ahead at the end of the cell fills the measured fraction of the frame height", () => {
  const halfFov = (CAMERA_CONFIG.fovYDegrees * Math.PI) / 360;
  const distance = 1; // the camera stands on the entry edge, the far wall is one cell away
  const fraction = WORLD.wallHeight / distance / (2 * Math.tan(halfFov));
  assert.ok(Math.abs(fraction - 0.5) < 1e-12, "540 of 1080 px");
  assert.ok(Math.abs(fraction - MEASURED.wallFraction) < 0.015, `predicted ${fraction}, measured ${MEASURED.wallFraction}`);
});

test("the drawn eye is set back just past the near plane so surfaces touching the camera plane render on software rasterizers", () => {
  assert.ok(CAMERA_CONFIG.eyeSetback > CAMERA_CONFIG.near, "every vertex that touches the camera plane stays beyond the near plane");
  assert.ok(CAMERA_CONFIG.eyeSetback <= 0.02, "a shift of at most 2% of a cell (a reconstruction choice, not an original value)");
});

test("eye height is mid wall height, matching the symmetric floor and ceiling edges", () => {
  assert.ok(Math.abs(CAMERA_CONFIG.eyeHeight - (WORLD.floorY + WORLD.ceilingY) / 2) < 1e-12);
});

test("a 5 degree update pans a 320-column render by the measured 10.25 px of a 240 px frame, within 3%", () => {
  // gluPerspective: x focal length in render pixels = (width / 2) / (aspect * tan(fovY / 2)) = 160 for aspect 1, 90 degrees.
  const halfFov = (CAMERA_CONFIG.fovYDegrees * Math.PI) / 360;
  const focalX = MEASURED.renderWidth / 2 / (CAMERA_CONFIG.aspect * Math.tan(halfFov));
  assert.ok(Math.abs(focalX - 160) < 1e-9);
  const panFrame = (focalX * Math.tan((5 * Math.PI) / 180) * MEASURED.frameWidth) / MEASURED.renderWidth;
  assert.ok(Math.abs(panFrame - MEASURED.panPxPerFiveDegrees) / MEASURED.panPxPerFiveDegrees < 0.03, `pan ${panFrame.toFixed(2)}`);
});

test("a marker billboard half a cell ahead spans about the measured third of the frame width", () => {
  const [sign] = markerBillboards(generateMaze({ seed: 1 }));
  const halfFov = (CAMERA_CONFIG.fovYDegrees * Math.PI) / 360;
  const fraction = sign.width / 0.5 / (2 * CAMERA_CONFIG.aspect * Math.tan(halfFov));
  assert.ok(Math.abs(fraction - 1 / 3) < 1e-6);
  assert.ok(Math.abs(fraction - MEASURED.markerWidthFraction) < 0.03, `predicted ${fraction.toFixed(3)}`);
});

test("trigger solids use the recovered 0.25 cell radius, rest on the floor and squash with the walls", () => {
  assert.deepEqual({ ...OBJECT_CONFIG }, { radius: 0.25, height: 0.25 });
  const model = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 0.25, 4, 1]);
  scaleHeight(model, 0.5);
  assert.equal(model[5], 0.5);
  assert.equal(model[13], 0.125, "centre height scales with the growth value");
  assert.equal(model[0], 1);
  assert.equal(model[12], 3);
});

test("the rat billboard uses the recovered half-cell by quarter-cell size", () => {
  assert.deepEqual({ ...SPRITE_CONFIG.rat }, { width: 0.5, height: 0.25 });
  assert.equal(SPRITE_CONFIG.rat.height / 2, 0.125, "rat centre is one eighth of a cell above the floor");
});

test("the logo uses the recovered size and billboards toward the camera without an independent spin", () => {
  assert.deepEqual({ ...SPRITE_CONFIG.logo }, { width: 2 / 3, height: 0.66, y: 0.5 });
  assert.equal(billboardAngle(0, 1, 0, 0), 0);
  assert.equal(billboardAngle(1, 0, 0, 0), Math.PI / 2);
  assert.equal(billboardAngle(-1, 0, 0, 0), -Math.PI / 2);
});

test("the entrance transition scales wall height about the floor and leaves width and depth alone", () => {
  const out = new Float32Array(16);
  for (const growth of [0, 0.025, 0.5, 1]) {
    wallGrowthMatrix(out, growth);
    assert.equal(out[0], 1);
    assert.equal(out[10], 1);
    assert.equal(out[15], 1);
    assert.ok(Math.abs(out[5] - growth) < 1e-6, "float32 precision");
    assert.ok([1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14].every((i) => out[i] === 0), "no shear or translation");
  }
  assert.equal(wallGrowthMatrix(out, 3)[5], 1, "clamped above (the raw overshoot to 1.025 is hidden by the ceiling)");
  assert.equal(wallGrowthMatrix(out, -1)[5], 0, "clamped below");
});
