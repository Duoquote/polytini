// decode, decodeFlat, encode and encodeFlat through the /stream classes, for
// bench/ab.js, so streaming can be compared with one call on the whole input:
//
//   node bench/ab.js --a src/web.js --b bench/stream.js --cases decode:1000000,decodeFlat:1000000
//   STREAM_CHUNKS=bytes node bench/ab.js --a src/web.js --b bench/stream.js --cases decode:1000000
//
// The input is cut once, outside the timed part, into chunks of
// STREAM_SIZE (default 65536) characters, each its own flat string like a
// network read gives, or with STREAM_CHUNKS=bytes into Uint8Arrays. Encoding
// writes STREAM_SIZE / 16 points at a time.
//
// A consumer would use each batch as it comes. ab.js wants one output, so
// decode returns a view over the batches (the length, the last point, and
// iteration for ab.js's check) instead of copying them into one array, and
// encode reads each string piece once, which flattens it the way writing it
// to a file or socket would, before joining them. Compare encode with
// --consume full, so A's string gets flattened too.
import { PolylineDecoder, PolylineEncoder } from '../src/stream.js';

const env = globalThis.Deno ? Deno.env.toObject() : process.env;
const bytes = env.STREAM_CHUNKS == 'bytes', size = Number(env.STREAM_SIZE ?? 65536);
const utf8 = new TextEncoder(), text = new TextDecoder();
const cache = new Map();

function chunks(s) {
  let c = cache.get(s);
  if (!c) {
    c = [];
    for (let i = 0; i < s.length; i += size) {
      const b = utf8.encode(s.slice(i, i + size));
      c.push(bytes ? b : text.decode(b));
    }
    cache.set(s, c);
  }
  return c;
}

// The batches as one list, without copying them.
class Batches {
  constructor(parts, n) {
    this.parts = parts;
    this.length = n;
    if (n) this[n - 1] = parts.findLast((p) => p.length).at(-1);
  }
  *[Symbol.iterator]() {
    for (const p of this.parts) yield* p;
  }
}

export function decode(s, o) {
  const d = new PolylineDecoder(o), parts = [];
  let n = 0;
  for (const c of chunks(s)) {
    const r = d.write(c);
    parts.push(r);
    n += r.length;
  }
  d.end();
  return new Batches(parts, n);
}

export function decodeFlat(s, o) {
  const d = new PolylineDecoder({ ...(typeof o == 'number' ? { precision: o } : o), flat: true }), parts = [];
  let n = 0;
  for (const c of chunks(s)) {
    const r = d.write(c);
    parts.push(r);
    n += r.length;
  }
  d.end();
  return new Batches(parts, n);
}

const encodeWith = (src, o, flat) => {
  const e = new PolylineEncoder(flat ? { ...(typeof o == 'number' ? { precision: o } : o), flat: true } : o), step = (size >> 4) * (flat ? 2 : 1);
  let s = '';
  for (let i = 0; i < src.length; i += step) {
    const piece = e.write(flat ? src.subarray(i, i + step) : src.slice(i, i + step));
    if (piece.charCodeAt(piece.length - 1) < 0) break;
    s += piece;
  }
  return s + e.end();
};
export const encode = (points, o) => encodeWith(points, o, 0);
export const encodeFlat = (values, o) => encodeWith(values, o, 1);
