// @duoquote/polytini/detect: which reading detect picks for known inputs,
// that each candidate's `valid` and `issue` are exactly what strict decode
// does with its options, and accuracy floors on the benchmark inputs.
// scripts/detect-accuracy.js prints the full table for docs/api.md.
import fc from 'fast-check';
import { test, eq, ok, throws, entries, json } from './lib.js';
import * as ref from './reference.js';
import { realWorldLines, gpsTrack } from './bench-fixtures.js';
import * as localDetect from '../src/detect.js';
import * as localLand from '../src/detect-land.js';
import * as F from '../src/flexible.js';

// In a Worker (scripts/test-workers.js) these are the packed package's.
const { detect, decodeAuto } = globalThis.__polytiniTest?.detect ?? localDetect;
const { isLand } = globalThis.__polytiniTest?.land ?? localLand;
const all = await entries();
const { decode, encode, decodeFlat } = all[0].api;
const env = globalThis.Deno ? Deno.env.toObject() : globalThis.process?.env ?? {};
const seed = Number(env.POLYTINI_SEED ?? 20261129);
const runs = Number(env.POLYTINI_RUNS ?? 200);

const GOOGLE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const top = (s, o) => detect(s, o)[0];
const reading = (c) => ({ format: c.format, precision: c.precision, order: c.order, dimensions: c.dimensions });
const fields = (e) => e && { name: e.name, code: e.code, index: e.index, message: e.message };
const thrown = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
};

