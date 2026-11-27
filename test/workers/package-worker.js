// The "package" Worker of scripts/test-workers.js: imports only what the
// published package exports, the way a Worker project would, and runs
// without nodejs_compat. It answers one request with what passed.
import * as polytini from '@duoquote/polytini';
import { osrm6, graphhopper3d } from '@duoquote/polytini/presets';
import * as flexible from '@duoquote/polytini/flexible';
import * as stream from '@duoquote/polytini/stream';
import { toFeature, fromGeoJSON } from '@duoquote/polytini/turf';
import { polylineData, addPolylineLayer } from '@duoquote/polytini/maplibre';
import { decodePath, encodePath } from '@duoquote/polytini/google';
import { binaryPaths } from '@duoquote/polytini/deckgl';
import * as wasm from '@duoquote/polytini/wasm';
import wasmModule from '@duoquote/polytini/polytini.wasm';

// Google's example from the format documentation.
const GOOGLE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const POINTS = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
// HERE's example from the flexible polyline README.
const HERE = 'BFoz5xJ67i1B1B7PzIhaxL7Y';
const HERE_POINTS = [[50.10228, 8.69821], [50.10201, 8.69567], [50.10063, 8.6915], [50.09878, 8.68752]];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const close = (a, b) => a.length === b.length && a.every((p, i) => p.every((v, j) => Math.abs(v - b[i][j]) < 1e-9));
function code(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}
async function codeAsync(fn) {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return null;
}

