import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as any).WebGL2RenderingContext ??= new Proxy({}, { get: () => 0 });
});
import { heightField } from 'omega-game-engine';
import { GEN_DEFAULT, groundColour, preview, PRESETS } from './generator';

const AREA = { x0: 0, z0: 0, x1: 384, z1: 384 };

describe('the relief generator panel', () => {
  it('every preset makes ground with some relief', () => {
    for (const p of PRESETS) {
      const pr = preview(heightField({ ...GEN_DEFAULT, ...p.settings }, AREA), AREA, 48, false, p.water ? 0 : null);
      expect(pr.max - pr.min, p.name).toBeGreaterThan(5);
    }
  });

  it('shows grey from the lowest to the highest point', () => {
    const pr = preview((x) => x, AREA, 16, true, null);
    expect(pr.rgba[0]).toBe(0);
    expect(pr.rgba[15 * 4]).toBe(255);
    expect([pr.min, pr.max]).toEqual([0, 384]);
  });

  it('paints the preview like the rules: snow up high, rock on cliffs, water under the level', () => {
    expect(groundColour(50, 5, null)).toEqual([236, 240, 246]);
    expect(groundColour(10, 40, null)).toEqual([128, 124, 118]);
    expect(groundColour(-5, 0, 0)[2]).toBeGreaterThan(groundColour(-5, 0, 0)[0]);
  });
});
