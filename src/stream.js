// Streaming encode and decode: one long polyline that arrives in chunks
// (a fetch body, a file), points that arrive a few at a time, and many
// polylines, one per line. Its own entry, so the other entries don't grow.
//
// Every class here gives exactly what decode or encode give on the whole
// input: the same numbers, the same string, and the same PolylineError with
// the same code and index, wherever the chunks are cut. The decoder mirrors
// the core's two paths: a fast 2D loop for whole points, and the exact
// per-character code of slowDecode for everything else (a point split
// between chunks, other dimensions, bad characters, huge values).
/* @ts-self-types="../types/stream.d.ts" */
import { opts, st, chars } from './core.js';
import { PolylineError, fail } from './error.js';
import { Lines, toText, flushText } from './lines.js';

export { PolylineError };

// Scaled values below this fit 32-bit math, deltas and zigzag included.
const LIMIT = 2 ** 29;
// Encoded characters for every zigzag value below 1024, like the core's.
const CHARS = /* @__PURE__ */ Array.from({ length: 1024 }, (_, z) => chars(z));

// The decoder and encoder keep the error that stopped them and throw it
// again on every later call: after a throw, their state is half updated.
const guard = (o, fn) => {
  if (o.e) throw o.e;
  try {
    return fn();
  } catch (e) {
    throw (o.e = e);
  }
};

// Reads the options once, with the core's parser, so a bad option throws the
// same PolylineError as decode and encode, from the constructor.
const setup = (o, options) => {
  o.f = opts(options);
  o.z = st.zf;
  o.d = st.dims;
  o.sw = st.swap && st.dims > 1;
  o.strict = st.strict;
  o.flat = !!(options && options.flat);
  o.e = null;
};

/**
 * Decodes one polyline that arrives in chunks. `write` returns the points
 * the chunk completed, `end` checks that nothing was cut off.
 */
export class PolylineDecoder {
  constructor(options) {
    setup(this, options);
    this.reset();
  }

  reset() {
    // Per axis sums, the value being read (v, m) and how many values of the
    // current point are done (a); n counts characters before this chunk.
    this.s = Array(this.d).fill(0);
    this.v = 0;
    this.m = 1;
    this.a = 0;
    this.n = 0;
    this.td = null;
  }

  write(chunk) {
    return guard(this, () => this.run(toText(this, chunk)));
  }

  end() {
    return guard(this, () => {
      const out = this.run(flushText(this));
      if (this.strict && (this.m > 1 || this.a)) fail('truncated', 'Truncated', this.n);
      this.reset();
      return out;
    });
  }

  run(s) {
    const len = s.length, d = this.d, flat = this.flat;
    let i = 0, out, end = len;
    if (flat) {
      // Every value ends with one character below code 95, so this counts the
      // points the chunk completes, to size the array, and finds where the
      // last one ends. Exact for valid input; bad characters can make both
      // too big, but then the fast loop gives up and the slow code decides.
      let t = this.a, r;
      for (let j = 0; j < len; j++) t += (s.charCodeAt(j) - 95) >>> 31;
      // Back from the end, past the values of the cut-off point. Finding the
      // end in the counting loop made it 70% slower.
      for (r = t % d; end > 0; end--) if (s.charCodeAt(end - 1) < 95 && !r--) break;
      out = new Float64Array(((t / d) | 0) * d);
    } else {
      // A point the fast loop takes is at most 12 characters, so stopping 12
      // before the end means it never reads past the chunk, and tuples need
      // no count. The rest goes to the slow code.
      end = len - 12;
      out = len < 64 ? [] : Array(len >> 2);
    }
    this.o = out;
    this.k = 0;
    if (d == 2) {
      if (this.a || this.m > 1) i = this.slow(s, 0, len, true);
      if (i < end) this.fast(s, i, end);
      else this.slow(s, i, len, false);
    } else this.slow(s, 0, len, false);
    this.n += len;
    this.o = null;
    const k = this.k;
    if (k == out.length) return out;
    if (flat) return out.slice(0, k);
    out.length = k;
    return out;
  }

