'use strict';
// Voxel models and a face-culling mesher with baked ambient occlusion.
(function (VC) {
  const OFF = 512;
  function key(x, y, z) { return (x + OFF) | ((y + OFF) << 10) | ((z + OFF) << 20); }

  /** '#fff' / '#a0703c' / 0xa0703c -> integer colour. */
  function toInt(c) {
    if (typeof c !== 'string') return c;
    let h = c.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return parseInt(h, 16);
  }

  function hexToRgb(c) {
    c = toInt(c);
    return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  }

  class Vox {
    constructor() {
      this.map = new Map();
      this.minX = this.minY = this.minZ = Infinity;
      this.maxX = this.maxY = this.maxZ = -Infinity;
    }
    set(x, y, z, c) {
      x = Math.round(x); y = Math.round(y); z = Math.round(z);
      if (c === null || c === undefined) { this.map.delete(key(x, y, z)); return; }
      this.map.set(key(x, y, z), toInt(c));
      if (x < this.minX) this.minX = x; if (x > this.maxX) this.maxX = x;
      if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y;
      if (z < this.minZ) this.minZ = z; if (z > this.maxZ) this.maxZ = z;
    }
    get(x, y, z) { return this.map.get(key(x, y, z)); }
    has(x, y, z) { return this.map.has(key(x, y, z)); }
    del(x, y, z) { this.map.delete(key(x, y, z)); }
    box(x0, y0, z0, x1, y1, z1, c) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
          for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.set(x, y, z, c);
    }
    /** Ellipsoid centred at (cx,cy,cz) with radii rx,ry,rz. */
    ball(cx, cy, cz, rx, ry, rz, c, filter) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
          for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
            const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
            if (d <= 1 && (!filter || filter(x, y, z))) this.set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
          }
    }
    /** Line of voxels from a to b (inclusive), optional thickness radius. */
    line(x0, y0, z0, x1, y1, z1, c, r) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 1);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, z = z0 + (z1 - z0) * t;
        if (r) this.ball(x, y, z, r, r, r, c); else this.set(x, y, z, c);
      }
    }
    each(fn) {
      for (const [k, c] of this.map) {
        fn((k & 1023) - OFF, ((k >> 10) & 1023) - OFF, ((k >> 20) & 1023) - OFF, c);
      }
    }
    get count() { return this.map.size; }
  }

  // Face definitions: normal, the 4 corners (unit cube), and the two in-plane axes for AO.
  const FACES = [
    { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.82 },
    { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], shade: 0.82 },
    { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.55 },
    { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], shade: 0.92 },
    { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: 0.92 },
  ];
  const AO = [0.5, 0.68, 0.84, 1.0];

  /**
   * Builds a BufferGeometry. opts: { scale, center: [x,y,z] in voxels or 'base', noise, seed }
   * Coordinates: model voxel (x,y,z) occupies [x,x+1] etc., scaled by `scale`.
   */
  function mesh(v, opts) {
    opts = opts || {};
    const s = opts.scale || 0.25;
    let ox = 0, oy = 0, oz = 0;
    if (opts.center === 'base') {
      ox = (v.minX + v.maxX + 1) / 2; oy = v.minY; oz = (v.minZ + v.maxZ + 1) / 2;
    } else if (Array.isArray(opts.center)) [ox, oy, oz] = opts.center;
    const noise = opts.noise === undefined ? 0.05 : opts.noise;
    const pos = [], nor = [], col = [], idx = [];
    let vi = 0;
    const solid = (x, y, z) => v.map.has(key(x, y, z));
    v.each((x, y, z, c) => {
      const rgb = hexToRgb(c);
      // Stable per-voxel noise so surfaces look hand-painted rather than flat.
      const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
      const nz = 1 + ((h - Math.floor(h)) - 0.5) * 2 * noise;
      for (const f of FACES) {
        const nx = x + f.n[0], ny = y + f.n[1], nzz = z + f.n[2];
        if (solid(nx, ny, nzz)) continue;
        const aos = [];
        for (const corner of f.c) {
          // In-plane neighbour offsets for this corner.
          const d = [corner[0] * 2 - 1, corner[1] * 2 - 1, corner[2] * 2 - 1];
          const u = [0, 0, 0], w = [0, 0, 0];
          let axes = [0, 1, 2].filter(a => f.n[a] === 0);
          u[axes[0]] = d[axes[0]];
          w[axes[1]] = d[axes[1]];
          const s1 = solid(nx + u[0], ny + u[1], nzz + u[2]) ? 1 : 0;
          const s2 = solid(nx + w[0], ny + w[1], nzz + w[2]) ? 1 : 0;
          const cc = solid(nx + u[0] + w[0], ny + u[1] + w[1], nzz + u[2] + w[2]) ? 1 : 0;
          const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
          aos.push(AO[ao]);
          pos.push((x + corner[0] - ox) * s, (y + corner[1] - oy) * s, (z + corner[2] - oz) * s);
          nor.push(f.n[0], f.n[1], f.n[2]);
        }
        for (let k = 0; k < 4; k++) {
          const b = f.shade * aos[k] * nz;
          col.push(rgb[0] * b, rgb[1] * b, rgb[2] * b);
        }
        // Flip the quad diagonal to avoid AO anisotropy.
        if (aos[0] + aos[2] < aos[1] + aos[3]) idx.push(vi + 1, vi + 2, vi + 3, vi + 1, vi + 3, vi);
        else idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        vi += 4;
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(vi > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }

  let sharedMat = null;
  function material(opts) {
    if (!opts && sharedMat) return sharedMat;
    const m = new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true }, opts || {}));
    if (!opts) sharedMat = m;
    return m;
  }

  function toMesh(v, opts) {
    const g = mesh(v, opts);
    const m = new THREE.Mesh(g, (opts && opts.material) || material());
    return m;
  }

  VC.Voxel = { Vox, mesh, toMesh, material, hexToRgb, toInt };
})(window.VC);
