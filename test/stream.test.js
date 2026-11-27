// The /stream entry. The main property: cutting the input anywhere, into any
// number of chunks, strings or bytes, gives exactly what decode and encode
// give on the whole input, on every entry point: the same numbers, the same
// string, and the same PolylineError (code, index and message). Checked on
// random lines and strings, the vectors, the PostGIS fixture and the
// real-world lines. Fixed seeds; POLYTINI_SEED and POLYTINI_RUNS explore more.
import fc from 'fast-check';
import { test, eq, ok, throws, entries, json, list } from './lib.js';
import { realWorldLines, benchFixtures } from './bench-fixtures.js';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as local from '../src/stream.js';

// In a Worker (scripts/test-workers.js) this is the packed package's
// @duoquote/polytini/stream instead of the file in src/.
const S = globalThis.__polytiniTest?.stream ?? local;
const all = await entries();
const env = globalThis.Deno ? Deno.env.toObject() : globalThis.process?.env ?? {};
const seed = Number(env.POLYTINI_SEED ?? 20261127);
const runs = Number(env.POLYTINI_RUNS ?? 200);
const check = (prop, o) => fc.assert(prop, { seed, numRuns: runs, ...o });
const utf8 = new TextEncoder();

// { value } or { error } with everything a PolylineError carries.
const attempt = (fn) => {
  try {
    return { value: fn() };
  } catch (e) {
    return { error: { name: e.name, code: e.code, index: e.index, message: e.message } };
  }
};
const plain = (x) => (ArrayBuffer.isView(x) ? Array.from(x) : x);

// Decodes chunks with PolylineDecoder. On an error, `emitted` has the
// points written before it.
function streamDecode(chunks, o) {
  const d = new S.PolylineDecoder(o), out = [];
  const put = (r) => {
    ok(o?.flat ? r instanceof Float64Array : Array.isArray(r), 'batch type');
    for (const x of r) out.push(x);
  };
  const r = attempt(() => {
    for (const c of chunks) put(d.write(c));
    put(d.end());
    return out;
  });
  r.emitted = out;
  return r;
}

const flatOf = (o) => ({ ...(typeof o == 'number' ? { precision: o } : o), flat: true });
const want = (api, s, o) => attempt(() => api.decode(s, o));
const wantFlat = (api, s, o) => attempt(() => plain(api.decodeFlat(s, o)));

// What decode and decodeFlat give on every entry. They must all agree, so
// the stream is checked against one result, computed once per input.
let last = null;
function expected(s, o) {
  const key = JSON.stringify([s, o ?? null]);
  if (last?.key === key) return last;
  const w = want(all[0].api, s, o), wf = wantFlat(all[0].api, s, o);
  for (const { name, api } of all.slice(1)) {
    const x = want(api, s, o), xf = wantFlat(api, s, o);
    eq(x.error ?? x.value, w.error ?? w.value, `decode on ${name}`);
    eq(xf.error ?? xf.value, wf.error ?? wf.value, `decodeFlat on ${name}`);
  }
  const lenient = all[0].api.decode(s, { ...(typeof o == 'number' ? { precision: o } : o), strict: false });
  return (last = { key, w: w.error ?? w.value, wf: wf.error ?? wf.value, lenient });
}

// The same result as decode, and what came out before an error is the
// start of what lenient decode gives.
function same(chunks, s, o, label) {
  const { w, wf, lenient } = expected(s, o);
  const got = streamDecode(chunks, o), gotFlat = streamDecode(chunks, flatOf(o));
  eq(got.error ?? got.value, w, label);
  eq(gotFlat.error ?? gotFlat.value, wf, `${label}, flat`);
  if (got.error) eq(got.emitted, lenient.slice(0, got.emitted.length), `${label}: points before the error`);
}

// Where to cut a string of n characters: everywhere up to 400, and in long
// ones the first and last 100 positions and 200 between, so the test stays
// linear. Random chunk sizes cover the rest.
function* cuts(n) {
  if (n <= 400) for (let i = 0; i <= n; i++) yield i;
  else {
    for (let i = 0; i <= 100; i++) yield i;
    for (let i = 1; i < 200; i++) yield 100 + Math.floor(((n - 200) * i) / 200);
    for (let i = n - 100; i <= n; i++) yield i;
  }
}

