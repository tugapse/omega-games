// Where the engine's source is: the omega-engine repository next to this one
// (../omega-engine), or the folder in OMEGA_ENGINE. The games import
// 'omega-game-engine' and the build and the tests point that name here, until
// the engine is on npm.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const engineSrc = resolve(process.env.OMEGA_ENGINE ?? resolve(root, '../omega-engine'), 'src');

/**
 * The names the build and the tests resolve: the engine, and the packages both
 * the engine and the games import, taken from this repository's node_modules
 * so there is one copy of each (two copies of Rapier would each need their own
 * init).
 */
export const aliases = {
  'omega-game-engine': engineSrc,
  ...Object.fromEntries(['gl-matrix', '@dimforge/rapier3d-compat', 'uuid', 'tslib'].map((p) => [p, resolve(root, 'node_modules', p)])),
};
