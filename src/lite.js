// The /lite entry: decode and encode for 2D lines at precision 0 to 6, about
// 500 bytes gzipped for both against about 1.9 KB for the default entry.
// It's the default entry's fast loops without the exact fallback paths and
// the options, with the same output for everything it accepts and the same
// speed as the core loops (paired runs in docs/api.md).
//
// What it leaves out, and what happens instead:
// - Options objects, presets, `order`, `dimensions`, `strict: false`: only a
//   precision number from 0 to 6. Anything else makes decode throw, and
//   encode throws on its first point.
// - Values that need more than 30 bits after zigzag (a scaled coordinate
//   past 2^29, about 536 degrees at precision 6): decode and encode throw
//   instead of falling back to Number math. No valid coordinate gets there.
// - Errors are plain `Error`s with a short message, not `PolylineError`
//   with a code and an index.
// - Encode reads `p[0]` and `p[1]` of each point, so `{ lat, lng }` objects,
//   NaN, Infinity and other non-numbers throw. `null` counts as 0 (it
//   multiplies to 0), where the default entry throws: rejecting it cost 7
//   bytes.
//
// Smaller versions were slower. A do/while decoder that appends with push
// was 32 bytes smaller, but 18 to 39% slower on Bun from 100 points and 5 to
// 11% on Node 24; encoding with a loop per character instead of the table was
// 52 bytes smaller and 39% slower on the real-world lines; and `10 ** p`
// instead of the table took about 50 ns per call on Node 22, a third of
// decoding 10 points. docs/api.md has what each check costs.
/* @ts-self-types="../types/lite.d.ts" */

// 10 ** p for the precisions lite takes. Anything else, including 7 and
// up, gives undefined, which decode rejects and which makes every encoded
// coordinate NaN.
const F = [1, 10, 100, 1e3, 1e4, 1e5, 1e6];

/** Decodes to [lat, lng] tuples. */
export const decode = (str, p) => {
  const f = F[p ?? 5], len = str.length, out = len < 64 ? [] : Array(len >> 1);
  let i = 0, n = 0, lat = 0, lng = 0, bad = 0, c, v, s;
  // The default entry's decodeLoop. `bad` collects every character code, so
  // anything outside ? to ~ sets a bit above the low six, and so does a 7th
  // chunk in one value (25 - s < 0). Reading past the end gives NaN, which
  // ends the value and leaves i past len: a truncated value or a missing
  // longitude.
  while (i < len) {
    c = str.charCodeAt(i++) - 63;
    bad |= c;
    v = c & 31;
    for (s = 5; c > 31; s += 5) {
      c = str.charCodeAt(i++) - 63;
      bad |= c | (25 - s);
      v |= (c & 31) << s;
    }
    lat += (v >> 1) ^ -(v & 1);
    c = str.charCodeAt(i++) - 63;
    bad |= c;
    v = c & 31;
    for (s = 5; c > 31; s += 5) {
      c = str.charCodeAt(i++) - 63;
      bad |= c | (25 - s);
      v |= (c & 31) << s;
    }
    lng += (v >> 1) ^ -(v & 1);
    out[n++] = [lat / f, lng / f];
  }
  if (bad >> 6 || i > len || !f) throw Error('Invalid polyline');
  if (out.length != n) out.length = n;
  return out;
};

// The largest double below 0.5. Adding it and truncating rounds half away
// from zero exactly: x + 0.5 would round 0.49999999999999994 up to 1, and
// this addend leaves it at 0.99999999999999989. Every x.5 still reaches the
// next integer, because the sum's last bit rounds up to it. The default
// entry adds 0.5 and fixes |x| < 0.5 afterwards, which costs 16 more bytes.
const h = 0.49999999999999994;

const put = (z) => {
  let s = '';
  for (; z > 31; z >>= 5) s += String.fromCharCode((z & 31) + 95);
  return s + String.fromCharCode(z + 63);
};

// The characters of every zigzag value below 1024, so one or two characters
// are one concatenation. Pure, so a decode-only bundle drops it.
const T = /* @__PURE__ */ Array.from({ length: 1024 }, (_, z) => put(z));

/** Encodes [lat, lng] tuples. */
export const encode = (pts, p) => {
  const f = F[p ?? 5];
  let s = '', i = 0, la = 0, lb = 0, x, y, z;
  for (; i < pts.length; i++) {
    x = pts[i][0] * f;
    y = pts[i][1] * f;
    // Below 2^58 squared means below 2^29, which keeps the delta and the
    // zigzag in 32 bits. False for NaN and Infinity too.
    if (!(x * x < 2.88e17 && y * y < 2.88e17)) throw Error('Invalid coordinate');
    x = (x + (x < 0 ? -h : h)) | 0;
    y = (y + (y < 0 ? -h : h)) | 0;
    z = x - la;
    z = (z << 1) ^ (z >> 31);
    s += z < 1024 ? T[z] : put(z);
    z = y - lb;
    z = (z << 1) ^ (z >> 31);
    s += z < 1024 ? T[z] : put(z);
    la = x;
    lb = y;
  }
  return s;
};
