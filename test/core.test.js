// Every entry point against the reference codec, plus strict mode, options
// and input shapes. The same checks run for web, node, bun, deno and wasm.
import { test, eq, near, ok, throws, entries } from './lib.js';
import * as ref from './reference.js';
import { latLngs, latLngsFlat } from '../src/core.js';

const all = await entries();
const google = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const pts = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];

// mulberry32, the same generator the benchmark fixtures use.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const q = (v, p) => Math.round(v * 10 ** p) / 10 ** p;
function cases(p) {
  const u = 10 ** -p, rand = rng(42 + p);
  const raw = [[0, -179.9832104]];
  while (raw.length < 300) raw.push([(rand() * 180 - 90).toFixed(9) * 1, (rand() * 360 - 180).toFixed(9) * 1]);
  const walk = [];
  for (let i = 0, lat = 0, lng = 0; i < 2000; i++) walk.push([q((lat += (rand() - 0.5) * 0.01), p), q((lng += (rand() - 0.5) * 0.01), p)]);
  return {
    empty: [],
    'single point at 0,0': [[0, 0]],
    negatives: [[-33.86882, 151.20929], [-22.90685, -43.1729], [-0.00001, -0.00001], [-54.80191, -68.30295]],
    'extremes (+-90, +-180)': [[90, 180], [-90, -180], [0, 0], [-90, 180], [90, -180]],
    antimeridian: [[10, 179.99999], [10, -179.99999], [10.00001, 179.99999]],
    'repeated points': Array.from({ length: 6 }, () => [52.52, 13.405]),
    'one-unit steps': [[0, 0], [u, u], [0, 0], [-u, -u], [q(-u * 2, p), q(u * 3, p)]],
    'unquantized input': raw,
    'random walk (2000 points, long enough for every fast path)': walk,
  };
}

