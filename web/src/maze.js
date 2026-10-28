export const DIRECTIONS = Object.freeze(["up", "right", "down", "left"]);

export const RNG_MODES = Object.freeze({
  MICROSOFT: "microsoft",
  PORTABLE: "portable",
});

export const DELTAS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  right: Object.freeze({ x: 1, y: 0 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
});

export const OPPOSITE = Object.freeze({
  up: "down",
  right: "left",
  down: "up",
  left: "right",
});

function hashSeed(seed) {
  let hash = 2166136261;
  for (const character of String(seed)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function normalizeMicrosoftSeed(seed) {
  const text = String(seed).trim();
  if (/^[+-]?\d+$/.test(text)) return Number(BigInt.asUintN(32, BigInt(text)));
  return hashSeed(text);
}

// Portable debugging stream retained for comparisons with earlier browser runs.
export function createRandom(seed) {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createMicrosoftRandom(seed, { warmup = 10 } = {}) {
  if (!Number.isInteger(warmup) || warmup < 0) throw new RangeError("Warm-up must be a non-negative integer.");
  let state = normalizeMicrosoftSeed(seed);
  const next = () => {
    state = (Math.imul(state, 0x343fd) + 0x269ec3) >>> 0;
    return (state >>> 16) & 0x7fff;
  };
  for (let index = 0; index < warmup; index += 1) next();
  return next;
}

function createRandomSource(seed, rngMode) {
  if (rngMode === RNG_MODES.MICROSOFT) {
    const next = createMicrosoftRandom(seed);
    return {
      index(limit) {
        if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Random index limit must be positive.");
        return next() % limit;
      },
    };
  }
  if (rngMode === RNG_MODES.PORTABLE) {
    const next = createRandom(seed);
    return {
      index(limit) {
        if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Random index limit must be positive.");
        return Math.floor(next() * limit);
      },
    };
  }
  throw new RangeError(`Unknown RNG mode: ${rngMode}.`);
}

export function cellAt(maze, x, y) {
  if (x < 0 || y < 0 || x >= maze.width || y >= maze.height) return undefined;
  return maze.cells[y * maze.width + x];
}

function createCells(width, height) {
  return Array.from({ length: width * height }, (_, index) => ({
    x: index % width,
    y: Math.floor(index / width),
    passages: { up: false, right: false, down: false, left: false },
    object: "none",
  }));
}

function carveKruskal(maze, random) {
  const edges = [];

  // This order and the intentionally biased shuffle reproduce the recovered routine at 0x01004280.
  for (let x = 1; x < maze.width; x += 1) {
    for (let y = 0; y < maze.height; y += 1) edges.push({ x, y, direction: "left" });
  }
  for (let y = 1; y < maze.height; y += 1) {
    for (let x = 0; x < maze.width; x += 1) edges.push({ x, y, direction: "up" });
  }
  for (let index = edges.length - 1; index > 0; index -= 1) {
    const swap = random.index(index);
    [edges[index], edges[swap]] = [edges[swap], edges[index]];
  }

  const parents = maze.cells.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const parent = parents[index];
      parents[index] = root;
      index = parent;
    }
    return root;
  };

  for (const edge of edges) {
    const cell = cellAt(maze, edge.x, edge.y);
    const delta = DELTAS[edge.direction];
    const neighbor = cellAt(maze, edge.x + delta.x, edge.y + delta.y);
    const cellIndex = cell.y * maze.width + cell.x;
    const neighborIndex = neighbor.y * maze.width + neighbor.x;
    const cellRoot = find(cellIndex);
    const neighborRoot = find(neighborIndex);
    if (cellRoot === neighborRoot) continue;
    parents[cellRoot] = neighborRoot;
    cell.passages[edge.direction] = true;
    neighbor.passages[OPPOSITE[edge.direction]] = true;
  }
}

export const TWISTER_COUNT_LIMIT = 9;

/**
 * Every closed wall segment, once: each cell contributes its north wall and its west wall (except the entrance
 * opening), the last row its south walls and the last column its east walls (except the exit opening). The
 * geometry builder uses this same list.
 */
export function listWalls(maze) {
  const out = [];
  for (const cell of maze.cells) {
    const { x, y } = cell;
    if (!cell.passages.up) out.push({ x, y, side: "n" });
    if (!cell.passages.left && !(x === 0 && y === maze.entrance.y)) out.push({ x, y, side: "w" });
    if (y === maze.height - 1 && !cell.passages.down) out.push({ x, y, side: "s" });
    if (x === maze.width - 1 && !cell.passages.right && !(y === maze.exit.y)) out.push({ x, y, side: "e" });
  }
  return out;
}

/** Every drawable wall in the original scene, including the closed entrance and exit boundary walls. */
export function listPictureWalls(maze) {
  return [
    ...listWalls(maze),
    { x: 0, y: maze.entrance.y, side: "w" },
    { x: maze.width - 1, y: maze.exit.y, side: "e" },
  ];
}

function takeRandomCell(pool, random) {
  if (pool.length === 0) throw new RangeError("No unoccupied maze cells remain.");
  const index = random.index(pool.length);
  const cell = pool[index];
  pool[index] = pool[pool.length - 1];
  pool.pop();
  return cell;
}
export const TWISTER_SHAPES = Object.freeze(["icosahedron", "octahedron", "dodecahedron", "tetrahedron"]);

export function generateMaze({
  width = 12,
  height = 12,
  seed = "windows-95",
  rngMode = RNG_MODES.MICROSOFT,
  twisterCount = null,
  ratCount = 1,
} = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new RangeError("Maze dimensions must be integers of at least 2.");
  }

  const maxTwisters = Math.min(TWISTER_COUNT_LIMIT - 1, width * height - 2);
  if (twisterCount !== null && (!Number.isInteger(twisterCount) || twisterCount < 0 || twisterCount > maxTwisters)) {
    throw new RangeError(`Twister count must be between 0 and ${maxTwisters}.`);
  }
  if (!Number.isInteger(ratCount) || ratCount < 0 || ratCount > width * height - 2) {
    throw new RangeError(`Rat count must be between 0 and ${width * height - 2}.`);
  }

  const random = createRandomSource(seed, rngMode);
  const cells = createCells(width, height);
  const maze = { width, height, seed: String(seed), rngMode, cells };
  carveKruskal(maze, random);

  const entranceRow = random.index(height);
  const exitRow = random.index(height);
  maze.entrance = { x: 0, y: entranceRow, boundary: "left" };
  maze.exit = { x: width - 1, y: exitRow, boundary: "right" };
  cellAt(maze, maze.entrance.x, maze.entrance.y).object = "start";
  cellAt(maze, maze.exit.x, maze.exit.y).object = "finish";

  // Observation (0x10010d9): draw 1-5 wall indices with replacement and replace the selected walls' texture.
  // Repeated indices still produce one pictured wall, just as repeated pointer assignments do in the original.
  const pictureWalls = listPictureWalls(maze);
  const pictureSelections = random.index(5) + 1;
  const selectedPictures = new Map();
  for (let index = 0; index < pictureSelections; index += 1) {
    const wall = pictureWalls[random.index(pictureWalls.length)];
    selectedPictures.set(`${wall.x},${wall.y},${wall.side}`, wall);
  }
  maze.pictures = [...selectedPictures.values()];

  // Observation (0x10036d8, 0x10036f4, 0x10037a2): start with all 144 cells, remove entrance and exit, then take
  // trigger, logo and rat cells without replacement by replacing each selected slot with the pool's last slot.
  const available = cells.filter((cell) => cell.object === "none");
  // Each trigger chooses one of four solids, spins 2-7 degrees/update about the original vertical Z axis and
  // 0-4 degrees/update about X. In browser coordinates, original Z is the vertical Y axis.
  const count = twisterCount ?? random.index(TWISTER_COUNT_LIMIT);
  maze.twisters = [];
  for (let index = 0; index < count; index += 1) {
    const cell = takeRandomCell(available, random);
    cell.object = "twister";
    maze.twisters.push({
      x: cell.x,
      y: cell.y,
      shape: random.index(4),
      spinZ: random.index(6) + 2,
      spinX: random.index(5),
    });
  }

  // One rand % 6 - 2 draw gives no logos for outcomes -2, -1 and 0, otherwise 1-3 logos.
  const logoCount = Math.max(0, random.index(6) - 2);
  maze.logos = Array.from({ length: logoCount }, () => {
    const cell = takeRandomCell(available, random);
    return { x: cell.x, y: cell.y };
  });
  maze.rats = Array.from({ length: ratCount }, () => {
    const start = takeRandomCell(available, random);
    return { x: start.x, y: start.y, handedness: random.index(1000) < 501 ? "left" : "right" };
  });
  // The camera route is created after the rats in the recovered lifecycle initialiser.
  maze.handedness = random.index(1000) < 501 ? "left" : "right";
  return maze;
}