// Every way to cut s in two, as strings and as UTF-8 bytes.
function everyCut(s, o, label) {
  same([s], s, o, label);
  same(cut(s, [1, 7, 64, 3, 0, 2]), s, o, `${label}, mixed chunks`);
  for (const i of cuts(s.length)) same([s.slice(0, i), s.slice(i)], s, o, `${label}, cut at ${i}`);
  const bytes = utf8.encode(s), text = new TextDecoder().decode(bytes);
  for (const i of cuts(bytes.length)) same([bytes.subarray(0, i), bytes.subarray(i)], text, o, `${label}, bytes cut at ${i}`);
}

// Chunks of the given sizes, repeated until the input runs out. 0 makes an
// empty chunk.
function cut(s, sizes) {
  const out = [];
  for (let i = 0, k = 0; i < s.length; k++) {
    const n = sizes[k % sizes.length];
    out.push(s.slice(i, i + n));
    i += n;
    if (k > s.length * 4 + 8) {
      out.push(s.slice(i));
      break;
    }
  }
  return out;
}
const sizes = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 6 }).filter((a) => a.some((n) => n > 0));

const coord = fc.oneof(fc.double({ min: -180, max: 180, noNaN: true }), fc.integer({ min: -180, max: 180 }), fc.constantFrom(0, -0, 0.000005, -0.000015, 123456.789));
const dims = fc.constantFrom(1, 2, 2, 2, 3);
const options = fc.record({
  precision: fc.integer({ min: 0, max: 10 }),
  order: fc.constantFrom('latlng', 'lnglat'),
  dimensions: dims,
  strict: fc.boolean(),
});
const line = (d) => fc.array(fc.array(coord, { minLength: d, maxLength: d }), { maxLength: 60 });
const fits = (l, p) => l.every((pt) => pt.every((v) => Math.abs(v) * 10 ** p < 2 ** 51));
// A valid polyline for the options, made by the core's encode.
const valid = options.chain((o) => line(o.dimensions).filter((l) => fits(l, o.precision)).map((l) => ({ o, s: all[0].api.encode(l, o) })));
// Broken ones: cut, with a bad character, with a value past 2^53, with
// characters outside ASCII.
const broken = fc.tuple(valid, fc.nat(), fc.constantFrom('', ' ', '!', '\n', 'é', '😀', '\ud83d', '﻿', '~~~~~~~~~~~~~', '\u007f')).map(([{ o, s }, n, x]) => {
  const i = s.length ? n % s.length : 0;
  return { o, s: x == '' ? s.slice(0, i) : s.slice(0, i) + x + s.slice(i) };
});

test('decode: every cut of valid and broken polylines', () =>
  check(fc.property(fc.oneof(valid, broken), ({ o, s }) => {
    everyCut(s, o, JSON.stringify(o));
    return true;
  }), { numRuns: Math.max(1, runs >> 2) }));

test('decode: random chunk sizes', () =>
  check(fc.property(fc.oneof(valid, broken), sizes, ({ o, s }, z) => {
    same(cut(s, z), s, o, `sizes ${z}`);
    const bytes = utf8.encode(s), text = new TextDecoder().decode(bytes), chunks = [];
    for (let i = 0, k = 0; i < bytes.length; k++) chunks.push(bytes.subarray(i, (i += z[k % z.length] || 1)));
    same(chunks, text, o, `byte sizes ${z}`);
    return true;
  })));

test('decode: any string, cut anywhere', () =>
  check(fc.property(fc.oneof(fc.string({ maxLength: 80, unit: 'binary' }), fc.stringMatching(/^[?-~]{0,120}$/), fc.string({ maxLength: 80 })), fc.boolean(), sizes, (s, strict, z) => {
    same(cut(s, z), s, { strict }, 'any string');
    same([s.slice(0, s.length >> 1), s.slice(s.length >> 1)], s, { strict }, 'any string, halves');
    return true;
  })));

test('decode: one character at a time, and empty chunks', () => {
  const s = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
  same([...s], s, undefined, 'single characters');
  same(['', ...[...s].flatMap((c) => [c, '']), ''], s, 5, 'with empty chunks');
  same([], '', undefined, 'no chunks');
  same([''], '', { strict: false }, 'one empty chunk');
});

