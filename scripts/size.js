// Minified and gzipped size of every entry point, checked against budgets.
//   node scripts/size.js           print the table, exit 1 over budget
//   node scripts/size.js --json    machine-readable
// Sizes come from esbuild (bundle, minify, ESM) and zlib gzip level 9, the
// same way for the competitors in the benchmark repo (bench/size.js there).
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const external = ['node:*', 'ol', 'ol/*', 'maplibre-gl', 'mapbox-gl', '@deck.gl/*', 'leaflet'];

// Budgets in gzipped bytes, about 4% over the size when they were set, so
// CI catches real growth. Raise them on purpose, in the same commit.
//
// The first rows are what an app ships when it imports one or two functions:
// bundlers for the browser resolve the bare import to src/browser.js. They
// catch tree-shaking regressions, like a module-level call that pins the
// encoder into a decode-only bundle. The rest are whole entries.
const imports = (from, names) => `export { ${names} } from './src/${from}.js'`;
export const entries = [
  { name: 'import { decode }', code: imports('browser', 'decode'), platform: 'browser', budget: 1110 },
  { name: 'import { encode }', code: imports('browser', 'encode'), platform: 'browser', budget: 1500 },
  { name: 'import { decode, encode }', code: imports('browser', 'decode, encode'), platform: 'browser', budget: 1980 },
  { name: 'import { decodeLatLng }', code: imports('browser', 'decodeLatLng'), platform: 'browser', budget: 1190 },
  { name: 'import { toGeoJSON }', code: imports('browser', 'toGeoJSON'), platform: 'browser', budget: 1190 },
  { name: '/web, import { encode }', code: imports('web', 'encode'), platform: 'browser', budget: 1280 },
  { name: '/web, import { decode, encode }', code: imports('web', 'decode, encode'), platform: 'browser', budget: 1760 },
  { name: 'default / web (everything)', file: 'src/web.js', platform: 'browser', budget: 2050 },
  { name: 'browser (the "browser" condition)', file: 'src/browser.js', platform: 'browser', budget: 2300 },
  { name: 'node', file: 'src/node.js', platform: 'node', budget: 2700 },
  { name: 'bun', file: 'src/bun.js', platform: 'node', budget: 2700 },
  { name: 'deno', file: 'src/deno.js', platform: 'browser', budget: 2570 },
  { name: 'wasm (JS glue + inlined .wasm)', file: 'src/wasm.js', platform: 'browser', budget: 5810 },
  { name: 'leaflet', file: 'src/leaflet.js', platform: 'browser', budget: 1990 },
  { name: 'turf', file: 'src/turf.js', platform: 'browser', budget: 2250 },
  { name: 'presets', file: 'src/presets.js', platform: 'browser', budget: 300 },
  { name: 'flexible', file: 'src/flexible.js', platform: 'browser', budget: 2120 },
  { name: 'stream', file: 'src/stream.js', platform: 'browser', budget: 3780 },
  { name: 'stream, PolylineDecoder only', code: "export { PolylineDecoder } from './src/stream.js'", platform: 'browser', budget: 1800 },
  { name: 'google', file: 'src/google.js', platform: 'browser', budget: 1990 },
  { name: 'openlayers', file: 'src/openlayers.js', platform: 'browser', budget: 1110 },
  { name: 'maplibre', file: 'src/maplibre.js', platform: 'browser', budget: 1600 },
  { name: 'mapbox', file: 'src/mapbox.js', platform: 'browser', budget: 1600 },
  { name: 'deckgl', file: 'src/deckgl.js', platform: 'browser', budget: 1990 },
  { name: 'cli', file: 'src/cli.js', platform: 'node', budget: 7140 },
];

export async function measure(e) {
  const r = await build({
    ...(e.code ? { stdin: { contents: e.code, resolveDir: root, loader: 'js' } } : { entryPoints: [root + e.file] }),
    bundle: true,
    minify: true,
    format: 'esm',
    platform: e.platform,
    external,
    write: false,
    logLevel: 'silent',
  });
  const out = r.outputFiles[0].contents;
  return { min: out.length, gzip: gzipSync(out, { level: 9 }).length };
}

if (import.meta.url == `file:///${process.argv[1].replace(/\\/g, '/').replace(/^\//, '')}` || process.argv[1]?.endsWith('size.js')) {
  const json = process.argv.includes('--json');
  const rows = [];
  let over = 0;
  for (const e of entries) {
    if (e.file && !existsSync(root + e.file)) continue;
    const s = await measure(e);
    const ok = s.gzip <= e.budget;
    if (!ok) over++;
    rows.push({ name: e.name, ...s, budget: e.budget, ok });
  }
  // The size badge in the README: decode only, and the whole browser entry,
  // gzipped.
  const dec = rows.find((r) => r.name == 'import { decode }'), all = rows.find((r) => r.name.startsWith('browser '));
  if (dec && all) {
    mkdirSync(`${root}assets/badges`, { recursive: true });
    writeFileSync(`${root}assets/badges/size.svg`, badge('gzipped', `decode ${dec.gzip} B, all ${(all.gzip / 1024).toFixed(1)} KB`, '#007ec6'));
  }
  if (json) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log('| entry | minified | gzipped | budget |\n|---|--:|--:|--:|');
    for (const r of rows) console.log(`| ${r.name} | ${r.min} B | ${r.gzip} B | ${r.budget} B${r.ok ? '' : ' OVER'} |`);
  }
  if (over) {
    console.error(`${over} entr${over == 1 ? 'y is' : 'ies are'} over budget`);
    process.exitCode = 1;
  }
}

// A badge in shields.io's flat style, so it sits in the same row as theirs.
function badge(label, value, color) {
  const w = (t) => Math.round(t.length * 6.2 + 10), lw = w(label), vw = w(value), total = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${label}: ${value}"><title>${label}: ${value}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${total}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text><text x="${lw / 2}" y="14">${label}</text><text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text><text x="${lw + vw / 2}" y="14">${value}</text></g></svg>
`;
}
