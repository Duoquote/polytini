// Opt-in WebAssembly build. Call `await init()` once (or `initSync()`), then
// the functions are synchronous and take the same arguments as the main
// entry, plus two batch functions for many lines in one call.
//
// The module (wasm/polytini.wat, under 1 KB) does the parsing and
// formatting. The glue keeps one instance and one memory for the whole
// program, grows it when an input doesn't fit, and moves data with
// TextEncoder.encodeInto and latin1Slice (or TextDecoder). Anything the module doesn't handle
// (objects, other dimensions, bad input) goes to the JS core, so results and
// errors are the same as the main entry's.
/* @ts-self-types="../types/wasm.d.ts" */
import bytes from './wasm-bytes.js';
import { opts, st, slowDecode, slowEncode, fail, latLngs, toGeo, fromGeo, decode as jsDecode, decodeFlat as jsFlat, encode as jsEncode, encodeFlat as jsEncodeFlat } from './core.js';

export { PolylineError } from './core.js';

// The module keeps nothing in its memory, so the glue uses all of it.
const base = 0;
let ex, mem, u8, f64, u32, input, size = 0;
// Node's and Bun's latin1Slice, looked up without writing the class's name:
// esm.sh adds an 8.8 KB gzipped polyfill of it to any module that mentions
// it, and ArrayBuffer.name.slice(5) is the same string. Deno has the global
// too, but its latin1Slice is a JS polyfill that made encoding 2 times
// slower there than TextDecoder.
const g = globalThis;
const latin1Slice = !g.Deno && g.process?.versions?.node && g[ArrayBuffer.name.slice(5)]?.prototype.latin1Slice;
// In Deno a UTF-8 TextDecoder is faster than a latin1 one for these ASCII
// bytes (encode 7 to 31% faster in paired runs); elsewhere latin1 is.
const te = new TextEncoder(), td = new TextDecoder(globalThis.Deno ? 'utf-8' : 'latin1');

const bin = () => Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
const ready = (instance) => {
  ex = instance.exports;
  mem = ex.memory;
  views();
};
const views = () => {
  u8 = new Uint8Array(mem.buffer);
  f64 = new Float64Array(mem.buffer);
  u32 = new Uint32Array(mem.buffer);
  size = u8.length;
  // encodeInto writes at the start of its target, so keep one view at base.
  input = u8.subarray(base);
};

// Cloudflare Workers don't compile WebAssembly from bytes at runtime; there
// the .wasm file is imported, which gives a compiled WebAssembly.Module, and
// passed in. The inlined bytes are valid, so a CompileError on them means
// the runtime refuses to compile. Errors from what the caller passed are
// theirs and pass through.
const blocked = (e, module) => {
  if (module || !(e instanceof WebAssembly.CompileError)) throw e;
  fail('init', "Can't compile WebAssembly from bytes here (" + e.message + '). Pass the compiled module: import wasm from "@duoquote/polytini/polytini.wasm"; await init(wasm)');
};
const compiled = (m) => m instanceof WebAssembly.Module;

/**
 * Instantiates the module. Safe to call more than once. Pass a compiled
 * WebAssembly.Module (or the .wasm bytes) where the runtime can't compile
 * the inlined bytes itself, like Cloudflare Workers.
 */
export async function init(module) {
  if (ex) return;
  let r;
  try {
    r = await WebAssembly.instantiate(module || bin());
  } catch (e) {
    blocked(e, module);
  }
  // A Module gives an Instance, bytes give { module, instance }.
  ready(compiled(module) ? r : r.instance);
}

/** Synchronous init. Browsers allow it here because the module is small. */
export function initSync(module) {
  if (ex) return;
  try {
    module = compiled(module) ? module : new WebAssembly.Module(module || bin());
  } catch (e) {
    blocked(e, module);
  }
  ready(new WebAssembly.Instance(module));
}

// Makes sure `n` bytes past base exist. The memory only grows, so a big
// line costs its memory once, not on every call.
function room(n) {
  if (!ex) fail('init', 'Call init() before using polytini/wasm');
  const need = base + n - size;
  if (need > 0) {
    mem.grow(Math.ceil(need / 65536));
    views();
  }
}

