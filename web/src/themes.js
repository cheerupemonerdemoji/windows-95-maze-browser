// Optional texture themes: validation and decoding of images, local storage of custom textures, and the lazily loaded built-in
// Backrooms-inspired theme. Classic (the procedural textures) stays the faithful default; themes are an optional presentation
// choice and carry no Microsoft Maze evidence.
//
// Privacy: images are read with the File API, decoded with createImageBitmap and drawn to a canvas in the page. They are never
// sent anywhere (no fetch, XHR, form or beacon is ever given user data). The only thing stored is the resized runtime copy,
// in IndexedDB, under the fixed keys wall, floor and ceiling: no filename, path, metadata or original bytes are kept, and
// nothing about an upload goes into the URL, localStorage, telemetry or the evidence export.

export const TEXTURE_SIZE = 512; // runtime size of every theme texture (square, repeated once per wall and per floor or ceiling cell)
export const SLOTS = Object.freeze(["wall", "floor", "ceiling"]);
export const MAX_BYTES = 10 * 1024 * 1024; // per source image
export const MAX_DIMENSION = 4096; // per side of the decoded source
export const ACCEPTED_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp"]);
export const BACKROOMS_ASSETS = Object.freeze({
  wall: "./assets/themes/backrooms/wall.webp",
  floor: "./assets/themes/backrooms/floor.webp",
  ceiling: "./assets/themes/backrooms/ceiling.webp",
});
export const DB_NAME = "glmaze-appearance";
export const STORE_NAME = "textures";

/** Why an image was rejected; `message` is safe to show (it never contains a filename). */
export class TextureError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TextureError";
    this.code = code;
  }
}

/** Identifies the format from the first bytes. The declared MIME type is not trusted. SVG and text are never decoded. */
export function sniffFormat(bytes) {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return null;
}

const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le16 = (b, i) => b[i] | (b[i + 1] << 8);
const le24 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/** Reads the pixel dimensions from the file header without decoding, so an enormous image is refused before it uses memory. */
export function readDimensions(bytes, format) {
  const b = bytes;
  if (format === "png") {
    if (b.length < 24) return null;
    return { width: be32(b, 16), height: be32(b, 20) };
  }
  if (format === "jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = (b[i + 2] << 8) | b[i + 3];
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + length;
    }
    return null;
  }
  if (format === "webp") {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8X" && b.length >= 30) return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
    if (chunk === "VP8 " && b.length >= 30) return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
    if (chunk === "VP8L" && b.length >= 25) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  return null;
}

/**
 * Checks a user file (any object with size, type and arrayBuffer()) before it is decoded. Resolves to the sniffed format and
 * the dimensions from the header, or throws a TextureError with a message that is safe to show.
 */
