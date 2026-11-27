// How often detect() picks the right reading, on the inputs in docs/api.md:
//   node scripts/detect-accuracy.js                 without a land mask
//   node scripts/detect-accuracy.js --land          with @duoquote/polytini/detect/land
//   node scripts/detect-accuracy.js --json
// "Right" means the top candidate has the precision, order and number of
// values per point the string was encoded with. Inputs:
// - the 1000 real-world lines (precision 5, PostGIS output from routes in
//   Turkey), as published and re-encoded at precision 6 and 7, and
//   longitude first
// - the decode cases of test/fixtures/vectors with a known precision
// - the PostGIS fixture's encode cases at the precisions detect tries
// - GPS-like tracks (polyline-benchmark's generator, made even in meters)
//   in 12 places, both hemispheres, near the antimeridian and the poles,
//   at precision 5 and 6, and longitude first
// - GraphHopper's elevation strings, and the tracks with an elevation
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { detect } from '../src/detect.js';
import { decode, encode } from '../src/web.js';
import { gpsTrack } from '../test/fixtures-core.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
// --land, or --land <file> for another mask module.
const at = args.indexOf('--land'), file = args[at + 1];
const maskFile = at < 0 ? null : file && !file.startsWith('--') ? pathToFileURL(resolve(file)).href : '../src/detect-land.js';
const isLand = maskFile ? (await import(maskFile)).isLand : undefined;
const options = { isLand };
const read = (p) => readFileSync(root + p, 'utf8');
const json = (p) => JSON.parse(read(p));

const realWorld = read('test/fixtures/real-world.csv').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.replace(/^"|"$/g, ''));
const realPts = realWorld.map((s) => decode(s));

// [string, wanted reading] pairs per row.
const rows = [];
const row = (name, cases) => rows.push({ name, cases });
const want = (precision, order = 'latlng', dimensions = 2) => ({ precision, order, dimensions });

row('Real-world lines, precision 5', realWorld.map((s) => [s, want(5)]));
row('Real-world lines, re-encoded at precision 6', realPts.map((p) => [encode(p, 6), want(6)]));
row('Real-world lines, re-encoded at precision 7', realPts.map((p) => [encode(p, 7), want(7)]));
row('Real-world lines, longitude first', realPts.map((p) => [encode(p, { order: 'lnglat' }), want(5, 'lnglat')]));

const vectors = [];
for (const f of readdirSync(root + 'test/fixtures/vectors').filter((f) => f.endsWith('.json'))) {
  for (const c of json('test/fixtures/vectors/' + f).cases) {
    if (c.op != 'decode' || c.throws || typeof c.input != 'string' || !c.expected?.length) continue;
    const o = typeof c.options == 'number' ? { precision: c.options } : c.options ?? {};
    if (o.factor || (o.dimensions ?? 2) != 2) continue;
    vectors.push([c.input, want(o.precision ?? 5)]);
  }
}
row('Test vectors (decode cases with a known precision)', vectors);

// PostGIS's own strings at the precisions detect tries, where they decode
// back to the points (its int32 math wraps for big values at high
// precisions) and the points are coordinates.
const near = (a, b, p) => a.length == b.length && a.every((x, i) => Math.abs(x[0] - b[i][0]) <= 10 ** -p && Math.abs(x[1] - b[i][1]) <= 10 ** -p);
const postgis = json('test/fixtures/postgis.json').encode.filter((c) => {
  if (!c.points.length || typeof c.postgis.encoded != 'string' || ![4, 5, 6, 7, 8].includes(c.precision)) return false;
  const pts = c.points.map((p) => p.map(Number));
  return pts.every(([a, b]) => Math.abs(a) <= 90 && Math.abs(b) <= 180) && near(decode(c.postgis.encoded, { precision: c.precision, strict: false }), pts, c.precision);
});
row('PostGIS fixture (edge cases: zeros, ties, bounds, one point)', postgis.map((c) => [c.postgis.encoded, want(c.precision)]));

