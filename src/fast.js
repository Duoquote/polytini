// Fast paths for runtimes with Node's Buffer: Node and Bun. Each choice here
// was measured with the benchmark fixtures (see "Platform notes" in the
// README):
//
// - Decode copies the string into a scratch buffer with `utf8Write` and
//   parses the bytes. On V8, charCodeAt in a hot loop re-checks the string
//   representation on every call, and the copy is close to a memcpy.
//   `latin1Write` is a bit faster but keeps only the low byte, so U+0151
//   would turn into a valid "Q". With UTF-8, any character outside ASCII
//   makes the byte count differ from the length, and those strings go to the
//   exact slow path, so strict mode stays exact. This used `ucs2Write`
//   before, which copied 0.24 to 0.45 ns per character on Node 22 and 26
//   where `utf8Write` takes 0.04. In paired runs the decoder got 4 to 16%
//   faster on Node 22, 7 to 12% on Node 26, 3 to 11% on Bun, and stayed
//   about the same on Node 24, where both copies are fast.
// - The decoder counts the points first (four characters per step, through
//   a Uint32Array view), so the output array is allocated at its exact size.
//   Growing it with push, or trimming an oversized one, both measured slower.
// - Encode writes bytes into a scratch buffer and makes the string with one
//   `latin1Slice` call. That was 2 to 4 times faster than building the string
//   with += on both V8 and JavaScriptCore, and the result is a flat string.
// - The character loops branch on "is there another chunk". A branchless
//   version was faster on the real-world lines, where 1 and 2 character
//   values alternate at random, but slower on the GPS tracks, where they come
//   in runs the branch predictor learns. Branchy won 5 of the 6 columns.
// - Strings under 64 characters skip the copy and use the core's loop.
import { opts, st, LIMIT, slowDecode, slowEncode, decodeLoop, flatLoop, flip } from './core.js';

// Scratch memory is reused between calls up to this size. Bigger inputs get
// a temporary buffer, so one huge line doesn't pin megabytes for good.
const KEEP = 1 << 20;

// `grow`: above this many points, build the result by appending instead of
// allocating it at its final size. See node.js for why.
export function fast(Buffer, grow = Infinity) {
  const utf8Write = Buffer.prototype.utf8Write, latin1Slice = Buffer.prototype.latin1Slice;
  // The kept scratch buffer and its 32-bit view. allocUnsafeSlow gives each
  // buffer its own ArrayBuffer at offset 0, so the wider view is aligned.
  let kept, k32, u8;
  const views = (buf) => [buf, new Uint32Array(buf.buffer, 0, buf.length >> 2)];
  [kept, k32] = views(Buffer.allocUnsafeSlow(1 << 14));
  const scratch = (bytes) => (bytes <= kept.length ? kept : bytes <= KEEP ? ([kept, k32] = views(Buffer.allocUnsafeSlow(bytes)))[0] : Buffer.allocUnsafeSlow(bytes));

  // Copies str into scratch as bytes, points u8 at it, and returns the
  // number of values, or -1 when the string isn't ASCII.
  function load(str, len) {
    const buf = scratch(len + 8);
    // One byte per character, or the string isn't ASCII.
    if (utf8Write.call(buf, str, 0) != len) return -1;
    u8 = buf;
    const u32 = buf == kept ? k32 : views(buf)[1];
    // Padding: '?' is a complete zero value, so a truncated string stops
    // inside the buffer and leaves the index past len.
    buf[len] = buf[len + 1] = buf[len + 2] = 63;
    // Every value ends with one character below code 95. Count the others,
    // which have bit 5 set after adding 1, four characters per word.
    let more = 0;
    for (let k = 0, w = (len + 3) >> 2; k < w; k++) more += Math.imul(((u32[k] + 0x1010101) >>> 5) & 0x1010101, 0x1010101) >>> 24;
    return len - more;
  }

  // decodeLoop over the byte copy, with an exactly sized output. Returns
  // null for slowDecode. Tuples and flat output are separate loops here: one
  // shared loop with a per-point branch measured about 20% slower on
  // JavaScriptCore at 10,000 points.
  function big(str, f) {
    const len = str.length, want = load(str, len) >> 1;
    if (want < 0) return null;
    const b = u8, out = want > grow ? [] : Array(want);
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
    // The count is exact for valid input, and invalid input stops here.
    return bad & ~63 || i != len ? null : out;
  }

  function bigFlat(str, f, sw) {
    const len = str.length, want = load(str, len);
    if (want < 0) return null;
    const out = new Float64Array(want & ~1), b = u8, a = +sw;
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
      out[n + a] = lat / f;
      out[n + 1 - a] = lng / f;
      n += 2;
    }
    return bad & ~63 || i != len ? null : out;
  }

  const decodeWith = (str, o, flat) => {
    const f = opts(o);
    if (st.dims != 2 || typeof str != 'string') return slowDecode(str, f, flat);
    const out = str.length < 64 ? (flat ? flatLoop(str, f, st.swap) : decodeLoop(str, f, st.swap)) : flat ? bigFlat(str, f, st.swap) : big(str, f);
    return out ? (st.swap && !flat ? flip(out) : out) : slowDecode(str, f, flat);
  };

  // Writes bytes into scratch, 7 per value at most below LIMIT. Returns null
  // for slowEncode.
  function encodeLoop(src, f, a, flat) {
    const n = flat ? src.length >> 1 : src.length, buf = scratch(n * 14 + 8);
    let i = 0, k = 0, la = 0, lb = 0, x, y, p, q, z, pt;
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
        for (; z >= 32; z >>>= 5) buf[k++] = (z & 31) + 95;
        buf[k++] = z + 63;
        z = q - lb;
        z = (z << 1) ^ (z >> 31);
        for (; z >= 32; z >>>= 5) buf[k++] = (z & 31) + 95;
        buf[k++] = z + 63;
        la = p;
        lb = q;
      }
    } catch {
      return null;
    }
    return latin1Slice.call(buf, 0, k);
  }

  const encodeWith = (src, o, flat) => {
    const f = opts(o);
    return (st.dims == 2 && f <= 1e6 && (flat ? src != null && !(src.length % 2) : Array.isArray(src)) ? encodeLoop(src, f, +st.swap, flat) : null) ?? slowEncode(src, f, flat);
  };

  return {
    decode: (str, o) => decodeWith(str, o, 0),
    decodeFlat: (str, o) => decodeWith(str, o, 1),
    encode: (src, o) => encodeWith(src, o, 0),
    encodeFlat: (src, o) => encodeWith(src, o, 1),
  };
}
