// More sculpting tools for the demo: terraces, stamps and erosion. Written like
// the engine's brushes (terrain-brush.ts): in terrain space, on the grid's
// global vertices, returning the vertices changed, so they can move there.
import { brushFalloff, BrushSettings, TerrainGrid, touchAround, VertexRect } from 'omega-game-engine';

/** The vertices within `r` of terrain-space (x, z), clipped to nothing when empty. */
function around(grid: TerrainGrid, x: number, z: number, r: number): VertexRect & { s: number } {
  const s = grid.settings.size / grid.settings.resolution;
  return { s, i0: Math.ceil((x - r) / s), i1: Math.floor((x + r) / s), j0: Math.ceil((z - r) / s), j1: Math.floor((z + r) / s) };
}

const smoothstep = (a: number, b: number, t: number) => {
  const k = Math.min(Math.max((t - a) / (b - a), 0), 1);
  return k * k * (3 - 2 * k);
};

// ---- Terraces ----

/** The terraced height for `h`: flat steps `step` metres apart with short, steep risers between. */
export function terraceHeight(h: number, step: number): number {
  const q = h / step, base = Math.floor(q);
  return (base + smoothstep(0.38, 0.62, q - base)) * step;
}

/**
 * One step of the terrace brush: heights move towards flat steps `step`
 * metres apart, as fast as `strength` (0 to 1) pulls, less towards the edge.
 */
export function terrace(grid: TerrainGrid, x: number, z: number, brush: BrushSettings, dt: number, step: number): VertexRect | null {
  const r = Math.max(brush.radius, 0.5);
  const { s, i0, i1, j0, j1 } = around(grid, x, z, r);
  let changed = false;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const h = grid.vertexHeight(i, j);
      if (h === undefined) continue;
      const f = brushFalloff(Math.hypot(i * s - x, j * s - z) / r, brush.hardness);
      if (f <= 0) continue;
      const pull = 1 - Math.pow(1 - Math.min(brush.strength, 1), dt * 10 * f);
      const next = h + (terraceHeight(h, step) - h) * pull;
      if (next !== h) { grid.setVertexHeight(i, j, next); changed = true; }
    }
  }
  if (!changed) return null;
  const rect = { i0, j0, i1, j1 };
  touchAround(grid, rect);
  return rect;
}

// ---- Stamps ----

export type StampShape = 'hill' | 'crater' | 'plateau' | 'volcano';

/** A stamp's height at t = distance / radius (0 at the middle to 1 at the edge), for a height of 1. Zero from t = 1 on. */
export function stampProfile(shape: StampShape, t: number): number {
  if (t >= 1) return 0;
  switch (shape) {
    case 'hill': return 0.5 + 0.5 * Math.cos(Math.PI * t);
    case 'plateau': return 1 - smoothstep(0.5, 1, t);
    case 'crater': {
      const bowl = -0.6 * (1 - smoothstep(0, 0.72, t));
      const rim = 0.4 * Math.exp(-(((t - 0.72) / 0.13) ** 2));
      return (bowl + rim) * (1 - smoothstep(0.85, 1, t));
    }
    case 'volcano': {
      const cone = Math.pow(1 - t, 1.4);
      const caldera = 0.45 * (1 - smoothstep(0, 0.22, t));
      return (cone - caldera) * (1 - smoothstep(0.9, 1, t));
    }
  }
}

/** Adds a stamp `height` metres high (negative digs it in) of `radius` at terrain-space (x, z). */
export function stamp(grid: TerrainGrid, shape: StampShape, x: number, z: number, radius: number, height: number): VertexRect | null {
  const r = Math.max(radius, 0.5);
  const { s, i0, i1, j0, j1 } = around(grid, x, z, r);
  let changed = false;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const h = grid.vertexHeight(i, j);
      if (h === undefined) continue;
      const d = stampProfile(shape, Math.hypot(i * s - x, j * s - z) / r) * height;
      if (d !== 0) { grid.setVertexHeight(i, j, h + d); changed = true; }
    }
  }
  if (!changed) return null;
  const rect = { i0, j0, i1, j1 };
  touchAround(grid, rect);
  return rect;
}

// ---- Erosion ----

/** How the water drops behave (the usual droplet erosion). */
export const EROSION = {
  inertia: 0.08,
  capacity: 4,
  minCapacity: 0.01,
  deposit: 0.3,
  erode: 0.3,
  evaporate: 0.02,
  gravity: 4,
  steps: 40,
  /** No more than this (m) taken from or left at one place in one step. */
  maxChange: 0.12,
  /** Earth is taken from the vertices this far round a drop (in vertices), so it cuts gullies, not needles. */
  radius: 2.5,
};

/** The vertices within EROSION.radius of (0, 0) with their weights (summing to 1). */
const KERNEL = (() => {
  const out: [number, number, number][] = [];
  const r = EROSION.radius, n = Math.ceil(r);
  let sum = 0;
  for (let dj = -n; dj <= n + 1; dj++) for (let di = -n; di <= n + 1; di++) {
    const w = Math.max(0, 1 - Math.hypot(di - 0.5, dj - 0.5) / r);
    if (w > 0) { out.push([di, dj, w]); sum += w; }
  }
  return out.map(([di, dj, w]) => [di, dj, w / sum] as [number, number, number]);
})();

