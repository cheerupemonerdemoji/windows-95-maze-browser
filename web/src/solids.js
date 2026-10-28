// Pure, DOM-free geometry for the four trigger solids. The original draws an icosahedron, octahedron,
// dodecahedron or tetrahedron (static analysis, direct observation); these are independently generated
// regular polyhedra, flat shaded, unit circumradius, so no Microsoft asset is involved.
import { TWISTER_SHAPES } from "./maze.js";

const PHI = (1 + Math.sqrt(5)) / 2;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function tetrahedronVertices() {
  return [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
}

function octahedronVertices() {
  return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
}

function icosahedronVertices() {
  const v = [];
  for (const a of [-1, 1]) for (const b of [-PHI, PHI]) v.push([0, a, b], [a, b, 0], [b, 0, a]);
  return v;
}

/** Faces of a polyhedron whose faces are all triangles: triples of mutually nearest vertices. */
function triangleFaces(vertices) {
  let edge = Infinity;
  for (let i = 0; i < vertices.length; i += 1) {
    for (let j = i + 1; j < vertices.length; j += 1) edge = Math.min(edge, len(sub(vertices[i], vertices[j])));
  }
  const near = (i, j) => Math.abs(len(sub(vertices[i], vertices[j])) - edge) < 1e-6;
  const faces = [];
  for (let i = 0; i < vertices.length; i += 1) {
    for (let j = i + 1; j < vertices.length; j += 1) {
      for (let k = j + 1; k < vertices.length; k += 1) {
        if (near(i, j) && near(j, k) && near(i, k)) faces.push([i, j, k]);
      }
    }
  }
  return faces;
}

function orient(points) {
  // Make the polygon counter-clockwise when seen from outside (normal points away from the origin).
  const normal = cross(sub(points[1], points[0]), sub(points[2], points[0]));
  const centroid = points.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]);
  return dot(normal, centroid) >= 0 ? points : [...points].reverse();
}

function triangulate(polygons) {
  const tris = [];
  for (const polygon of polygons) {
    const p = orient(polygon);
    for (let i = 1; i < p.length - 1; i += 1) tris.push([p[0], p[i], p[i + 1]]);
  }
  return tris;
}

function polyhedronTriangles(name) {
  if (name === "tetrahedron" || name === "octahedron" || name === "icosahedron") {
    const vertices = { tetrahedron: tetrahedronVertices, octahedron: octahedronVertices, icosahedron: icosahedronVertices }[name]();
    return triangulate(triangleFaces(vertices).map((face) => face.map((i) => vertices[i])));
  }
  // Dodecahedron as the dual of the icosahedron: one pentagon per icosahedron vertex, whose corners are the
  // centres of the five icosahedron faces around that vertex, ordered by angle about the vertex axis.
  const ico = icosahedronVertices();
  const faces = triangleFaces(ico);
  const centers = faces.map((f) => unit(f.reduce((s, i) => [s[0] + ico[i][0], s[1] + ico[i][1], s[2] + ico[i][2]], [0, 0, 0])));
  const pentagons = ico.map((vertex, index) => {
    const axis = unit(vertex);
    const ring = faces.map((f, k) => (f.includes(index) ? centers[k] : null)).filter(Boolean);
    const ref = unit(sub(ring[0], axis.map((a) => a * dot(ring[0], axis))));
    const side = cross(axis, ref);
    return ring.sort((a, b) => {
      const pa = sub(a, axis.map((v) => v * dot(a, axis)));
      const pb = sub(b, axis.map((v) => v * dot(b, axis)));
      return Math.atan2(dot(pa, side), dot(pa, ref)) - Math.atan2(dot(pb, side), dot(pb, ref));
    });
  });
  return triangulate(pentagons);
}

/**
 * Flat-shaded triangle soup for all four solids in TWISTER_SHAPES order.
 * `ranges[shape]` is {first, count} in vertices (draw with gl.drawArrays).
 */
export function buildSolids() {
  const positions = [];
  const normals = [];
  const ranges = [];
  for (const name of TWISTER_SHAPES) {
    const first = positions.length / 3;
    let maxRadius = 0;
    const tris = polyhedronTriangles(name);
    for (const t of tris) for (const p of t) maxRadius = Math.max(maxRadius, len(p));
    for (const [a, b, c] of tris) {
      const n = unit(cross(sub(b, a), sub(c, a)));
      for (const p of [a, b, c]) {
        positions.push(p[0] / maxRadius, p[1] / maxRadius, p[2] / maxRadius);
        normals.push(n[0], n[1], n[2]);
      }
    }
    ranges.push({ name, first, count: positions.length / 3 - first });
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), ranges };
}

/** A unit sprite quad centred on the origin in the XY plane, normal +Z, uv 0..1 (two triangles, 6 vertices). */
export function buildSprite() {
  const corners = [[-0.5, -0.5, 0, 0, 0], [0.5, -0.5, 0, 1, 0], [0.5, 0.5, 0, 1, 1], [-0.5, 0.5, 0, 0, 1]];
  const order = [0, 1, 2, 0, 2, 3];
  const data = new Float32Array(order.length * 8);
  order.forEach((k, i) => {
    const [x, y, z, u, v] = corners[k];
    data.set([x, y, z, 0, 0, 1, u, v], i * 8);
  });
  return data;
}
