import test from "node:test";
import assert from "node:assert/strict";
import { TWISTER_SHAPES } from "../src/maze.js";
import { buildSolids } from "../src/solids.js";

const TRIANGLES = { icosahedron: 20, octahedron: 8, dodecahedron: 36, tetrahedron: 4 };

test("trigger solids are the four recovered Platonic solids with outward-facing flat faces", () => {
  const solids = buildSolids();
  assert.deepEqual(solids.ranges.map((r) => r.name), [...TWISTER_SHAPES]);
  assert.ok(solids.positions.every(Number.isFinite) && solids.normals.every(Number.isFinite));
  for (const range of solids.ranges) {
    assert.equal(range.count / 3, TRIANGLES[range.name], range.name);
    for (let t = 0; t < range.count / 3; t += 1) {
      const i = (range.first + t * 3) * 3;
      const a = solids.positions.subarray(i, i + 3);
      const b = solids.positions.subarray(i + 3, i + 6);
      const c = solids.positions.subarray(i + 6, i + 9);
      const n = solids.normals.subarray(i, i + 3);
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      assert.ok(cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 1e-9, "winding agrees with normal");
      assert.ok(a[0] * n[0] + a[1] * n[1] + a[2] * n[2] > 0, "normal points away from the centre");
      assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-6);
    }
    // Every vertex lies on the unit circumsphere.
    for (let v = range.first; v < range.first + range.count; v += 1) {
      const p = solids.positions.subarray(v * 3, v * 3 + 3);
      assert.ok(Math.abs(Math.hypot(...p) - 1) < 1e-6, `${range.name} vertex radius`);
    }
  }
});

test("each solid is a closed surface: Euler characteristic 2 and every edge shared by two triangles", () => {
  const solids = buildSolids();
  const key = (p) => p.map((v) => v.toFixed(5)).join(",");
  for (const range of solids.ranges) {
    const verts = new Set();
    const edges = new Map();
    for (let t = 0; t < range.count / 3; t += 1) {
      const pts = [0, 1, 2].map((k) => {
        const i = (range.first + t * 3 + k) * 3;
        return key(Array.from(solids.positions.subarray(i, i + 3)));
      });
      pts.forEach((p) => verts.add(p));
      for (let k = 0; k < 3; k += 1) {
        const e = [pts[k], pts[(k + 1) % 3]].sort().join("|");
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
    }
    assert.ok([...edges.values()].every((n) => n === 2), `${range.name} edges are shared by exactly two triangles`);
    assert.equal(verts.size - edges.size + range.count / 3, 2, `${range.name} Euler characteristic`);
  }
});
