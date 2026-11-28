// Saving the terrain: the chunks as the engine saves them (TerrainBehaviour.
// saveChunks), the relief's numbers and the water, gzipped and in base64 so a painted
// 3 × 3 terrain fits in the browser's storage (and in a small file).
import type { SavedTerrainChunk } from 'omega-game-engine';
import type { Area, GenSettings } from './generator';

export interface SavedWorld {
  v: 1;
  seed: number;
  /** The generator's numbers and the box they were made for (worlds saved before it have only the seed). */
  gen?: GenSettings & { area: Area };
  water: { on: boolean; level: number };
  chunks: SavedTerrainChunk[];
}

/** The world as gzipped JSON bytes. */
export async function packWorld(world: SavedWorld): Promise<Uint8Array> {
  const stream = new Blob([JSON.stringify(world)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The world from gzipped JSON bytes; throws on anything else. */
export async function unpackWorld(bytes: Uint8Array): Promise<SavedWorld> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  const world = JSON.parse(await new Response(stream).text());
  if (world?.v !== 1 || !Array.isArray(world.chunks)) throw new Error('não é um terreno guardado');
  return world as SavedWorld;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let k = 0; k < s.length; k++) out[k] = s.charCodeAt(k);
  return out;
}