const align = (n) => (n + 15) & ~7;
const text = (a, b) => (latin1Slice ? latin1Slice.call(u8, a, b) : td.decode(u8.subarray(a, b)));

// Copies an ASCII string to base. False when it isn't ASCII, which the JS
// core then reports.
const put = (str, len) => te.encodeInto(str, input).written == len;

// Decodes str to f64 pairs in memory. Returns [offset in f64s, count], or
// null when the JS core has to handle it.
function run(str, f) {
  const len = str.length, out = base + align(len);
  room(align(len) + len * 8 + 16);
  if (!put(str, len)) return null;
  const k = ex.decode(base, len, out, f, +st.swap);
  return k < 0 ? null : [out >> 3, k];
}

// Lines this short are faster in JS on every runtime measured: the call and
// moving the data in and out cost more than the work. About 30 points.
const SHORT = 128;

export function decodeFlat(str, o) {
  if (typeof str == 'string' && str.length < SHORT) return jsFlat(str, o);
  const f = opts(o);
  if (typeof str != 'string') fail('input', 'Expected a string');
  const r = st.dims == 2 && run(str, f);
  return r ? f64.slice(r[0], r[0] + r[1]) : slowDecode(str, f, 1);
}

// [lat, lng] tuples come from the JS decoder. Building one array per point
// is most of the work, and reading the numbers back out of WASM memory only
// added to it: the WASM version was 15 to 40% slower at every size.
export const decode = (str, o) => jsDecode(str, o);

// f64 values at base to a string.
function finish(values, f) {
  const out = base + values * 8;
  const k = ex.encode(base, values, f, out);
  return k < 0 ? null : text(out, out + k);
}

export function encode(points, o) {
  if (points?.length < SHORT / 4) return jsEncode(points, o);
  const f = opts(o);
  if (st.dims != 2 || !Array.isArray(points)) return slowEncode(points, f);
  const n = points.length, a = +st.swap, b = 1 - a;
  room(n * 16 + n * 14 + 16);
  const m = f64;
  try {
    for (let i = 0, j = 0; i < n; i++, j += 2) {
      const p = points[i], x = p[a], y = p[b];
      // A Float64Array store would turn null into 0 and '1' into 1.
      if (typeof x != 'number' || typeof y != 'number') return slowEncode(points, f);
      m[j] = x;
      m[j + 1] = y;
    }
  } catch {
    // A null or missing point.
    return slowEncode(points, f);
  }
  return finish(n * 2, f) ?? slowEncode(points, f);
}

export function encodeFlat(values, o) {
  if (values?.length < SHORT / 2) return jsEncodeFlat(values, o);
  const f = opts(o);
  if (st.dims != 2 || values == null || values.length % 2) return slowEncode(values, f, 1);
  const n = values.length;
  room(n * 8 + n * 7 + 16);
  if (!(values instanceof Float64Array || values instanceof Float32Array)) {
    for (let i = 0; i < n; i++) if (typeof values[i] != 'number') return slowEncode(values, f, 1);
  }
  const at = base >> 3;
  if (st.swap) for (let i = 0; i < n; i += 2) (f64[at + i] = values[i + 1]), (f64[at + i + 1] = values[i]);
  else f64.set(values, at);
  return finish(n, f) ?? slowEncode(values, f, 1);
}

/**
 * Decodes many lines in one call into one Float64Array of lat/lng pairs,
 * plus `starts`: the first point of each line, and the total point count
 * at the end, as deck.gl's binary paths expect.
 */