export async function validateUpload(file) {
  if (!file || typeof file.size !== "number") throw new TextureError("not-a-file", "That is not an image file.");
  if (file.size === 0) throw new TextureError("empty", "That file is empty.");
  if (file.size > MAX_BYTES) throw new TextureError("too-large", `That image is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
  const type = String(file.type || "").toLowerCase();
  if (type === "image/svg+xml") throw new TextureError("svg", "SVG images are not accepted. Use PNG, JPEG or WebP.");
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 64 * 1024)).arrayBuffer());
  const format = sniffFormat(head);
  if (!format) throw new TextureError("unsupported", "That file is not a PNG, JPEG or WebP image.");
  if (type && !ACCEPTED_TYPES.includes(type)) throw new TextureError("unsupported", "That file type is not accepted. Use PNG, JPEG or WebP.");
  const size = readDimensions(head, format);
  if (!size || size.width < 1 || size.height < 1) throw new TextureError("corrupt", "That image could not be read; it may be damaged.");
  if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) throw new TextureError("too-big", `That image is larger than ${MAX_DIMENSION} pixels on a side.`);
  return { format, width: size.width, height: size.height };
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function bitmapFrom(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" }); // applies EXIF orientation
  } catch (error) {
    if (error && error.name === "InvalidStateError") throw error; // undecodable data: do not retry
    return createImageBitmap(blob); // browsers that reject the options object
  }
}

/**
 * Decodes an image blob to the runtime texture: RGBA8 pixels, TEXTURE_SIZE square. The picture is stretched to the square
 * (a seamless square source tiles best). Throws a TextureError when the image cannot be decoded.
 */
export async function decodeToTexture(blob) {
  let bitmap;
  try {
    bitmap = await bitmapFrom(blob);
  } catch {
    throw new TextureError("corrupt", "That image could not be decoded; it may be damaged.");
  }
  try {
    if (bitmap.width > MAX_DIMENSION || bitmap.height > MAX_DIMENSION) throw new TextureError("too-big", `That image is larger than ${MAX_DIMENSION} pixels on a side.`);
    const canvas = makeCanvas(TEXTURE_SIZE, TEXTURE_SIZE);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    const pixels = context.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    // Opaque: transparency would be cut out by the sprite shader's alpha test.
    const data = pixels.data;
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    return { width: TEXTURE_SIZE, height: TEXTURE_SIZE, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  } catch (error) {
    if (error instanceof TextureError) throw error;
    throw new TextureError("memory", "That image could not be prepared (not enough memory). Try a smaller image.");
  } finally {
    bitmap.close?.();
  }
}

/** Encodes runtime pixels as a lossless PNG blob for storage (the resized copy only; the original upload is discarded). */
export async function textureToBlob(texture) {
  const canvas = makeCanvas(texture.width, texture.height);
  const context = canvas.getContext("2d");
  context.putImageData(new ImageData(new Uint8ClampedArray(texture.data.buffer, texture.data.byteOffset, texture.data.byteLength), texture.width, texture.height), 0, 0);
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))), "image/png"));
}

/** Validates and decodes a user file in one step. */
export async function textureFromUpload(file) {
  await validateUpload(file);
  return decodeToTexture(file);
}

/** Fetches one built-in theme image from the same origin and decodes it. */
export async function loadBuiltin(url, base = (typeof document !== "undefined" ? document.baseURI : undefined)) {
  const response = await fetch(new URL(url, base).href, { credentials: "omit", cache: "force-cache" });
  if (!response.ok) throw new TextureError("missing", "A built-in theme image could not be loaded.");
  return decodeToTexture(await response.blob());
}

/** Loads all three Backrooms-inspired textures (lazily: only when the theme is chosen or restored). */
export async function loadBackrooms() {
  const [wall, floor, ceiling] = await Promise.all(SLOTS.map((slot) => loadBuiltin(BACKROOMS_ASSETS[slot])));
  return { wall, floor, ceiling };
}

// ---- IndexedDB storage of the resized custom textures ----

function openDb(factory = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new Error("IndexedDB is unavailable")); return; }
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed"));
    request.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

async function withStore(mode, run, factory) {
  const db = await openDb(factory);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const result = run(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(result?.result);
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

export const storage = {
  /** Stores the runtime copy of one slot. `blob` must come from textureToBlob (no filename or metadata). */
  save: (slot, blob, factory) => withStore("readwrite", (store) => store.put(blob, slot), factory),
  remove: (slot, factory) => withStore("readwrite", (store) => store.delete(slot), factory),
  clear: (factory) => withStore("readwrite", (store) => store.clear(), factory),
  /** Reads the stored blobs of the three slots (missing slots are null). */
  async loadBlobs(factory) {
    const out = { wall: null, floor: null, ceiling: null };
    await withStore("readonly", (store) => {
      for (const slot of SLOTS) {
        const request = store.get(slot);
        request.onsuccess = () => { out[slot] = request.result instanceof Blob ? request.result : null; };
      }
      return null;
    }, factory);
    return out;
  },
};

/**
 * Restores stored custom textures. Corrupt or undecodable entries are dropped and reported, so the caller can fall back to
 * Classic for that slot and say so.
 */
export async function restoreCustom(factory) {
  const result = { textures: { wall: null, floor: null, ceiling: null }, problems: [], available: true };
  let blobs;
  try {
    blobs = await storage.loadBlobs(factory);
  } catch {
    result.available = false;
    return result;
  }
  for (const slot of SLOTS) {
    if (!blobs[slot]) continue;
    try {
      result.textures[slot] = await decodeToTexture(blobs[slot]);
    } catch {
      result.problems.push(slot);
    }
  }
  return result;
}

/** Human-readable summary of where each slot's picture comes from, for the status line (never includes file names). */
export function describeSources(sources) {
  const label = { classic: "Classic", builtin: "built-in", user: "your image" };
  return SLOTS.map((slot) => `${slot} ${label[sources[slot]] ?? "Classic"}`).join(", ");
}