for (const { name, api } of all) {
  test(`${name}: Google's documented example`, () => {
    eq(api.encode(pts), google);
    eq(api.decode(google), pts);
    eq(api.encode([[0, -179.9832104]]), '?`~oia@');
  });

  for (const p of [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 13]) {
    test(`${name}: matches the reference at precision ${p}`, () => {
      for (const [label, line] of Object.entries(cases(p))) {
        const s = ref.encode(line, p);
        eq(api.encode(line, p), s, `${label} encode`);
        eq(api.encode(line, { precision: p }), s, `${label} encode (options object)`);
        eq(api.decode(s, p), ref.decode(s, p), `${label} decode`);
        eq(api.decodeFlat(s, p), ref.decode(s, p).flat(), `${label} decodeFlat`);
        eq(api.encodeFlat(line.flat(), p), s, `${label} encodeFlat`);
        eq(api.encodeFlat(new Float64Array(line.flat()), p), s, `${label} encodeFlat Float64Array`);
      }
    });
  }

  test(`${name}: lnglat order`, () => {
    const flipped = pts.map(([a, b]) => [b, a]);
    eq(api.encode(flipped, { order: 'lnglat' }), google);
    eq(api.decode(google, { order: 'lnglat' }), flipped);
    eq(api.decodeFlat(google, { order: 'lnglat' }), flipped.flat());
    eq(api.encodeFlat(flipped.flat(), { order: 'lnglat' }), google);
    const long = cases(5)['random walk (2000 points, long enough for every fast path)'];
    eq(api.decode(ref.encode(long, 5), { order: 'lnglat' }), long.map(([a, b]) => [b, a]));
  });

  test(`${name}: objects, typed points and mixed input`, () => {
    eq(api.encode(pts.map(([lat, lng]) => ({ lat, lng }))), google);
    eq(api.encode(pts.map(([latitude, longitude]) => ({ latitude, longitude }))), google);
    eq(api.encode(pts.map(([lat, lon]) => ({ lat, lon }))), google);
    eq(api.encode([pts[0], { lat: 40.7, lng: -120.95 }, new Float64Array(pts[2])]), google);
    // Objects ignore order: they're named.
    eq(api.encode(pts.map(([lat, lng]) => ({ lat, lng })), { order: 'lnglat' }), google);
    eq(api.decodeLatLng(google), pts.map(([lat, lng]) => ({ lat, lng })));
    // A 0 in an object must not be treated as missing (polyline-encoded's bug).
    eq(api.encode([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]), ref.encode([[0, 0], [0, 1]]));
  });

  test(`${name}: GeoJSON`, () => {
    const line = { type: 'LineString', coordinates: pts.map(([a, b]) => [b, a]) };
    eq(api.toGeoJSON(google), line);
    eq(api.fromGeoJSON(line), google);
    eq(api.fromGeoJSON({ type: 'Feature', properties: {}, geometry: line }), google);
    eq(api.toGeoJSON(ref.encode(pts, 6), 6), line);
    eq(api.fromGeoJSON(line, { precision: 6 }), ref.encode(pts, 6));
    // [lng, lat, alt] positions encode as 2D unless dimensions says otherwise.
    eq(api.fromGeoJSON({ type: 'LineString', coordinates: line.coordinates.map((c) => [...c, 100]) }), google);
    throws(() => api.fromGeoJSON({ type: 'Point', coordinates: [1, 2] }), 'input');
    throws(() => api.fromGeoJSON(null), 'input');
  });

  // The node and deno entries build long lines' objects from decodeFlat
  // (latLngsFlat in core.js), Bun's at every length. The objects and errors
  // have to be the tuples' either way.
  test(`${name}: decodeLatLng is decode's points as objects, short and long, with any options`, () => {
    const objs = (s, o) => {
      try {
        return api.decode(s, { ...(typeof o == 'number' ? { precision: o } : o), order: 'latlng' }).map(([lat, lng]) => ({ lat, lng }));
      } catch (e) {
        return `${e.name} ${e.code} ${e.index} ${e.message}`;
      }
    };
    const same = (s, o, label) => {
      let got;
      try {
        got = api.decodeLatLng(s, o);
      } catch (e) {
        got = `${e.name} ${e.code} ${e.index} ${e.message}`;
      }
      eq(got, objs(s, o), label);
    };
    const walk = cases(5)['random walk (2000 points, long enough for every fast path)'];
    const long = ref.encode(walk, 5), mid = ref.encode(walk.slice(0, 80), 5), issues = [];
    ok(mid.length >= 256 && mid.length < 400, 'a line just past the cutoff');
    const opts = [undefined, 5, 6, { precision: 6 }, { order: 'lnglat' }, { dimensions: 1 }, { dimensions: 3 }, { dimensions: 2 }, { dimensions: '2' }, { factor: 3 }, { strict: false }, { strict: false, onIssue: (e) => issues.push(e.code) }, { precision: 'x' }, { dimensions: 0 }];
    for (const s of ['', google, mid, long, long + '?', long.slice(0, -1), long.slice(0, 300) + ' ' + long.slice(300), long.slice(0, 300) + 'ő' + long.slice(300)]) {
      for (const o of opts) same(s, o, `${s.length} characters, ${JSON.stringify(o)}`);
    }
    ok(issues.length > 0, 'onIssue was called');
    for (const s of [null, undefined, 5, Array(300).fill('?'), { length: 300 }]) same(s, undefined, String(s).slice(0, 20));
  });

  // Which entries take the decodeFlat route depends on the runtime (none on
  // Node 24, and none here for deno.js outside Deno), so the helper itself
  // runs too, over this entry's decoders, at both cutoffs.
  test(`${name}: latLngsFlat gives decodeLatLng's objects and errors`, () => {
    const call = (fn, s, o) => {
      try {
        return fn(s, o);
      } catch (e) {
        return `${e.name} ${e.code} ${e.index} ${e.message}`;
      }
    };
    const want = latLngs(api.decode), walk = cases(5)['random walk (2000 points, long enough for every fast path)'];
    const long = ref.encode(walk, 5);
    for (const cut of [0, 256]) {
      const got = latLngsFlat(api.decode, api.decodeFlat, cut);
      for (const s of ['', google, long, long.slice(0, -1), long + '!', null, 5]) {
        for (const o of [undefined, 6, { order: 'lnglat' }, { dimensions: 3 }, { dimensions: 1 }, { strict: false }, { precision: 'x' }]) eq(call(got, s, o), call(want, s, o), `cut ${cut}, ${String(s).length} characters, ${JSON.stringify(o)}`);
      }
    }
  });

  test(`${name}: strict decode errors`, () => {
    let e = throws(() => api.decode(google.slice(0, -1)), 'truncated');
    eq(e.name, 'PolylineError');
    ok(e instanceof api.PolylineError && e instanceof Error);
    // Every truncation of a valid string throws (a cut on a point boundary
    // is a valid shorter line).
    const ends = new Set([0]);
    for (let i = 0, k = 0; i < google.length; i++) if (google.charCodeAt(i) < 95 && ++k % 2 == 0) ends.add(i + 1);
    for (let n = 1; n < google.length; n++) {
      if (ends.has(n)) eq(api.decode(google.slice(0, n)).length, [...ends].filter((x) => x && x <= n).length);
      else throws(() => api.decode(google.slice(0, n)), 'truncated', `length ${n}`);
    }
    e = throws(() => api.decode('_p~iF~ps|U _ulLnnqC'), 'char');
    eq(e.index, 10);
    throws(() => api.decode('_p~iF~ps|Uő'), 'char');
    throws(() => api.decode('_p~iF~ps|U\u007f'), 'char');
    throws(() => api.decode('_p~iF~ps|U>'), 'char');
    // A long string, so the buffer paths see it too.
    throws(() => api.decode(ref.encode(cases(5)['unquantized input'], 5) + 'ő?'), 'char');
    throws(() => api.decode(ref.encode(cases(5)['unquantized input'], 5) + '_'), 'truncated');
    throws(() => api.decode(ref.encode(cases(5)['unquantized input'], 5) + '?'), 'truncated');
    // Characters outside ASCII anywhere in a long string, where the buffer
    // paths copy it as bytes: at the start, in the middle, a lone surrogate,
    // and more of them than the scratch buffer holds.
    const long = ref.encode(cases(5)['unquantized input'], 5);
    eq(throws(() => api.decode('ő' + long), 'char').index, 0);
    eq(throws(() => api.decode(long + 'é' + long), 'char').index, long.length);
    eq(throws(() => api.decode(long + '�' + long), 'char').index, long.length);
    eq(throws(() => api.decode(long + '😀'), 'char').index, long.length);
    eq(throws(() => api.decode('ő'.repeat(40000)), 'char').index, 0);
    eq(throws(() => api.decodeFlat('€'.repeat(40000)), 'char').index, 0);
    // U+0151 is 0x51 "Q" in its low byte, and U+013F is 0x3f "?".
    throws(() => api.decode(long + 'őĿ'), 'char');
    // More than 53 bits.
    throws(() => api.decode('~'.repeat(11) + '??'), 'overflow');
    throws(() => api.decode(42), 'input');
    throws(() => api.decodeFlat(google.slice(0, -1)), 'truncated');
  });

  test(`${name}: lenient decode`, () => {
    const o = { strict: false };
    eq(api.decode(google.slice(0, -1), o), pts.slice(0, 2));
    eq(api.decode(google + '?', o), pts);
    eq(api.decode('_p~iF ~ps|U\n', o), pts.slice(0, 1));
    eq(api.decodeFlat(google.slice(0, -1), o), pts.slice(0, 2).flat());
    eq(api.decode('', o), []);
    // Long strings with characters outside ASCII: skipped like any other.
    const line = cases(5)['unquantized input'], long = ref.encode(line, 5);
    eq(api.decode('ő' + long + '�', o), ref.decode(long, 5));
    eq(api.decodeFlat(long.slice(0, 100) + 'é€' + long.slice(100), o), ref.decode(long, 5).flat());
    eq(api.decode('ő'.repeat(40000), o), []);
  });

  test(`${name}: values past 32 bits decode exactly`, () => {
    // 7+ chunk values: precision 10 coordinates and huge deltas.
    for (const p of [7, 9, 10, 13]) {
      const line = [[89.9999999999, 179.9999999999], [-89.9999999999, -179.9999999999], [0, 0]].map(([a, b]) => [q(a, p), q(b, p)]);
      const s = ref.encode(line, p);
      eq(api.decode(s, p), ref.decode(s, p));
      eq(api.encode(line, p), s);
    }
    // Coordinates far out of range still round-trip (some people encode
    // projected or pixel coordinates).
    const big = [[123456.78901, -987654.32109], [0, 0]];
    eq(api.encode(big), ref.encode(big, 5));
    eq(api.decode(ref.encode(big, 5)), ref.decode(ref.encode(big, 5), 5));
  });

  test(`${name}: strict encode errors`, () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'abc']) {
      const e = throws(() => api.encode([[1, 2], [bad, 3]]), 'coordinate', String(bad));
      eq(e.index, 1);
    }
    throws(() => api.encode([[1, 2], null]), 'coordinate');
    throws(() => api.encode([[1, 2], {}]), 'coordinate');
    throws(() => api.encode([[1, 2], [3]]), 'coordinate');
    throws(() => api.encode(null), 'input');
    throws(() => api.encode(42), 'input');
    throws(() => api.encodeFlat([1, 2, 3]), 'input');
    throws(() => api.encodeFlat([1, NaN]), 'coordinate');
    throws(() => api.encode([[1e300, 0]]), 'overflow');
    // Long lines take the byte-buffer paths, which have their own bailouts.
    const long = Array.from({ length: 1000 }, (_, i) => [i / 1e3, -i / 1e3]);
    for (const bad of [null, [NaN, 1], ['1', 2]]) {
      const pts = long.slice();
      pts[700] = bad;
      if (typeof bad?.[0] == 'string') eq(api.encode(pts), ref.encode(pts.map((p) => p.map(Number)), 5));
      else eq(throws(() => api.encode(pts), 'coordinate').index, 700);
    }
    // Numeric strings are numbers, like in every other library.
    eq(api.encode([['38.5', '-120.2']]), ref.encode([[38.5, -120.2]], 5));
  });

  test(`${name}: every length from 0 to 40 and around 64, 128, 256, 512 and 1024 points`, () => {
    // The entries switch from string building to byte buffers at different
    // lengths (16, 32, 512 and 1024 points, and the string-builtins cutoffs in
    // wasm.js), so check each side of all of them.
    const walk = cases(5)['random walk (2000 points, long enough for every fast path)'];
    for (const n of [...Array(41).keys(), 63, 64, 65, 127, 128, 129, 255, 256, 257, 511, 512, 513, 1023, 1024, 1025]) {
      const line = walk.slice(0, n), s = ref.encode(line, 5);
      eq(api.encode(line), s, `encode ${n}`);
      eq(api.encodeFlat(new Float64Array(line.flat())), s, `encodeFlat ${n}`);
      eq(api.decode(s), ref.decode(s, 5), `decode ${n}`);
      eq(api.decodeFlat(s), ref.decode(s, 5).flat(), `decodeFlat ${n}`);
    }
  });

  test(`${name}: lenient encode`, () => {
    const o = { strict: false };
    eq(api.encode([[1, 2], [NaN, 3]], o), ref.encode([[1, 2], [0, 3]], 5));
    eq(api.encode([[1, 2], null], o), ref.encode([[1, 2], [0, 0]], 5));
    eq(api.encodeFlat([1, 2, 3], o), ref.encode([[1, 2]], 5));
  });

  test(`${name}: options`, () => {
    for (const bad of [-1, 16, 5.5, NaN, '5']) throws(() => api.decode(google, bad), 'option', String(bad));
    throws(() => api.decode(google, { precision: 99 }), 'option');
    throws(() => api.decode(google, { order: 'xy' }), 'option');
    throws(() => api.decode(google, { factor: 0 }), 'option');
    throws(() => api.decode(google, { dimensions: 0 }), 'option');
    throws(() => api.encode(pts, { zFactor: -1 }), 'option');
    eq(api.decode(google, null), pts);
    eq(api.decode(google, {}), pts);
    eq(api.decode(google, { precision: undefined }), pts);
    // factor instead of precision, like @pirxpilot/google-polyline.
    eq(api.encode(pts, { factor: 1e5 }), google);
    eq(api.decode(google, { factor: 1e5 }), pts);
    eq(api.decode(api.encode([[1.5, 2.25]], { factor: 4 }), { factor: 4 }), [[1.5, 2.25]]);
  });

  test(`${name}: dimensions and zFactor`, () => {
    const line = [[38.5, -120.2, 120.5], [40.7, -120.95, 98], [43.252, -126.453, 1500.25]];
    // Every value is a delta of the same value of the previous point.
    const s = ref.encode(line.map(([a, b]) => [a, b]), 5);
    const s3 = api.encode(line, { dimensions: 3, zFactor: 100 });
    eq(api.decode(s3, { dimensions: 3, zFactor: 100 }), line);
    eq(api.decodeFlat(s3, { dimensions: 3, zFactor: 100 }), line.flat());
    eq(api.encodeFlat(line.flat(), { dimensions: 3, zFactor: 100 }), s3);
    eq(api.decode(s3, { dimensions: 3, zFactor: 100, order: 'lnglat' }), line.map(([a, b, c]) => [b, a, c]));
    eq(api.encode(line.map(([lat, lng, alt]) => ({ lat, lng, alt })), { dimensions: 3, zFactor: 100 }), s3);
    eq(api.encode(line.map(([latitude, longitude, altitude]) => ({ latitude, longitude, altitude })), { dimensions: 3, zFactor: 100 }), s3);
    ok(s3 != s);
    eq(api.decode(api.encode([[1], [2], [-3]], { dimensions: 1 }), { dimensions: 1 }), [[1], [2], [-3]]);
    throws(() => api.decode(s3), 'truncated', '3D string read as 2D');
  });

  test(`${name}: -0 and rounding ties`, () => {
    // Half away from zero, like Google's reference implementation.
    eq(api.encode([[0.000005, 0], [-0.000005, 0], [0.000015, 0], [-0.000015, 0]]), ref.encode([[0.000005, 0], [-0.000005, 0], [0.000015, 0], [-0.000015, 0]], 5));
    eq(ref.decode(api.encode([[-0.000005, 0]]), 5)[0][0], -0.00001);
    eq(ref.decode(api.encode([[-0.000015, 0]]), 5)[0][0], -0.00002);
    // The largest double below 0.5 rounds to 0. floor(x + 0.5) gets 1,
    // because the addition rounds up (PostGIS, which uses C round(), agrees).
    eq(api.encode([[0.49999999999999994, -0.49999999999999994]], 0), '??');
    eq(api.encode([[0.0000049999999999999996, -0.0000049999999999999996]], 5), '??');
    eq(api.encode([[0.49999999999999994, 0], [1e7, 0]], { precision: 0, dimensions: 2 }), ref.encode([[0, 0], [1e7, 0]], 0));
    eq(api.encode([[-0, -0]]), '??');
    eq(api.decode('??'), [[0, 0]]);
  });

  test(`${name}: big inputs go through every buffer size`, () => {
    // 110,000 points is over 1 MB as a string, past the kept scratch size.
    for (const n of [1, 15, 16, 31, 32, 33, 100, 5000, 110000]) {
      const rand = rng(n), line = [];
      for (let i = 0; i < n; i++) line.push([q(rand() * 180 - 90, 5), q(rand() * 360 - 180, 5)]);
      const s = ref.encode(line, 5);
      eq(api.encode(line), s, `encode ${n}`);
      eq(api.decode(s), ref.decode(s, 5), `decode ${n}`);
    }
  });
}

