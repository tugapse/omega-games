// The ramp tool: a straight slope from A to B. Written like the engine's
// brushes (terrain-brush.ts), in terrain space, so it can move there later as
// `ramp()` plus a `TerrainBehaviour.rampAt()`.
import { vec3 } from 'gl-matrix';
import { brushFalloff, TerrainBehaviour, TerrainGrid, touchAround, VertexRect } from 'omega-game-engine';

/** A point in terrain space: x, z and the height there. */
export interface RampEnd { x: number; z: number; h: number }

/**
 * Lays a straight ramp from `a` to `b` in terrain space: each vertex within
 * `width` of the segment moves towards the height along it (a's at a, b's at
 * b), fully in the middle and less towards the edges by `hardness`, like a
 * brush. Past the ends the edge is round. Returns the vertices changed.
 */
export function ramp(grid: TerrainGrid, a: RampEnd, b: RampEnd, width: number, hardness: number): VertexRect | null {
  const s = grid.settings.size / grid.settings.resolution;
  const r = Math.max(width, s * 0.5);
  const i0 = Math.ceil((Math.min(a.x, b.x) - r) / s), i1 = Math.floor((Math.max(a.x, b.x) + r) / s);
  const j0 = Math.ceil((Math.min(a.z, b.z) - r) / s), j1 = Math.floor((Math.max(a.z, b.z) + r) / s);
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  let changed = false;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const h = grid.vertexHeight(i, j);
      if (h === undefined) continue;
      const x = i * s, z = j * s;
      const t = len2 > 0 ? Math.min(Math.max(((x - a.x) * dx + (z - a.z) * dz) / len2, 0), 1) : 0;
      const f = brushFalloff(Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) / r, hardness);
      if (f <= 0) continue;
      const next = h + (a.h + (b.h - a.h) * t - h) * f;
      if (next !== h) { grid.setVertexHeight(i, j, next); changed = true; }
    }
  }
  if (!changed) return null;
  const rect = { i0, j0, i1, j1 };
  touchAround(grid, rect);
  return rect;
}

/**
 * A ramp between two world points (each at its own height), as one undo step.
 * Returns whether the ground changed.
 */
export function rampAt(terrain: TerrainBehaviour, from: vec3, to: vec3, width: number, hardness: number): boolean {
  const a = terrain.toLocal(from), b = terrain.toLocal(to);
  const scale = terrain.transform.worldScale?.[0] || 1;
  const w = width / scale;
  const grid = terrain.grid;
  const size = grid.settings.size, pad = w + size / grid.settings.resolution;
  terrain.beginStroke('heights');
  for (const c of grid.all()) {
    if (Math.max(a[0], b[0]) + pad < c.originX || Math.min(a[0], b[0]) - pad > c.originX + size) continue;
    if (Math.max(a[2], b[2]) + pad < c.originZ || Math.min(a[2], b[2]) - pad > c.originZ + size) continue;
    terrain.history.save(c);
  }
  const done = !!ramp(grid, { x: a[0], z: a[2], h: a[1] }, { x: b[0], z: b[2], h: b[1] }, w, hardness);
  terrain.endStroke();
  return done;
}
