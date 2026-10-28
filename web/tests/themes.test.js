import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BACKROOMS_ASSETS, MAX_BYTES, MAX_DIMENSION, SLOTS, TextureError, describeSources, readDimensions, sniffFormat, validateUpload } from "../src/themes.js";

// Header-level validation of user uploads (the decode and storage paths run in a real browser: web/tests/smoke/appearance.mjs).

function png(width, height, extra = 0) {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function jpeg(width, height) {
  // SOI, an APP0 segment of 16 bytes, then SOF0 with the size.
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
}

function webpLossy(width, height) {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
  b[26] = width & 255; b[27] = (width >> 8) & 0x3f;
  b[28] = height & 255; b[29] = (height >> 8) & 0x3f;
  return b;
}

function webpExtended(width, height) {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
  const w = width - 1, h = height - 1;
  b[24] = w & 255; b[25] = (w >> 8) & 255; b[26] = (w >> 16) & 255;
  b[27] = h & 255; b[28] = (h >> 8) & 255; b[29] = (h >> 16) & 255;
  return b;
}

const file = (bytes, type, size = bytes.length) => {
  const blob = new Blob([bytes], { type });
  // A claimed size (the real bytes stay small) is modelled with a wrapper that exposes the same File surface.
  return { size, type, slice: (a, b) => blob.slice(a, b) };
};
const reject = async (candidate, code) => {
  await assert.rejects(() => validateUpload(candidate), (error) => error instanceof TextureError && error.code === code, code);
};

test("the formats are recognised from their bytes, not from the declared type", () => {
  assert.equal(sniffFormat(png(8, 8)), "png");
  assert.equal(sniffFormat(jpeg(8, 8)), "jpeg");
  assert.equal(sniffFormat(webpLossy(8, 8)), "webp");
  assert.equal(sniffFormat(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null);
  assert.equal(sniffFormat(new TextEncoder().encode("GIF89a")), null);
  assert.equal(sniffFormat(new Uint8Array(0)), null);
});

test("dimensions are read from the header without decoding", () => {
  assert.deepEqual(readDimensions(png(640, 480), "png"), { width: 640, height: 480 });
  assert.deepEqual(readDimensions(jpeg(1024, 768), "jpeg"), { width: 1024, height: 768 });
  assert.deepEqual(readDimensions(webpLossy(512, 256), "webp"), { width: 512, height: 256 });
  assert.deepEqual(readDimensions(webpExtended(4096, 2048), "webp"), { width: 4096, height: 2048 });
  assert.equal(readDimensions(new Uint8Array(10), "png"), null);
});

test("valid PNG, JPEG and WebP uploads pass the header checks", async () => {
  assert.deepEqual(await validateUpload(file(png(512, 512), "image/png")), { format: "png", width: 512, height: 512 });
  assert.deepEqual(await validateUpload(file(jpeg(300, 200), "image/jpeg")), { format: "jpeg", width: 300, height: 200 });
  assert.deepEqual(await validateUpload(file(webpLossy(64, 64), "image/webp")), { format: "webp", width: 64, height: 64 });
  assert.deepEqual(await validateUpload(file(png(MAX_DIMENSION, MAX_DIMENSION), "image/png")), { format: "png", width: MAX_DIMENSION, height: MAX_DIMENSION });
});

test("SVG, non-images, corrupt files, oversized files and oversized dimensions are rejected", async () => {
  const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><script>alert(1)</script></svg>");
  await reject(file(svg, "image/svg+xml"), "svg");
  await reject(file(svg, "image/png"), "unsupported"); // an SVG renamed to look like a PNG is still refused: the bytes decide
  await reject(file(new TextEncoder().encode("hello"), "text/plain"), "unsupported");
  await reject(file(new TextEncoder().encode("GIF89a......"), "image/gif"), "unsupported");
  await reject(file(png(8, 8), "image/gif"), "unsupported"); // PNG bytes with a GIF label are not an accepted declared type
  await reject(file(new Uint8Array(0), "image/png"), "empty");
  await reject(file(png(8, 8).slice(0, 12), "image/png"), "corrupt");
  await reject(file(png(8, 8), "image/png", MAX_BYTES + 1), "too-large");
  await reject(file(png(MAX_DIMENSION + 1, 64), "image/png"), "too-big");
  await reject(file(jpeg(64, MAX_DIMENSION + 1), "image/jpeg"), "too-big");
  await reject(file(png(100000, 100000), "image/png"), "too-big");
  await reject(null, "not-a-file");
});

test("rejection messages never contain a file name", async () => {
  const named = Object.assign(new Blob([new TextEncoder().encode("hello")], { type: "text/plain" }), { name: "C:\\Users\\private\\holiday.png" });
  try { await validateUpload(named); assert.fail("should reject"); } catch (error) {
    assert.ok(!/holiday|private|Users/.test(error.message));
  }
});

test("theme assets are three same-origin relative URLs and the slots are wall, floor and ceiling", () => {
  assert.deepEqual([...SLOTS], ["wall", "floor", "ceiling"]);
  for (const slot of SLOTS) {
    assert.match(BACKROOMS_ASSETS[slot], /^\.\/assets\/themes\/backrooms\/[a-z]+\.webp$/);
  }
  assert.equal(describeSources({ wall: "user", floor: "classic", ceiling: "builtin" }), "wall your image, floor Classic, ceiling built-in");
});

test("the appearance code has no network path for user images", () => {
  // Comments may name what is forbidden, so they are stripped before checking.
  const code = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/ .*$/gm, "");
  const themes = code("themes.js");
  const appearance = code("appearance.js");
  for (const forbidden of ["XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "FormData", "localStorage", "sessionStorage"]) {
    assert.ok(!themes.includes(forbidden), `themes.js must not use ${forbidden}`);
    assert.ok(!appearance.includes(forbidden), `appearance.js must not use ${forbidden}`);
  }
  assert.ok(!/\bfetch\(/.test(appearance), "appearance.js never calls fetch");
  // The only fetch in themes.js loads a built-in asset by a fixed relative URL.
  assert.equal((themes.match(/\bfetch\(/g) ?? []).length, 1);
  assert.ok(/fetch\(new URL\(url, base\)\.href/.test(themes));
  // Nothing derived from a file name is ever used: the name property is not read.
  assert.ok(!/\.name\b(?!\s*=\s*"TextureError")/.test(themes.replace(/this\.name = "TextureError"/, "").replace(/error\.name/g, "")), "file names are never read");
  assert.ok(!/files\?*\.\[0\]\.name|file\.name/.test(appearance));
});
