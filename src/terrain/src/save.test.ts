import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as any).WebGL2RenderingContext ??= new Proxy({}, { get: () => 0 });
});
import { packWorld, unpackWorld, fromBase64, toBase64 } from './save';

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