test('every entry has the same exports', () => {
  // wasm adds init, initSync and the batch functions.
  const extra = ['init', 'initSync', 'decodeMany', 'encodeMany'];
  const names = (api) => Object.keys(api).filter((k) => !extra.includes(k)).sort();
  for (const { name, api } of all) eq(names(api), names(all[0].api), name);
});

test('wasm: decodeMany and encodeMany match the per-line results', () => {
  for (const { api: w } of all.filter((e) => e.api.decodeMany)) wasmMany(w);
});
function wasmMany(w) {
  const lines = [[], pts, [[0, 0]], Array.from({ length: 300 }, (_, i) => [i / 7 - 20, -i / 3 + 50.123456])];
  for (const o of [undefined, 6, { order: 'lnglat' }, { precision: 0 }]) {
    // The strings always hold lat first; lnglat only flips the tuples.
    const enc = lines.map((l) => ref.encode(l, typeof o == 'number' ? o : o?.precision ?? 5));
    const many = w.decodeMany(enc, o);
    eq([...many.starts], [0, 0, 3, 4, 304], 'starts');
    const flat = enc.map((s) => [...w.decodeFlat(s, o)]).flat();
    near([...many.coords], flat, 1e-12, 'coords');
    eq(w.encodeMany(lines.map((l) => (o?.order ? l.map(([a, b]) => [b, a]) : l)), o), enc, 'encodeMany');
    eq(w.encodeMany(many, o), enc, 'encodeMany from { coords, starts }');
  }
  // A bad line: strict mode throws, lenient falls back to the JS path.
  throws(() => w.decodeMany([google, google.slice(0, -2)]), 'truncated');
  eq(w.decodeMany([google, 'a!'], { strict: false }).starts.length, 3);
  throws(() => w.encodeMany([pts, [[NaN, 1]]]), 'coordinate');
  // A null point, in short lines and in long ones (the two encodeMany paths).
  const long = Array.from({ length: 300 }, (_, i) => [i / 7, i / 9]);
  for (const batch of [[pts, [[1, 2], null]], [long, long, [[1, 2], null]]]) {
    const want = throws(() => all[0].api.encode([[1, 2], null]));
    eq(throws(() => w.encodeMany(batch)).code, want.code, 'null point');
    eq(w.encodeMany(batch, { strict: false }), batch.map((l) => all[0].api.encode(l, { strict: false })), 'null point, lenient');
  }
  throws(() => w.decodeMany('abc'), 'input');
  eq(w.decodeMany([]).coords.length, 0);
  eq(w.encodeMany([]), []);
}

