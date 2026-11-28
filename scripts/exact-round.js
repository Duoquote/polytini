// Checks the fast encode loops' rounding against the definition at every
// half step in their range. test/rounding.test.js runs a sample of this in
// the normal suite; this is the whole thing, for when the rounding changes.
//
//   node scripts/exact-round.js                  every k below 2^29 (LIMIT)
//   node scripts/exact-round.js --to 1000000     a quicker part
//   node scripts/exact-round.js --workers 6 --random 200000000
//
// For every k from --from to --to it checks k + 0.5 and its 8 nearest
// doubles on each side, and k and its 2 nearest on each side (at half the
// spacing below k, so powers of two are covered), both signs. --random adds
// that many random bit patterns below 2^29 and random coordinates times
// 10^p. Each value goes through the loops' expression,
// (x + (x < 0 ? -H : H)) | 0 with H from src/core.js, and is compared with
// Math.round on the magnitude, which is half away from zero and what
// slowEncode does. As a control, plain (x + 0.5) | 0 is checked too: it has
// to fail at exactly ±0.49999999999999994, or the harness isn't seeing the
// case H exists for.
//
// Every k below 2^29 is about 24 billion values: about 5 minutes on 6 cores
// of a Ryzen 7 5800X with Node 24. Exits 1 if the expression is wrong for
// any value.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { H, LIMIT } from '../src/core.js';

const round = (x) => (x + (x < 0 ? -H : H)) | 0;
const plain = (x) => (x < 0 ? -((0.5 - x) | 0) : (x + 0.5) | 0);
const want = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));

function part({ from, to, random, seed }) {
  const f64 = new Float64Array(1), u64 = new BigUint64Array(f64.buffer);
  const step = (x, j) => {
    f64[0] = x;
    u64[0] += BigInt(j);
    return f64[0];
  };
  const ulp = (x) => 2 ** (Math.floor(Math.log2(x)) - 52);
  let tested = 0, wrong = 0, control = 0;
  const bad = [], controlBad = [];
  const check = (x) => {
    for (const v of [x, -x]) {
      const r = want(v);
      tested++;
      if (round(v) != r && wrong++ < 5) bad.push(v);
      if (plain(v) != r && control++ < 5) controlBad.push(v);
    }
  };
  for (let k = from; k < to; k++) {
    if (k == 0) {
      // 0.5 is a power of two: the spacing below it is half the one above.
      for (let j = -8; j <= 8; j++) check(step(0.5, j));
      for (let j = 0; j <= 2; j++) check(step(0, j));
      continue;
    }
    const h = k + 0.5, u = ulp(h);
    for (let j = -8; j <= 8; j++) check(h + j * u);
    const v = ulp(k) / 2;
    for (let j = -2; j <= 2; j++) check(k + j * v);
  }
  let s = seed;
  const r32 = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) | 0), s >>> 0);
  for (let i = 0; i < random; i++) {
    // Uniform bit patterns below 2^29: exponents up to 1023 + 28.
    f64[0] = 0;
    u64[0] = (BigInt(r32() % (0x41c00000 + 1)) << 32n) | BigInt(r32());
    check(f64[0]);
    // A coordinate times 10^p, the way the encoder gets x.
    const c = (r32() / 4294967296 - 0.5) * 360;
    check(c * 10 ** (i % 7));
    check((Math.round(c * 1e6) / 1e6) * 10 ** (i % 7));
  }
  return { tested, wrong, bad, control, controlBad };
}

if (!isMainThread) parentPort.postMessage(part(workerData));
else {
  const args = process.argv.slice(2);
  const opt = (n, d) => (args.includes('--' + n) ? Number(args[args.indexOf('--' + n) + 1]) : d);
  const from = opt('from', 0), to = opt('to', LIMIT), random = opt('random', 0), n = opt('workers', Math.max(1, os.availableParallelism() - 2));
  const t0 = Date.now(), size = Math.ceil((to - from) / n);
  const parts = await Promise.all(
    Array.from({ length: n }, (_, i) => {
      const data = { from: from + i * size, to: Math.min(to, from + (i + 1) * size), random: i ? 0 : random, seed: 12345 };
      return new Promise((ok, fail) => new Worker(new URL(import.meta.url), { workerData: data }).on('message', ok).on('error', fail));
    }),
  );
  const sum = (key) => parts.reduce((a, p) => a + p[key], 0);
  const list = (key) => parts.flatMap((p) => p[key]).slice(0, 5).join(', ');
  console.log(`k ${from} to ${to}, ${random} random: ${sum('tested')} values in ${((Date.now() - t0) / 1000).toFixed(0)} s on ${n} workers`);
  console.log(`  (x + (x < 0 ? -H : H)) | 0: ${sum('wrong')} wrong${sum('wrong') ? ', e.g. ' + list('bad') : ''}`);
  console.log(`  control, (x + 0.5) | 0: ${sum('control')} wrong${sum('control') ? ', e.g. ' + list('controlBad') : ''}`);
  // The control only sees its failure when k = 0 is in range.
  if (sum('wrong') || (from == 0 && sum('control') != 2)) process.exitCode = 1;
}
