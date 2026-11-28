// Opt-in WebAssembly build. Call `await init()` once (or `initSync()`), then
// the functions are synchronous and take the same arguments as the main
// entry, plus two batch functions for many lines in one call.
//
// Two modules, both under 1 KB, do the parsing and formatting:
// - wasm/polytini.wat, everywhere. The glue keeps one instance and one
//   memory for the whole program, grows it when an input doesn't fit, and
//   moves strings through that memory with TextEncoder.encodeInto and
//   latin1Slice (or TextDecoder).
// - wasm/polytini-strings.wat, the same loops on JS String Builtins
//   (wasm:js-string): strings go in and out as JS strings, with no copy
//   through linear memory. Used on V8 where it compiles (Chrome 130+, Node
//   22.19+ and 24+, Deno), for the calls where it measured faster (see
//   `builtins` below).
// Anything the modules don't handle (objects, other dimensions, bad input)
// goes to the JS core, so results and errors are the same as the main
// entry's.
/* @ts-self-types="../types/wasm.d.ts" */
import bytes, { strings } from './wasm-bytes.js';
import { opts, st, slowDecode, slowEncode, fail, latLngs, toGeo, fromGeo, decode as jsDecode, decodeFlat as jsFlat, encode as jsEncode, encodeFlat as jsEncodeFlat } from './core.js';

export { PolylineError } from './core.js';

// The module keeps nothing in its memory, so the glue uses all of it.
const base = 0;
let ex, mem, u8, f64, u32, input, size = 0;
// The string-builtins instance, its memory and a view of it, or undefined.
let sx, smem, sf64, ssize = 0;
// Node's and Bun's latin1Slice, looked up without writing the class's name:
// esm.sh adds an 8.8 KB gzipped polyfill of it to any module that mentions
// it, and ArrayBuffer.name.slice(5) is the same string. Deno has the global
// too, but its latin1Slice is a JS polyfill that made encoding 2 times
// slower there than TextDecoder.
const g = globalThis;
const latin1Slice = !g.Deno && g.process?.versions?.node && g[ArrayBuffer.name.slice(5)]?.prototype.latin1Slice;
// In Deno a UTF-8 TextDecoder is faster than a latin1 one for these ASCII
// bytes (encode 7 to 31% faster in paired runs); elsewhere latin1 is.
const te = new TextEncoder(), td = new TextDecoder(g.Deno ? 'utf-8' : 'latin1');

// The inlined hex to bytes, once per init. Hex and not base64 because two
// characters per byte keep the same bytes as the same text, so gzip finds
// what the two modules share: both together gzip to about 1,020 bytes in
// hex and 1,320 in base64. Uint8Array.fromHex where the runtime has it
// (where fromBase64 is too), a plain loop where it doesn't (Node 24). For a
// character code c of 0-9 or a-f, (c & 15) + (c >> 6) * 9 is its value.
const hex = (c) => (c & 15) + (c >> 6) * 9;
const bin = (h) => {
  if (Uint8Array.fromHex) return Uint8Array.fromHex(h);
  const u = new Uint8Array(h.length / 2);
  for (let i = 0; i < u.length; i++) u[i] = (hex(h.charCodeAt(2 * i)) << 4) | hex(h.charCodeAt(2 * i + 1));
  return u;
};
const ready = (instance) => {
  ex = instance.exports;
  mem = ex.memory;
  views();
  // Set here and not at load, so short lines still encode before init on
  // Bun too, like everywhere else.
  if (g.Bun) enc = 0;
};
const views = () => {
  u8 = new Uint8Array(mem.buffer);
  f64 = new Float64Array(mem.buffer);
  u32 = new Uint32Array(mem.buffer);
  size = u8.length;
  // encodeInto writes at the start of its target, so keep one view at base.
  input = u8.subarray(base);
};