test('decode: the vectors, cut everywhere', async () => {
  let n = 0;
  for (const f of (await list('fixtures/vectors/')).filter((f) => f.endsWith('.json'))) {
    for (const c of (await json('fixtures/vectors/' + f)).cases) {
      if (c.op != 'decode') continue;
      if (typeof c.input != 'string') {
        // Not a string: the decoder refuses it too, with the same code.
        eq(attempt(() => new S.PolylineDecoder(c.options).write(c.input)).error?.code, want(all[0].api, c.input, c.options).error?.code, c.name);
        continue;
      }
      if (want(all[0].api, c.input, c.options).error?.code == 'option') {
        eq(attempt(() => new S.PolylineDecoder(c.options)).error, want(all[0].api, c.input, c.options).error, c.name);
        continue;
      }
      everyCut(c.input, c.options, `${f}: ${c.name}`);
      n++;
    }
  }
  ok(n > 150, `only ${n} decode vectors`);
});

test('decode: the PostGIS fixture, cut everywhere', async () => {
  const fx = await json('fixtures/postgis.json');
  let n = 0;
  for (const c of fx.decode) {
    for (const o of [{ precision: c.precision }, { precision: c.precision, order: 'lnglat' }]) {
      if (want(all[0].api, c.encoded, o).error?.code == 'option') {
        eq(attempt(() => new S.PolylineDecoder(o)).error, want(all[0].api, c.encoded, o).error, c.name);
        continue;
      }
      everyCut(c.encoded, o, `postgis ${c.name}`);
      n++;
    }
  }
  ok(n > 600, `only ${n} PostGIS decodes`);
});

test('decode: the 1000 real-world lines in random chunks', () => {
  const lines = realWorldLines();
  eq(lines.length, 1000);
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i];
    same(cut(s, [1 + (i % 7), 3, 1 + (i % 13)]), s, 5, `real-world ${i}`);
    if (i % 50 == 0) everyCut(s, 5, `real-world ${i}`);
  }
});

test('decode: 100,000 points in 64 KB chunks, strings and bytes', () => {
  const s = benchFixtures(5).find((f) => f.name == '100,000 pts').encoded[0];
  const bytes = utf8.encode(s);
  for (const size of [65536, 4096, 777]) {
    const chunks = cut(s, [size]), byteChunks = [];
    for (let i = 0; i < bytes.length; i += size) byteChunks.push(bytes.subarray(i, i + size));
    for (const o of [5, { order: 'lnglat' }]) {
      const w = all[0].api.decode(s, o), wf = plain(all[0].api.decodeFlat(s, o));
      eq(streamDecode(chunks, o).value, w, `${size}`);
      eq(streamDecode(byteChunks, o).value, w, `${size} bytes`);
      eq(streamDecode(chunks, flatOf(o)).value, wf, `${size} flat`);
    }
    // Cut off and corrupted near the end of the last chunk.
    same(cut(s.slice(0, -1), [size]), s.slice(0, -1), 5, 'truncated');
    same(cut(s.slice(0, -7) + '!' + s.slice(-6), [size]), s.slice(0, -7) + '!' + s.slice(-6), 5, 'bad character');
  }
});

