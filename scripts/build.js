// Builds what `npm pack` adds to the ESM sources in src/:
//   node scripts/build.js
// - dist/*.cjs, the CommonJS files for `require()` where the runtime or tool
//   can't load the ESM sources: Node before 22.12, Jest, Deno's createRequire,
//   Yarn PnP. Node 22.12+ and Bun get src/ through the `module-sync` and `bun`
//   conditions instead (package.json).
// - dist/polytini.iife.js, the browser entry as a global `polytini`, for a
//   <script> tag without a bundler, and dist/polytini-lite.iife.js, /lite
//   under the same global.
// - One folder per subpath with a package.json (turf/package.json and so on),
//   for resolvers that ignore "exports": TypeScript's node10, Parcel's
//   defaults, older bundlers.
// Each dist file is a separate bundle with its own copy of the core, so a
// PolylineError from dist/turf.cjs isn't instanceof the one in dist/node.cjs.
// Check `err.name == 'PolylineError'` or `err.code` across subpaths.
import { build } from 'esbuild';
import { existsSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const node = ['node', 'leaflet-auto'];
const names = ['node', 'web', 'browser', 'wasm', 'lite', 'turf', 'leaflet', 'leaflet-auto', 'presets', 'flexible', 'stream', 'google', 'maplibre', 'mapbox', 'deckgl'];

rmSync(root + 'dist', { recursive: true, force: true });
for (const name of names) {
  if (!existsSync(`${root}src/${name}.js`)) continue;
  await build({
    entryPoints: [`${root}src/${name}.js`],
    outfile: `${root}dist/${name}.cjs`,
    bundle: true,
    format: 'cjs',
    platform: node.includes(name) ? 'node' : 'neutral',
    target: 'es2022',
    external: ['node:*', 'ol', 'ol/*', 'maplibre-gl', 'mapbox-gl', '@deck.gl/*', 'leaflet'],
    logLevel: 'warning',
  });
}
// The same for /lite, under the same global, so switching is one URL.
for (const [entry, out] of [['browser', 'polytini'], ['lite', 'polytini-lite']]) {
  await build({
    entryPoints: [`${root}src/${entry}.js`],
    outfile: `${root}dist/${out}.iife.js`,
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: 'polytini',
    platform: 'browser',
    target: 'es2020',
    logLevel: 'warning',
  });
}
// CommonJS type declarations: the same .d.ts files as .d.cts, so
// TypeScript under node16/nodenext doesn't read the ESM types for require().
mkdirSync(root + 'dist/types', { recursive: true });
for (const f of readdirSync(root + 'types').filter((f) => f.endsWith('.d.ts'))) {
  const src = readFileSync(`${root}types/${f}`, 'utf8').replace(/\.\/([\w-]+)\.d\.ts/g, './$1.d.cts');
  writeFileSync(`${root}dist/types/${f.replace(/\.d\.ts$/, '.d.cts')}`, src);
}

// The subpath folders, from package.json's exports, so they can't drift.
// Each one's file has to be in "files" too; this fails if it isn't.
const pkg = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
const target = (v, cond) => {
  const t = v[cond];
  return typeof t == 'object' ? t.default : t;
};
for (const [sub, v] of Object.entries(pkg.exports)) {
  if (sub == '.' || typeof v != 'object') continue;
  const name = sub.slice(2), up = '../'.repeat(name.split('/').length);
  const file = `${name}/package.json`;
  if (!pkg.files.includes(file)) throw new Error(`${file} is missing from "files" in package.json`);
  const rel = (p) => up + p.slice(2);
  const stub = { private: true, main: rel(target(v, 'require') ?? v.default), module: rel(v.default), types: rel(v.types) };
  mkdirSync(root + name, { recursive: true });
  writeFileSync(root + file, JSON.stringify(stub, null, 2) + '\n');
}
console.log('built dist/*.cjs, dist/polytini.iife.js, dist/polytini-lite.iife.js, dist/types/*.d.cts and the subpath folders');
