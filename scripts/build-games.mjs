// Builds every game in <name>/ into docs/<name>/ (GitHub Pages, from develop).
// Each game has src/main.ts and index.html; an assets/ folder is copied as is.
// index.html (the list of games) and shots/ go to docs/ too.
// `node scripts/build-games.mjs drift` builds one game.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { aliases } from './engine.mjs';

const only = process.argv[2];
mkdirSync('docs', { recursive: true });
cpSync('index.html', 'docs/index.html');
cpSync('shots', 'docs/shots', { recursive: true });
for (const name of readdirSync('.')) {
  if (only && name !== only) continue;
  if (!existsSync(join(name, 'src/main.ts'))) continue;
  const out = join('docs', name);
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: [join(name, 'src/main.ts')],
    outfile: join(out, 'game.js'),
    bundle: true,
    format: 'esm',
    minify: true,
    keepNames: true,
    target: 'es2020',
    logLevel: 'warning',
    alias: aliases,
  });
  cpSync(join(name, 'index.html'), join(out, 'index.html'));
  if (existsSync(join(name, 'assets'))) cpSync(join(name, 'assets'), join(out, 'assets'), { recursive: true });
  console.log(`built ${out}`);
}