  // The core's 2D loop, from the sums so far to `end`. With flat output
  // that's the end of the last whole point. With tuples it's 12 characters
  // before the end of the chunk, and the loop finishes the point it's in. Any
  // bad character, or a value longer than six characters, sends the range
  // to the slow code instead. The rest of the chunk goes to the slow code
  // too, which keeps a cut-off point's characters in the state.
  fast(s, i, end) {
    const f = this.f, out = this.o, flat = this.flat, a = +this.sw, i0 = i, k0 = this.k;
    let lat = this.s[0], lng = this.s[1], k = k0, bad = 0, c, v, sh;
    while (i < end) {
      c = s.charCodeAt(i++) - 63;
      bad |= c;
      v = c & 31;
      for (sh = 5; c >= 32; sh += 5) {
        c = s.charCodeAt(i++) - 63;
        bad |= c | (25 - sh);
        v |= (c & 31) << sh;
      }
      lat += (v >>> 1) ^ -(v & 1);
      c = s.charCodeAt(i++) - 63;
      bad |= c;
      v = c & 31;
      for (sh = 5; c >= 32; sh += 5) {
        c = s.charCodeAt(i++) - 63;
        bad |= c | (25 - sh);
        v |= (c & 31) << sh;
      }
      lng += (v >>> 1) ^ -(v & 1);
      if (flat) {
        out[k + a] = lat / f;
        out[k + 1 - a] = lng / f;
        k += 2;
      } else out[k++] = [lat / f, lng / f];
    }
    if (bad & ~63 || (flat && i != end)) return this.slow(s, i0, s.length, false);
    // Built as [lat, lng] and flipped after, like the core.
    if (a && !flat) for (let j = k0; j < k; j++) out[j] = [out[j][1], out[j][0]];
    this.s[0] = lat;
    this.s[1] = lng;
    this.k = k;
    this.slow(s, i, s.length, false);
  }

  // slowDecode one character at a time, with its state kept between chunks.
  // With `once`, it stops after the first point it completes.
  slow(s, i, len, once) {
    const d = this.d, sum = this.s, strict = this.strict, f = this.f, z = this.z, sw = this.sw, flat = this.flat, out = this.o;
    let v = this.v, m = this.m, a = this.a, k = this.k, c;
    for (; i < len; i++) {
      c = s.charCodeAt(i) - 63;
      if (c < 0 || c > 63) {
        if (strict) fail('char', 'Invalid character', this.n + i);
        continue;
      }
      v += (c & 31) * m;
      m *= 32;
      if (v > 2 ** 53 && strict) fail('overflow', 'Value too large', this.n + i);
      if (c < 32) {
        sum[a] += v % 2 ? -(v + 1) / 2 : v / 2;
        v = 0;
        m = 1;
        if (++a == d) {
          a = 0;
          const p = flat ? out : Array(d), o = flat ? k : 0;
          for (let b = 0; b < d; b++) p[o + (sw && b < 2 ? 1 - b : b)] = sum[b] / (b < 2 ? f : z);
          if (flat) k += d;
          else out[k++] = p;
          if (once) {
            i++;
            break;
          }
        }
      }
    }
    this.v = v;
    this.m = m;
    this.a = a;
    this.k = k;
    return i;
  }
}

// write() takes one point or an array of them: an array whose first item
// isn't an object is one tuple, and anything without a length is one
// {lat, lng} object.
const isPoint = (x) => !(x.length >= 0) || (x.length > 0 && (typeof x[0] != 'object' || x[0] === null));

/**
 * Encodes points that arrive a few at a time. Each `write` returns the
 * string for its points, so the pieces joined are what encode gives for all
 * of them.
 */
export class PolylineEncoder {
  constructor(options) {
    setup(this, options);
    this.reset();
  }

  reset() {
    // The last scaled value per axis, the points so far, and with `flat`
    // the values of a point split between writes.
    this.l = Array(this.d).fill(0);
    this.i = 0;
    this.r = [];
  }

  write(points) {
    return guard(this, () => {
      if (points == null || typeof points != 'object') fail('input', this.flat ? 'Expected an array' : 'Expected a point or an array of points');
      if (!this.flat) return isPoint(points) ? this.run([points], 0, 0, 1) : this.run(points, 0, 0, points.length);
      if (!(points.length >= 0)) fail('input', 'Expected an array');
      const d = this.d, r = this.r;
      let s = '', off = 0;
      if (r.length) {
        off = Math.min(d - r.length, points.length);
        for (let j = 0; j < off; j++) r.push(points[j]);
        if (r.length < d) return '';
        s = this.run(r, 0, 1, 1);
        this.r = [];
      }
      const n = ((points.length - off) / d) | 0;
      s += this.run(points, off, 1, n);
      for (let j = off + n * d; j < points.length; j++) this.r.push(points[j]);
      return s;
    });
  }

  end() {
    return guard(this, () => {
      if (this.r.length && this.strict) fail('input', 'Length not a multiple of ' + this.d);
      this.reset();
      return '';
    });
  }