test('detect: Google\'s example is precision 5, latitude first', () => {
  const c = top(GOOGLE);
  eq(reading(c), { format: 'google', precision: 5, order: 'latlng', dimensions: 2 });
  eq(c.valid, true);
  eq(c.issue, null);
  eq(c.options, { precision: 5, order: 'latlng', dimensions: 2 });
  eq(c.presets, ['google', 'osrm', 'graphhopper', 'openrouteservice', 'mapbox', 'strava', 'otp']);
  eq(decodeAuto(GOOGLE).coordinates, [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

test('detect: the routing engines\' own responses', async () => {
  const fx = async (f) => json('fixtures/presets/' + f);
  const p6 = [(await fx('osrm-polyline6.json')).routes[0].geometry, (await fx('valhalla-route.json')).trip.legs[0].shape, (await fx('mapbox-directions_v5_precision_6.json')).routes[0].geometry];
  for (const s of p6) eq(reading(top(s)), { format: 'google', precision: 6, order: 'latlng', dimensions: 2 });
  eq(top(p6[0]).presets, ['osrm6', 'valhalla', 'stadia', 'mapbox6']);
  const p5 = [(await fx('osrm-polyline.json')).routes[0].geometry, (await fx('mapbox-directions_v5.json')).routes[0].geometry];
  for (const s of p5) eq(reading(top(s)), { format: 'google', precision: 5, order: 'latlng', dimensions: 2 });
  for (const c of (await fx('graphhopper.json')).tests.decode3d) {
    const t = top(c.points);
    eq(reading(t), { format: 'google', precision: 5, order: 'latlng', dimensions: 3 });
    eq(t.zFactor, 100);
    eq(t.presets, ['graphhopper3d', 'openrouteservice3d']);
    eq(decodeAuto(c.points).coordinates, c.latLng);
  }
});

test('detect: a string encoded longitude first', () => {
  // Longitude -120 can't be a latitude. Read at precision 6 it can, as -12,
  // which is in the Atlantic.
  const s = encode([[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  const c = top(s, { isLand });
  eq(reading(c), { format: 'google', precision: 5, order: 'lnglat', dimensions: 2 });
  eq(decode(s, c.options), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  eq(decodeAuto(s, { isLand }).coordinates[0], [38.5, -120.2]);
});

test('detect: HERE Flexible Polyline, by its header', () => {
  const s = F.encode({ polyline: [[50.10228, 8.69821, 112.5], [50.10201, 8.69567, 113.1], [50.10063, 8.6915, 114.8]], precision: 5, thirdDim: F.ELEVATION, thirdDimPrecision: 1 });
  const c = top(s);
  eq([c.format, c.precision, c.dimensions, c.thirdDim, c.thirdDimPrecision, c.valid], ['flexible', 5, 3, 3, 1, true]);
  eq(decodeAuto(s).coordinates[0], [50.10228, 8.69821, 112.5]);
  eq(top('BFoz5xJ67i1B1B7PzIhaxL7Y').format, 'flexible');
  ok(!detect('BFoz5xJ67i1B1B7PzIhaxL7Y', { flexible: false }).some((x) => x.format == 'flexible'));
  // Cut off: still the best reading, with the strict error.
  const cut = top('BFoz5xJ67i1B1B7PzIhaxL7');
  eq([cut.format, cut.valid, fields(cut.issue)], ['flexible', false, fields(thrown(() => F.decode('BFoz5xJ67i1B1B7PzIhaxL7')))]);
});

test('detect: a cut-off or damaged string, with the strict error and how far it got', () => {
  const c = top('_p~iF~ps|U_ulLnnq');
  eq(reading(c), { format: 'google', precision: 5, order: 'latlng', dimensions: 2 });
  eq([c.valid, c.issue.code, c.issue.index], [false, 'truncated', 17]);
  const d = decodeAuto('_p~iF~ps|U_ul LnnqC_mqNvxq`@');
  eq(d.coordinates, decode(GOOGLE));
  eq(d.issues.map(fields), [fields(thrown(() => decode('_p~iF~ps|U_ul LnnqC_mqNvxq`@')))]);
  const { coordinates, issues, candidates, ...best } = d;
  eq(best, candidates[0]);
});

test('detect: confidences add up to 1, best first', () => {
  for (const s of [GOOGLE, '', '??', 'BFoz5xJ67i1B1B7PzIhaxL7Y', 'not a polyline at all']) {
    const list = detect(s);
    ok(Math.abs(list.reduce((a, c) => a + c.confidence, 0) - 1) < 1e-9, s);
    for (let i = 1; i < list.length; i++) ok(list[i - 1].score >= list[i].score && list[i - 1].confidence >= list[i].confidence, s);
  }
  eq(detect('').length, 20);
  eq(decodeAuto('').coordinates, []);
});

test('detect: options', () => {
  eq(detect(GOOGLE, { precisions: [6], orders: ['latlng'], dimensions: [2] }).map(reading), [{ format: 'google', precision: 6, order: 'latlng', dimensions: 2 }]);
  eq(detect(GOOGLE, { precisions: [0, 15] }).length, 8);
  throws(() => detect(GOOGLE, { precisions: [16] }), 'option');
  throws(() => detect(GOOGLE, { precisions: [5.5] }), 'option');
  throws(() => detect(GOOGLE, { orders: ['xy'] }), 'option');
  throws(() => detect(GOOGLE, { dimensions: [4] }), 'option');
  throws(() => detect(GOOGLE, { dimensions: [] }), 'option');
  throws(() => detect(GOOGLE, { sample: 1 }), 'option');
  throws(() => detect(42), 'input');
  throws(() => decodeAuto(null), 'input');
  // A header that doesn't parse isn't a Flexible candidate.
  ok(!detect('B_').some((c) => c.format == 'flexible'));
  // One point far away from the rest.
  const jump = Array.from({ length: 30 }, (_, i) => [52.5 + i * 0.0005, 13.4]);
  jump[15] = [-40, 170];
  ok(detect(encode(jump)).every((c) => c.reasons.includes('huge jumps between points') || c.reasons.some((r) => r.includes('out of range'))));
  // A small sample still finds the precision of a long line.
  const long = encode(gpsTrack({ points: 5000, seed: 3, precision: 6 }), 6);
  eq(top(long, { sample: 16 }).precision, 6);
});

test('detect/land: the 1 degree mask', () => {
  for (const [lat, lng] of [[41, 29], [52.5, 13.4], [-23.5, -46.6], [47.6, -122.3], [-33.9, 151.2], [64.7, 177.5], [-85, 0], [60, 100]]) ok(isLand(lat, lng), `${lat},${lng} is land`);
  for (const [lat, lng] of [[0, 0], [-46.6, -23.5], [30, -40], [-40, 90], [0, -150], [90, 0], [91, 0], [0, 181], [NaN, 0]]) ok(!isLand(lat, lng), `${lat},${lng} is not land`);
  // A precision 5 string read at 6 lands in the Gulf of Guinea.
  const s = encode([[4.1, 9.7], [4.11, 9.71], [4.12, 9.73], [4.13, 9.74]], 5);
  eq(top(s, { isLand }).precision, 5);
});

// Each candidate says what strict decode does with its options: the same
// error, or none. On random lines and broken strings.
const coord = fc.double({ min: -180, max: 180, noNaN: true });
const line = fc.tuple(fc.array(fc.tuple(coord, coord), { maxLength: 40 }), fc.integer({ min: 0, max: 8 })).map(([l, p]) => ref.encode(l, p));
const junk = fc.constantFrom(' ', '!', 'ő', '~~~~~~~~~~~~', '_', '?', '@');
const broken = fc.tuple(line, fc.array(fc.tuple(fc.nat(), junk), { maxLength: 3 }), fc.option(fc.nat())).map(([s, ins, cut]) => {
  for (const [at, j] of ins) s = s.slice(0, at % (s.length + 1)) + j + s.slice(at % (s.length + 1));
  return cut == null ? s : s.slice(0, cut % (s.length + 1));
});
const three = fc.array(fc.tuple(coord, coord, fc.double({ min: -100, max: 5000, noNaN: true })), { maxLength: 30 }).map((l) => encode(l, { dimensions: 3, zFactor: 100 }));

test('detect: valid and issue are what strict decode does with each candidate\'s options', () =>
  fc.assert(fc.property(fc.oneof(line, broken, three, fc.string({ maxLength: 60 })), (s) => {
    for (const c of detect(s)) {
      if (c.format != 'google') continue;
      const err = thrown(() => decodeFlat(s, c.options));
      eq(fields(c.issue), fields(err), `${JSON.stringify(s)} ${JSON.stringify(c.options)}`);
      eq(c.valid, !err);
    }
    const d = decodeAuto(s);
    if (d.format == 'google') eq(d.coordinates, decode(s, { ...d.options, strict: false }));
    return true;
  }), { seed, numRuns: runs }));

// Floors, so a change to the scoring that loses accuracy fails here. The
// numbers are in docs/api.md.
const real = realWorldLines();
const rate = (cases, o) => cases.filter(([s, want]) => {
  const c = top(s, o);
  return c.format == 'google' && c.precision == want.precision && c.order == (want.order ?? 'latlng') && c.dimensions == (want.dimensions ?? 2);
}).length / cases.length;

test('detect accuracy: the 1000 real-world lines at precision 5, 6 and 7', () => {
  const pts = real.map((s) => decode(s));
  const p5 = rate(real.map((s) => [s, { precision: 5 }]));
  const p6 = rate(pts.map((p) => [encode(p, 6), { precision: 6 }]));
  const p7 = rate(pts.map((p) => [encode(p, 7), { precision: 7 }]));
  ok(p5 >= 0.995 && p6 >= 0.995 && p7 >= 0.995, JSON.stringify({ p5, p6, p7 }));
  eq(rate(real.slice(0, 200).map((s) => [s, { precision: 5 }]), { isLand }), 1);
});

test('detect accuracy: generated tracks, with elevation and longitude first', () => {
  const tracks = [[41.01, 28.98], [-23.55, -46.63], [47.61, -122.33], [-33.87, 151.21]].flatMap(([lat, lng]) => Array.from({ length: 10 }, (_, i) => gpsTrack({ points: 200, seed: i + 1, anchor: { lat, lng }, precision: 6 })));
  const r = {
    p5: rate(tracks.map((t) => [encode(t, 5), { precision: 5 }])),
    p6: rate(tracks.map((t) => [encode(t, 6), { precision: 6 }])),
    // An elevation that goes up and down by a few meters.
    z: rate(tracks.map((t, i) => [encode(t.map((p, k) => [...p, 300 + 20 * Math.sin(k / 15 + i)]), { dimensions: 3, zFactor: 100 }), { precision: 5, dimensions: 3 }])),
    // Sao Paulo swapped lands in the Atlantic, Seattle's and Sydney's out of
    // range; Istanbul's lands in Saudi Arabia, which nothing tells apart.
    swapped: rate(tracks.map((t) => [encode(t, { order: 'lnglat' }), { precision: 5, order: 'lnglat' }]), { isLand }),
  };
  ok(r.p5 >= 0.95 && r.p6 >= 0.95 && r.z >= 0.95 && r.swapped >= 0.4, JSON.stringify(r));
});
