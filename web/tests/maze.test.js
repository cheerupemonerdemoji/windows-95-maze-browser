import test from "node:test";
import assert from "node:assert/strict";
import {
  RNG_MODES,
  listPictureWalls,
  listWalls,
  cellAt,
  createMicrosoftRandom,
  generateMaze,
  serializeMaze,
  validateMaze,
} from "../src/maze.js";
import { AutoWalker, SIMULATION_STEP_MS, TRANSITION_UPDATES, originalEdgePose } from "../src/walker.js";

test("Microsoft-compatible RNG matches the recovered LCG after ten warm-up values", () => {
  const random = createMicrosoftRandom(1);
  assert.deepEqual(Array.from({ length: 5 }, () => random()), [5705, 28145, 23281, 16827, 9961]);
});

test("numeric seed 1 preserves the recovered edge order and boundary-row draws", () => {
  const maze = generateMaze({ seed: 1, twisterCount: 0 });
  assert.deepEqual(maze.entrance, { x: 0, y: 5, boundary: "left" });
  assert.deepEqual(maze.exit, { x: 11, y: 11, boundary: "right" });
  assert.equal(maze.handedness, "left");
  assert.equal(
    serializeMaze(maze).split("|").slice(1, 13).join("|"),
    "0,0:d:none|1,0:r:none|2,0:rdl:none|3,0:l:none|4,0:r:none|5,0:rl:none|6,0:rdl:none|7,0:l:none|8,0:rd:none|9,0:l:none|10,0:rd:none|11,0:l:none",
  );
});

test("fixed seeds deterministically select both recovered handedness branches", () => {
  assert.equal(generateMaze({ seed: 0 }).handedness, "right");
  assert.equal(generateMaze({ seed: 1 }).handedness, "left");
  assert.equal(generateMaze({ seed: 3 }).handedness, generateMaze({ seed: 3 }).handedness);
});

test("the same seed and RNG mode always produce the same maze", () => {
  for (const rngMode of Object.values(RNG_MODES)) {
    assert.equal(
      serializeMaze(generateMaze({ seed: "maze-95", rngMode })),
      serializeMaze(generateMaze({ seed: "maze-95", rngMode })),
    );
  }
});

test("different seeds and RNG modes produce different serialized runs", () => {
  const microsoft = serializeMaze(generateMaze({ seed: "maze-95" }));
  assert.notEqual(microsoft, serializeMaze(generateMaze({ seed: "maze-96" })));
  assert.notEqual(microsoft, serializeMaze(generateMaze({ seed: "maze-95", rngMode: RNG_MODES.PORTABLE })));
});

test("default maze has 144 connected cells and 143 reciprocal passages", () => {
  const maze = generateMaze({ seed: "evidence-run" });
  const result = validateMaze(maze);
  assert.equal(maze.width, 12);
  assert.equal(maze.height, 12);
  assert.equal(maze.cells.length, 144);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
  assert.equal(result.reachableCells, 144);
  assert.equal(result.passageCount, 143);
});

test("entrance and exit occupy random rows on opposite boundaries", () => {
  const maze = generateMaze({ seed: 95 });
  assert.equal(maze.entrance.x, 0);
  assert.equal(maze.exit.x, 11);
  assert.ok(maze.entrance.y >= 0 && maze.entrance.y < 12);
  assert.ok(maze.exit.y >= 0 && maze.exit.y < 12);
  assert.equal(cellAt(maze, maze.entrance.x, maze.entrance.y).object, "start");
  assert.equal(cellAt(maze, maze.exit.x, maze.exit.y).object, "finish");
  const placed = maze.cells.filter((cell) => cell.object === "twister");
  assert.ok(placed.length >= 0 && placed.length <= 8, "recovered object count is rand() % 9");
  assert.equal(maze.twisters.length, placed.length);
});

