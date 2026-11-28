// Byte-buffer paths through TextEncoder/TextDecoder, for runtimes without
// Node's Buffer where those are fast: Deno, Workers and, for encoding,
// browsers. Measured on Deno 2.5, workerd and Chrome 157 with the benchmark
// fixtures (docs/platforms.md):
//
// - Decode: encodeInto copies the string into a reused Uint8Array, then the
//   loop reads bytes instead of calling charCodeAt. 20 to 35% faster from 100
//   points up. Any non-ASCII character makes `written` differ from the
//   length, and those strings go to the exact slow path, so strict mode stays
//   exact. Under 64 characters the copy costs more than it saves.
// - Encode: bytes into a reused buffer, then one TextDecoder call. 30 to 60%
//   faster from 1,000 points up, but the call has a fixed cost that made
//   short lines slower than the core's string building, so it starts at 100
//   points in browsers (see min below). Both the cost and the best decoder
//   depend on the runtime, so an entry can change them (tune below; deno.js
//   does).
import { st, opts, LIMIT, slowEncode, decodeWith, flatWith, decodeLoop, flatLoop, encode as coreEncode, encodeFlat as coreEncodeFlat } from './core.js';

const te = /* @__PURE__ */ new TextEncoder();
// The decoder that makes the string, and the number of points encode starts
// using it at. These are the browser entry's: in Chrome 157 a UTF-8 decoder
// was 5 to 6% slower than 'latin1' from 10,000 points up. The switch was at
// 512 points until 0.1.10, and is at 100 now, except in Firefox. Chrome 156
// and WebKit were faster through TextDecoder from 16 points (WebKit 3
// times), but in Chrome a switch at 16 made 10,000 points 4 to 5% slower in
// a process that had encoded shorter lines first. From 100 nothing was
// slower, and 100 to 500 points took 0.39 to 0.46 of the time in Chrome and
// 0.17 to 0.19 in WebKit. Firefox 159 was 11 to 38% slower below 40 points,
// and with the switch anywhere from 16 to 100 points its real-world lines
// were 3 to 27% slower, depending on what ran before, so it keeps 512.
// That's with the string read afterwards; when nothing reads it, a string
// built with += is never flattened and looks cheaper than it is.
let td = /* @__PURE__ */ new TextDecoder('latin1'), min = /* @__PURE__ */ cutoff();
function cutoff() {
  return /Firefox\//.test(globalThis.navigator?.userAgent) ? 512 : 100;
}

/**
 * Sets the decoder and the switch point for every encode after it. The bytes
 * are always ASCII, so any ASCII-compatible decoder gives the same string.
 * Entries share this module, so a program that loads two of them gets the
 * last one's choice in both; only the speed changes.
 */
export const tune = (decoder, points) => {
  td = decoder;
  min = points;
};
// Reused up to 1 MB, like the Buffer paths.
let kept = /* @__PURE__ */ new Uint8Array(1 << 14), u8;
const scratch = (n) => (n <= kept.length ? kept : n <= 1 << 20 ? (kept = new Uint8Array(n)) : new Uint8Array(n));

// Copies str into scratch as bytes, points u8 at it, and returns the number
// of values, or -1 when the string isn't ASCII.
function load(str, len) {
  const b = (u8 = scratch(len + 8));
  if (te.encodeInto(str, b).written != len) return -1;
  // '?' padding: a truncated string stops inside the buffer, past len.
  b[len] = b[len + 1] = 63;
  let t = 0;
  for (let k = 0; k < len; k++) t += (b[k] - 95) >>> 31;
  return t;
}

// decodeLoop and flatLoop over the bytes, with an exactly sized output.
// Two functions, so a bundle that only decodes to tuples drops the other.
// The locals are declared in the same order in both, so the minifier gives
// them the same names and gzip finds the second loop in the first.
function big(str, f, sw) {
  const len = str.length, t = load(str, len);
  if (t < 0) return null;
  const out = Array(t >> 1), b = u8;
  let i = 0, n = 0, lat = 0, lng = 0, bad = 0, c, v, s;
  while (i < len) {
    c = b[i++] - 63;
    bad |= c;
    v = c & 31;
    for (s = 5; c >= 32; s += 5) {
      c = b[i++] - 63;
      bad |= c | (25 - s);
      v |= (c & 31) << s;
    }
    lat += (v >>> 1) ^ -(v & 1);
    c = b[i++] - 63;
    bad |= c;
    v = c & 31;
    for (s = 5; c >= 32; s += 5) {
      c = b[i++] - 63;
      bad |= c | (25 - s);
      v |= (c & 31) << s;
    }
    lng += (v >>> 1) ^ -(v & 1);
    out[n++] = [lat / f, lng / f];
  }
  return bad & ~63 || i != len ? null : out;
}

