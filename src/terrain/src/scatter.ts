// Where trees grow on a chunk: one candidate per cell of a jittered grid,
// kept where the ground suits a tree (by the same height and slope rules that
// paint it, or by the painting itself) and where a large noise says forest.
// Every candidate draws its random numbers whether it grows or not, so the
// same chunk, seed and numbers always give the same trees, and changing the
// density only adds or takes trees away.
import { vec3 } from 'gl-matrix';
import { Noise2D, seededRandom, TerrainChunkData, TerrainGrid } from 'omega-game-engine';

/** A tree's kind: a pine (cone crown) or a broadleaf (round crown). */
export type TreeKind = 'pine' | 'broadleaf';

export interface Tree {
  /** Terrain space: the foot of the trunk. */
  x: number; y: number; z: number;
  kind: TreeKind;
  /** Metres, to the top of the crown. */
  height: number;
  /** The crown's radius (m). */
  radius: number;
  /** Which of two greens (broadleaf). */
  tint: number;
}

export interface TreeRules {
  seed: number;
  /** 0 none to 1 the most. */
  density: number;
  /** Degrees: trees thin out from `maxSlope - 6` and stop at it. */
  maxSlope: number;
  /** The treeline (m): trees thin out over the 8 m below it. */
  maxHeight: number;
  /** The water's level, or null for none: no trees under it or on the shore. */
  water: number | null;
  /** The painted layer trees grow on (grass); any other painted layer has none. */
  grassLayer: number;
}

export const TREE_RULES: TreeRules = { seed: 7, density: 0.5, maxSlope: 25, maxHeight: 34, water: null, grassLayer: 0 };

/** Metres between candidates: at most (128 / 6)² ≈ 455 trees on a 128 m chunk. */
export const TREE_CELL = 6;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** 0 to 1: how much painting covers a terrain-space point, and how much of it is the layer. */
export function paintedAt(c: TerrainChunkData, x: number, z: number, layer: number): { cover: number; layer: number } {
  const s = c.settings.splatResolution;
  const u = Math.round(((x - c.originX) / c.size) * (s - 1)), v = Math.round(((z - c.originZ) / c.size) * (s - 1));
  const k = (Math.min(Math.max(v, 0), s - 1) * s + Math.min(Math.max(u, 0), s - 1)) * 4;
  let cover = 0;
  for (let t = 0; t < 4; t++) cover += c.splat[0][k + t] + c.splat[1][k + t];
  const own = c.splat[layer >> 2][k + (layer & 3)];
  return { cover: Math.min(cover / 255, 1), layer: own / 255 };
}

/** How well a tree grows at a point, 0 to 1, from the ground alone. */
export function suitability(h: number, slope: number, rules: TreeRules): number {
  if (rules.water !== null && h < rules.water + 0.6) return 0;
  return (1 - smoothstep(rules.maxSlope - 6, rules.maxSlope, slope)) * (1 - smoothstep(rules.maxHeight - 8, rules.maxHeight, h));
}

/** The trees of one chunk, in terrain space. */
export function scatterTrees(grid: TerrainGrid, c: TerrainChunkData, rules: TreeRules): Tree[] {
  const trees: Tree[] = [];
  if (rules.density <= 0) return trees;
  const random = seededRandom((rules.seed * 73856093) ^ (c.cx * 19349663) ^ (c.cz * 83492791));
  const forest = new Noise2D(rules.seed + 501);
  const cells = Math.floor(c.size / TREE_CELL);
  const normal = vec3.create();
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const r0 = random(), r1 = random(), r2 = random(), r3 = random(), r4 = random(), r5 = random();
      const x = c.originX + (i + 0.1 + r1 * 0.8) * TREE_CELL;
      const z = c.originZ + (j + 0.1 + r2 * 0.8) * TREE_CELL;
      const h = c.heightAtLocal(x - c.originX, z - c.originZ);
      const n = grid.normalAt(x, z, normal);
      const slope = n ? Math.acos(Math.min(Math.max(n[1], 0), 1)) * 180 / Math.PI : 0;
      // Painted grass grows trees on any slope up to 38°; any other painting none.
      const paint = paintedAt(c, x, z, rules.grassLayer);
      const fromPaint = rules.water !== null && h < rules.water + 0.6 ? 0 : paint.layer * (slope < 38 ? 1 : 0);
      const suit = suitability(h, slope, rules) * (1 - paint.cover) + fromPaint;
      // Woods and clearings: dense where the noise is high, a few trees elsewhere.
      const woods = 0.12 + 0.88 * smoothstep(-0.1, 0.35, forest.get(x / 110, z / 110));
      if (r0 >= suit * woods * rules.density * 1.6) continue;
      const pine = r3 < 0.15 + 0.75 * smoothstep(4, 24, h);
      const size = (0.65 + 0.35 * Math.min(suit * 1.4, 1)) * (0.75 + r4 * 0.5);
      trees.push({
        x, y: h, z,
        kind: pine ? 'pine' : 'broadleaf',
        height: (pine ? 10 : 7.5) * size,
        radius: (pine ? 2.3 : 3) * size,
        tint: r5 < 0.5 ? 0 : 1,
      });
    }
  }
  return trees;
}