/**
 * Hydraulic erosion under the brush: `drops` drops of water start inside it,
 * run downhill picking up earth where they speed up and leaving it where they
 * slow down, which cuts gullies and fills hollows. Drops stop 1.5 radii out.
 * `random` gives 0 to 1 (seeded for tests). Returns the vertices changed.
 */
export function erode(grid: TerrainGrid, x: number, z: number, brush: BrushSettings, drops: number, random: () => number = Math.random): VertexRect | null {
  const s = grid.settings.size / grid.settings.resolution;
  const r = Math.max(brush.radius, s);
  const reach = r * 1.5;
  const E = EROSION;
  // Drop positions are in vertex units (global vertex = 1).
  const cx = x / s, cz = z / s, rv = r / s, reachV = reach / s;
  // The drops work on a copy of the heights around the brush, written back at the end.
  const pad = Math.ceil(EROSION.radius) + 2;
  const gi0 = Math.floor(cx - reachV) - pad, gj0 = Math.floor(cz - reachV) - pad;
  const W = Math.ceil(cx + reachV) + pad - gi0 + 1, H = Math.ceil(cz + reachV) + pad - gj0 + 1;
  const hs = new Float32Array(W * H), has = new Uint8Array(W * H), dirty = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const h = grid.vertexHeight(gi0 + i, gj0 + j);
    if (h !== undefined) { hs[j * W + i] = h; has[j * W + i] = 1; }
  }
  const get = (i: number, j: number) => {
    const li = i - gi0, lj = j - gj0;
    return li < 0 || lj < 0 || li >= W || lj >= H || !has[lj * W + li] ? undefined : hs[lj * W + li];
  };
  const at = (px: number, pz: number) => {
    const ix = Math.floor(px), iz = Math.floor(pz);
    const h00 = get(ix, iz), h10 = get(ix + 1, iz), h01 = get(ix, iz + 1), h11 = get(ix + 1, iz + 1);
    if (h00 === undefined || h10 === undefined || h01 === undefined || h11 === undefined) return undefined;
    const fx = px - ix, fz = pz - iz;
    return {
      ix, iz, fx, fz,
      h: h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz,
      gx: ((h10 - h00) * (1 - fz) + (h11 - h01) * fz) / s,
      gz: ((h01 - h00) * (1 - fx) + (h11 - h10) * fx) / s,
    };
  };
  const add = (i: number, j: number, amount: number) => {
    const li = i - gi0, lj = j - gj0;
    if (li < 0 || lj < 0 || li >= W || lj >= H || !has[lj * W + li]) return;
    hs[lj * W + li] += amount;
    dirty[lj * W + li] = 1;
  };
  /** Leaves `amount` (m) on the four vertices around a point, by their bilinear weights. */
  const deposit = (ix: number, iz: number, fx: number, fz: number, amount: number) => {
    add(ix, iz, amount * (1 - fx) * (1 - fz));
    add(ix + 1, iz, amount * fx * (1 - fz));
    add(ix, iz + 1, amount * (1 - fx) * fz);
    add(ix + 1, iz + 1, amount * fx * fz);
  };
  /** Takes `amount` (m) from the vertices round a point (the kernel). */
  const take = (ix: number, iz: number, amount: number) => {
    for (const [di, dj, w] of KERNEL) add(ix + di, iz + dj, -amount * w);
  };
  for (let d = 0; d < drops; d++) {
    // A start inside the brush, more often where its weight is high.
    let px = 0, pz = 0, ok = false;
    for (let tries = 0; tries < 8 && !ok; tries++) {
      const a = random() * Math.PI * 2, m = Math.sqrt(random()) * rv;
      px = cx + Math.cos(a) * m;
      pz = cz + Math.sin(a) * m;
      ok = random() < brushFalloff(m / rv, brush.hardness);
    }
    if (!ok) continue;
    let dx = 0, dz = 0, speed = 1, water = 1, sediment = 0;
    for (let step = 0; step < E.steps; step++) {
      const here = at(px, pz);
      if (!here) break;
      dx = dx * E.inertia - here.gx * (1 - E.inertia);
      dz = dz * E.inertia - here.gz * (1 - E.inertia);
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) break;
      dx /= len; dz /= len;
      const nx = px + dx, nz = pz + dz;
      if (Math.hypot(nx - cx, nz - cz) > reachV) break;
      const next = at(nx, nz);
      if (!next) break;
      const dh = next.h - here.h;
      const capacity = Math.max(-dh * speed * water * E.capacity, E.minCapacity);
      if (sediment > capacity || dh > 0) {
        const amount = Math.min(dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * E.deposit, E.maxChange);
        sediment -= amount;
        deposit(here.ix, here.iz, here.fx, here.fz, amount * brush.strength);
      } else {
        const amount = Math.min((capacity - sediment) * E.erode, -dh, E.maxChange);
        sediment += amount;
        take(here.ix, here.iz, amount * brush.strength);
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * E.gravity));
      water *= 1 - E.evaporate;
      px = nx; pz = nz;
    }
  }
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!dirty[j * W + i]) continue;
    grid.setVertexHeight(gi0 + i, gj0 + j, hs[j * W + i]);
    i0 = Math.min(i0, gi0 + i); i1 = Math.max(i1, gi0 + i);
    j0 = Math.min(j0, gj0 + j); j1 = Math.max(j1, gj0 + j);
  }
  if (i0 > i1) return null;
  const rect = { i0, j0, i1, j1 };
  touchAround(grid, rect);
  return rect;
}