test('decode: errors stick, and end() starts over', () => {
  const d = new S.PolylineDecoder();
  const e = throws(() => d.write('_p~iF!'), 'char');
  eq(e.index, 5);
  eq(throws(() => d.write('_p~iF'), 'char'), e);
  eq(throws(() => d.end(), 'char'), e);
  const r = new S.PolylineDecoder();
  eq([...r.write('_p~iF~ps|U'), ...r.end()], [[38.5, -120.2]]);
  eq([...r.write('_ulLnnqC'), ...r.end()], [[2.2, -0.75]]);
  const t = new S.PolylineDecoder();
  t.write('_p~iF~ps|U_ulL');
  eq(throws(() => t.end(), 'truncated').index, 14);
  throws(() => new S.PolylineDecoder().write(123), 'input');
  throws(() => new S.PolylineDecoder().write(null), 'input');
  throws(() => new S.PolylineDecoder({ precision: 99 }), 'option');
  throws(() => new S.PolylineDecoder({ order: 'xy' }), 'option');
  // Byte chunks accept ArrayBuffer and any view, and a split UTF-8
  // character at the very end becomes U+FFFD, which strict mode rejects.
  eq([...new S.PolylineDecoder().write(utf8.encode('_p~iF~ps|U').buffer)], [[38.5, -120.2]]);
  const b = new S.PolylineDecoder();
  b.write(utf8.encode('_p~iF~ps|U'));
  b.write(new Uint8Array([0xc3]));
  eq(throws(() => b.end(), 'char').index, 10);
  // A BOM is dropped at the start of the bytes, like res.text() does, and is
  // a character anywhere else, also at the start of a later chunk.
  eq([...new S.PolylineDecoder().write(utf8.encode('﻿_p~iF~ps|U'))], [[38.5, -120.2]]);
  const bom = new S.PolylineDecoder();
  bom.write(utf8.encode('_p~iF'));
  eq(throws(() => bom.write(utf8.encode('﻿~ps|U')), 'char').index, 5);
  const l = new S.PolylineDecoder({ strict: false });
  l.write(utf8.encode('_p~iF~ps|U'));
  l.write(new Uint8Array([0xc3]));
  eq(l.end(), []);
});

// Encoding: points written in any batches give encode's string.
const points = fc.oneof(
  fc.array(fc.tuple(coord, coord), { maxLength: 80 }),
  fc.array(fc.oneof(fc.tuple(coord, coord), fc.constantFrom([NaN, 1], [1, Infinity], [null, 2], [1e300, 1], ['38.5', '-120.2'], [3]), fc.record({ lat: coord, lng: coord })), { maxLength: 30 }),
);
const encOptions = fc.record({ precision: fc.integer({ min: 0, max: 15 }), order: fc.constantFrom('latlng', 'lnglat'), strict: fc.boolean() });

function streamEncode(writes, o) {
  const e = new S.PolylineEncoder(o);
  let s = '';
  return attempt(() => {
    for (const w of writes) s += e.write(w);
    return s + e.end();
  });
}
const batches = (pts, z) => {
  const out = [];
  for (let i = 0, k = 0; i < pts.length; k++) out.push(pts.slice(i, (i += z[k % z.length])));
  return out;
};
let lastEnc = null;
const sameEncode = (writes, pts, o, label, flat) => {
  if (lastEnc?.pts !== pts || lastEnc.o !== o || lastEnc.flat !== flat) {
    const run = (api) => attempt(() => (flat ? api.encodeFlat(pts, o) : api.encode(pts, o)));
    const w = run(all[0].api);
    for (const { name, api } of all.slice(1)) {
      const x = run(api);
      eq(x.error ?? x.value, w.error ?? w.value, `encode on ${name}`);
    }
    lastEnc = { pts, o, flat, w: w.error ?? w.value };
  }
  const got = streamEncode(writes, flat ? flatOf(o) : o);
  eq(got.error ?? got.value, lastEnc.w, label);
};

test('encode: points in random batches, one at a time, and flat values cut anywhere', () =>
  check(fc.property(points, encOptions, sizes, (pts, o, z) => {
    sameEncode(batches(pts, z), pts, o, `batches ${z}`);
    sameEncode(pts.filter((p) => p.length !== 0).map((p) => p), pts.filter((p) => p.length !== 0), o, 'one point per write');
    if (pts.every((p) => p.length == 2)) {
      const flat = pts.flat();
      for (let i = 0; i <= flat.length; i++) sameEncode([flat.slice(0, i), flat.slice(i)], flat, o, `flat cut at ${i}`, 1);
      sameEncode(batches(flat, z), flat, o, `flat sizes ${z}`, 1);
      sameEncode([Float64Array.from(flat)], Float64Array.from(flat), o, 'Float64Array', 1);
    }
    return true;
  })));

test('encode: three dimensions and one', () =>
  check(fc.property(fc.constantFrom(1, 3), fc.integer({ min: 0, max: 8 }), sizes, (d, p, z) => {
    const pts = Array.from({ length: 20 }, (_, i) => Array.from({ length: d }, (_, a) => ((i * 37 + a * 11) % 360) - 180 + i / 7));
    const o = { dimensions: d, precision: p, zFactor: 100 };
    sameEncode(batches(pts, z), pts, o, `${d}D`);
    sameEncode(batches(pts.flat(), z), pts.flat(), o, `${d}D flat`, 1);
    return true;
  })));

