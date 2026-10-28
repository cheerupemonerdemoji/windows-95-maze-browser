import { WORLD, buildMazeGeometry, markerBillboards } from "./webgl-geometry.js";
import { lookAt, multiply, perspective } from "./mat4.js";
import { createBrickTexture, createStippleTexture, createEmblemTexture, createPictureTexture, createRatTexture, createSmileyTexture, createStartSignTexture, createWoodTexture, createWhiteTexture } from "./procedural-textures.js";
import { buildSolids, buildSprite } from "./solids.js";

// Evidence classes per value (O observation / D derived / I inference / C reconstruction choice / U unknown):
//   fovYDegrees, aspect, near, far   O: constants passed to the projection call in the scene renderer (0x100203e): 90 degrees
//                vertical, aspect 1.0, near 0.01, far 100. The aspect is a constant, so the image is stretched to the window
//                (D: the horizontal FOV is also 90 degrees). Cross-checks against the captures are in camera.test.js.
//   eyeHeight    O: the eye is at z 0.5 of a cell whose floor is z 0 and ceiling z 1.0.
//   quality      'turbo' reproduces the observed 320x200 render buffer (O: the captured frames are built from 6 px wide blocks
//                on a 1920 px display); the other levels are browser choices (C). The original's Normal size is U.
export const CAMERA_CONFIG = Object.freeze({
  fovYDegrees: 90,
  aspect: 1,
  eyeHeight: WORLD.wallHeight / 2,
  near: 0.01,
  far: 100,
  // Reconstruction choice (C): the original camera stands exactly on cell edges, so floors, ceilings and walls start at the camera
  // plane. Software rasterizers (SwiftShader, found 2026-10-27) then mis-interpolate texture coordinates on those triangles and
  // draw them flat. Drawing the eye 0.015 cell behind the logical pose keeps every vertex beyond the near plane; the picture shifts
  // by 1.5% of a cell and no simulation, pose or telemetry value changes.
  eyeSetback: 0.015,
  maxPixelRatio: 2,
  turboSize: Object.freeze([320, 200]),
});

export const QUALITY_LEVELS = Object.freeze(["high", "standard", "turbo"]);

// Observation (OpenGL initialiser 0x1003f5c and object painter 0x1001b98): textured surfaces are unlit and unfogged;
// trigger solids alone enable legacy fixed-function lighting. LIGHT0 is positional at original (6, 6, 10), which maps
// to browser (6, 10, 6). The 0.04 ambient and 0.8 diffuse products are the OpenGL default global/material values.
export const LIGHT_CONFIG = Object.freeze({
  ambient: 0.04,
  diffuse: 0.8,
  position: Object.freeze([6, 10, 6]),
  fog: false,
});

// Trigger solids. Observation (placement in 0x10037a2, painter 0x1001b98): white, radius 0.25 cell, centre height 0.25 (so
// the solid rests on the floor), and the painter scales the height and the vertical position by the wall growth value.
export const OBJECT_CONFIG = Object.freeze({ radius: 0.25, height: 0.25 });

// Experimental sprites. The original records are camera-facing quads (0x10037a2, painter 0x1001b98). The logo uses
// half-width 1/3, half-height 0.33 and centre height 0.5; the rat uses half-width 0.25, half-height 0.125 and centre
// height 0.125. Neither has an independent decorative spin.
export const SPRITE_CONFIG = Object.freeze({
  logo: Object.freeze({ width: 2 / 3, height: 0.66, y: WORLD.wallHeight * 0.5 }),
  rat: Object.freeze({ width: 0.5, height: 0.25 }),
});

export function billboardAngle(eyeX, eyeZ, spriteX, spriteZ) {
  return Math.atan2(eyeX - spriteX, eyeZ - spriteZ);
}

const VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUv;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vPosition;
out vec3 vNormal;
out vec2 vUv;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vPosition = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vUv = aUv;
  gl_Position = uViewProj * world;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vPosition;
