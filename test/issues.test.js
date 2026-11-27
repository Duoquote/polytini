// onIssue: lenient decoding reports what strict mode would have thrown.
// On every entry, for every decoder that has a lenient mode:
// - the first issue is the PolylineError strict mode throws: same class,
//   code, index and message
// - the output is what strict: false gives without onIssue
// - strict mode never calls it
// - valid input reports nothing
// Fixed seeds; POLYTINI_SEED and POLYTINI_RUNS explore more.
import fc from 'fast-check';
import { test, eq, ok, throws, entries } from './lib.js';
import * as ref from './reference.js';
import * as localStream from '../src/stream.js';
import * as F from '../src/flexible.js';
import { osrm6, graphhopper3d, valhalla } from '../src/presets.js';

const S = globalThis.__polytiniTest?.stream ?? localStream;
const all = await entries();
const env = globalThis.Deno ? Deno.env.toObject() : globalThis.process?.env ?? {};
const seed = Number(env.POLYTINI_SEED ?? 20261128);
const runs = Number(env.POLYTINI_RUNS ?? 150);
const check = (prop) => fc.assert(prop, { seed, numRuns: runs });

const plain = (x) => (ArrayBuffer.isView(x) ? Array.from(x) : x);
const fields = (e) => ({ name: e.name, code: e.code, index: e.index, message: e.message });
const thrown = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
};
const asObject = (o) => (typeof o == 'number' ? { precision: o } : o ?? {});

// Calls fn(str, options) leniently with onIssue and checks it against
// strict mode and plain lenient mode. Returns the issues.
function compare(api, fn, s, o, label) {
  const issues = [];
  const got = fn(s, { ...asObject(o), strict: false, onIssue: (e) => issues.push(e) });
  eq(plain(got), plain(fn(s, { ...asObject(o), strict: false })), `${label}: same output as without onIssue`);
  const err = thrown(() => fn(s, o));
  if (err) {
    ok(issues.length > 0, `${label}: strict threw ${err.message}, onIssue got nothing`);
    ok(issues[0] instanceof api.PolylineError, `${label}: a PolylineError`);
    eq(fields(issues[0]), fields(err), `${label}: first issue`);
  } else eq(issues.map(fields), [], `${label}: valid input reports nothing`);
  // Strict mode throws as before and never calls onIssue.
  let called = 0;
  const strictErr = thrown(() => fn(s, { ...asObject(o), strict: true, onIssue: () => called++ }));
  eq(strictErr && fields(strictErr), err && fields(err), `${label}: strict with onIssue`);
  eq(called, 0, `${label}: strict mode doesn't call onIssue`);
  return issues;
}

// Broken strings: valid lines with invalid characters put in, cut off at
// any point, or with values past 2^53 (a run of continuation characters).
const coord = fc.double({ min: -180, max: 180, noNaN: true });
const valid = fc.tuple(fc.array(fc.tuple(coord, coord), { maxLength: 60 }), fc.integer({ min: 0, max: 7 })).map(([l, p]) => ref.encode(l, p));
const junk = fc.constantFrom(' ', '!', '>', '\x7f', 'ő', '\u{1F600}', '\n', '~~~~~~~~~~~~', '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~?');
const broken = fc.tuple(valid, fc.array(fc.tuple(fc.nat(), junk), { maxLength: 4 }), fc.option(fc.nat())).map(([s, ins, cut]) => {
  for (const [at, j] of ins) s = s.slice(0, at % (s.length + 1)) + j + s.slice(at % (s.length + 1));
  return cut == null ? s : s.slice(0, cut % (s.length + 1));
});
const input = fc.oneof(valid, broken, broken);
const options = fc.constantFrom(undefined, 5, 6, 7, { precision: 6, order: 'lnglat' }, { dimensions: 3, zFactor: 100 }, { dimensions: 1 }, osrm6, graphhopper3d, valhalla);

for (const { name, api } of all) {
  test(`${name}: onIssue gets what strict mode throws, from every decoder`, () =>
    check(fc.property(input, options, (s, o) => {
      for (const f of ['decode', 'decodeFlat', 'decodeLatLng', 'toGeoJSON']) compare(api, api[f], s, o, `${name} ${f} ${JSON.stringify(s)} ${JSON.stringify(o)}`);
      return true;
    })));
}

const web = all[0].api;

