// Rounding at the half steps, on every entry. The fast encode loops round
// by adding the largest double below 0.5 with x's sign and truncating (see
// the note after LIMIT in core.js). This checks a sample of the values where that could go wrong
// against Math.round on the magnitude, which is the definition (and what
// slowEncode and the reference do): k + 0.5 and its 8 nearest doubles on
// each side, k and its nearest doubles, both signs, for every k below 2048,
// around every power of two up to 2^28, at the top of the fast loops' range
// (2^29) and for 3000 random k below it. scripts/exact-round.js runs the
// same check for every k below 2^29, about 24 billion values.
import { test, eq, entries } from './lib.js';
import * as ref from './reference.js';

const all = await entries();
const LIMIT = 2 ** 29;

const f64 = new Float64Array(1), i64 = new BigInt64Array(f64.buffer);
// The double j steps away from x > 0 (j may be negative).
const step = (x, j) => {
  f64[0] = x;
  i64[0] += BigInt(j);
  return f64[0];
};

function values() {
  const ks = new Set();
  for (let k = 0; k < 2048; k++) ks.add(k);
  for (let j = 11; j < 29; j++) for (let d = -2; d <= 2; d++) ks.add(2 ** j + d);
  for (let k = LIMIT - 4; k < LIMIT; k++) ks.add(k);
  // Seeded, so every runtime checks the same values.
  let s = 20261128;
  for (let i = 0; i < 3000; i++) {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) | 0;
    ks.add((s >>> 0) % LIMIT);
  }
  const out = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE];
  for (const k of ks) {
    // Up to 8 doubles either side of k + 0.5, and 2 either side of k.
    for (let j = -8; j <= 8; j++) out.push(step(k + 0.5, j));
    if (k) for (let j = -2; j <= 2; j++) out.push(step(k, j));
  }
  // Everything the fast loops take, so none of them hands over to slowEncode.
  return out.filter((x) => x < LIMIT).flatMap((x) => [x, -x]);
}

// Lines of [x, y], [0, 0], ... at precision 0, so the encoder rounds x
// itself and every delta stays within 2^29. Long lines, so the byte loops
// (fast.js, and text.js from 16 or 512 points) run, and short ones for the
// core's string loop.
const lines = (vals, size) => {
  const out = [];
  for (let i = 0; i < vals.length; i += size) {
    const line = [];
    for (let j = i; j < Math.min(i + size, vals.length - 1); j += 2) line.push([vals[j], vals[j + 1]], [0, 0]);
    out.push(line);
  }
  return out;
};

const vals = values();
const long = lines(vals, 2048), short = lines(vals, 8);
const want = (ls) => ls.map((l) => ref.encode(l, 0));
const longWant = want(long), shortWant = want(short);

for (const { name, api } of all) {
  test(`${name}: rounds half away from zero at ${vals.length} half steps and integers`, () => {
    eq(long.map((l) => api.encode(l, 0)), longWant, 'long lines');
    eq(short.map((l) => api.encode(l, 0)), shortWant, 'short lines');
    eq(long.map((l) => api.encodeFlat(new Float64Array(l.flat()), 0)), longWant, 'encodeFlat, Float64Array');
    eq(short.map((l) => api.encodeFlat(l.flat(), 0)), shortWant, 'encodeFlat, short');
  });
}