in vec3 vNormal;
in vec2 vUv;
uniform sampler2D uTexture;
uniform vec3 uLightPosition;
uniform vec2 uLight; // ambient, diffuse
uniform float uLighting;
out vec4 outColor;
void main() {
  vec4 texel = texture(uTexture, vUv);
  if (texel.a < 0.5) discard; // cut-out sprites (logo objects, rats)
  vec3 color = texel.rgb;
  if (uLighting > 0.5) {
    vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
    vec3 toLight = normalize(uLightPosition - vPosition);
    color *= uLight.x + uLight.y * max(dot(n, toLight), 0.0);
  }
  outColor = vec4(color, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

export class WebGLMazeRenderer {
  /** `onContextLost` / `onContextRestored` let the app switch views; neither starts a loop. */
  constructor(canvas, { onContextLost = null, onContextRestored = null } = {}) {
    this.canvas = canvas;
    this.onContextLost = onContextLost;
    this.onContextRestored = onContextRestored;
    this.gl = canvas.getContext("webgl2", { antialias: true, alpha: false, powerPreference: "high-performance" });
    if (!this.gl) throw new Error("WebGL 2 is not available.");
    this.contextLost = false;
    this.maze = null;
    this.geometry = null;
    this.resources = null;
    this.liveTextures = 0;
    this.theme = { walls: null, floor: null, ceiling: null }; // GL textures of the active theme (null = classic)
    this.themeData = { walls: null, floor: null, ceiling: null }; // their pixels, kept so a lost context can be restored
    this.aspect = 1;
    this.proj = new Float32Array(16);
    this.view = new Float32Array(16);
    this.viewProj = new Float32Array(16);
    this.fovY = (CAMERA_CONFIG.fovYDegrees * Math.PI) / 180;
    this.lightPosition = new Float32Array(LIGHT_CONFIG.position);
    this.lightParams = new Float32Array([LIGHT_CONFIG.ambient, LIGHT_CONFIG.diffuse]);
    this.model = new Float32Array(16);
    this.wallModel = new Float32Array(16);
    this.identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    this.quality = "high";
    this.markersEnabled = false;
    this.picturesEnabled = false;
    this.logosEnabled = false;
    this.sprite = buildSprite();
    this.solids = buildSolids();

    this.handleLost = (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.resources = null; // all GL objects died with the context
      this.liveTextures = 0;
      this.theme = { walls: null, floor: null, ceiling: null };
      this.onContextLost?.();
    };
    this.handleRestored = () => {
      try {
        this.createResources();
        this.uploadThemeTextures();
        if (this.maze) this.uploadGeometry();
        this.contextLost = false;
      } catch (error) {
        this.contextLost = true;
        console.error(error);
        return;
      }
      this.onContextRestored?.();
    };
    canvas.addEventListener("webglcontextlost", this.handleLost);
    canvas.addEventListener("webglcontextrestored", this.handleRestored);
    this.createResources();
  }

  /**
   * Creates one texture with the original sampling state. Observation (0x1003f5c): GL_NEAREST for both minification and
   * magnification, repeat in S and T, no mipmaps. Themes reuse this, so they keep the original filtering and repeat behaviour.
   */
  makeTexture({ width, height, data }) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.liveTextures += 1;
    return texture;
  }

  deleteTexture(texture) {
    if (!texture) return;
    this.gl.deleteTexture(texture);
    this.liveTextures = Math.max(0, this.liveTextures - 1);
  }

  /**
   * Replaces the wall, floor and ceiling textures with theme images (each {width, height, data: RGBA bytes}) or restores a
   * classic one with null. Called only when a theme is selected or restored, never per frame. The superseded GL textures are
   * deleted and the pixel data is kept only for the active theme so a lost context can be restored.
   */
  setThemeTextures({ wall = null, floor = null, ceiling = null } = {}) {
    const incoming = { walls: wall, floor, ceiling };
    for (const slot of ["walls", "floor", "ceiling"]) {
      this.deleteTexture(this.theme[slot]);
      this.theme[slot] = null;
      this.themeData[slot] = incoming[slot];
    }
    if (!this.contextLost && this.resources) this.uploadThemeTextures();
  }

  uploadThemeTextures() {
    for (const slot of ["walls", "floor", "ceiling"]) {
      if (this.themeData[slot] && !this.theme[slot]) this.theme[slot] = this.makeTexture(this.themeData[slot]);
    }
  }

  /** Live GL texture count and an estimate of the GPU bytes held by theme textures (RGBA8, no mipmaps). */
  textureStats() {
    let themeBytes = 0;
    for (const slot of ["walls", "floor", "ceiling"]) if (this.theme[slot]) themeBytes += this.themeData[slot].width * this.themeData[slot].height * 4;
    return { live: this.liveTextures, themeBytes };
  }

  createResources() {
    const gl = this.gl;
    const program = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.bindAttribLocation(program, 1, "aNormal");
    gl.bindAttribLocation(program, 2, "aUv");
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link failed: ${log}`);
    }
    const uniform = (name) => gl.getUniformLocation(program, name);
    const makeTexture = (spec) => this.makeTexture(spec);
    this.resources = {
      program,
      uniforms: {
        viewProj: uniform("uViewProj"), lightPosition: uniform("uLightPosition"), light: uniform("uLight"),
        lighting: uniform("uLighting"), texture: uniform("uTexture"),
        model: uniform("uModel"),
      },
      textures: { walls: makeTexture(createBrickTexture()), floor: makeTexture(createWoodTexture()), ceiling: makeTexture(createStippleTexture()), white: makeTexture(createWhiteTexture()), start: makeTexture(createStartSignTexture()), smiley: makeTexture(createSmileyTexture()), picture: makeTexture(createPictureTexture()), emblem: makeTexture(createEmblemTexture()), rat: makeTexture(createRatTexture()) },
      spriteVao: gl.createVertexArray(),
      spriteBuffer: gl.createBuffer(),
      solidVao: gl.createVertexArray(),
      solidBuffer: gl.createBuffer(),
      vao: gl.createVertexArray(),
      vertexBuffer: gl.createBuffer(),
      indexBuffer: gl.createBuffer(),
    };
    // Static uniforms are set once. Textured geometry is unlit; only trigger-solid draws opt into lighting per frame.
    gl.useProgram(program);
    gl.uniform1i(this.resources.uniforms.texture, 0);
    gl.uniform3fv(this.resources.uniforms.lightPosition, this.lightPosition);
    gl.uniform2fv(this.resources.uniforms.light, this.lightParams);
    gl.uniform1f(this.resources.uniforms.lighting, 0);
    this.uploadSolids();
    this.uploadSprite();
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
  }

  /** Static trigger-solid geometry (position and normal, flat white) uploaded once per context. */
  uploadSolids() {
    const gl = this.gl;
    const { solidVao, solidBuffer } = this.resources;
    const n = this.solids.positions.length / 3;
    const data = new Float32Array(n * 8);
    for (let i = 0; i < n; i += 1) {
      data.set(this.solids.positions.subarray(i * 3, i * 3 + 3), i * 8);
      data.set(this.solids.normals.subarray(i * 3, i * 3 + 3), i * 8 + 3);
    }
    gl.bindVertexArray(solidVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, solidBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.disableVertexAttribArray(2);
    gl.vertexAttrib2f(2, 0.5, 0.5);
    gl.bindVertexArray(null);
  }

  uploadSprite() {
    const gl = this.gl;
    const { spriteVao, spriteBuffer } = this.resources;
    gl.bindVertexArray(spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.sprite, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    gl.bindVertexArray(null);
  }

  /** Experimental flags: picture walls and logo objects (rats are passed per frame by the app). */
  setExperimental({ pictures = false, logos = false } = {}) {
    this.picturesEnabled = Boolean(pictures);
    this.logosEnabled = Boolean(logos);
  }

  /** Start/exit markers are an experimental flag (billboard art is not the original's); geometry is always uploaded. */
  setMarkers(enabled) {
    this.markersEnabled = Boolean(enabled);
  }

  /** 'high' (DPR up to 2), 'standard' (DPR 1) or 'turbo' (the observed 320x200 buffer, pixelated). */
  setQuality(level) {
    if (!QUALITY_LEVELS.includes(level)) throw new RangeError(`Unknown quality level: ${level}`);
    this.quality = level;
    this.canvas.style.imageRendering = level === "turbo" ? "pixelated" : "";
  }

  /** Builds geometry only when the maze object changes, then uploads it once. */
  setMaze(maze) {
    if (maze === this.maze) return;
    this.maze = maze;
    this.geometry = buildMazeGeometry(maze);
    if (!this.contextLost && this.resources) this.uploadGeometry();
  }

  uploadGeometry() {
    const gl = this.gl;
    const g = this.geometry;
    const interleaved = new Float32Array(g.vertexCount * 8);
    for (let i = 0; i < g.vertexCount; i += 1) {
      interleaved.set(g.positions.subarray(i * 3, i * 3 + 3), i * 8);
      interleaved.set(g.normals.subarray(i * 3, i * 3 + 3), i * 8 + 3);
      interleaved.set(g.uvs.subarray(i * 2, i * 2 + 2), i * 8 + 6);
    }
    const { vao, vertexBuffer, indexBuffer } = this.resources;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.indices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    gl.bindVertexArray(null);
  }

  /** Matches the drawing buffer to the CSS size; returns false when the canvas is not laid out. */
  resize() {
    const cssWidth = this.canvas.clientWidth;
    const cssHeight = this.canvas.clientHeight;
    if (cssWidth < 1 || cssHeight < 1) return false;
    let width;
    let height;
    if (this.quality === "turbo") {
      [width, height] = CAMERA_CONFIG.turboSize; // stretched to the canvas like the original
    } else {
      const ratio = this.quality === "standard" ? 1 : Math.min(window.devicePixelRatio || 1, CAMERA_CONFIG.maxPixelRatio);
      width = Math.max(1, Math.round(cssWidth * ratio));
      height = Math.max(1, Math.round(cssHeight * ratio));
    }
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    // The projection aspect is the constant 1.0 whatever the window or buffer shape (observation), so the picture is
    // stretched to the canvas as in the original.
    this.aspect = CAMERA_CONFIG.aspect;
    return true;
  }

  /**
   * Draws one frame from the walker pose. Never mutates maze or walker state.
   * `roll` is the scene roll in radians (0 upright, pi inverted); `growth` (0..1) scales the walls, markers and
   * pictures vertically about the floor (observed entrance transition; floor and ceiling stay full); `simUpdates` drives the solid spin; `consumed` hides collected triggers.
   */
  render(pose, { roll = 0, growth = 1, simUpdates = 0, consumed = null, rats = null } = {}) {
    if (this.contextLost || !this.resources || !this.geometry) return;
    if (!this.resize()) return;
    const gl = this.gl;
    const { program, uniforms, textures, vao } = this.resources;
    const fx = Math.sin(pose.heading), fz = -Math.cos(pose.heading);
    // The eye is drawn a hair behind the logical camera so no surface that touches the camera plane has a vertex closer than
    // the near plane (see CAMERA_CONFIG.eyeSetback).
    const ex = pose.x + 0.5 - fx * CAMERA_CONFIG.eyeSetback, ez = pose.y + 0.5 - fz * CAMERA_CONFIG.eyeSetback, ey = CAMERA_CONFIG.eyeHeight;
    // right = forward x up = (cos h, 0, sin h); rolling tilts up toward it.
    const sr = Math.sin(roll), cr = Math.cos(roll);
    perspective(this.proj, this.fovY, this.aspect, CAMERA_CONFIG.near, CAMERA_CONFIG.far);
    lookAt(this.view, ex, ey, ez, ex + fx, ey, ez + fz, sr * Math.cos(pose.heading), cr, sr * Math.sin(pose.heading));
    multiply(this.viewProj, this.proj, this.view);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.viewProj, false, this.viewProj);
    gl.uniformMatrix4fv(uniforms.model, false, this.identity);
    gl.uniform1f(uniforms.lighting, 0);
    const growthClamp = Math.min(1, Math.max(0, growth)); // the raw value overshoots to 1.025 and -0.025, hidden by the ceiling and floor
    wallGrowthMatrix(this.wallModel, growth);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);

    const { ranges } = this.geometry;
    gl.uniformMatrix4fv(uniforms.model, false, this.wallModel);
    gl.disable(gl.CULL_FACE); // shared walls are double-sided
    gl.bindTexture(gl.TEXTURE_2D, this.theme.walls ?? textures.walls);
    gl.drawElements(gl.TRIANGLES, ranges.sharedWalls.count, gl.UNSIGNED_INT, ranges.sharedWalls.start * 4);
    gl.enable(gl.CULL_FACE); // the closed entrance and exit boundary walls are single-sided: invisible from behind
    gl.drawElements(gl.TRIANGLES, ranges.boundaryWalls.count, gl.UNSIGNED_INT, ranges.boundaryWalls.start * 4);
    gl.uniformMatrix4fv(uniforms.model, false, this.identity); // floor and ceiling are single-sided
    gl.bindTexture(gl.TEXTURE_2D, this.theme.floor ?? textures.floor);
    gl.drawElements(gl.TRIANGLES, ranges.floor.count, gl.UNSIGNED_INT, ranges.floor.start * 4);
    gl.bindTexture(gl.TEXTURE_2D, this.theme.ceiling ?? textures.ceiling);
    gl.drawElements(gl.TRIANGLES, ranges.ceiling.count, gl.UNSIGNED_INT, ranges.ceiling.start * 4);

    if (this.picturesEnabled && ranges.pictures.count > 0) {
      gl.uniformMatrix4fv(uniforms.model, false, this.wallModel);
      gl.bindTexture(gl.TEXTURE_2D, textures.picture);
      gl.drawElements(gl.TRIANGLES, ranges.pictures.count, gl.UNSIGNED_INT, ranges.pictures.start * 4);
    }

    const logos = this.logosEnabled ? this.maze?.logos : null;
    const hasRats = rats && rats.length > 0;
    if ((logos && logos.length) || hasRats || this.markersEnabled) {
      gl.bindVertexArray(this.resources.spriteVao);
      gl.disable(gl.CULL_FACE);
      if (this.markersEnabled) {
        // Start sign and smiley: camera-facing quads at the entrance and exit cell centres, eye height, scaled with the
        // wall growth value like the walls (observation: original object painter 0x1001b98).
        const g = growthClamp;
        const facing = -pose.heading; // the quad normal (+Z rotated by angleY) points back at the camera
        for (const marker of markerBillboards(this.maze)) {
          gl.bindTexture(gl.TEXTURE_2D, marker.kind === "start" ? textures.start : textures.smiley);
          composeSprite(this.model, marker.x, marker.y * g, marker.z, facing, marker.width, marker.height * g);
          gl.uniformMatrix4fv(uniforms.model, false, this.model);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
      }
      if (logos) {
        gl.bindTexture(gl.TEXTURE_2D, textures.emblem);
        const { width, height, y } = SPRITE_CONFIG.logo;
        for (const logo of logos) {
          const lx = logo.x + 0.5;
          const lz = logo.y + 0.5;
          composeSprite(this.model, lx, y, lz, billboardAngle(ex, ez, lx, lz), width, height);
          gl.uniformMatrix4fv(uniforms.model, false, this.model);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
      }
      if (hasRats) {
        gl.bindTexture(gl.TEXTURE_2D, textures.rat);
        const { width, height } = SPRITE_CONFIG.rat;
        for (const rat of rats) {
          const rx = rat.pose.x + 0.5;
          const rz = rat.pose.y + 0.5;
          composeSprite(this.model, rx, height / 2 + 0.001, rz, billboardAngle(ex, ez, rx, rz), width, height);
          gl.uniformMatrix4fv(uniforms.model, false, this.model);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
      }
      gl.enable(gl.CULL_FACE);
    }

    const twisters = this.maze?.twisters;
    if (twisters && twisters.length) {
      gl.uniform1f(uniforms.lighting, 1);
      gl.bindVertexArray(this.resources.solidVao);
      gl.bindTexture(gl.TEXTURE_2D, textures.white);
      const degrees = Math.PI / 180;
      for (const t of twisters) {
        if (consumed && consumed.has(`${t.x},${t.y}`)) continue;
        composeModel(this.model, t.x + 0.5, OBJECT_CONFIG.height, t.y + 0.5, t.spinZ * simUpdates * degrees, t.spinX * simUpdates * degrees, OBJECT_CONFIG.radius);
        scaleHeight(this.model, growthClamp);
        gl.uniformMatrix4fv(uniforms.model, false, this.model);
        const range = this.solids.ranges[t.shape];
        gl.drawArrays(gl.TRIANGLES, range.first, range.count);
      }
    }
    gl.bindVertexArray(null);
  }

  disposeResources() {
    const gl = this.gl;
    const r = this.resources;
    if (!r || this.contextLost) return;
    gl.deleteProgram(r.program);
    for (const texture of Object.values(r.textures)) this.deleteTexture(texture);
    for (const slot of ["walls", "floor", "ceiling"]) { this.deleteTexture(this.theme[slot]); this.theme[slot] = null; this.themeData[slot] = null; } // release the active theme
    gl.deleteVertexArray(r.vao);
    gl.deleteVertexArray(r.solidVao);
    gl.deleteVertexArray(r.spriteVao);
    gl.deleteBuffer(r.spriteBuffer);
    gl.deleteBuffer(r.solidBuffer);
    gl.deleteBuffer(r.vertexBuffer);
    gl.deleteBuffer(r.indexBuffer);
    this.resources = null;
  }

  dispose() {
    this.canvas.removeEventListener("webglcontextlost", this.handleLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleRestored);
    this.disposeResources();
    this.themeData = { walls: null, floor: null, ceiling: null };
    this.geometry = null;
    this.maze = null;
  }
}

/** Model matrix = translate * Rvertical * Rx * uniform scale, matching original glRotate Z then X after axis mapping. */
export function composeModel(out, x, y, z, angleVertical, angleX, scale) {
  const cy = Math.cos(angleVertical), sy = Math.sin(angleVertical), cx = Math.cos(angleX), sx = Math.sin(angleX);
  out[0] = cy * scale; out[1] = 0; out[2] = -sy * scale; out[3] = 0;
  out[4] = sy * sx * scale; out[5] = cx * scale; out[6] = cy * sx * scale; out[7] = 0;
  out[8] = sy * cx * scale; out[9] = -sx * scale; out[10] = cy * cx * scale; out[11] = 0;
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}

/** Vertical growth about the floor for walls, markers and pictures (the observed entrance transition). */
export function wallGrowthMatrix(out, growth) {
  out.fill(0);
  out[0] = 1; out[5] = Math.min(1, Math.max(0, growth)); out[10] = 1; out[15] = 1;
  return out;
}

/** Scales a column-major model matrix vertically about the floor (the painter's glScaled(1, 1, growth) and z * growth). */
export function scaleHeight(out, growth) {
  out[1] *= growth; out[5] *= growth; out[9] *= growth; out[13] *= growth;
  return out;
}

/** Model matrix for a sprite quad: translate * Ry(angle) * scale(width, height, 1), column-major. */
export function composeSprite(out, x, y, z, angleY, width, height) {
  const c = Math.cos(angleY), s = Math.sin(angleY);
  out[0] = c * width; out[1] = 0; out[2] = -s * width; out[3] = 0;
  out[4] = 0; out[5] = height; out[6] = 0; out[7] = 0;
  out[8] = s; out[9] = 0; out[10] = c; out[11] = 0;
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}