// A running sum past 2^31: precision 8 and up does that with real
// coordinates (30 degrees is 3e9 at 1e8). The JS paths add in doubles; the
// WASM modules used to add in 32 bits and wrapped.
test('a running sum past 2^31 decodes the same on every entry', () => {
  const zig = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    for (; v >= 32; v >>>= 5) s += String.fromCharCode((32 | (v & 31)) + 63);
    return s + String.fromCharCode(v + 63);
  };
  for (const n of [5, 40, 200]) {
    // n steps of 5.3 degrees up in lat and down in lng, at precision 8.
    const str = (zig(2 ** 29 - 1) + zig(-(2 ** 29 - 1))).repeat(n), want = ref.decode(str, 8);
    eq(want[n - 1], [(n * (2 ** 29 - 1)) / 1e8, (-n * (2 ** 29 - 1)) / 1e8]);
    for (const { name, api } of all) {
      eq(api.decode(str, 8), want, `${name} decode, ${n} points`);
      eq([...api.decodeFlat(str, 8)], want.flat(), `${name} decodeFlat, ${n} points`);
      if (api.decodeMany) eq([...api.decodeMany([str, str], 8).coords], [...want.flat(), ...want.flat()], `${name} decodeMany, ${n} points`);
    }
  }
});

test('wasm: initSync after init is a no-op, and works on its own', async () => {
  const wasm = all.find((e) => e.name == 'wasm').api;
  wasm.initSync();
  eq(wasm.decode(google), pts);
});