test('encode: the vectors and the PostGIS fixture, in every two batches', async () => {
  const cases = [];
  for (const f of (await list('fixtures/vectors/')).filter((f) => f.endsWith('.json')))
    for (const c of (await json('fixtures/vectors/' + f)).cases) if (c.op == 'encode' && Array.isArray(c.input)) cases.push([c.input, c.options, c.name]);
  const num = (x) => (typeof x == 'string' && ['NaN', 'Infinity', '-Infinity', '-0'].includes(x) ? Number(x) : x);
  const revive = (v) => (Array.isArray(v) ? v.map(revive) : v && typeof v == 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)])) : num(v));
  for (const c of (await json('fixtures/postgis.json')).encode) cases.push([c.points.map((p) => p.map(num)), c.precision, c.name]);
  ok(cases.length > 400, `only ${cases.length} encode cases`);
  for (const [input, o, name] of cases) {
    const pts = revive(input);
    if (attempt(() => all[0].api.encode(pts, o)).error?.code == 'option') {
      eq(attempt(() => new S.PolylineEncoder(o)).error?.code, 'option', name);
      continue;
    }
    for (let i = 0; i <= pts.length; i++) sameEncode([pts.slice(0, i), pts.slice(i)], pts, o, `${name}, split at ${i}`);
  }
});

test('encode: errors carry the point index across writes', () => {
  const e = new S.PolylineEncoder();
  e.write([[1, 2], [3, 4]]);
  e.write([5, 6]);
  eq(throws(() => e.write([[7, 8], [NaN, 1]]), 'coordinate').index, 4);
  throws(() => e.write([[1, 2]]), 'coordinate');
  throws(() => new S.PolylineEncoder().write(null), 'input');
  throws(() => new S.PolylineEncoder().write(5), 'input');
  throws(() => new S.PolylineEncoder({ flat: true }).write({}), 'input');
  const f = new S.PolylineEncoder({ flat: true });
  eq(f.write([38.5]), '');
  eq(f.write([-120.2, 40.7]), '_p~iF~ps|U');
  eq(throws(() => f.end(), 'input').message, 'Length not a multiple of 2');
  const lenient = new S.PolylineEncoder({ flat: true, strict: false });
  eq(lenient.write([38.5, -120.2, 40.7]) + lenient.end(), '_p~iF~ps|U');
  // end() starts a new line.
  const r = new S.PolylineEncoder();
  eq(r.write([38.5, -120.2]) + r.end(), '_p~iF~ps|U');
  eq(r.write([38.5, -120.2]) + r.end(), '_p~iF~ps|U');
  eq(r.write([]), '');
  eq(r.write({ lat: 38.5, lng: -120.2 }), '_p~iF~ps|U');
  r.end();
  throws(() => new S.PolylineEncoder({ flat: true }).write(null), 'input');
  eq(throws(() => new S.PolylineEncoder().write([[1, 2], null]), 'coordinate').index, 1);
  // Every field name encode reads from objects, in three dimensions.
  const objs = [{ lat: 1, lng: 2, alt: 3 }, { latitude: 4, lon: 5, altitude: 6 }, { lat: 7, longitude: 8, alt: 9 }];
  for (const o of [{ dimensions: 3 }, { dimensions: 3, order: 'lnglat' }]) {
    const e3 = new S.PolylineEncoder(o);
    eq(e3.write(objs[0]) + e3.write(objs.slice(1)) + e3.end(), all[0].api.encode(objs, o));
  }
});

// The stream classes and the iterables, over the same codecs.
const google = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const gpts = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
const readable = (chunks) => new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } });
const collect = async (stream) => {
  const out = [];
  for await (const x of source(stream)) out.push(x);
  return out;
};
// Iterates a ReadableStream with a reader, for runtimes without for await on streams.
async function* source(stream) {
  if (!stream.getReader) return yield* stream;
  const r = stream.getReader();
  for (let x; !(x = await r.read()).done; ) yield x.value;
}
const rejects = async (p, code) => {
  try {
    await p;
  } catch (e) {
    if (code) eq(e.code, code);
    return e;
  }
  throw new Error('expected a rejection');
};