async function run() {
  const checks = [];
  const notes = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });

  check('default: encode', polytini.encode(POINTS) === GOOGLE);
  check('default: decode', close(polytini.decode(GOOGLE), POINTS));
  check('default: long line round trip', (() => {
    const pts = Array.from({ length: 5000 }, (_, i) => [((i * 37) % 1800) / 10 - 90, ((i * 91) % 3600) / 10 - 180]);
    return close(polytini.decode(polytini.encode(pts)), pts);
  })());
  check('default: encodeFlat/decodeFlat', polytini.encodeFlat(POINTS.flat()) === GOOGLE && close([...polytini.decodeFlat(GOOGLE)].reduce((a, v, i) => (i % 2 ? a[a.length - 1].push(v) : a.push([v]), a), []), POINTS));
  check('default: toGeoJSON/fromGeoJSON', polytini.fromGeoJSON(polytini.toGeoJSON(GOOGLE)) === GOOGLE);
  const trunc = code(() => polytini.decode(GOOGLE.slice(0, -1)));
  check('default: strict truncated', trunc instanceof polytini.PolylineError && trunc.code === 'truncated', trunc?.message);
  const bad = code(() => polytini.decode('_p~iF ~ps|U'));
  check('default: strict bad character', bad instanceof polytini.PolylineError && bad.code === 'char' && bad.index === 5, bad?.message);
  check('default: strict false', close(polytini.decode('_p~iF ~ps|U', { strict: false }), [[38.5, -120.2]]));
  const nan = code(() => polytini.encode([[NaN, 1]]));
  check('default: strict coordinate', nan?.code === 'coordinate', nan?.message);

  check('presets: osrm6', polytini.decode(polytini.encode([[-120.2, 38.5]], osrm6), osrm6)[0].join() === '-120.2,38.5');
  check('presets: graphhopper3d', close(polytini.decode(polytini.encode([[38.5, -120.2, 1234.5]], graphhopper3d), graphhopper3d), [[38.5, -120.2, 1234.5]]));

  check('flexible: decode', close(flexible.decode(HERE).polyline, HERE_POINTS));
  check('flexible: encode', flexible.encode({ polyline: HERE_POINTS }) === HERE);
  check('flexible: header', flexible.header(HERE).precision === 5);

  // A fetch body in small pieces, the way a Worker gets one from upstream.
  const body = (text, size) => new ReadableStream({ start(c) { const b = new TextEncoder().encode(text); for (let i = 0; i < b.length; i += size) c.enqueue(b.subarray(i, i + size)); c.close(); } });
  const batches = [];
  for await (const b of body(GOOGLE, 3).pipeThrough(new stream.DecodeStream())) batches.push(...b);
  check('stream: DecodeStream on a body', close(batches, POINTS));
  const pieces = [];
  for await (const s of body(GOOGLE, 5).pipeThrough(new stream.DecodeStream()).pipeThrough(new stream.EncodeStream())) pieces.push(s);
  check('stream: DecodeStream into EncodeStream', pieces.join('') === GOOGLE);
  const cut = await codeAsync(async () => { for await (const b of body(GOOGLE.slice(0, -1), 4).pipeThrough(new stream.DecodeStream())); });
  check('stream: truncated body', cut instanceof stream.PolylineError && cut.code === 'truncated' && cut.index === GOOGLE.length - 1, cut?.message);
  const lines = [];
  for await (const x of body(`{"id":1,"g":"${GOOGLE}"}\n\n{"id":2,"g":"_p~iF~ps|U"}\n`, 7).pipeThrough(new stream.DecodeLinesStream({ field: 'g' }))) lines.push(x);
  check('stream: DecodeLinesStream NDJSON', lines.length === 2 && close(lines[0].g, POINTS) && lines[1].id === 2);
  let n = 0;
  for await (const p of stream.decodeIterable(body(GOOGLE, 2))) n += p.length;
  check('stream: decodeIterable', n === 6);
  check('stream: one PolylineError class', stream.PolylineError === polytini.PolylineError);

  const f = toFeature(GOOGLE, { properties: { a: 1 } });
  check('turf: toFeature', f.geometry.coordinates[0].join() === '-120.2,38.5' && f.properties.a === 1);
  check('turf: fromGeoJSON', same(fromGeoJSON(f), [GOOGLE]));

  const calls = [];
  const map = { addSource: (id, s) => calls.push(['source', id, s.type]), addLayer: (l, b) => calls.push(['layer', l.id, l.type, b]), getSource: () => undefined };
  addPolylineLayer(map, 'route', GOOGLE, { beforeId: 'labels' });
  check('maplibre: polylineData', polylineData([GOOGLE, GOOGLE]).features.length === 2);
  check('maplibre: addPolylineLayer', same(calls, [['source', 'route', 'geojson'], ['layer', 'route', 'line', 'labels']]));

  const lits = decodePath(GOOGLE, { LatLng: false });
  check('google: decodePath', lits[0].lat === 38.5 && lits[0].lng === -120.2);
  check('google: encodePath', encodePath(lits) === GOOGLE);

  const bin = binaryPaths([GOOGLE, GOOGLE]);
  check('deckgl: binaryPaths', bin.length === 2 && bin.startIndices.join() === '0,3,6' && bin.attributes.getPath.value[0] === -120.2);

  // WebAssembly: compiling bytes at runtime is blocked in Workers; a
  // compiled module (the imported .wasm file) is not.
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const raw = await codeAsync(() => WebAssembly.compile(bytes));
  notes.push(`WebAssembly.compile(bytes) in workerd: ${raw ? `${raw.name}: ${raw.message}` : 'allowed'}`);
  check('wasm: imported file is a WebAssembly.Module', wasmModule instanceof WebAssembly.Module);
  const noModule = await codeAsync(() => wasm.init());
  check('wasm: init() without the module throws PolylineError init', noModule instanceof wasm.PolylineError && noModule.code === 'init' && noModule.message.includes('polytini.wasm'), noModule?.message);
  if (noModule) notes.push(`init() without the module: ${noModule.message}`);
  const noModuleSync = code(() => wasm.initSync());
  check('wasm: initSync() without the module throws PolylineError init', noModuleSync?.code === 'init', noModuleSync?.message);
  // decode itself runs in JS; the batch functions need the instance.
  const before = code(() => wasm.decodeMany([GOOGLE]));
  check('wasm: not ready after a failed init', before?.code === 'init', before?.message);
  await wasm.init(wasmModule);
  check('wasm: decode after init(module)', close(wasm.decode(GOOGLE), POINTS));
  check('wasm: encode', wasm.encode(POINTS) === GOOGLE);
  const many = wasm.decodeMany([GOOGLE, GOOGLE]);
  check('wasm: decodeMany', many.starts.join() === '0,3,6' && many.coords[0] === 38.5);
  check('wasm: encodeMany', same(wasm.encodeMany([POINTS, POINTS]), [GOOGLE, GOOGLE]));
  const long = Array.from({ length: 20000 }, (_, i) => [((i * 37) % 1800) / 10 - 90, ((i * 91) % 3600) / 10 - 180]);
  check('wasm: long line, memory grows', wasm.encode(long) === polytini.encode(long) && close(wasm.decode(polytini.encode(long)), long));
  await wasm.init(wasmModule);
  check('wasm: init again is free', wasm.encode(POINTS) === GOOGLE);

  notes.push(`navigator.userAgent: ${globalThis.navigator?.userAgent}`);
  const failures = checks.filter((c) => !c.ok).map((c) => c.name + (c.detail ? ': ' + c.detail : ''));
  return { passed: checks.length - failures.length, failed: failures.length, failures, notes };
}

export default {
  async fetch() {
    try {
      return Response.json(await run());
    } catch (e) {
      return Response.json({ passed: 0, failed: 1, failures: ['threw: ' + (e?.stack ?? e)], notes: [] });
    }
  },
};
