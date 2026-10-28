// Minimal column-major 4×4 matrix helpers (WebGL layout). Each writes into `out`
// so the per-frame path allocates nothing.

export function perspective(out, fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function lookAt(out, ex, ey, ez, tx, ty, tz, ux, uy, uz) {
  let zx = ex - tx, zy = ey - ty, zz = ez - tz;
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * ex + xy * ey + xz * ez);
  out[13] = -(yx * ex + yy * ey + yz * ez);
  out[14] = -(zx * ex + zy * ey + zz * ez);
  out[15] = 1;
  return out;
}

export function multiply(out, a, b) {
  for (let col = 0; col < 4; col += 1) {
    const b0 = b[col * 4], b1 = b[col * 4 + 1], b2 = b[col * 4 + 2], b3 = b[col * 4 + 3];
    out[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}
