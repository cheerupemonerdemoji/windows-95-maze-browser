// Pure, DOM-free static geometry for the first-person renderer.
//
// Conventions (browser reconstruction choices, not recovered Microsoft constants):
//   world X = cell x, world Z = cell y, floor Y = 0, ceiling Y = WORLD.ceilingY, one unit per cell.
//   Quads are two triangles (0,1,2) (0,2,3), counter-clockwise when viewed from the
//   side the normal points to. A wall's "front" is the side facing its owning cell;
//   walls are shared with the neighbouring cell, so the renderer draws them
//   double-sided (culling off, normal flipped by gl_FrontFacing). Floors and ceilings
//   are single-sided and rely on back-face culling.
//
// Each closed internal boundary is emitted once: by the cell below or to the right of it
// (north/west walls). Final-row south walls and final-column east walls complete the
// perimeter. listWalls() leaves the entrance (left boundary) and exit (right boundary) openings out, as the top-down debug
// view shows them; buildMazeGeometry() then closes both, as the original does.

// Evidence status (docs/original-exit-camera-analysis.md): the world is the original's. Observation (scene renderer 0x100203e,
// floor and ceiling 0x1001e88, wall quads 0x1001922): cubic cells, floor at z 0, ceiling at z 1.0, walls from z 0 to the
// growth value (1.0 when grown). The original generator closes every outer boundary edge (0x1004280), so the entrance cell's
// west wall and the exit cell's east wall exist; they are emitted here after the internal walls. The top-down debug map still
// draws the entrance and exit as openings because it is a debug view. An earlier capture-fitted model (wall height 0.282,
// 60 degree FOV, cell-centre camera) was withdrawn: it assumed a cell-centre camera and only matched at one distance.
import { listWalls } from "./maze.js";

export const WORLD = Object.freeze({ floorY: 0, wallHeight: 1, ceilingY: 1 });

// Entrance and exit markers (artwork is an experimental flag, off by default). Observation (decompiled maze initialiser 0x10010d9,
// object painter 0x1001b98): the Start sign and the smiley are camera-facing quads ("billboards") centred on the middle
// of the entrance cell and of the exit cell, at height 0.5 (eye level). The quad is perpendicular to the camera heading,
// half-width 0.16666667 cell and half-height 0.166 of the unit wall height, and its vertical position and size scale
// with the wall growth value, so it squashes with the walls (matching the captures). Nothing but the quad is added:
// the camera stands on the entry edge of the cell, so the cell-centre quad is always 0.5 straight ahead.
// Resource order (fixed table 0x1023238..: Start, smiley, rat, logo, picture) identifies the textures (derived).
// Choice: only the artwork (procedural stand-ins, not Microsoft's); showing it never changes the camera or the world.
export const MARKERS = Object.freeze({
  entrance: Object.freeze({ kind: "start", halfWidth: 0.16666667, halfHeight: 0.166, centre: 0.5 }),
  exit: Object.freeze({ kind: "exit", halfWidth: 0.16666667, halfHeight: 0.166, centre: 0.5 }),
});

/** Marker billboards for a maze: cell-centre positions in world X/Z, vertical sizes in world units at full growth. */
export function markerBillboards(maze) {
  const place = (marker, cell) => ({
    kind: marker.kind,
    x: cell.x + 0.5,
    z: cell.y + 0.5,
    y: marker.centre,
    width: marker.halfWidth * 2,
    height: marker.halfHeight * 2,
  });
  return [place(MARKERS.entrance, maze.entrance), place(MARKERS.exit, maze.exit)];
}

class GeometryBuilder {
  constructor(quadCapacity) {
    this.positions = new Float32Array(quadCapacity * 12);
    this.normals = new Float32Array(quadCapacity * 12);
    this.uvs = new Float32Array(quadCapacity * 8);
    this.indices = new Uint32Array(quadCapacity * 6);
    this.quads = 0;
  }

  // corners: 4 [x,y,z] points in CCW order seen from the normal side.
  quad(corners, normal, uMax = 1) {
    const q = this.quads++;
    const uv = [0, 0, uMax, 0, uMax, 1, 0, 1];
    for (let i = 0; i < 4; i += 1) {
      this.positions.set(corners[i], (q * 4 + i) * 3);
      this.normals.set(normal, (q * 4 + i) * 3);
      this.uvs[(q * 4 + i) * 2] = uv[i * 2];
      this.uvs[(q * 4 + i) * 2 + 1] = uv[i * 2 + 1];
    }
    const base = q * 4;
    this.indices.set([base, base + 1, base + 2, base, base + 2, base + 3], q * 6);
  }
}

const PICTURE_OFFSET = 0.002;

