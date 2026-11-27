import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as any).WebGL2RenderingContext ??= new Proxy({}, { get: () => 0 });
});
import { seededRandom, TerrainGrid } from 'omega-game-engine';
import { erode, stamp, stampProfile, terrace, terraceHeight } from './brushes';
import { fillChunk } from './grow';
import { packWorld, unpackWorld, fromBase64, toBase64 } from './save';

const brush = { radius: 20, strength: 1, hardness: 0.5 };

function grid(...cells: [number, number][]): TerrainGrid {
  const g = new TerrainGrid();
  for (const [x, z] of cells) g.add(x, z);
  return g;
}

/** A tilted plane: height = x / 4. */
function slope(g: TerrainGrid): void {
  const n = g.settings.resolution;
  for (const c of g.all()) for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) c.heights[j * (n + 1) + i] = (c.originX + i * c.spacing) / 4;
}

describe('terraces', () => {
  it('has flat steps with risers between them', () => {
    expect(terraceHeight(10.5, 5)).toBe(10);
    expect(terraceHeight(14.5, 5)).toBe(15);
    expect(terraceHeight(12.5, 5)).toBeCloseTo(12.5, 6);
  });

  it('pulls a slope into steps under the brush only', () => {
    const g = grid([0, 0]);
    slope(g);
    for (let k = 0; k < 60; k++) terrace(g, 64, 64, brush, 1 / 30, 5);
    expect(g.heightAt(61, 64)).toBeCloseTo(15, 1); // 15.25 on the slope
    expect(g.heightAt(64, 64)).toBeCloseTo(15, 1); // 16
    expect(g.heightAt(120, 64)).toBe(30); // outside: untouched
  });
});

describe('stamps', () => {
  it('fades to nothing at the edge', () => {
    for (const shape of ['hill', 'crater', 'plateau', 'volcano'] as const) {
      expect(stampProfile(shape, 1)).toBe(0);
      expect(Math.abs(stampProfile(shape, 0.99))).toBeLessThan(0.02);
    }
  });

  it('raises a hill, digs a crater with a rim, tops a volcano with a hollow', () => {
    expect(stampProfile('hill', 0)).toBe(1);
    expect(stampProfile('crater', 0)).toBeLessThan(0);
    expect(stampProfile('crater', 0.72)).toBeGreaterThan(0.3);
    expect(stampProfile('volcano', 0)).toBeLessThan(stampProfile('volcano', 0.25));
    expect(stampProfile('plateau', 0.4)).toBe(1);
  });

  it('adds its height on the ground', () => {
    const g = grid([0, 0]);
    stamp(g, 'hill', 64, 64, 30, 20);
    expect(g.heightAt(64, 64)).toBeCloseTo(20, 4);
    expect(g.heightAt(64, 100)).toBe(0);
  });
});

describe('erosion', () => {
  it('moves earth down a slope without making or losing much of it', () => {
    const g = grid([0, 0]);
    slope(g);
    stamp(g, 'hill', 64, 64, 40, 25);
    const total = () => g.all()[0].heights.reduce((a, b) => a + b, 0);
    const before = total();
    const top = g.heightAt(64, 64)!;
    expect(erode(g, 64, 64, brush, 400, seededRandom(3))).not.toBeNull();
    expect(g.heightAt(64, 64)).not.toBe(top);
    // Earth only moves: what the drops still carry when they stop is the only loss.
    expect(Math.abs(total() - before) / before).toBeLessThan(0.01);
  });

  it('leaves the ground outside its reach alone', () => {
    const g = grid([0, 0]);
    slope(g);
    stamp(g, 'hill', 64, 64, 40, 25);
    const far = [[64, 90], [100, 64], [30, 30]].map(([x, z]) => g.heightAt(x, z));
    erode(g, 64, 64, { ...brush, radius: 10 }, 300, seededRandom(5));
    expect([[64, 90], [100, 64], [30, 30]].map(([x, z]) => g.heightAt(x, z))).toEqual(far);
  });
});

describe('growing', () => {
  it('meets a sculpted neighbour exactly and is the relief further in', () => {
    const g = grid([0, 0]);
    const n = g.settings.resolution;
    const heights = g.get(0, 0)!.heights;
    heights.fill(50);
    g.add(1, 0);
    const relief = (x: number) => x / 10;
    fillChunk(g, 1, 0, relief, 32);
    const c = g.get(1, 0)!;
    for (let j = 0; j <= n; j++) expect(c.heights[j * (n + 1)]).toBe(50);
    expect(g.heightAt(129, 64)).toBeGreaterThan(40); // bent towards the border
    expect(g.heightAt(200, 64)).toBeCloseTo(20, 5); // relief from 32 m in
  });

  it('meets a chunk that only touches it at a corner', () => {
    const g = grid([0, 0]);
    g.get(0, 0)!.heights.fill(30);
    g.add(1, 1);
    fillChunk(g, 1, 1, () => 0, 32);
    expect(g.heightAt(128, 128)).toBe(30);
    expect(g.heightAt(131, 131)).toBeGreaterThan(5);
    expect(g.heightAt(200, 200)).toBe(0);
  });
});

describe('saving', () => {
  it('packs and unpacks a world', async () => {
    const world = { v: 1 as const, seed: 9, water: { on: true, level: 12 }, chunks: [{ cx: 0, cz: 0, heights: 'AAAA' }] };
    const bytes = await packWorld(world);
    expect(await unpackWorld(fromBase64(toBase64(bytes)))).toEqual(world);
  });

  it('refuses something that is not a saved terrain', async () => {
    const bytes = await packWorld({ hello: 1 } as any);
    await expect(unpackWorld(bytes)).rejects.toThrow();
  });
});