// String builtins only on V8, the engine they were measured on: Bun
// (JavaScriptCore) has them too, but decoding was 4 to 7% slower there and
// short lines up to 20%. Firefox and Safari haven't been measured, so they
// keep the other module.
const v8 = !g.Bun && !!(g.process?.versions?.v8 || g.Deno || /Chrome\//.test(g.navigator?.userAgent));
// Compiling with { builtins: ['js-string'] } gives a module with no imports
// where the engine has them. Where it doesn't, the option is ignored and the
// wasm:js-string imports are missing, so instantiating throws (Node 22.12 to
// 22.18 without a flag, older browsers, workerd), and every call takes the
// other module.
function builtins() {
  if (!v8) return;
  try {
    // Bun 1.4 throws without an imports object, even for a module with no
    // imports.
    sx = new WebAssembly.Instance(new WebAssembly.Module(bin(strings), { builtins: ['js-string'] }), {}).exports;
  } catch {
    return;
  }
  smem = sx.memory;
  sviews();
}
const sviews = () => {
  sf64 = new Float64Array(smem.buffer);
  ssize = sf64.byteLength;
};
function sroom(n) {
  if (n > ssize) {
    smem.grow(Math.ceil((n - ssize) / 65536));
    sviews();
  }
}

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
    r = await WebAssembly.instantiate(module || bin(bytes));
  } catch (e) {
    blocked(e, module);
  }
  // A Module gives an Instance, bytes give { module, instance }.
  ready(compiled(module) ? r : r.instance);
  // A module from the caller means the runtime can't compile the inlined
  // bytes, so don't try the other ones.
  if (!module) builtins();
}

