// Original procedural textures for the first-person renderer. They are generated in
// code (RGBA8 pixel arrays, no DOM, no external files), so no third-party or Microsoft
// asset is redistributed. Appearance is a reconstruction choice, not evidence-derived.

function hash(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function buildRect(width, height, shade) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = shade(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function build(size, shade) {
  return buildRect(size, size, shade);
}

/** Like buildRect but the shader returns [r, g, b, a] (a below 128 is cut out by the renderer). */
function buildRectAlpha(width, height, shade) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = shade(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { width, height, data };
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * Red brick, mapped once per 1 x 1 wall: 5 courses of 2.5 bricks, offset every other course so the tile repeats, with mortar.
 * Derived from the captures (a wall is about 2.3-2.5 bricks across and about 4.7 courses high; the stretched screen shows
 * the bricks 3.5 times wider than tall).
 */
export function createBrickTexture(size = 128, courses = 5, bricksPerCourse = 2.5) {
  const courseH = size / courses;
  const brickW = size / bricksPerCourse;
  const mortar = Math.max(2, size / 40);
  return build(size, (x, y) => {
    const course = Math.floor(y / courseH);
    const xx = (x + (course % 2 ? brickW / 2 : 0)) % size;
    const inX = xx % brickW, inY = y % courseH;
    const noise = hash(x, y, 1) * 22 - 11;
    if (inX < mortar || inY < mortar) return [clamp(168 + noise), clamp(160 + noise), clamp(148 + noise)];
    const tint = hash(Math.floor(xx / brickW), course, 7) * 36 - 18;
    return [clamp(150 + tint + noise), clamp(64 + tint / 2 + noise), clamp(46 + tint / 2 + noise)];
  });
}

/**
 * Floor: warm brown wood grain (long horizontal streaks with fine noise). Direct observation: the original floor is
 * a warm brown wood grain; this is an original generator, and the one-tile-per-cell mapping is a reconstruction choice.
 */
export function createWoodTexture(size = 128) {
  return build(size, (x, y) => {
    const streak = hash(Math.floor(y / 2), 0, 11) * 0.5 + hash(Math.floor(y / 5), 1, 12) * 0.5;
    const grain = hash(Math.floor(x / 24), Math.floor(y / 3), 13) * 0.25;
    const noise = hash(x, y, 14) * 0.12;
    const k = 0.78 + streak * 0.34 + grain - 0.12 + noise;
    return [clamp(178 * k), clamp(112 * k), clamp(48 * k)];
  });
}

/**
 * Ceiling: grey stipple (random light and dark specks). Direct observation: the original ceiling is a grey stipple;
 * this is an original generator.
 */
export function createStippleTexture(size = 128) {
  return build(size, (x, y) => {
    const v = 150 + hash(x, y, 15) * 90 + (hash(Math.floor(x / 2), Math.floor(y / 2), 16) - 0.5) * 20;
    return [clamp(v), clamp(v), clamp(v + 2)];
  });
}

/** Plain white, used for the flat-shaded trigger solids. */
export function createWhiteTexture() {
  return build(2, () => [255, 255, 255]);
}

/**
 * Entrance marker: an original green sign with a white border, a chevron and three bars. No lettering, so no font
 * or Microsoft artwork is involved. Aspect 3:1.
 */
export function createStartSignTexture(width = 192, height = 64) {
  return buildRect(width, height, (x, y) => {
    const border = x < 4 || y < 4 || x >= width - 4 || y >= height - 4;
    if (border) return [245, 245, 245];
    const cx = x - width * 0.3;
    const cy = y - height / 2;
    const chevron = Math.abs(cy) < height * 0.34 - Math.abs(cx) * 0.9 && cx > -height * 0.34 && cx < height * 0.34 && Math.abs(cy) > (height * 0.34 - Math.abs(cx) * 0.9) - 10;
    const bar = x > width * 0.5 && x < width * 0.9 && (Math.abs(y - height * 0.3) < 4 || Math.abs(y - height * 0.5) < 4 || Math.abs(y - height * 0.7) < 4);
    if (chevron || bar) return [250, 250, 250];
    return [28, 140 + Math.round(hash(x, y, 5) * 12), 58];
  });
}

/**
 * Exit marker: an original yellow smiley (disc, two eyes, a smile arc) with a transparent surround, so it sits directly
 * on the brick like the observed one. Rows run bottom to top in GL texture space, hence the flipped y.
 */
export function createSmileyTexture(size = 64) {
  const c = (size - 1) / 2;
  return buildRectAlpha(size, size, (x, y) => {
    const dx = x - c;
    const dy = y - c; // up is positive: row 0 is the bottom of the texture
    const r = Math.hypot(dx, dy);
    if (r > size * 0.47) return [0, 0, 0, 0];
    if (r > size * 0.43) return [20, 20, 20, 255];
    const eye = (Math.abs(Math.abs(dx) - size * 0.17) < size * 0.06) && (Math.abs(dy - size * 0.12) < size * 0.09);
    const mouthRadius = Math.hypot(dx, dy + size * 0.02);
    const mouth = dy < -size * 0.08 && Math.abs(mouthRadius - size * 0.27) < size * 0.035;
    if (eye || mouth) return [20, 20, 20, 255];
    return [250, 214 + Math.round(hash(x, y, 6) * 6), 40, 255];
  });
}

/**
 * Picture wall: an original painted scene (sky gradient, sun, two hills, a tree) in a wooden frame. The original
 * uses a nursery picture; nothing of it is reproduced.
 */
export function createPictureTexture(size = 128) {
  return build(size, (x, y) => {
    const u = x / size;
    const v = 1 - y / size; // rows run bottom to top in GL texture space; v is measured down from the top of the picture
    if (u < 0.04 || u > 0.96 || v < 0.05 || v > 0.95) return [112, 78, 44];
    const sun = Math.hypot(u - 0.72, v - 0.28) < 0.1;
    if (sun) return [252, 226, 96];
    const hillBack = v > 0.62 + 0.07 * Math.sin(u * 6.0);
    const hillFront = v > 0.76 + 0.05 * Math.sin(u * 9.0 + 1.0);
    const trunk = Math.abs(u - 0.28) < 0.018 && v > 0.55 && v < 0.78;
    const crown = Math.hypot(u - 0.28, v - 0.5) < 0.11;
    if (trunk) return [92, 60, 34];
    if (crown) return [34, 118 + Math.round(hash(x, y, 8) * 20), 52];
    if (hillFront) return [64, 150, 70];
    if (hillBack) return [104, 176, 96];
    return [120 + Math.round(v * 90), 180 + Math.round(v * 50), 235];
  });
}

/** Logo object: an original multicolour ring emblem on a transparent square (no lettering, no OpenGL artwork). */
export function createEmblemTexture(size = 64) {
  const c = (size - 1) / 2;
  return buildRectAlpha(size, size, (x, y) => {
    const dx = x - c;
    const dy = y - c;
    const r = Math.hypot(dx, dy) / (size / 2);
    if (r > 0.98) return [0, 0, 0, 0];
    if (r < 0.30) return [250, 250, 250, 255];
    const angle = Math.atan2(dy, dx);
    const ring = r < 0.62 ? 0 : 1;
    const hue = (angle / (Math.PI * 2) + 0.5 + ring * 0.5) % 1;
    const k = Math.floor(hue * 6);
    const f = hue * 6 - k;
    const palette = [[230, 60, 60], [240, 170, 40], [240, 230, 70], [60, 190, 90], [60, 130, 230], [150, 80, 220]];
    const [pr, pg, pb] = palette[k % 6];
    const shade = 0.75 + 0.25 * (1 - Math.abs(f - 0.5) * 2);
    return [Math.round(pr * shade), Math.round(pg * shade), Math.round(pb * shade), 255];
  });
}

/** Rat sprite: an original grey side-view silhouette (body, head, ear, eye, tail) on a transparent background. */
export function createRatTexture(width = 64, height = 32) {
  return buildRectAlpha(width, height, (x, y) => {
    const u = x / width;
    const v = 1 - y / height; // see createPictureTexture: v is measured down from the top of the sprite
    const body = ((u - 0.45) / 0.3) ** 2 + ((v - 0.62) / 0.3) ** 2 < 1;
    const head = ((u - 0.8) / 0.15) ** 2 + ((v - 0.62) / 0.19) ** 2 < 1;
    const ear = ((u - 0.78) / 0.05) ** 2 + ((v - 0.38) / 0.09) ** 2 < 1;
    const tail = u < 0.2 && Math.abs(v - (0.62 - (0.2 - u) * 0.9)) < 0.04;
    const eye = ((u - 0.86) / 0.025) ** 2 + ((v - 0.56) / 0.04) ** 2 < 1;
    if (eye) return [20, 20, 24, 255];
    if (ear) return [206, 150, 150, 255];
    if (body || head) return [112 + Math.round(hash(x, y, 9) * 16), 108 + Math.round(hash(x, y, 9) * 16), 114 + Math.round(hash(x, y, 9) * 16), 255];
    if (tail) return [196, 140, 140, 255];
    return [0, 0, 0, 0];
  });
}