export function serializeMaze(maze) {
  const header = [
    `size=${maze.width}x${maze.height}`,
    `rng=${maze.rngMode ?? RNG_MODES.PORTABLE}`,
    `seed=${encodeURIComponent(maze.seed)}`,
    `entrance=${maze.entrance?.x ?? 0},${maze.entrance?.y ?? 0}`,
    `exit=${maze.exit?.x ?? maze.width - 1},${maze.exit?.y ?? maze.height - 1}`,
    `handedness=${maze.handedness ?? "right"}`,
  ].join(";");
  const cells = maze.cells.map((cell) => {
    const exits = DIRECTIONS.filter((direction) => cell.passages[direction])
      .map((direction) => direction[0]).join("");
    return `${cell.x},${cell.y}:${exits}:${cell.object}`;
  }).join("|");
  const twisters = (maze.twisters ?? []).map((t) => `${t.x},${t.y},${t.shape},${t.spinZ},${t.spinX}`).join(";");
  const extras = [
    maze.pictures?.length ? `pictures=${maze.pictures.map((w) => `${w.x},${w.y},${w.side}`).join(";")}` : "",
    maze.logos?.length ? `logos=${maze.logos.map((l) => `${l.x},${l.y}`).join(";")}` : "",
    maze.rats?.length ? `rats=${maze.rats.map((r) => `${r.x},${r.y},${r.handedness}`).join(";")}` : "",
  ].filter(Boolean);
  return [`${header}|${cells}`, twisters ? `twisters=${twisters}` : "", ...extras].filter(Boolean).join("|");
}