test('issues: one per invalid character, one per oversized value, one for the cut-off end', () => {
  const s = '_p~iF ~ps|U!_ulL' + '~'.repeat(12) + '?nnqC_mqNvxq`';
  const issues = [];
  web.decode(s, { strict: false, onIssue: (e) => issues.push(e) });
  eq(issues.map((e) => [e.code, e.index]), [['char', 5], ['char', 11], ['overflow', 26], ['truncated', s.length]]);
  eq(issues[3].message, `Truncated at ${s.length}`);
  // Skipping a character is decoding the string without it.
  for (const { api } of all) eq(api.decode('_p~iF ~ps|U_ulLnnqC!', { strict: false, onIssue() {} }), api.decode('_p~iF~ps|U_ulLnnqC'));
});

test('issues: decoding goes on after onIssue, and stops if it throws', () => {
  const stop = new Error('stop');
  for (const { api } of all) {
    eq(thrown(() => api.decode('_p~iF ~ps|U', { strict: false, onIssue: () => { throw stop; } })), stop);
    eq(thrown(() => api.decodeFlat('_p~iF ~ps|U', { strict: false, onIssue: () => { throw stop; } })), stop);
  }
});

test('issues: onIssue can decode, and the outer call keeps its own options', () => {
  for (const { name, api } of all) {
    const inner = [];
    const got = api.decode('_p~iF~ps|U_ulL nnqC_mqNvxq`@', {
      precision: 6, order: 'lnglat', strict: false,
      onIssue: () => inner.push(api.decode('_p~iF~ps|U', { dimensions: 1 }), api.decodeFlat('_p~iF~ps|U_', { strict: false })),
    });
    eq(got, api.decode('_p~iF~ps|U_ulLnnqC_mqNvxq`@', { precision: 6, order: 'lnglat' }), name);
    eq(inner.length, 2);
  }
});

test('issues: a missing onIssue is fine, strict: false without it is unchanged', () => {
  eq(web.decode('_p~iF~ps|U!', { strict: false, onIssue: undefined }), [[38.5, -120.2]]);
  eq(web.decode('_p~iF~ps|U!', { strict: false, onIssue: null }), [[38.5, -120.2]]);
});

test('issues: wasm decodeMany reports each line\'s issues with the index in that line', async () => {
  const w = all.find((e) => e.name == 'wasm')?.api;
  if (!w?.decodeMany) return;
  const issues = [];
  const r = w.decodeMany(['_p~iF~ps|U', '_p~i!F~ps|U', '_p~iF~ps|U_'], { strict: false, onIssue: (e) => issues.push(e) });
  eq(issues.map(fields), [fields(thrown(() => web.decode('_p~i!F~ps|U'))), fields(thrown(() => web.decode('_p~iF~ps|U_')))]);
  eq(Array.from(r.starts), [0, 1, 2, 3]);
});

// /stream: the issues of the whole input, in order, with indexes in the
// whole input, wherever the chunks are cut.
const cuts = fc.array(fc.nat(), { maxLength: 5 });
const chunked = (s, at) => {
  const pos = [...new Set(at.map((n) => n % (s.length + 1)))].sort((a, b) => a - b);
  const out = [];
  let last = 0;
  for (const p of pos) out.push(s.slice(last, p)), (last = p);
  out.push(s.slice(last));
  return out;
};

test('stream: PolylineDecoder reports the same issues as decode on the whole string', () =>
  check(fc.property(input, options, cuts, fc.boolean(), (s, o, at, flat) => {
    const want = [];
    const whole = web.decode(s, { ...asObject(o), strict: false, onIssue: (e) => want.push(e) });
    const got = [], pts = [];
    const d = new S.PolylineDecoder({ ...asObject(o), flat, strict: false, onIssue: (e) => got.push(e) });
    for (const c of chunked(s, at)) pts.push(...d.write(c));
    pts.push(...d.end());
    eq(got.map(fields), want.map(fields), JSON.stringify([s, o, at]));
    ok(got.every((e) => e instanceof S.PolylineError));
    if (!flat) eq(pts, whole);
    // Strict mode: the first issue is what it throws, and onIssue is not called.
    let called = 0;
    const sd = new S.PolylineDecoder({ ...asObject(o), onIssue: () => called++ });
    const err = thrown(() => {
      for (const c of chunked(s, at)) sd.write(c);
      sd.end();
    });
    eq(err && fields(err), want[0] ? fields(want[0]) : null);
    eq(called, 0);
    return true;
  })));