export function decodeMany(lines, o) {
  const f = opts(o);
  if (!Array.isArray(lines)) fail('input', 'Expected an array of strings');
  const count = lines.length;
  let len = 0;
  for (let i = 0; i < count; i++) {
    if (typeof lines[i] != 'string') return many(lines, o);
    len += lines[i].length;
  }
  if (st.dims != 2) return many(lines, o);
  const lens = base + align(len), out = lens + align(count * 4), starts = out + len * 8 + 8;
  room(starts - base + count * 4 + 16);
  if (!put(lines.join(''), len)) return many(lines, o);
  const L = u32, l0 = lens >> 2;
  for (let i = 0; i < count; i++) L[l0 + i] = lines[i].length;
  const k = ex.decode_many(base, lens, count, out, starts, f, +st.swap);
  if (k < 0) return many(lines, o);
  return { coords: f64.slice(out >> 3, (out >> 3) + k), starts: u32.slice(starts >> 2, (starts >> 2) + count + 1) };
}

// The JS path for decodeMany, for bad lines (strict mode throws on the
// first one) and anything the module doesn't take.
function many(lines, o) {
  const parts = lines.map((s) => jsFlat(s, o)), starts = new Uint32Array(parts.length + 1);
  let n = 0;
  parts.forEach((p, i) => (starts[i + 1] = n += p.length / st.dims));
  const coords = new Float64Array(n * st.dims);
  let at = 0;
  for (const p of parts) coords.set(p, (at += p.length) - p.length);
  return { coords, starts };
}

/**
 * Encodes many lines in one call. Takes an array of point arrays, or the
 * { coords, starts } shape decodeMany returns. Returns one string per line.
 */
export function encodeMany(lines, o) {
  const f = opts(o);
  if (st.dims != 2) return toLines(lines).map((l) => slowEncode(l, f, ArrayBuffer.isView(l) ? 1 : 0));
  let coords, starts, count;
  if (Array.isArray(lines)) {
    count = lines.length;
    let n = 0;
    for (const l of lines) {
      if (!Array.isArray(l)) return lines.map((x) => jsEncode(x, o));
      n += l.length;
    }
    room(n * 16 + count * 8 + n * 14 + 64);
    const a = +st.swap, b = 1 - a, m = f64, S = u32, s0 = (base + n * 16) >> 2;
    let j = base >> 3, k = 0;
    S[s0] = 0;
    try {
      for (let i = 0; i < count; i++) {
        const l = lines[i], len = l.length;
        for (let q = 0; q < len; q++) {
          const p = l[q], x = p[a], y = p[b];
          if (typeof x != 'number' || typeof y != 'number') return lines.map((x) => jsEncode(x, o));
          m[j++] = x;
          m[j++] = y;
        }
        S[s0 + i + 1] = k += len;
      }
    } catch {
      return lines.map((x) => jsEncode(x, o));
    }
    return manyOut(base + n * 16, count, n, f) ?? lines.map((x) => jsEncode(x, o));
  }
  ({ coords, starts } = lines ?? {});
  if (!coords || !starts) fail('input', 'Expected an array of lines or { coords, starts }');
  count = starts.length - 1;
  const n = coords.length >> 1;
  room(n * 16 + count * 8 + n * 14 + 64);
  const at = base >> 3;
  if (st.swap) for (let i = 0; i < n * 2; i += 2) (f64[at + i] = coords[i + 1]), (f64[at + i + 1] = coords[i]);
  else f64.set(coords, at);
  u32.set(starts, (base + n * 16) >> 2);
  return manyOut(base + n * 16, count, n, f) ?? toLines(lines).map((l) => jsEncodeFlat(l, o));
}
const toLines = (l) => (Array.isArray(l) ? l : Array.from({ length: l.starts.length - 1 }, (_, i) => l.coords.subarray(l.starts[i] * 2, l.starts[i + 1] * 2)));

function manyOut(startsAt, count, n, f) {
  const ends = startsAt + align((count + 1) * 4), out = ends + align(count * 4);
  const k = ex.encode_many(base, startsAt, count, f, out, ends);
  if (k < 0) return null;
  const r = Array(count), e = u32, e0 = ends >> 2;
  for (let i = 0, a = out; i < count; i++) r[i] = text(a, (a = out + e[e0 + i]));
  return r;
}

export const decodeLatLng = /* @__PURE__ */ latLngs(decode);
export const toGeoJSON = /* @__PURE__ */ toGeo(decode);
export const fromGeoJSON = /* @__PURE__ */ fromGeo(encode);