export function validateMaze(maze) {
  const errors = [];
  let passageCount = 0;
  for (const cell of maze.cells) {
    for (const direction of DIRECTIONS) {
      if (!cell.passages[direction]) continue;
      const delta = DELTAS[direction];
      const neighbor = cellAt(maze, cell.x + delta.x, cell.y + delta.y);
      if (!neighbor) errors.push(`Passage leaves maze at ${cell.x},${cell.y} ${direction}.`);
      else if (!neighbor.passages[OPPOSITE[direction]]) {
        errors.push(`Passage is not reciprocal at ${cell.x},${cell.y} ${direction}.`);
      }
      if (direction === "right" || direction === "down") passageCount += 1;
    }
  }

  const reached = new Set([0]);
  const queue = [maze.cells[0]];
  while (queue.length) {
    const cell = queue.shift();
    for (const direction of DIRECTIONS) {
      if (!cell.passages[direction]) continue;
      const delta = DELTAS[direction];
      const next = cellAt(maze, cell.x + delta.x, cell.y + delta.y);
      const key = next.y * maze.width + next.x;
      if (!reached.has(key)) { reached.add(key); queue.push(next); }
    }
  }
  if (reached.size !== maze.cells.length) errors.push("Not every cell is reachable.");
  if (passageCount !== maze.cells.length - 1) errors.push("Maze is not a perfect tree.");
  return { valid: errors.length === 0, errors, reachableCells: reached.size, passageCount };
}