/** Wall centre x, centre z and inward normal for a listWalls() entry. */
function wallPlacement({ x, y, side }) {
  if (side === "n") return [x + 0.5, y, [0, 0, 1]];
  if (side === "w") return [x, y + 0.5, [1, 0, 0]];
  if (side === "s") return [x + 0.5, y + 1, [0, 0, -1]];
  return [x + 1, y + 0.5, [-1, 0, 0]];
}

function wallQuad(builder, cx, cz, normal, uMax = 1) {
  // right = up × normal, so corners run left→right as seen from the front.
  const right = [normal[2], 0, -normal[0]];
  const { floorY: y0, ceilingY: y1 } = WORLD;
  const l = [cx - right[0] / 2, cz - right[2] / 2];
  const r = [cx + right[0] / 2, cz + right[2] / 2];
  // The brick texture is mapped once per 1 x 1 wall (observation: the original repeat count is 1; derived: about 2.5 bricks
  // across and 5 courses, which the captures show as bricks 3.5 times wider than tall on the stretched screen).
  builder.quad([[l[0], y0, l[1]], [r[0], y0, r[1]], [r[0], y1, r[1]], [l[0], y1, l[1]]], normal, uMax);
}

/**
 * @returns {{positions: Float32Array, normals: Float32Array, uvs: Float32Array,
 *   indices: Uint32Array, vertexCount: number, indexCount: number,
 *   ranges: {walls: {start: number, count: number}, floor: {start: number, count: number}, ceiling: {start: number, count: number}},
 *   counts: {walls: number, floors: number, ceilings: number}}}
 */
export function buildMazeGeometry(maze) {
  const { width, height, cells } = maze;
  const wallList = listWalls(maze).map(wallPlacement);
  const pictures = maze.pictures ?? [];

  const builder = new GeometryBuilder(wallList.length + 2 + cells.length * 2 + pictures.length * 2);
  for (const [cx, cz, normal] of wallList) wallQuad(builder, cx, cz, normal);
  wallQuad(builder, 0, maze.entrance.y + 0.5, [1, 0, 0]); // closed entrance boundary wall
  wallQuad(builder, width, maze.exit.y + 0.5, [-1, 0, 0]); // closed exit boundary wall
  const wallEnd = builder.quads;
  const { floorY, ceilingY } = WORLD;
  for (const { x, y } of cells) {
    builder.quad([[x, floorY, y + 1], [x + 1, floorY, y + 1], [x + 1, floorY, y], [x, floorY, y]], [0, 1, 0]);
  }
  const floorEnd = builder.quads;
  for (const { x, y } of cells) {
    builder.quad([[x, ceilingY, y], [x + 1, ceilingY, y], [x + 1, ceilingY, y + 1], [x, ceilingY, y + 1]], [0, -1, 0]);
  }

  // Picture walls (experimental flag): each picture covers one wall segment on both faces, offset by a hair so it
  // never z-fights the brick, as overlay quads.
  // The two closed boundary walls get only the inward face: their outer face is outside the maze and the eye may sit just behind
  // them at the start.
  const pictureStart = builder.quads;
  for (const wall of pictures) {
    const [cx, cz, normal] = wallPlacement(wall);
    wallQuad(builder, cx + normal[0] * PICTURE_OFFSET, cz + normal[2] * PICTURE_OFFSET, normal, 1);
    const boundary = (wall.side === "w" && wall.x === 0 && wall.y === maze.entrance.y) || (wall.side === "e" && wall.x === width - 1 && wall.y === maze.exit.y);
    if (!boundary) wallQuad(builder, cx - normal[0] * PICTURE_OFFSET, cz - normal[2] * PICTURE_OFFSET, [-normal[0], 0, -normal[2]], 1);
  }

  return {
    positions: builder.positions,
    normals: builder.normals,
    uvs: builder.uvs,
    indices: builder.indices,
    vertexCount: builder.quads * 4,
    indexCount: builder.quads * 6,
    ranges: {
      walls: { start: 0, count: wallEnd * 6 },
      // Walls shared by two cells are drawn double-sided; the two closed boundary walls at the end of the wall range are only ever
      // seen from inside, so the renderer draws them single-sided and the eye can sit behind them without being blinded.
      sharedWalls: { start: 0, count: (wallEnd - 2) * 6 },
      boundaryWalls: { start: (wallEnd - 2) * 6, count: 2 * 6 },
      floor: { start: wallEnd * 6, count: (floorEnd - wallEnd) * 6 },
      ceiling: { start: floorEnd * 6, count: (pictureStart - floorEnd) * 6 },
      pictures: { start: pictureStart * 6, count: (builder.quads - pictureStart) * 6 },
    },
    counts: { walls: wallEnd, floors: floorEnd - wallEnd, ceilings: pictureStart - floorEnd, boundaryWalls: 2, pictureQuads: builder.quads - pictureStart },
  };
}