test("trigger solids: counts span 0-8 and shape/spin draws stay in the recovered ranges", () => {
  const counts = new Set();
  const shapes = new Set();
  for (let seed = 0; seed < 400; seed += 1) {
    const maze = generateMaze({ seed });
    counts.add(maze.twisters.length);
    for (const t of maze.twisters) {
      assert.equal(cellAt(maze, t.x, t.y).object, "twister");
      assert.ok(t.shape >= 0 && t.shape <= 3);
      assert.ok(t.spinZ >= 2 && t.spinZ <= 7);
      assert.ok(t.spinX >= 0 && t.spinX <= 4);
      shapes.add(t.shape);
    }
  }
  assert.deepEqual([...counts].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(shapes.size, 4);
  assert.equal(generateMaze({ seed: 5, twisterCount: 0 }).twisters.length, 0);
  assert.equal(serializeMaze(generateMaze({ seed: 5 })), serializeMaze(generateMaze({ seed: 5 })));
});

test("serialization includes dimensions, RNG mode, seed, entrance, exit, and handedness", () => {
  const maze = generateMaze({ seed: "metadata" });
  const serialized = serializeMaze(maze);
  assert.match(serialized, /^size=12x12;rng=microsoft;seed=metadata;entrance=0,\d+;exit=11,\d+;handedness=(left|right)\|/);
  assert.ok(serialized.split("|").length >= 145 && serialized.split("|").length <= 149);
});

test("a move is 18 updates: a decision call, 17 integration calls, then the snap, which is the next decision call", () => {
  const maze = generateMaze({ seed: "transition-clock", twisterCount: 0 });
  const walker = new AutoWalker(maze);
  const origin = walker.snapshot();
  assert.equal(SIMULATION_STEP_MS, 25);
  assert.equal(TRANSITION_UPDATES, 18);

  const decision = walker.step();
  assert.equal(decision.type, "transition");
  assert.equal(decision.transition.update, 0, "the decision call starts the move");
  assert.deepEqual(decision.pose, origin.pose, "the decision call does not move the camera");
  for (let update = 1; update < TRANSITION_UPDATES; update += 1) {
    const event = walker.step();
    assert.equal(event.type, "transition");
    assert.equal(event.transition.update, update);
    assert.equal(event.steps, 0);
  }
  const completed = walker.step();
  assert.equal(completed.type, "move");
  assert.equal(completed.steps, 1);
  assert.equal(completed.simulationUpdates, 1 + TRANSITION_UPDATES, "decision at update 1, snap at update 19");
  assert.equal(completed.simulationTimeMs, 475);
  assert.equal(completed.transition.update, 0, "the snap call is the next move's decision call");
  assert.notDeepEqual([completed.x, completed.y], [origin.x, origin.y]);
});

test("quarter turns follow the recovered Euler arc while heading changes five degrees per update", () => {
  const cells = Array.from({ length: 4 }, (_, index) => ({
    x: index % 2,
    y: Math.floor(index / 2),
    passages: { up: false, right: false, down: false, left: false },
    object: "none",
  }));
  cells[0].passages.down = true;
  cells[2].passages.up = true;
  const maze = {
    width: 2,
    height: 2,
    entrance: { x: 0, y: 0, boundary: "left" },
    exit: { x: 1, y: 1, boundary: "right" },
    handedness: "right",
    cells,
  };
  const walker = new AutoWalker(maze);
  const start = walker.renderPose();
  walker.step(); // decision
  assert.deepEqual(walker.renderPose(), start);
  for (let update = 1; update <= 9; update += 1) walker.step();
  const midpoint = walker.renderPose();
  assert.ok(midpoint.x > start.x && midpoint.y > start.y, "the path bows into the cell rather than following a chord");
  assert.ok(Math.abs(midpoint.heading - Math.PI * 0.75) < 1e-6, "nine integration steps of 5 degrees (the original float 0.08726647) from east to south-east");

  for (let update = 10; update < TRANSITION_UPDATES; update += 1) walker.step();
  const beforeSnap = walker.renderPose();
  assert.ok(Math.abs(beforeSnap.heading - (Math.PI / 2 + (17 * 5 * Math.PI) / 180)) < 1e-6, "85 degrees after 17 steps");
  walker.step(); // snap
  assert.deepEqual([walker.x, walker.y, walker.direction], [0, 1, "down"]);
  assert.deepEqual(walker.renderPose(), originalEdgePose(0, 1, "down"));
  assert.deepEqual(walker.renderPose(), { x: 0, y: 0.5, heading: Math.PI });
});

test("a dead-end reversal rotates ten degrees per update in place for 17 updates, then snaps", () => {
  const cells = Array.from({ length: 2 }, (_, x) => ({
    x,
    y: 0,
    passages: { up: false, right: false, down: false, left: false },
    object: "none",
  }));
  cells[0].passages.right = true;
  cells[1].passages.left = true;
  const maze = {
    width: 2,
    height: 1,
    entrance: { x: 1, y: 0, boundary: "right" },
    exit: { x: 0, y: 0, boundary: "left" },
    handedness: "right",
    cells,
  };
  const walker = new AutoWalker(maze);
  const start = walker.renderPose();
  walker.step(); // decision
  assert.equal(walker.snapshot().transition.choice, "reverse");
  for (let update = 1; update <= 9; update += 1) walker.step();
  assert.ok(Math.abs(walker.renderPose().heading - Math.PI) < 1e-6, "nine steps of 10 degrees (the original float 0.17453294) from east to south");
  assert.equal(walker.renderPose().x, start.x, "a reversal turns in place");
  assert.equal(walker.renderPose().y, start.y);

  for (let update = 10; update < TRANSITION_UPDATES; update += 1) walker.step();
  assert.ok(Math.abs(walker.renderPose().heading - (Math.PI / 2 + (17 * 10 * Math.PI) / 180)) < 1e-6, "170 degrees after 17 steps");
  walker.step(); // snap
  assert.deepEqual([walker.x, walker.y, walker.direction], [0, 0, "left"]);
  assert.equal(walker.deadEnds, 2, "the snap call is also the next decision call, which finds another dead end and reverses again");
  assert.equal(walker.snapshot().transition.choice, "reverse");
  assert.deepEqual(walker.renderPose(), originalEdgePose(0, 0, "left"));
});

test("both walker handedness modes reach the finish without crossing a wall", () => {
  for (const handedness of ["left", "right"]) {
    for (const seed of ["alpha", "beta", "gamma", "delta", "epsilon"]) {
      const maze = generateMaze({ seed });
      const walker = new AutoWalker(maze, { handedness });
      assert.deepEqual(
        [walker.x, walker.y, walker.direction, walker.handedness],
        [maze.entrance.x, maze.entrance.y, "right", handedness],
      );
      let attempts = 0;
      while (!walker.finished && attempts < maze.cells.length * 8 * TRANSITION_UPDATES) {
        const before = walker.snapshot();
        const event = walker.step();
        if (event.type === "move") {
          const origin = cellAt(maze, before.x, before.y);
          assert.equal(origin.passages[event.direction], true, `${handedness}/${seed}: crossed a wall`);
        }
        attempts += 1;
      }
      assert.equal(walker.finished, true, `${handedness}/${seed}: did not find finish`);
      assert.deepEqual([walker.x, walker.y], [maze.exit.x, maze.exit.y]);
    }
  }
});

test("experimental draws come after the earlier draws: seed 1 keeps its recovered trigger placement", () => {
  const maze = generateMaze({ seed: 1 });
  assert.deepEqual(maze.twisters, [
    { x: 4, y: 9, shape: 0, spinZ: 5, spinX: 4 },
    { x: 3, y: 2, shape: 3, spinZ: 6, spinX: 0 },
    { x: 7, y: 8, shape: 1, spinZ: 6, spinX: 1 },
    { x: 3, y: 10, shape: 1, spinZ: 6, spinX: 2 },
  ]);
  assert.equal(maze.entrance.y, 5);
});

test("picture walls: 1-5 recovered draws with replacement, deterministic and always on a drawable wall", () => {
  const counts = new Set();
  for (let seed = 0; seed < 300; seed += 1) {
    const maze = generateMaze({ seed });
    const walls = listPictureWalls(maze);
    const keys = new Set(walls.map((w) => `${w.x},${w.y},${w.side}`));
    assert.ok(maze.pictures.length >= 1 && maze.pictures.length <= 5);
    assert.equal(new Set(maze.pictures.map((w) => `${w.x},${w.y},${w.side}`)).size, maze.pictures.length);
    assert.ok(maze.pictures.every((w) => keys.has(`${w.x},${w.y},${w.side}`)));
    counts.add(maze.pictures.length);
  }
  assert.deepEqual([...counts].sort(), [1, 2, 3, 4, 5]);
  assert.equal(serializeMaze(generateMaze({ seed: 9 })), serializeMaze(generateMaze({ seed: 9 })));
});

test("logo objects: none for about half of the mazes, otherwise 1-3, on free cells", () => {
  let none = 0;
  const seen = new Set();
  for (let seed = 0; seed < 400; seed += 1) {
    const maze = generateMaze({ seed });
    seen.add(maze.logos.length);
    if (maze.logos.length === 0) none += 1;
    assert.ok(maze.logos.length <= 3);
    const occupied = new Set(maze.cells.filter((c) => c.object !== "none").map((c) => `${c.x},${c.y}`));
    const cells = new Set();
    for (const logo of maze.logos) {
      assert.ok(!occupied.has(`${logo.x},${logo.y}`), "logo does not share a start, finish or trigger cell");
      assert.ok(!cells.has(`${logo.x},${logo.y}`));
      cells.add(`${logo.x},${logo.y}`);
      assert.deepEqual(Object.keys(logo).sort(), ["x", "y"], "logos have no invented spin state");
    }
  }
  assert.ok(none > 140 && none < 260, `none = ${none} of 400`);
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
});

test("rats: RatCount rats (default 1) each with its own hand, deterministic", () => {
  const maze = generateMaze({ seed: 4 });
  assert.equal(maze.rats.length, 1);
  assert.ok(["left", "right"].includes(maze.rats[0].handedness));
  assert.ok(cellAt(maze, maze.rats[0].x, maze.rats[0].y));
  assert.equal(generateMaze({ seed: 4, ratCount: 3 }).rats.length, 3);
  assert.equal(generateMaze({ seed: 4, ratCount: 0 }).rats.length, 0);
  const hands = new Set();
  for (let seed = 0; seed < 60; seed += 1) {
    const generated = generateMaze({ seed });
    hands.add(generated.rats[0].handedness);
    const occupied = new Set([
      `${generated.entrance.x},${generated.entrance.y}`,
      `${generated.exit.x},${generated.exit.y}`,
      ...generated.twisters.map((o) => `${o.x},${o.y}`),
      ...generated.logos.map((o) => `${o.x},${o.y}`),
    ]);
    for (const rat of generated.rats) {
      const key = `${rat.x},${rat.y}`;
      assert.ok(!occupied.has(key), "rat uses the remaining cell pool");
      occupied.add(key);
    }
  }
  assert.equal(hands.size, 2);
});
