import test from "node:test";
import assert from "node:assert/strict";
import { generateMaze } from "../src/maze.js";
import { WORLD, buildMazeGeometry, markerBillboards } from "../src/webgl-geometry.js";
import { lookAt, multiply, perspective } from "../src/mat4.js";
import { createBrickTexture, createStippleTexture, createWoodTexture } from "../src/procedural-textures.js";

const OPPOSITE_DIR = { up: "down", down: "up", left: "right", right: "left" };

function quadsOf(geometry, range) {
  const out = [];
  for (let i = range.start; i < range.start + range.count; i += 6) {
    const base = geometry.indices[i];
    const p = [0, 1, 2, 3].map((k) => Array.from(geometry.positions.subarray((base + k) * 3, (base + k) * 3 + 3)));
    const n = Array.from(geometry.normals.subarray(base * 3, base * 3 + 3));
    out.push({ base, p, n });
  }
  return out;
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => a.map((v, i) => v - b[i]);

// Wall segment on the XZ plane as a canonical key (independent of side).
function wallKey(q) {
  const pts = q.p.filter((v) => v[1] === 0).map((v) => `${v[0]},${v[2]}`).sort();
  return pts.join("|");
}

// Expected closed boundaries computed straight from the passage flags. The original closes every outer edge, including the
// entrance cell's west wall and the exit cell's east wall.
function expectedWalls(maze) {
  const keys = new Set();
  const add = (x1, z1, x2, z2) => keys.add([`${x1},${z1}`, `${x2},${z2}`].sort().join("|"));
  for (const c of maze.cells) {
    if (!c.passages.up) add(c.x, c.y, c.x + 1, c.y);
    if (!c.passages.down) add(c.x, c.y + 1, c.x + 1, c.y + 1);
    if (!c.passages.left) add(c.x, c.y, c.x, c.y + 1);
    if (!c.passages.right) add(c.x + 1, c.y, c.x + 1, c.y + 1);
  }
  return keys;
}

test("geometry is deterministic for a deterministic maze", () => {
  const a = buildMazeGeometry(generateMaze({ seed: 1 }));
  const b = buildMazeGeometry(generateMaze({ seed: 1 }));
  assert.deepEqual(a.positions, b.positions);
  assert.deepEqual(a.indices, b.indices);
  assert.deepEqual(a.uvs, b.uvs);
});

test("vertex data is finite, normals are unit length and indices are valid triangles", () => {
  const g = buildMazeGeometry(generateMaze({ seed: "finite" }));
  for (const array of [g.positions, g.normals, g.uvs]) assert.ok(array.every(Number.isFinite));
  assert.equal(g.positions.length, g.vertexCount * 3);
  assert.equal(g.normals.length, g.vertexCount * 3);
  assert.equal(g.uvs.length, g.vertexCount * 2);
  assert.equal(g.indices.length, g.indexCount);
  assert.equal(g.indexCount % 3, 0);
  assert.ok(g.indices.every((i) => Number.isInteger(i) && i >= 0 && i < g.vertexCount));
  for (let i = 0; i < g.vertexCount; i += 1) {
    assert.ok(Math.abs(Math.hypot(g.normals[i * 3], g.normals[i * 3 + 1], g.normals[i * 3 + 2]) - 1) < 1e-6);
  }
  assert.ok(g.uvs.every((v) => v === 0 || v === 1));
});

test("every cell has exactly one floor and one ceiling quad, in distinct draw ranges", () => {
  const maze = generateMaze({ seed: 1 });
  const g = buildMazeGeometry(maze);
  assert.equal(maze.cells.length, 144);
  assert.equal(g.counts.floors, 144);
  assert.equal(g.counts.ceilings, 144);
  assert.equal(g.ranges.walls.start + g.ranges.walls.count, g.ranges.floor.start);
  assert.equal(g.ranges.floor.start + g.ranges.floor.count, g.ranges.ceiling.start);
  const chain = ["ceiling", "pictures"];
  for (let i = 0; i < chain.length - 1; i += 1) {
    assert.equal(g.ranges[chain[i]].start + g.ranges[chain[i]].count, g.ranges[chain[i + 1]].start, `${chain[i]} is followed by ${chain[i + 1]}`);
  }
  assert.equal(g.ranges.pictures.start + g.ranges.pictures.count, g.indexCount);
  for (const [range, y, ny] of [[g.ranges.floor, WORLD.floorY, 1], [g.ranges.ceiling, WORLD.ceilingY, -1]]) {
    const cells = new Set();
    for (const q of quadsOf(g, range)) {
      assert.ok(q.p.every((v) => Math.abs(v[1] - y) < 1e-6));
      assert.deepEqual(q.n, [0, ny, 0]);
      cells.add(`${Math.min(...q.p.map((v) => v[0]))},${Math.min(...q.p.map((v) => v[2]))}`);
    }
    assert.equal(cells.size, 144);
  }
});

test("triangle winding agrees with the stored normal for every quad", () => {
  const g = buildMazeGeometry(generateMaze({ seed: 5 }));
  for (const range of Object.values(g.ranges)) {
    for (const q of quadsOf(g, range)) {
      const n = cross(sub(q.p[1], q.p[0]), sub(q.p[2], q.p[0]));
      const length = Math.hypot(...n);
      assert.ok(n.every((v, i) => Math.abs(v / length - q.n[i]) < 1e-6), "winding matches the stored normal");
    }
  }
});

test("closed boundaries have exactly one wall and passages have none", () => {
  for (const seed of [1, 2, "maze-95", 3]) {
    const maze = generateMaze({ seed });
    const g = buildMazeGeometry(maze);
    const walls = quadsOf(g, g.ranges.walls);
    const keys = walls.map(wallKey);
    assert.equal(new Set(keys).size, keys.length, "no duplicate wall faces");
    assert.deepEqual(new Set(keys), expectedWalls(maze));
    for (const q of walls) {
      assert.equal(q.p[0][1], 0);
      assert.ok(Math.abs(q.p[3][1] - WORLD.ceilingY) < 1e-6);
    }
    // No wall may sit on an open passage between two cells.
    for (const c of maze.cells) {
      for (const [dir, [dx, dz, ax, az, bx, bz]] of Object.entries({
        up: [0, -1, 0, 0, 1, 0], down: [0, 1, 0, 1, 1, 1], left: [-1, 0, 0, 0, 0, 1], right: [1, 0, 1, 0, 1, 1],
      })) {
        if (!c.passages[dir]) continue;
        assert.ok(!keys.includes([`${c.x + ax},${c.y + az}`, `${c.x + bx},${c.y + bz}`].sort().join("|")));
        const neighbor = maze.cells.find((o) => o.x === c.x + dx && o.y === c.y + dz);
        assert.ok(neighbor.passages[OPPOSITE_DIR[dir]]);
      }
    }
  }
});

test("the entrance and exit boundary walls are closed, as in the original", () => {
  const maze = generateMaze({ seed: 1 });
  const g = buildMazeGeometry(maze);
  const keys = new Set(quadsOf(g, g.ranges.walls).map(wallKey));
  const entrance = [`0,${maze.entrance.y}`, `0,${maze.entrance.y + 1}`].sort().join("|");
  const exit = [`${maze.width},${maze.exit.y}`, `${maze.width},${maze.exit.y + 1}`].sort().join("|");
  assert.ok(keys.has(entrance));
  assert.ok(keys.has(exit));
  // They are the last two quads of the wall range and face into the maze.
  const walls = quadsOf(g, g.ranges.walls);
  assert.deepEqual(walls[walls.length - 2].n, [1, 0, 0]);
  assert.deepEqual(walls[walls.length - 1].n, [-1, 0, 0]);
  assert.equal(g.counts.boundaryWalls, 2);
});

test("geometry rebuilds for a newly generated maze", () => {
  const a = buildMazeGeometry(generateMaze({ seed: 1 }));
  const second = generateMaze({ seed: 2 });
  const b = buildMazeGeometry(second);
  assert.notDeepEqual(a.positions, b.positions);
  assert.deepEqual(new Set(quadsOf(b, b.ranges.walls).map(wallKey)), expectedWalls(second));
});

test("matrix helpers: lookAt maps the eye to the origin and forward to -Z; projection is column-major", () => {
  const view = lookAt(new Float32Array(16), 2, 0.5, 3, 2, 0.5, 2, 0, 1, 0);
  const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
  assert.deepEqual(apply(view, [2, 0.5, 3]).map((v) => Math.abs(v) < 1e-6 ? 0 : v), [0, 0, 0]);
  const ahead = apply(view, [2, 0.5, 2]);
  assert.ok(Math.abs(ahead[2] + 1) < 1e-6 && Math.abs(ahead[0]) < 1e-6);
  // Right of the camera (looking toward -Z) is +X.
  assert.ok(apply(view, [3, 0.5, 3])[0] > 0);

  const proj = perspective(new Float32Array(16), Math.PI / 2, 2, 0.1, 100);
  assert.equal(proj[11], -1);
  assert.ok(Math.abs(proj[5] - 1) < 1e-6 && Math.abs(proj[0] - 0.5) < 1e-6);
  const near = [0, 0, -0.1, 1], far = [0, 0, -100, 1];
  const clip = (z) => [proj[10] * z + proj[14], -z];
  assert.ok(Math.abs(clip(near[2])[0] / clip(near[2])[1] + 1) < 1e-5);
  assert.ok(Math.abs(clip(far[2])[0] / clip(far[2])[1] - 1) < 1e-5);

  const id = new Float32Array(16); id[0] = id[5] = id[10] = id[15] = 1;
  assert.deepEqual(Array.from(multiply(new Float32Array(16), id, view)), Array.from(view));
});

test("procedural textures are deterministic, opaque RGBA8 pixel arrays", () => {
  for (const make of [createBrickTexture, createWoodTexture, createStippleTexture]) {
    const t = make(64);
    assert.equal(t.data.length, 64 * 64 * 4);
    assert.deepEqual(t.data, make(64).data);
    for (let i = 3; i < t.data.length; i += 4) assert.equal(t.data[i], 255);
  }
});

test("markers are camera-facing billboards at the entrance and exit cell centres, in a world with unit-high walls", () => {
  for (const seed of [1, 2, 3, "markers"]) {
    const maze = generateMaze({ seed });
    const g = buildMazeGeometry(maze);
    assert.equal(g.counts.ceilings, 144);
    // Billboards: centres of the entrance and exit cells at eye height; original half sizes 1/6 and 0.166 (decoded floats
    // 0x3e2aaaab and 0x3e29fbe7) in a world whose walls are 1.0 tall.
    const [start, exit] = markerBillboards(maze);
    assert.equal(start.kind, "start");
    assert.equal(exit.kind, "exit");
    assert.deepEqual([start.x, start.z], [maze.entrance.x + 0.5, maze.entrance.y + 0.5]);
    assert.deepEqual([exit.x, exit.z], [maze.exit.x + 0.5, maze.exit.y + 0.5]);
    for (const marker of [start, exit]) {
      assert.ok(Math.abs(marker.width - 2 / 6) < 1e-6);
      assert.ok(Math.abs(marker.height - 2 * 0.166) < 1e-9);
      assert.equal(marker.y, 0.5, "centred at eye height");
    }
    assert.equal(exit.x, maze.width - 0.5, "the exit marker is in the last column, inside the maze");
  }
});

test("picture walls add two inward-facing overlay quads per picture, hair-offset from the bricks", () => {
  for (const seed of [1, 2, 3, 11]) {
    const maze = generateMaze({ seed });
    const g = buildMazeGeometry(maze);
    const quads = quadsOf(g, g.ranges.pictures);
    assert.equal(quads.length, maze.pictures.length * 2);
    assert.equal(g.counts.pictureQuads, quads.length);
    for (let i = 0; i < maze.pictures.length; i += 1) {
      const front = quads[i * 2];
      const back = quads[i * 2 + 1];
      assert.deepEqual(front.n.map((v) => v + 0), back.n.map((v) => -v + 0));
      for (const q of [front, back]) {
        const n = cross(sub(q.p[1], q.p[0]), sub(q.p[2], q.p[0]));
        assert.ok(n.every((v, k) => Math.abs(v / Math.hypot(...n) - q.n[k]) < 1e-6), "overlay winding matches its normal");
      }
      // The pair straddles the brick wall plane within a hair.
      const axis = front.n[0] !== 0 ? 0 : 2;
      assert.ok(Math.abs(front.p[0][axis] - back.p[0][axis]) < 0.01);
    }
  }
  // The brick walls themselves are unchanged by pictures (pictures are overlays, drawn only behind the flag).
  const maze = generateMaze({ seed: 1 });
  const g = buildMazeGeometry(maze);
  assert.equal(quadsOf(g, g.ranges.walls).length, 169, "167 internal and outer walls plus the two closed boundary walls");
});

test("a picture on a closed boundary wall gets only its inward face, so an eye just outside the maze is never blinded by it", () => {
  const maze = generateMaze({ seed: 1 });
  maze.pictures = [
    { x: 0, y: maze.entrance.y, side: "w" },
    { x: maze.width - 1, y: maze.exit.y, side: "e" },
    { x: 5, y: 5, side: "n" },
  ];
  const g = buildMazeGeometry(maze);
  const quads = quadsOf(g, g.ranges.pictures);
  assert.equal(quads.length, 1 + 1 + 2, "one face on each boundary wall, two on an inner wall");
  assert.equal(g.counts.pictureQuads, 4);
  assert.deepEqual(quads[0].n, [1, 0, 0]);
  assert.deepEqual(quads[1].n, [-1, 0, 0]);
  // The boundary walls are their own draw range at the end of the wall range, drawn single-sided.
  assert.equal(g.ranges.boundaryWalls.start + g.ranges.boundaryWalls.count, g.ranges.walls.start + g.ranges.walls.count);
  assert.equal(g.ranges.sharedWalls.count + g.ranges.boundaryWalls.count, g.ranges.walls.count);
});
