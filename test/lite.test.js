// The /lite entry against the default entry. The property everything here
// checks: for any input, lite gives exactly what the default entry gives, or
// it throws. It may only throw where the default entry throws too, or where
// the input is outside lite's scope (a precision other than 0 to 6, a value
// that needs a 7th chunk, a coordinate past 2^29 units), and it may only
// succeed where the default entry throws for a null coordinate, which lite
// encodes as 0 (documented).
// Checked on the vectors, the PostGIS fixture, the real-world lines, random
// lines and strings, and the same again in headless Chrome.
import fc from 'fast-check';
import { test, eq, ok, throws, entries, json, list } from './lib.js';
import { realWorldLines, benchFixtures } from './bench-fixtures.js';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as local from '../src/lite.js';

// In a Worker (scripts/test-workers.js) this is the packed package's
// @duoquote/polytini/lite instead of the file in src/.
const lite = globalThis.__polytiniTest?.lite ?? local;
const all = await entries();
const main = all[0].api;
const env = globalThis.Deno ? Deno.env.toObject() : globalThis.process?.env ?? {};
const seed = Number(env.POLYTINI_SEED ?? 20261127);
const runs = Number(env.POLYTINI_RUNS ?? 300);
const check = (prop) => fc.assert(prop, { seed, numRuns: runs });

const attempt = (fn) => {
  try {
    return { value: fn() };
  } catch (e) {
    return { error: e };
  }
};
// A value of 7 or more chunks: 6 continuation characters in a row.
const sevenChunks = (s) => /[_-~]{6}/.test(s);
// What lite's encoder accepts: |x * factor| below about 2^29.
const inRange = (pts, p) => pts.every((q) => [q[0], q[1]].every((x) => {
  const y = x * 10 ** p;
  return y * y < 2.88e17;
}));
const hasNull = (pts) => pts.some((q) => q[0] === null || q[1] === null);
// The precisions lite takes: a number from 0 to 6, or null and undefined for 5.
const inScope = (p) => p == null || [0, 1, 2, 3, 4, 5, 6].includes(p);

/** Lite's decode agrees with the default entry's, or throws where it may. Returns 'same', 'both threw' or 'lite threw'. */
function decodes(s, p, label = JSON.stringify(s)) {
  const m = attempt(() => main.decode(s, p)), l = attempt(() => lite.decode(s, p));
  if ('value' in l) {
    ok('value' in m, `${label} at ${p}: lite decoded what the default entry rejects (${m.error?.message})`);
    eq(l.value, m.value, `${label} at ${p}`);
    return 'same';
  }
  ok(l.error.constructor === Error && l.error.message === 'Invalid polyline', `${label}: unexpected error ${l.error}`);
  if ('error' in m) return 'both threw';
  if (!inScope(p)) return 'out of scope';
  ok(sevenChunks(s), `${label} at ${p}: lite threw on a string the default entry decodes`);
  return 'lite threw';
}

/** The same for encode. */
function encodes(pts, p, label = JSON.stringify(pts).slice(0, 80)) {
  const m = attempt(() => main.encode(pts, p)), l = attempt(() => lite.encode(pts, p));
  if ('value' in l) {
    if ('error' in m) {
      ok(hasNull(pts), `${label} at ${p}: lite encoded what the default entry rejects (${m.error.message})`);
      eq(l.value, main.encode(pts.map((q) => [q[0] ?? 0, q[1] ?? 0]), p), `${label} at ${p}, null as 0`);
      return 'null';
    }
    eq(l.value, m.value, `${label} at ${p}`);
    return 'same';
  }
  ok(l.error.constructor === Error && l.error.message === 'Invalid coordinate', `${label}: unexpected error ${l.error}`);
  if ('error' in m) return 'both threw';
  if (!inScope(p)) return 'out of scope';
  ok(!inRange(pts, p), `${label} at ${p}: lite threw on points the default entry encodes`);
  return 'lite threw';
}

const tally = (results) => results.reduce((t, r) => ((t[r] = (t[r] ?? 0) + 1), t), {});

test('lite: the API is decode and encode only', () => {
  eq(Object.keys(lite).sort(), ['decode', 'encode']);
});