  // n points from src: tuples or objects, or with `flat` numbers from `off`.
  // 2D numbers in range take the core's fast rounding, everything else
  // slowEncode's exact code, one point at a time. Both round the same way.
  run(src, off, flat, n) {
    const two = this.d == 2, f = this.f, a = +this.sw, last = this.l;
    let s = '', j = 0, la = last[0], lb = last[1], x, y, p, q, w, pt;
    // Whether the previous values fit the 32-bit delta math.
    let fits = two && la < LIMIT && la > -LIMIT && lb < LIMIT && lb > -LIMIT;
    for (; j < n; j++) {
      if (fits) {
        if (flat) {
          x = src[off + j * 2 + a];
          y = src[off + j * 2 + 1 - a];
        } else {
          pt = src[j];
          x = pt == null ? pt : pt[a];
          y = pt == null ? pt : pt[1 - a];
        }
        if (typeof x == 'number' && typeof y == 'number' && (x *= f) < LIMIT && x > -LIMIT && (y *= f) < LIMIT && y > -LIMIT) {
          p = x < 0 ? -((0.5 - x) | 0) : (x + 0.5) | 0;
          q = y < 0 ? -((0.5 - y) | 0) : (y + 0.5) | 0;
          if (x < 0.5 && x > -0.5) p = 0;
          if (y < 0.5 && y > -0.5) q = 0;
          w = p - la;
          w = (w << 1) ^ (w >> 31);
          s += w < 1024 ? CHARS[w] : chars(w);
          w = q - lb;
          w = (w << 1) ^ (w >> 31);
          s += w < 1024 ? CHARS[w] : chars(w);
          la = p;
          lb = q;
          continue;
        }
      }
      if (two) {
        last[0] = la;
        last[1] = lb;
      }
      s += this.point(src, off, flat, j);
      if (two) {
        la = last[0];
        lb = last[1];
        fits = la < LIMIT && la > -LIMIT && lb < LIMIT && lb > -LIMIT;
      }
    }
    if (two) {
      last[0] = la;
      last[1] = lb;
    }
    this.i += n;
    return s;
  }

  // One point with slowEncode's code.
  point(src, off, flat, j) {
    const d = this.d, sw = this.sw, f = this.f, z = this.z, strict = this.strict, last = this.l, p = flat ? 0 : src[j];
    let s = '';
    for (let a = 0; a < d; a++) {
      const b = sw && a < 2 ? 1 - a : a;
      let x = flat ? src[off + j * d + b] : p == null ? p : p.length >= 0 ? p[b] : a ? (a > 1 ? p.alt ?? p.altitude : p.lng ?? p.lon ?? p.longitude) : p.lat ?? p.latitude;
      x = x == null ? NaN : +x * (a < 2 ? f : z);
      if (!(x - x == 0)) {
        if (strict) fail('coordinate', 'Invalid coordinate', this.i + j);
        x = 0;
      }
      x = Math.sign(x) * Math.round(Math.abs(x));
      let w = x - last[a];
      last[a] = x;
      w = w < 0 ? -w * 2 - 1 : w * 2;
      if (w > 2 ** 53 && strict) fail('overflow', 'Value too large', this.i + j);
      if (w < 1024) s += CHARS[w];
      else {
        for (; w >= 32; w = Math.floor(w / 32)) s += String.fromCharCode((w % 32) + 95);
        s += String.fromCharCode(w + 63);
      }
    }
    return s;
  }
}

// One result per line: the polyline's points, or with `field` the line's
// JSON object with that field decoded. Blank lines are skipped. An error
// gets the line number as `line`; with `errors: 'skip'` it goes to
// `onError` and the line is left out. Each line goes through one
// PolylineDecoder or PolylineEncoder, reused while it doesn't throw, so
// this entry doesn't carry a second copy of the codec.
const lineOptions = (o, Codec) => {
  const c = { o, field: o && o.field, skip: false, cb: o && o.onError, no: 0, x: new Codec(o) };
  const e = o && o.errors;
  if (e === 'skip') c.skip = true;
  else if (e != null && e !== 'throw') fail('option', 'Invalid errors');
  c.fn = (v) => {
    try {
      const r = c.x.write(v);
      c.x.end();
      return r;
    } catch (err) {
      c.x = new Codec(o);
      throw err;
    }
  };
  return c;
};

const each = (c, out, fn) => {
  c.no++;
  try {
    const r = fn();
    if (r !== undefined) out.push(r);
  } catch (e) {
    if (e && typeof e == 'object') e.line = c.no;
    if (!c.skip) throw e;
    if (c.cb) c.cb(e, c.no);
  }
};