function bigFlat(str, f, sw) {
  const len = str.length, t = load(str, len);
  if (t < 0) return null;
  const out = new Float64Array(t & ~1), b = u8;
  let i = 0, n = 0, lat = 0, lng = 0, bad = 0, c, v, s, a = +sw;
  while (i < len) {
    c = b[i++] - 63;
    bad |= c;
    v = c & 31;
    for (s = 5; c >= 32; s += 5) {
      c = b[i++] - 63;
      bad |= c | (25 - s);
      v |= (c & 31) << s;
    }
    lat += (v >>> 1) ^ -(v & 1);
    c = b[i++] - 63;
    bad |= c;
    v = c & 31;
    for (s = 5; c >= 32; s += 5) {
      c = b[i++] - 63;
      bad |= c | (25 - s);
      v |= (c & 31) << s;
    }
    lng += (v >>> 1) ^ -(v & 1);
    out[n + a] = lat / f;
    out[n + 1 - a] = lng / f;
    n += 2;
  }
  return bad & ~63 || i != len ? null : out;
}

// Under 64 characters the copy costs more than it saves.
const pick = (str, f) => (str.length < 64 ? decodeLoop(str, f) : big(str, f));
const pickFlat = (str, f, sw) => (str.length < 64 ? flatLoop(str, f, sw) : bigFlat(str, f, sw));

// The 2D fast loop for long lines, the core's encodeLoop with bytes instead
// of strings. Returns null for slowEncode.
function bytesLoop(src, f, a, flat) {
  // In the order of encodeLoop's, for the same reason as above.
  const n = flat ? src.length >> 1 : src.length, b = scratch(n * 14 + 8);
  let i = 0, la = 0, lb = 0, x, y, p, q, z, pt, k = 0;
  try {
    for (; i < n; i++) {
      if (flat) {
        x = src[i * 2 + a];
        y = src[i * 2 + 1 - a];
      } else {
        pt = src[i];
        x = pt[a];
        y = pt[1 - a];
      }
      if (typeof x != 'number' || typeof y != 'number' || !((x *= f) < LIMIT && x > -LIMIT && (y *= f) < LIMIT && y > -LIMIT)) return null;
      // Half away from zero, the same way as core.js (see the note after LIMIT there).
      p = (x < 0 ? x - 0.49999999999999994 : x + 0.49999999999999994) | 0;
      q = (y < 0 ? y - 0.49999999999999994 : y + 0.49999999999999994) | 0;
      z = p - la;
      z = (z << 1) ^ (z >> 31);
      for (; z >= 32; z >>>= 5) b[k++] = (z & 31) + 95;
      b[k++] = z + 63;
      z = q - lb;
      z = (z << 1) ^ (z >> 31);
      for (; z >= 32; z >>>= 5) b[k++] = (z & 31) + 95;
      b[k++] = z + 63;
      la = p;
      lb = q;
    }
  } catch {
    return null;
  }
  return td.decode(b.subarray(0, k));
}

// Short lines: the core's string building is faster than a TextDecoder call.
// The long ones get their own copy of the core's wrapper: with one wrapper
// calling both loops, its call site saw two functions.
const bytes = (src, o, flat, core) => {
  if (!(src?.length >= (flat ? 2 * min : min))) return core(src, o);
  const f = opts(o);
  return (st.dims == 2 && f <= 1e6 && (flat ? !(src.length % 2) : Array.isArray(src)) ? bytesLoop(src, f, +st.swap, flat) : null) ?? slowEncode(src, f, flat);
};

export const decode = (str, o) => decodeWith(str, o, pick);
export const decodeFlat = (str, o) => flatWith(str, o, pickFlat);
export const encode = (src, o) => bytes(src, o, 0, coreEncode);
export const encodeFlat = (src, o) => bytes(src, o, 1, coreEncodeFlat);