test('lite: Google example, precision 6, empty input', () => {
  const pts = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
  eq(lite.encode(pts), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  eq(lite.decode('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), pts);
  eq(lite.decode(lite.encode(pts, 6), 6), pts);
  eq(lite.encode(pts, null), lite.encode(pts));
  eq(lite.decode('_p~iF~ps|U', null), [[38.5, -120.2]]);
  eq(lite.decode(''), []);
  eq(lite.encode([]), '');
});

// JSON has no NaN, Infinity or -0, so the vectors spell them as strings.
const NUMBERS = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity, '-0': -0 };
const revive = (v) => (typeof v == 'string' && v in NUMBERS ? NUMBERS[v] : Array.isArray(v) ? v.map(revive) : v);
const precisionOf = (o) => (o == null ? undefined : typeof o == 'number' ? o : Object.keys(o).length == 1 && 'precision' in o ? o.precision : NaN);

test('lite: the vectors, every case with only a precision', async () => {
  const results = [];
  for (const f of (await list('fixtures/vectors/')).filter((f) => f.endsWith('.json')).sort()) {
    for (const c of (await json('fixtures/vectors/' + f)).cases) {
      const p = precisionOf(c.options);
      if (p !== undefined && !(Number.isInteger(p) && p >= 0 && p <= 15)) continue;
      const label = `${f}: ${c.name}`;
      if (c.op == 'decode' && typeof c.input == 'string') results.push(decodes(c.input, p, label));
      if (c.op == 'encode' && Array.isArray(c.input) && c.input.every(Array.isArray)) results.push(encodes(revive(c.input), p, label));
    }
  }
  const t = tally(results);
  ok(t.same > 120 && t['both threw'] > 20, `too few cases: ${JSON.stringify(t)}`);
});

test('lite: the PostGIS fixture, precisions 0 to 15', async () => {
  const fx = await json('fixtures/postgis.json');
  const num = (x) => (typeof x == 'string' ? Number(x) : x);
  const results = [];
  // Lite doesn't check the precision beyond it being a number, so the
  // cases with a precision the default entry rejects are left out.
  const valid = (c) => Number.isInteger(c.precision) && c.precision >= 0 && c.precision <= 15;
  for (const c of fx.decode.filter(valid)) results.push(decodes(c.encoded, c.precision, c.name));
  for (const c of fx.encode.filter(valid)) results.push(encodes(c.points.map((q) => q.map(num)), c.precision, c.name));
  const t = tally(results);
  // Every case at precision 6 and below is in scope, apart from the
  // "range" ones with values past 2^29.
  ok(t.same > 300 && t['out of scope'] > 100, JSON.stringify(t));
});

test('lite: the benchmark fixtures and the 1000 real-world lines', () => {
  for (const s of realWorldLines()) eq(lite.decode(s), main.decode(s));
  for (const p of [5, 6]) {
    for (const f of benchFixtures(p)) {
      for (const [i, s] of f.encoded.entries()) {
        eq(lite.decode(s, p), main.decode(s, p), f.name);
        eq(lite.encode(f.coords[i], p), s, f.name);
      }
    }
  }
});

test('lite: rounding, half away from zero and exact at 0.49999999999999994', () => {
  const halves = [0.5, 1.5, 2.5, 1e6 + 0.5, 0.49999999999999994, 0.5000000000000001, 1.4999999999999998, 2 ** -1074, 0];
  for (let p = 0; p <= 6; p++) {
    for (const h of halves) {
      for (const k of [0, 1, -1, 17, -17, 12345, -12345]) {
        for (const x of [k + h, k - h]) {
          const pts = [[x / 10 ** p, -x / 10 ** p], [x, x / 7]];
          if (inRange(pts, p)) eq(lite.encode(pts, p), main.encode(pts, p), `${x} at ${p}`);
        }
      }
    }
  }
  eq(lite.encode([[0.49999999999999994, -0.49999999999999994]], 0), '??');
  eq(lite.encode([[0.5, -0.5]], 0), 'A@');
  eq(lite.encode([[-0, -0]]), '??');
});

test('lite: errors and what is out of scope', () => {
  const e = throws(() => lite.decode('_p~iF~ps|U_ulLnnq'));
  ok(e.constructor === Error && e.message === 'Invalid polyline', e.message);
  throws(() => lite.decode('_p~iF~ps|U_ulLnnqC_'), undefined, 'truncated inside a value');
  throws(() => lite.decode('_p~iF'), undefined, 'a latitude and no longitude');
  throws(() => lite.decode('_p~iF ~ps|U'), undefined, 'a space');
  throws(() => lite.decode('_p~iF~ps|U\u00e9'), undefined, 'above ~');
  throws(() => lite.decode('_p~iF~ps|U\n'), undefined, 'a newline');
  throws(() => lite.decode('~~~~~~??'), undefined, 'a 7th chunk');
  throws(() => lite.decode('_p~iF~ps|U', { precision: 6 }), undefined, 'an options object');
  for (const p of ['x', 7, 15, -1, 2.5, NaN, Infinity]) throws(() => lite.decode('_p~iF~ps|U', p), undefined, 'precision ' + p);
  for (const p of [7, -1, 2.5]) ok(throws(() => lite.encode([[1, 2]], p)).message === 'Invalid coordinate', 'encode at precision ' + p);
  eq(lite.decode('_p~iF~ps|U', '6'), main.decode('_p~iF~ps|U', 6), 'a numeric string precision');
  for (const bad of [[[NaN, 1]], [[1, Infinity]], [[1]], [[1, 'x']], [{ lat: 1, lng: 2 }], [[1e300, 0]], [[5400, 0]]]) {
    const err = throws(() => lite.encode(bad), undefined, JSON.stringify(bad));
    ok(err.message === 'Invalid coordinate', err.message);
  }
  // Precision 6 covers every valid coordinate, both ways round the world.
  const world = [[90, 180], [-90, -180], [90, -180], [-90, 180], [0, 0]];
  eq(lite.encode(world, 6), main.encode(world, 6));
  eq(lite.decode(main.encode(world, 6), 6), world);
  // Lenient where the docs say so: null is 0, numeric strings are numbers.
  eq(lite.encode([[null, '1.5']]), main.encode([[0, 1.5]]));
});

test('lite: random lines agree with the default entry at precisions 0 to 6', () => {
  const coord = fc.oneof(fc.double({ min: -180, max: 180, noNaN: true }), fc.integer({ min: -180, max: 180 }), fc.constantFrom(0, -0, 90, -90, 180, -180, 0.000005, -0.000005, 1e-7));
  const line = fc.array(fc.tuple(coord, coord), { maxLength: 150 });
  check(fc.property(line, fc.integer({ min: 0, max: 6 }), (l, p) => {
    eq(encodes(l, p), 'same');
    eq(decodes(main.encode(l, p), p), 'same');
    return true;
  }));
});

test('lite: random strings and cut or corrupted polylines agree with the default entry', () => {
  const real = realWorldLines();
  check(fc.property(fc.oneof(fc.string({ maxLength: 200, unit: 'binary' }), fc.stringMatching(/^[?-~]{0,300}$/)), fc.integer({ min: 0, max: 8 }), (s, p) => (decodes(s, p), true)));
  check(fc.property(fc.integer({ min: 0, max: real.length - 1 }), fc.nat(), fc.integer({ min: 0, max: 200 }), (k, at, code) => {
    const s = real[k], i = at % (s.length + 1), c = String.fromCharCode(code);
    decodes(s.slice(0, i), 5);
    decodes(s.slice(0, i) + c + s.slice(i), 5);
    decodes(s + c, 5);
    return true;
  }));
});

test('lite: random encode inputs, valid or not, agree with the default entry', () => {
  const v = fc.oneof(fc.double(), fc.double({ min: -1000, max: 1000 }), fc.constantFrom(NaN, Infinity, -Infinity, null, undefined, '1.5', '', 'x', true, 2 ** 29, 1e9));
  const pt = fc.oneof(fc.tuple(v, v), fc.tuple(v), fc.tuple(v, v, v));
  check(fc.property(fc.array(pt, { maxLength: 20 }), fc.integer({ min: 0, max: 9 }), (pts, p) => (encodes(pts, p), true)));
});

// The same differential checks in headless Chrome, on src/lite.js as the
// browser loads it, against the default entry's results from here.
const chromePath = globalThis.__polytiniTest ? null : [env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
if (!chromePath && !globalThis.__polytiniTest) console.log('lite.test.js: no Chrome found (set CHROME_PATH), skipping the browser run');
if (chromePath) {
  test('lite: in Chrome, the same results as the default entry', async () => {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const ORIGIN = 'http://polytini.test', src = fileURLToPath(new URL('../src/', import.meta.url));
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin != ORIGIN) return route.abort();
        if (url.pathname == '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
        const file = url.pathname.startsWith('/src/') && src + url.pathname.slice(5);
        return file && existsSync(file) ? route.fulfill({ contentType: 'text/javascript', body: readFileSync(file) }) : route.fulfill({ status: 404, body: '' });
      });
      await page.goto(ORIGIN + '/');
      const result = (fn) => {
        const r = attempt(fn);
        return 'value' in r ? { value: r.value } : { error: r.error.message };
      };
      const real = realWorldLines();
      const strings = [...real, ...real.slice(0, 50).map((s) => s.slice(0, -1)), '~~~~~~??', '_p~iF ~ps|U', ...fc.sample(fc.string({ maxLength: 60, unit: 'binary' }), { seed, numRuns: 100 })];
      const dec = strings.flatMap((s) => [5, 6].map((p) => ({ s, p, want: result(() => lite.decode(s, p)) })));
      const lines = [...benchFixtures(5).flatMap((f) => f.coords.slice(0, 20)), [[NaN, 1]], [[0.49999999999999994, 2.5]]];
      const enc = lines.map((pts) => ({ pts, want: result(() => lite.encode(pts)) }));
      // What lite gives here is already checked against the default entry above.
      const bad = await page.evaluate(
        async ({ origin, decodes, encodes }) => {
          const L = await import(origin + '/src/lite.js');
          const run = (fn) => {
            try {
              return { value: fn() };
            } catch (e) {
              return { error: e.message };
            }
          };
          const out = [];
          for (const { s, p, want } of decodes) if (JSON.stringify(run(() => L.decode(s, p))) != JSON.stringify(want)) out.push('decode ' + JSON.stringify(s).slice(0, 60));
          for (const { pts, want } of encodes) if (JSON.stringify(run(() => L.encode(pts))) != JSON.stringify(want)) out.push('encode ' + JSON.stringify(pts).slice(0, 60));
          return out;
        },
        { origin: ORIGIN, decodes: dec, encodes: enc },
      );
      eq(bad, [], 'differences in Chrome');
      eq(errors, [], 'page errors');
    } finally {
      await browser.close();
    }
  });
}