test('DecodeStream and EncodeStream', async () => {
  ok(new S.DecodeStream() instanceof TransformStream && new S.EncodeStream() instanceof TransformStream);
  eq((await collect(readable(['_p~iF~p', 's|U_ulL', utf8.encode('nnqC_mqNvxq`@')]).pipeThrough(new S.DecodeStream()))).flat(), gpts);
  const flat = await collect(readable([google]).pipeThrough(new S.DecodeStream({ flat: true, order: 'lnglat' })));
  ok(flat[0] instanceof Float64Array);
  eq(plain(flat[0]), [-120.2, 38.5, -120.95, 40.7, -126.453, 43.252]);
  eq((await rejects(collect(readable([google.slice(0, 10), google.slice(10, -1)]).pipeThrough(new S.DecodeStream())), 'truncated')).index, 26);
  eq((await collect(readable([gpts[0], gpts.slice(1)]).pipeThrough(new S.EncodeStream()))).join(''), google);
  eq((await collect(readable([gpts.flat()]).pipeThrough(new S.EncodeStream({ flat: true })))).join(''), google);
  await rejects(collect(readable([[[NaN, 1]]]).pipeThrough(new S.EncodeStream())), 'coordinate');
  // Through fetch's Response, the way a body arrives.
  eq((await collect(new Response(google).body.pipeThrough(new S.DecodeStream()))).flat(), gpts);
  throws(() => new S.DecodeStream({ precision: -1 }), 'option');
});

test('DecodeLinesStream and EncodeLinesStream', async () => {
  const text = `${google}\r\n\n  ${google.slice(0, 10)}  \n!\n${google}`;
  const bytes = utf8.encode(text);
  for (let i = 0; i <= bytes.length; i++) {
    const got = await collect(readable([bytes.subarray(0, i), bytes.subarray(i)]).pipeThrough(new S.DecodeLinesStream({ errors: 'skip' })));
    eq(got, [gpts, gpts.slice(0, 1), gpts], `cut at ${i}`);
  }
  const skipped = [];
  await collect(readable([text]).pipeThrough(new S.DecodeLinesStream({ errors: 'skip', onError: (e, line) => skipped.push([e.code, e.index, e.line, line]) })));
  eq(skipped, [['char', 0, 4, 4]]);
  const e = await rejects(collect(readable([text]).pipeThrough(new S.DecodeLinesStream())), 'char');
  eq([e.index, e.line], [0, 4]);
  const flat = await collect(readable([text]).pipeThrough(new S.DecodeLinesStream({ errors: 'skip', flat: true })));
  ok(flat.every((x) => x instanceof Float64Array));
  // NDJSON with a polyline field, both ways.
  const nd = `{"id":1,"shape":"${google}"}\n{"id":2,"shape":"_p~iF~ps|U"}\n`;
  const objs = await collect(readable([nd]).pipeThrough(new S.DecodeLinesStream({ field: 'shape', order: 'lnglat' })));
  eq(objs, [{ id: 1, shape: gpts.map(([a, b]) => [b, a]) }, { id: 2, shape: [[-120.2, 38.5]] }]);
  eq((await collect(readable(objs).pipeThrough(new S.EncodeLinesStream({ field: 'shape', order: 'lnglat' })))).join(''), nd);
  eq(await collect(readable([gpts, gpts.slice(0, 1)]).pipeThrough(new S.EncodeLinesStream())), [google + '\n', '_p~iF~ps|U\n']);
  const bad = await rejects(collect(readable(['{"id":1}\n', '{"id":2\n']).pipeThrough(new S.DecodeLinesStream({ field: 'shape' }))), 'input');
  eq(bad.line, 1);
  const json = await rejects(collect(readable(['{"id":2\n']).pipeThrough(new S.DecodeLinesStream({ field: 'shape' }))));
  eq([json.name, json.line], ['SyntaxError', 1]);
  await rejects(collect(readable(['5\n']).pipeThrough(new S.DecodeLinesStream({ field: 'shape' }))), 'input');
  const encErrors = [];
  eq(await collect(readable([[[NaN, 1]], gpts, 7]).pipeThrough(new S.EncodeLinesStream({ errors: 'skip', onError: (e, n) => encErrors.push([e.code, n]) }))), [google + '\n']);
  eq(encErrors, [['coordinate', 1], ['input', 3]]);
  throws(() => new S.DecodeLinesStream({ errors: 'ignore' }), 'option');
  throws(() => new S.EncodeLinesStream({ precision: 16 }), 'option');
});

