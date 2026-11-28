import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as any).WebGL2RenderingContext ??= new Proxy({}, { get: () => 0 });
});
import { TerrainGrid } from 'omega-game-engine';
import { scatterTrees, suitability, TREE_RULES } from './scatter';
import { treeMeshes } from './trees';

function flat(height = 5): TerrainGrid {
  const g = new TerrainGrid();
  g.add(0, 0);
  g.get(0, 0)!.heights.fill(height);
  return g;
}

const rules = { ...TREE_RULES, density: 1 };

describe('scattering trees', () => {
  it('gives the same trees for the same chunk and numbers', () => {
    const g = flat();
    const a = scatterTrees(g, g.get(0, 0)!, rules), b = scatterTrees(g, g.get(0, 0)!, rules);
    expect(a.length).toBeGreaterThan(20);
    expect(b).toEqual(a);
  });

  it('a lower density keeps some of the same trees and adds none', () => {
    const g = flat(), c = g.get(0, 0)!;
    const many = scatterTrees(g, c, rules), few = scatterTrees(g, c, { ...rules, density: 0.3 });
    expect(few.length).toBeLessThan(many.length);
    const at = new Set(many.map((t) => `${t.x},${t.z}`));
    for (const t of few) expect(at.has(`${t.x},${t.z}`)).toBe(true);
    expect(scatterTrees(g, c, { ...rules, density: 0 })).toEqual([]);
  });

  it('keeps trees off the water, the snow line and cliffs', () => {
    const g = flat(5), c = g.get(0, 0)!;
    expect(scatterTrees(g, c, { ...rules, water: 10 })).toEqual([]);
    expect(scatterTrees(flat(40), flat(40).get(0, 0)!, rules)).toEqual([]);
    expect(suitability(5, 40, rules)).toBe(0);
    expect(suitability(5, 5, rules)).toBe(1);
  });

  it('follows the painting: none on painted rock, grass lets them climb', () => {
    const g = flat(), c = g.get(0, 0)!;
    c.splat[0].fill(0);
    for (let k = 0; k < c.splat[0].length; k += 4) c.splat[0][k + 2] = 255; // rock everywhere
    expect(scatterTrees(g, c, rules)).toEqual([]);
    // A 35° slope, painted grass: trees despite the rules.
    const s = new TerrainGrid(); s.add(0, 0);
    const sc = s.get(0, 0)!, n = s.settings.resolution;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) sc.heights[j * (n + 1) + i] = -20 + (i * sc.spacing) * Math.tan(35 * Math.PI / 180) * 0.3;
    const bare = scatterTrees(s, sc, { ...rules, maxSlope: 8 }).length;
    for (let k = 0; k < sc.splat[0].length; k += 4) sc.splat[0][k] = 255;
    expect(scatterTrees(s, sc, { ...rules, maxSlope: 8 }).length).toBeGreaterThan(bare);
  });

  it('every tree stands on the ground', () => {
    const g = flat(3);
    for (const t of scatterTrees(g, g.get(0, 0)!, rules)) expect(t.y).toBeCloseTo(3, 5);
  });

  it('merges a chunk of trees into four meshes', () => {
    const g = flat();
    const list = scatterTrees(g, g.get(0, 0)!, rules);
    const m = treeMeshes(list);
    const pines = list.filter((t) => t.kind === 'pine').length;
    expect(m.trunks.vertices.length).toBe(list.length * treeMeshes([list[0]]).trunks.vertices.length);
    expect(m.pines.indices.length > 0).toBe(pines > 0);
    expect(m.trunks.vertices.length + m.pines.vertices.length + m.crowns[0].vertices.length + m.crowns[1].vertices.length).toBeLessThan(65536);
  });
});