// polyline-benchmark's tracks move by even steps in degrees. Real movement
// is even in meters, so longitude steps are stretched by 1 / cos(latitude).
const PLACES = [
  ['Istanbul', 41.01, 28.98], ['Sao Paulo', -23.55, -46.63], ['Seattle', 47.61, -122.33], ['Sydney', -33.87, 151.21],
  ['Berlin', 52.52, 13.4], ['Nairobi', -1.29, 36.82], ['Singapore', 1.35, 103.82], ['Quito', -0.18, -78.47],
  ['Suva, Fiji (antimeridian)', -18.14, 178.44], ['Chukotka (antimeridian)', 64.73, 177.51],
  ['Svalbard (78 N)', 78.22, 15.65], ['McMurdo (78 S)', -77.85, 166.67],
];
const track = (lat0, lng0, seed, precision) => {
  const t = gpsTrack({ points: 200, seed, anchor: { lat: 0, lng: 0 }, precision: 6 });
  return t.map(([a, b]) => {
    const lat = lat0 + a, lng = ((lng0 + b / Math.cos(lat * (Math.PI / 180)) + 540) % 360) - 180;
    const f = 10 ** precision;
    return [Math.round(lat * f) / f, Math.round(lng * f) / f];
  });
};
const tracks = [];
for (const [name, lat, lng] of PLACES) {
  const ts = Array.from({ length: 50 }, (_, i) => [i + 1, track(lat, lng, i + 1, 6)]);
  tracks.push({ name, p5: ts.map(([, t]) => [encode(t, 5), want(5)]), p6: ts.map(([, t]) => [encode(t, 6), want(6)]), swapped: ts.map(([, t]) => [encode(t, { order: 'lnglat' }), want(5, 'lnglat')]) });
}
row('Generated tracks, 12 places, precision 5', tracks.flatMap((t) => t.p5));
row('Generated tracks, 12 places, precision 6', tracks.flatMap((t) => t.p6));
row('Generated tracks, 12 places, longitude first', tracks.flatMap((t) => t.swapped));

row('GraphHopper test strings with elevation', json('test/fixtures/presets/graphhopper.json').tests.decode3d.map((c) => [c.points, want(5, 'latlng', 3)]));
// The same tracks with an elevation that wanders between 0 and 3000 m,
// encoded the way GraphHopper does: centimeters, a third value per point.
const withZ = tracks.flatMap((t, i) => t.p5.slice(0, 20).map(([s], j) => {
  let z = 100 + ((i * 37 + j * 101) % 2500);
  const pts = decode(s).map((p, k) => [...p, (z = Math.max(0, z + Math.sin(k * 0.3 + j) * 2))]);
  return [encode(pts, { dimensions: 3, zFactor: 100 }), want(5, 'latlng', 3)];
}));
row('Generated tracks with elevation, precision 5', withZ);

const right = (s, w) => {
  const c = detect(s, options)[0];
  return c.format == 'google' && c.precision == w.precision && c.order == w.order && c.dimensions == w.dimensions;
};
const rate = (cases) => cases.filter(([s, w]) => right(s, w)).length / cases.length;
const pct = (x) => (100 * x).toFixed(1) + '%';

const out = rows.map((r) => ({ name: r.name, n: r.cases.length, rate: rate(r.cases) }));
const places = tracks.map((t) => ({ name: t.name, p5: rate(t.p5), p6: rate(t.p6), swapped: rate(t.swapped) }));

// Time on the 10,000-point track from the benchmark fixtures.
const long = encode(gpsTrack({ points: 10000, seed: 1003, precision: 5 }), 5);
for (let i = 0; i < 20; i++) detect(long, options);
let t = performance.now();
for (let i = 0; i < 50; i++) detect(long, options);
const ms = (performance.now() - t) / 50;
t = performance.now();
for (let i = 0; i < 50; i++) decode(long);
const decodeMs = (performance.now() - t) / 50;

if (args.includes('--json')) console.log(JSON.stringify({ land: !!isLand, rows: out, places, ms, decodeMs }, null, 2));
else {
  console.log(`land mask: ${isLand ? 'yes' : 'no'}\n\n| Input | Lines | Right |\n|---|--:|--:|`);
  for (const r of out) console.log(`| ${r.name} | ${r.n} | ${pct(r.rate)} |`);
  console.log('\n| Place | Precision 5 | Precision 6 | Longitude first |\n|---|--:|--:|--:|');
  for (const p of places) console.log(`| ${p.name} | ${pct(p.p5)} | ${pct(p.p6)} | ${pct(p.swapped)} |`);
  console.log(`\ndetect() on 10,000 points: ${ms.toFixed(2)} ms (decode alone: ${decodeMs.toFixed(2)} ms)`);
}