test('decodeIterable, encodeIterable, decodeLines and encodeLines', async () => {
  async function* gen(xs) {
    for (const x of xs) yield x;
  }
  const take = async (it) => {
    const out = [];
    for await (const x of it) out.push(x);
    return out;
  };
  eq(await take(S.decodeIterable(gen(['_p~iF~p', utf8.encode('s|U_ulLnnqC_mqNvxq`@')]))), gpts);
  eq(await take(S.decodeIterable([google])), gpts);
  eq(await take(S.decodeIterable(google, { flat: true })), gpts);
  eq(await take(S.decodeIterable(readable([google]))), gpts);
  // A stream that can only be read with a reader, like in Safari.
  const rs = readable([google.slice(0, 5), google.slice(5)]);
  eq(await take(S.decodeIterable({ getReader: () => rs.getReader() })), gpts);
  await rejects(take(S.decodeIterable([google.slice(0, -1)])), 'truncated');
  await rejects(take(S.decodeIterable(5)), 'input');
  eq((await take(S.encodeIterable(gpts))).join(''), google);
  eq((await take(S.encodeIterable(gen([gpts[0], gpts.slice(1)])))).join(''), google);
  // Long lines come out in pieces of about 64 KB.
  const long = benchFixtures(5).find((f) => f.name == '100,000 pts');
  const pieces = await take(S.encodeIterable(long.coords[0]));
  ok(pieces.length > 4 && pieces.slice(0, -1).every((p) => p.length >= 65536 && p.length < 65600), `${pieces.length} pieces`);
  eq(pieces.join(''), long.encoded[0]);
  eq(await take(S.decodeLines(gen([`${google}\n`, `\n${google}`]))), [gpts, gpts]);
  eq(await take(S.encodeLines([gpts, gpts])), [google + '\n', google + '\n']);
  eq(await take(S.encodeLines([])), []);
  // The last line without a \n, ending in \r or in a cut-off UTF-8 character.
  eq(await take(S.decodeLines([`${google}\r`])), [gpts]);
  const cut = [];
  eq(await take(S.decodeLines([utf8.encode(google + '\n_p~iF~ps|U'), new Uint8Array([0xc3])], { errors: 'skip', onError: (e, line) => cut.push([e.code, e.index, line]) })), [gpts]);
  eq(cut, [['char', 10, 2]]);
});

// A runtime without TransformStream, like React Native: a second copy of the
// module, loaded while the global is gone. The rest still works.
test('without TransformStream', async () => {
  if (globalThis.__polytiniTest) return;
  const TS = globalThis.TransformStream;
  let mod;
  try {
    delete globalThis.TransformStream;
    const url = new URL('../src/stream.js', import.meta.url).href + '?no-transform-stream';
    mod = await import(url);
  } finally {
    globalThis.TransformStream = TS;
  }
  // Bun gives back the module it already has, query string or not.
  if (mod === local) return;
  eq(throws(() => new mod.DecodeStream()).name, 'TypeError');
  eq([...mod.PolylineDecoder.prototype.write.call(new mod.PolylineDecoder(), google)], gpts);
});

