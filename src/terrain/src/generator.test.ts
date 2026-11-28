import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as any).WebGL2RenderingContext ??= new Proxy({}, { get: () => 0 });
});
import { TerrainGrid } from 'omega-game-engine';
import { areaOf, generate, GEN_DEFAULT, groundColour, heightField, preview, PRESETS, smoothHeightmap } from './generator';

const AREA = { x0: 0, z0: 0, x1: 384, z1: 384 };

function grid(...cells: [number, number][]): TerrainGrid {
  const g = new TerrainGrid();
  for (const [x, z] of cells) g.add(x, z);
  return g;
}

describe('the relief generator', () => {
  it('gives the same relief for the same numbers, another for another seed', () => {
    const a = heightField(GEN_DEFAULT, AREA), b = heightField({ ...GEN_DEFAULT }, AREA);
    const c = heightField({ ...GEN_DEFAULT, seed: 8 }, AREA);
    expect(a(100, 200)).toBe(b(100, 200));
    expect(a(100, 200)).not.toBe(c(100, 200));
  });

  it('with no twist and no island is the engine relief', () => {
    const h = heightField({ ...GEN_DEFAULT, warp: 0, island: 0 }, AREA);
    const g = grid([0, 0]);
    generate(g, h);
    expect(g.vertexHeight(10, 20)).toBeCloseTo(h(10 * g.get(0, 0)!.spacing, 20 * g.get(0, 0)!.spacing), 4);
  });

  it('sinks the edges for an island and keeps the middle', () => {
    const plain = { ...GEN_DEFAULT, amplitude: 0, base: 20 };
    const island = heightField({ ...plain, island: 1 }, AREA);
    expect(island(192, 192)).toBeCloseTo(20, 4);
    expect(island(2, 2)).toBeCloseTo(20 - 6, 1); // base − amplitude/2 − 6
  });

  it('twisting moves the relief but not its range much', () => {
    const area = AREA;
    const p0 = preview(heightField(GEN_DEFAULT, area), area, 64, true, null);
    const p1 = preview(heightField({ ...GEN_DEFAULT, warp: 0.6 }, area), area, 64, true, null);
    expect(p1.rgba).not.toEqual(p0.rgba);
    expect(Math.abs((p1.max - p1.min) - (p0.max - p0.min))).toBeLessThan(40);
  });

  it('writes every chunk so shared borders match', () => {
    const g = grid([0, 0], [1, 0], [0, 1]);
    generate(g, heightField({ ...GEN_DEFAULT, warp: 0.4, island: 0.5 }, areaOf(g)));
    const n = g.settings.resolution, a = g.get(0, 0)!, b = g.get(1, 0)!;
    for (let j = 0; j <= n; j += 16) expect(a.heights[j * (n + 1) + n]).toBe(b.heights[j * (n + 1)]);
  });

  it('reads heights from a grey image, stretched over the area', () => {
    const image = { width: 2, height: 1, data: new Uint16Array([0, 65535]) };
    const h = heightField({ ...GEN_DEFAULT, amplitude: 100, base: 10 }, AREA, image);
    expect(h(0, 0)).toBeCloseTo(-40, 4);
    expect(h(384, 0)).toBeCloseTo(60, 4);
    expect(h(192, 100)).toBeCloseTo(10, 4);
  });

  it('every preset makes ground with some relief', () => {
    for (const p of PRESETS) {
      const pr = preview(heightField({ ...GEN_DEFAULT, ...p.settings }, AREA), AREA, 48, false, p.water ? 0 : null);
      expect(pr.max - pr.min, p.name).toBeGreaterThan(5);
    }
  });

  it('paints the preview like the rules: snow up high, rock on cliffs, water under the level', () => {
    expect(groundColour(50, 5, null)).toEqual([236, 240, 246]);
    expect(groundColour(10, 40, null)).toEqual([128, 124, 118]);
    expect(groundColour(-5, 0, 0)[2]).toBeGreaterThan(groundColour(-5, 0, 0)[0]);
  });

  it('smooths the steps of an 8-bit image and keeps flat ground flat', () => {
    const w = 32, data = new Uint16Array(w * w);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) data[j * w + i] = (i < 16 ? 0 : 255) * 257;
    const s = smoothHeightmap({ width: w, height: w, data });
    expect(s.data[5 * w + 2]).toBe(0);
    expect(s.data[5 * w + 30]).toBe(65535);
    expect(s.data[5 * w + 16]).toBeGreaterThan(0);
    expect(s.data[5 * w + 16]).toBeLessThan(65535);
  });
});