const object = (x) => (x && typeof x == 'object' ? x : fail('input', 'Expected an object'));

class LineDecoder {
  constructor(o) {
    this.c = lineOptions(o, PolylineDecoder);
    this.lines = new Lines();
  }
  line(text, out) {
    const c = this.c;
    each(c, out, () => {
      const t = text.trim();
      if (!t) return;
      if (c.field == null) return c.fn(t);
      const r = object(JSON.parse(t));
      r[c.field] = c.fn(typeof r[c.field] == 'string' ? r[c.field] : fail('input', 'Expected a string'));
      return r;
    });
  }
  write(chunk) {
    const out = [];
    this.lines.push(chunk, (l) => this.line(l, out));
    return out;
  }
  end() {
    const out = [];
    this.lines.end((l) => this.line(l, out));
    return out;
  }
}

class LineEncoder {
  constructor(o) {
    this.c = lineOptions(o, PolylineEncoder);
  }
  write(item) {
    const c = this.c, out = [];
    each(c, out, () => (c.field == null ? c.fn(item) : JSON.stringify({ ...object(item), [c.field]: c.fn(item[c.field]) })) + '\n');
    return out;
  }
  end() {
    return [];
  }
}

// TransformStream classes over the codecs above. Made by a function so
// bundlers can drop the ones nobody imports, and so a runtime without
// TransformStream (React Native) can still load this file and use the rest.
const TS = globalThis.TransformStream;
const streamClass = (Codec, many) =>
  class extends (TS || Object) {
    constructor(options) {
      if (!TS) throw new TypeError('TransformStream is not available here; use PolylineDecoder or PolylineEncoder');
      const c = new Codec(options);
      const put = (r, ctl) => {
        if (many) for (const x of r) ctl.enqueue(x);
        else if (r.length) ctl.enqueue(r);
      };
      super({ transform: (chunk, ctl) => put(c.write(chunk), ctl), flush: (ctl) => put(c.end(), ctl) });
    }
  };

/** Text or bytes in, one array of points (or Float64Array with `flat`) out per chunk. */
export const DecodeStream = /* @__PURE__ */ streamClass(PolylineDecoder, 0);
/** Points or arrays of points in, string pieces out. */
export const EncodeStream = /* @__PURE__ */ streamClass(PolylineEncoder, 0);
/** Text or bytes with one polyline (or JSON object, with `field`) per line in, one result per line out. */
export const DecodeLinesStream = /* @__PURE__ */ streamClass(LineDecoder, 1);
/** One array of points (or object, with `field`) per chunk in, one line of text out per chunk. */
export const EncodeLinesStream = /* @__PURE__ */ streamClass(LineEncoder, 1);

// Async iterables, sync iterables and ReadableStreams (which older Safari
// versions can't iterate with for await). A string or bytes is one chunk.
const source = (x) =>
  typeof x == 'string' || (x && x.byteLength >= 0) ? [x]
  : x && (x[Symbol.asyncIterator] || x[Symbol.iterator]) ? x
  : x && x.getReader ? read(x)
  : fail('input', 'Expected an iterable or a ReadableStream');

async function* read(stream) {
  const r = stream.getReader();
  try {
    for (let x; !(x = await r.read()).done; ) yield x.value;
  } finally {
    r.releaseLock();
  }
}

/** Yields the points of one polyline read from chunks of text or bytes. */
export async function* decodeIterable(chunks, options) {
  const d = new PolylineDecoder(options);
  d.flat = false;
  for await (const chunk of source(chunks)) for (const p of d.write(chunk)) yield p;
  d.end();
}

/** Yields the polyline for points (or arrays of points), in pieces of about 64 KB. */
export async function* encodeIterable(points, options) {
  const e = new PolylineEncoder(options);
  let s = '';
  for await (const p of source(points)) if ((s += e.write(p)).length >= 65536) {
    yield s;
    s = '';
  }
  if ((s += e.end())) yield s;
}

/** Yields one result per line of text or bytes, like DecodeLinesStream. */
export async function* decodeLines(chunks, options) {
  const d = new LineDecoder(options);
  for await (const chunk of source(chunks)) yield* d.write(chunk);
  yield* d.end();
}

/** Yields one line of text per array of points (or object), like EncodeLinesStream. */
export async function* encodeLines(items, options) {
  const e = new LineEncoder(options);
  for await (const item of source(items)) yield* e.write(item);
}