/** Synchronous init. Browsers allow it here because the module is small. */
export function initSync(module) {
  if (ex) return;
  let m;
  try {
    m = compiled(module) ? module : new WebAssembly.Module(module || bin(bytes));
  } catch (e) {
    blocked(e, module);
  }
  ready(new WebAssembly.Instance(m));
  if (!module) builtins();
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
// moving the data in and out cost more than the work. About 30 points. With
// string builtins decodeFlat has no cutoff: it was faster than the JS core
// from 10 points up on Node and in Chrome and Deno.
const SHORT = 128;
// Encode's cutoff, in characters like SHORT (4 per point). On Bun the core's
// string building was 3.5 to 4.8 times slower than the module for 2 to 20
// points, so after init (see ready) encode has no cutoff there.
let enc = SHORT;
// With string builtins, lines under this many points encode through them,
// and encodeMany takes them when its lines average fewer. Longer lines go
// through bytes and one latin1Slice or TextDecoder call, which made the
// string faster than fromCharCodeArray from about 64 points on Node 24 and
// 26 (1.02 to 1.07 slower at 128 to 512 points with the builtins) and from
// about 256 in Chrome and Deno (Chrome 1.04 to 1.07 slower at 512). On Node
// 22 (V8 12) the builtins were 10 to 26% faster at every length tried (10
// to 512 points, the real-world lines, batches of 20- and 500-point lines),
// so there's no cutoff.
const pv = g.process?.versions, node = !g.Deno && !!pv?.node, v12 = !!pv?.v8?.startsWith('12.');
const SB_ENCODE = g.Deno ? 256 : v12 ? Infinity : node ? 64 : 256, SB_MANY = SB_ENCODE;
// decodeMany through the builtins, one call per line, was 4 to 8% slower
// than the other module's one call on the joined lines on Node 24 and 26,
// and 13% faster in Chrome. Even on Node 22 and in Deno. On Node 24 and 26
// that only held for long lines: for batches of lines under MANY_SHORT
// characters on average, one call per line was 4 to 8% faster there too.
const SB_DECODE_MANY = !node || v12, MANY_SHORT = 300;

export function decodeFlat(str, o) {
  if (sx && typeof str == 'string') {
    const f = opts(o);
    if (st.dims != 2) return slowDecode(str, f, 1);
    sroom(str.length * 8 + 16);
    const k = sx.decode(str, 0, f, +st.swap);
    return k < 0 ? slowDecode(str, f, 1) : sf64.slice(0, k);
  }
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
  if (sx && points?.length < SB_ENCODE) return sbEncode(points, o);
  if (points?.length < enc / 4) return jsEncode(points, o);
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
  if (sx && values?.length < SB_ENCODE * 2) return sbEncodeFlat(values, o);
  if (values?.length < enc / 2) return jsEncodeFlat(values, o);
  const f = opts(o);
  if (st.dims != 2 || values == null || values.length % 2) return slowEncode(values, f, 1);
  const n = values.length, at = base >> 3;
  room(n * 8 + n * 7 + 16);
  if (!(values instanceof Float64Array || values instanceof Float32Array)) {
    // On Bun a plain array is checked and copied in one loop: Float64Array.set
    // from a plain array was 3.4 times slower than that on JavaScriptCore. On
    // Node 24 the loop was 12 to 20% slower than set, so V8 keeps set.
    if (g.Bun) {
      for (let i = 0, x, sw = +st.swap; i < n; i++) {
        if (typeof (x = values[i ^ sw]) != 'number') return slowEncode(values, f, 1);
        f64[at + i] = x;
      }
      return finish(n, f) ?? slowEncode(values, f, 1);
    }
    for (let i = 0; i < n; i++) if (typeof values[i] != 'number') return slowEncode(values, f, 1);
  }
  if (st.swap) for (let i = 0; i < n; i += 2) (f64[at + i] = values[i + 1]), (f64[at + i + 1] = values[i]);
  else f64.set(values, at);
  return finish(n, f) ?? slowEncode(values, f, 1);
}

// encode and encodeFlat through the string builtins, in their own functions:
// with one function for both, the paths above were 2 to 3% slower than
// 0.1.4 at 100 points on Node 24 and 26, and 0 to 1% with two.
function sbEncode(points, o) {
  const f = opts(o);
  if (st.dims != 2 || !Array.isArray(points)) return slowEncode(points, f);
  const n = points.length, a = +st.swap, b = 1 - a;
  sroom(n * 16 + 16);
  const m = sf64;
  try {
    for (let i = 0, j = 0; i < n; i++, j += 2) {
      const p = points[i], x = p[a], y = p[b];
      if (typeof x != 'number' || typeof y != 'number') return slowEncode(points, f);
      m[j] = x;
      m[j + 1] = y;
    }
  } catch {
    return slowEncode(points, f);
  }
  return sx.encode(0, n * 2, f) ?? slowEncode(points, f);
}

function sbEncodeFlat(values, o) {
  const f = opts(o);
  if (st.dims != 2 || values == null || values.length % 2) return slowEncode(values, f, 1);
  const n = values.length;
  sroom(n * 8 + 16);
  if (!(values instanceof Float64Array || values instanceof Float32Array)) {
    for (let i = 0; i < n; i++) if (typeof values[i] != 'number') return slowEncode(values, f, 1);
  }
  const m = sf64;
  if (st.swap) for (let i = 0; i < n; i += 2) (m[i] = values[i + 1]), (m[i + 1] = values[i]);
  else m.set(values);
  return sx.encode(0, n, f) ?? slowEncode(values, f, 1);
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
  if (sx && (SB_DECODE_MANY || len < MANY_SHORT * count)) {
    // One call per line: 2 to 9% faster than one call on the joined lines.
    sroom(len * 8 + 16);
    const starts = new Uint32Array(count + 1), sw = +st.swap;
    let at = 0;
    for (let i = 0; i < count; i++) {
      const k = sx.decode(lines[i], at * 8, f, sw);
      if (k < 0) return many(lines, o);
      starts[i + 1] = (at += k) >> 1;
    }
    return { coords: sf64.slice(0, at), starts };
  }
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
  // dims first: an onIssue callback can decode with other options.
  const d = st.dims, parts = lines.map((s) => jsFlat(s, o)), starts = new Uint32Array(parts.length + 1);
  let n = 0;
  parts.forEach((p, i) => (starts[i + 1] = n += p.length / d));
  const coords = new Float64Array(n * d);
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
    if (sx && n < SB_MANY * count) return sbMany(lines, count, n, f, o);
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

// encodeMany through the string builtins: every point into memory, then one
// call per line, each returning its string.
function sbMany(lines, count, n, f, o) {
  sroom(n * 16 + 16);
  const a = +st.swap, b = 1 - a, m = sf64, r = Array(count);
  let j = 0;
  try {
    for (let i = 0; i < count; i++) {
      const l = lines[i], len = l.length, start = j;
      for (let q = 0; q < len; q++) {
        const p = l[q], x = p[a], y = p[b];
        if (typeof x != 'number' || typeof y != 'number') return lines.map((x) => jsEncode(x, o));
        m[j++] = x;
        m[j++] = y;
      }
      if ((r[i] = sx.encode(start * 8, len * 2, f)) == null) return lines.map((x) => jsEncode(x, o));
    }
  } catch {
    return lines.map((x) => jsEncode(x, o));
  }
  return r;
}

export const decodeLatLng = /* @__PURE__ */ latLngs(decode);
export const toGeoJSON = /* @__PURE__ */ toGeo(decode);
export const fromGeoJSON = /* @__PURE__ */ fromGeo(encode);