test('stream: lines get the line number on each issue', async () => {
  const issues = [];
  const out = [];
  for await (const r of S.decodeLines(['_p~iF~ps|U\n_p~iF !~ps|U\n\n_p~iF~ps|U_'], { strict: false, onIssue: (e) => issues.push(e) })) out.push(r);
  eq(issues.map((e) => [e.code, e.index, e.line]), [['char', 5, 2], ['char', 6, 2], ['truncated', 11, 4]]);
  eq(out, [[[38.5, -120.2]], [[38.5, -120.2]], [[38.5, -120.2]]]);
});

// /flexible: decode takes strict: false and onIssue too. The header is
// always strict, since nothing can be read without it.
const flexValid = fc.tuple(fc.array(fc.tuple(fc.double({ min: -90, max: 90, noNaN: true }), coord, coord), { maxLength: 40 }), fc.integer({ min: 0, max: 15 }), fc.constantFrom(0, 3)).map(([l, p, t]) =>
  F.encode(l, { precision: Math.min(p, 9), thirdDim: t, thirdDimPrecision: 2 }),
);
const flexJunk = fc.constantFrom(' ', '!', '.', 'ő', '+', 'gggggggggggggggA', '-------------------');
const flexBroken = fc.tuple(flexValid, fc.array(fc.tuple(fc.nat(), flexJunk), { maxLength: 3 }), fc.option(fc.nat())).map(([s, ins, cut]) => {
  // After the header, which takes the first 2 to 4 characters.
  const h = Math.min(4, s.length);
  for (const [at, j] of ins) {
    const k = h + (at % (s.length - h + 1));
    s = s.slice(0, k) + j + s.slice(k);
  }
  return cut == null ? s : s.slice(0, h + (cut % (s.length - h + 1)));
});

test('flexible: onIssue gets what strict mode throws', () =>
  check(fc.property(fc.oneof(flexValid, flexBroken), (s) => {
    const issues = [];
    const err = thrown(() => F.decode(s));
    let got;
    const headerErr = thrown(() => F.header(s));
    if (headerErr) {
      // A header problem throws in lenient mode too.
      eq(fields(thrown(() => F.decode(s, { strict: false, onIssue: (e) => issues.push(e) }))), fields(headerErr));
      eq(issues, []);
      return true;
    }
    got = F.decode(s, { strict: false, onIssue: (e) => issues.push(e) });
    eq(got, F.decode(s, { strict: false }));
    if (err) {
      ok(issues[0] instanceof F.PolylineError);
      eq(fields(issues[0]), fields(err), JSON.stringify(s));
    } else {
      eq(issues, []);
      eq(got, F.decode(s));
    }
    let called = 0;
    const e2 = thrown(() => F.decode(s, { onIssue: () => called++ }));
    eq(e2 && fields(e2), err && fields(err));
    eq(called, 0);
    return true;
  })));

test('flexible: lenient decoding skips bad characters and drops a cut-off point', () => {
  const s = 'BFoz5xJ67i1B1B7PzIhaxL7Y';
  const issues = [];
  eq(F.decode('BFoz5xJ6 7i1B1B7PzIhaxL7', { strict: false, onIssue: (e) => issues.push(e) }), { ...F.decode(s), polyline: F.decode(s).polyline.slice(0, 3) });
  eq(issues.map((e) => [e.code, e.index, e.message]), [['char', 8, 'Invalid character " " at 8'], ['truncated', 24, 'Polyline ends inside a value at 24']]);
  throws(() => F.decode('B', { strict: false }), 'truncated');
  throws(() => F.decode('C', { strict: false }), 'version');
});

test('integrations that decode pass onIssue through', async () => {
  const s = '_p~iF~ps|U_ul LnnqC_';
  const want = [];
  web.decode(s, { strict: false, onIssue: (e) => want.push(fields(e)) });
  const { decodePath } = await import('../src/google.js');
  const { polylineData } = await import('../src/maplibre.js');
  const { toFeature } = await import('../src/turf.js');
  const { binaryPaths } = await import('../src/deckgl.js');
  for (const [label, fn] of [['google', decodePath], ['maplibre', polylineData], ['turf', toFeature], ['deckgl', (x, o) => binaryPaths([x], o)]]) {
    const got = [];
    fn(s, { strict: false, onIssue: (e) => got.push(fields(e)) });
    eq(got, want, label);
  }
});
