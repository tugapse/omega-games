import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as any).WebGL2RenderingContext ??= new Proxy({}, { get: () => 0 });
});
import { TerrainGrid } from 'omega-game-engine';
import { ramp } from './ramp';

function flatGrid(): TerrainGrid {
  const grid = new TerrainGrid();
  grid.add(0, 0);
  grid.add(1, 0);
  return grid;
}

describe('ramp', () => {
  it('slopes straight from one end to the other', () => {
    const grid = flatGrid();
    expect(ramp(grid, { x: 40, z: 64, h: 0 }, { x: 200, z: 64, h: 32 }, 10, 0.5)).not.toBeNull();
    expect(grid.heightAt(40, 64)).toBeCloseTo(0, 3);
    expect(grid.heightAt(120, 64)).toBeCloseTo(16, 3);
    expect(grid.heightAt(200, 64)).toBeCloseTo(32, 3);
  });

  it('crosses the border between chunks without a step', () => {
    const grid = flatGrid();
    ramp(grid, { x: 40, z: 64, h: 0 }, { x: 200, z: 64, h: 32 }, 10, 0.5);
    expect(grid.heightAt(127.5, 64)! - grid.heightAt(128.5, 64)!).toBeCloseTo(-0.2, 2);
  });

  it('fades out across its width and leaves the rest alone', () => {
    const grid = flatGrid();
    ramp(grid, { x: 40, z: 64, h: 0 }, { x: 200, z: 64, h: 32 }, 10, 0.5);
    const middle = grid.heightAt(120, 64)!, edge = grid.heightAt(120, 72)!;
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(middle);
    expect(grid.heightAt(120, 80)).toBe(0);
    expect(grid.heightAt(230, 64)).toBe(0);
  });

  it('does nothing outside the terrain', () => {
    expect(ramp(flatGrid(), { x: -100, z: -100, h: 0 }, { x: -60, z: -100, h: 10 }, 5, 0.5)).toBeNull();
  });
});