// The same checks in headless Chrome, through playwright-core, on the files
// in src/: every cut of strings and bytes against decode's results from
// here, encoding in batches, and the stream classes on fetch bodies.
const chromePath = globalThis.__polytiniTest ? null : [env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
if (!chromePath && !globalThis.__polytiniTest) console.log('stream.test.js: no Chrome found (set CHROME_PATH), skipping the browser run');
if (chromePath) {
  // Runs in the page. Returns the cases that came out differently.
  const scenario = async ({ origin, decodes, encodes, long }) => {
    const S = await import(origin + '/src/stream.js');
    const utf8 = new TextEncoder(), bad = [];
    const attempt = (fn) => {
      try {
        return { value: fn() };
      } catch (e) {
        return { error: { name: e.name, code: e.code, index: e.index, message: e.message } };
      }
    };
    const dec = (chunks, o) =>
      attempt(() => {
        const d = new S.PolylineDecoder(o), out = [];
        for (const c of chunks) out.push(...d.write(c));
        out.push(...d.end());
        return out;
      });
    const same = (got, want, label) => JSON.stringify(got) == JSON.stringify(want) || bad.push(label + ': ' + JSON.stringify(got).slice(0, 200));
    for (const { s, o, want, wantFlat } of decodes) {
      const bytes = utf8.encode(s);
      for (let i = 0; i <= s.length; i++) {
        same(dec([s.slice(0, i), s.slice(i)], o), want, `${JSON.stringify(s)} cut at ${i}`);
        same(dec([s.slice(0, i), s.slice(i)], { ...o, flat: true }), wantFlat, `${JSON.stringify(s)} flat, cut at ${i}`);
      }
      if (s == new TextDecoder().decode(bytes)) for (let i = 0; i <= bytes.length; i++) same(dec([bytes.subarray(0, i), bytes.subarray(i)], o), want, `${JSON.stringify(s)} bytes cut at ${i}`);
    }
    for (const { pts, o, want } of encodes)
      for (let i = 0; i <= pts.length; i++)
        same(attempt(() => { const e = new S.PolylineEncoder(o); return e.write(pts.slice(0, i)) + e.write(pts.slice(i)) + e.end(); }), want, `encode ${JSON.stringify(pts).slice(0, 80)} split at ${i}`);
    // A long line as a fetch body, in 64 KB pieces, through each API.
    const body = () => new Response(new Blob([long.s])).body;
    const batches = [];
    for await (const b of body().pipeThrough(new S.DecodeStream())) batches.push(b.length);
    let n = 0;
    for await (const p of S.decodeIterable(body())) n += p.length == 2;
    const r = body().pipeThrough(new S.DecodeStream({ flat: true })).getReader();
    let flat = 0;
    for (let x; !(x = await r.read()).done; ) flat += x.value.length;
    const lines = [];
    for await (const x of new Response(long.s.slice(0, 1000) + '\n!\n' + long.s.slice(0, 10)).body.pipeThrough(new S.DecodeLinesStream({ errors: 'skip', strict: false }))) lines.push(x.length);
    const pieces = [];
    for await (const x of S.encodeIterable(long.pts)) pieces.push(x);
    return { bad, total: batches.reduce((a, b) => a + b, 0), n, flat, lines, encoded: pieces.join('') == long.s, isTransform: new S.DecodeStream() instanceof TransformStream };
  };

  test('in Chrome: every cut, encoding in batches, and the stream classes on fetch bodies', async () => {
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
      const api = all[0].api, real = realWorldLines();
      const strings = [google, google.slice(0, -1), google.slice(0, 9) + ' ' + google.slice(9), google + '\u00e9', '~~~~~~~~~~~~~?', '', ...real.slice(0, 40), ...fc.sample(fc.string({ maxLength: 40, unit: 'binary' }), { seed, numRuns: 40 })];
      const decodes = [];
      for (const s of strings)
        for (const o of [{}, { precision: 6, order: 'lnglat' }, { strict: false }, { dimensions: 3 }])
          decodes.push({ s, o, want: attempt(() => api.decode(s, o)), wantFlat: attempt(() => plain(api.decodeFlat(s, o))) });
      const encodes = [gpts, [...gpts, [NaN, 1]], [{ lat: 38.5, lng: -120.2 }, [1e300, 1]], real.slice(0, 5).flatMap((s) => api.decode(s))].flatMap((pts) => [{}, { precision: 7 }, { strict: false }].map((o) => ({ pts, o, want: attempt(() => api.encode(pts, o)) })));
      const f = benchFixtures(5).find((x) => x.name == '100,000 pts');
      const got = await page.evaluate(({ code, ...args }) => (0, eval)(code)(args), { code: `(${scenario})`, origin: ORIGIN, decodes, encodes, long: { s: f.encoded[0], pts: f.coords[0] } });
      eq(got.bad, [], 'differences in Chrome');
      eq(got, { bad: [], total: 100000, n: 100000, flat: 200000, lines: [api.decode(f.encoded[0].slice(0, 1000), { strict: false }).length, 0, api.decode(f.encoded[0].slice(0, 10), { strict: false }).length], encoded: true, isTransform: true });
      eq(errors, [], 'page errors');
    } finally {
      await browser.close();
    }
  });
}
