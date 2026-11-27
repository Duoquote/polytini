// A paired A/B microbenchmark for deciding on small changes. The numbers in
// the polyline-benchmark repo move about 30% between rounds, which is fine
// for comparing libraries and useless for a 5% change in one loop.
//
//   git worktree add ../base main
//   node bench/ab.js --a ../base/src/node.js --b src/node.js --cases decode:10,decode:real
//   node bench/ab.js --a src/web.js --b src/web.js          A against itself: the noise floor
//   node bench/ab.js ... --exe "C:/path/to/bun.exe"         another runtime (deno gets `run -A`)
//   node bench/ab.js ... --mode same                        both in one process
//   node bench/ab.js ... --prio high --affinity 0xF000      what I used on Windows
//
// A and B are modules that export decode, encode, decodeFlat and encodeFlat,
// so another library works too with a two-line wrapper. A case is
// `op:fixture`, with the fixtures of the benchmark repo: 10, 100, 1000, 10000,
// 100000 points and `real` (its 1000 real-world lines). Any other number
// makes a track of that many points.
//
// - `--mode fresh` (default): every round starts one process for A and one
//   for B, in alternating order. Each warms up for `--warm` ms, takes
//   `--samples` samples of about `--sample` ms and reports the fastest. The
//   result is the ratio B/A per round.
// - `--mode same`: one process per round loads both and takes samples in
//   ABBA order. Each has its own generated call site, so they don't share
//   inline caches there. They do share everything in the modules they both
//   import, so use it for modules that share nothing.
// - The report is the geometric mean of the ratios with a 95% confidence
//   interval (t distribution on the log ratios), and how many rounds B won.
//   Below 1.00 means B is faster. If the interval includes 1.00, there is
//   no result.
// - Results are consumed: the length and the last value of every output go
//   into a sum that's printed. `--consume full` also reads the last
//   character of encoded strings, which flattens a string built with +=.
// - `--strings`: how decode inputs are stored. `as-is` is what the benchmark
//   repo times: concatenated strings for the generated lines, slices of the
//   CSV for the real-world ones. `flat` copies each one first, which is what
//   JSON.parse gives you. V8 reads the two at different speeds.
// - `--stat min` (default), `p25`, `median`, `mean` or `all`: which number
//   of a worker's samples to compare. The fastest sample was the steadiest
//   by far: on a desktop where other programs used about half the CPU, A
//   against itself over 8 rounds gave an interval of about ±2% with it, and
//   ±8 to 13% with the median or the mean. It leaves out most garbage
//   collections, so for a change in what gets allocated look at `mean` too.
// - `--prio high` raises the workers' priority and `--affinity <mask>` pins
//   this process and its children to those cores (Windows only). Together
//   they cut the spread between rounds from 10 to 60% down to 4 to 12%.
//   High priority alone did nothing I could measure.
//
// Even so, I don't trust a difference under 3% from 8 rounds: A against
// itself landed on "1.4% faster, 8 of 8" once.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, basename } from 'node:path';
import os from 'node:os';

const args = globalThis.Deno ? Deno.args : process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i == -1 ? fallback : args[i + 1];
};
const mode = opt('mode', 'fresh');
const cases = opt('cases', 'decode:10,decode:100,decode:real,encode:10,encode:real').split(',');
const rounds = Number(opt('rounds', 12));
const warm = Number(opt('warm', 300));
const sampleMs = Number(opt('sample', 4));
const samples = Number(opt('samples', 60));
const consume = opt('consume', 'len');
const strings = opt('strings', 'as-is');
const optArg = opt('arg', '5');
const statName = opt('stat', 'min');

// ---------------------------------------------------------------- worker

async function worker() {
  const { benchFixtures, gpsTrack, ANCHORS } = await import(new URL('../test/bench-fixtures.js', import.meta.url).href);
  const ref = await import(new URL('../test/reference.js', import.meta.url).href);
  const mods = [];
  for (const file of opt('mods').split(',')) {
    const m = await import(pathToFileURL(file).href);
    if (m.init) await m.init(); // the /wasm entry
    mods.push(m);
  }
  const arg = optArg == 'none' ? undefined : JSON.parse(optArg);
  const precision = typeof arg == 'number' ? arg : 5;
  const fixtures = benchFixtures(precision);
  const now = () => performance.now();
  const out = {};
  let sink = 0;
  for (const c of cases) {
    const [op, size] = c.split(':');
    let fixture = fixtures.find((f) => f.name == (size == 'real' ? 'real-world' : `${Number(size).toLocaleString('en-US')} pts`));
    if (!fixture) {
      // Any other size: the same kind of track, built the same way.
      const coords = [gpsTrack({ points: Number(size), seed: 2000 + Number(size), anchor: ANCHORS[size % 4], precision })];
      fixture = { coords, encoded: coords.map((line) => ref.encode(line, precision)) };
    }
    const flat = op.endsWith('Flat');
    let inputs;
    if (op.startsWith('decode')) {
      inputs = fixture.encoded;
      // A real copy: through bytes and back, so nothing points at the old string.
      if (strings == 'flat') inputs = inputs.map((s) => new TextDecoder().decode(new TextEncoder().encode(s)));
    } else inputs = fixture.coords.map((line) => (flat ? new Float64Array(line.flat()) : line));
    // One runner per module, so each has its own call site and feedback.
    const body =
      op.startsWith('decode')
        ? `let s = 0;
           for (let r = 0; r < reps; r++) for (let i = 0; i < inputs.length; i++) {
             const out = fn(inputs[i], arg), last = out[out.length - 1];
             s += out.length + (typeof last == 'number' ? last : last[1]);
           }
           return s;`
        : `let s = 0;
           for (let r = 0; r < reps; r++) for (let i = 0; i < inputs.length; i++) {
             const out = fn(inputs[i], arg);
             s += out.length${consume == 'full' ? ' + out.charCodeAt(out.length - 1)' : ''};
           }
           return s;`;
    const runs = mods.map((m) => {
      if (typeof m[op] != 'function') throw new Error(`module has no ${op}`);
      return { fn: m[op], run: new Function('fn', 'inputs', 'arg', 'reps', body), times: [] };
    });
    // A checksum of every output, so the parent can see that A and B agree
    // before the timing means anything.
    for (const r of runs) {
      let h = 0;
      const mix = (x) => (h = (Math.imul(h, 31) + (x * 1e7)) | 0);
      for (const input of inputs) {
        const o = r.fn(input, arg);
        mix(o.length);
        if (typeof o == 'string') for (let i = 0; i < o.length; i++) mix(o.charCodeAt(i));
        else for (const p of o) typeof p == 'number' ? mix(p) : (mix(p[0]), mix(p[1]), mix(p.length));
      }
      r.check = h;
    }
    // Repetitions per sample, from the first module, the same for both.
    let reps = 1;
    for (;;) {
      const t = now();
      sink += runs[0].run(runs[0].fn, inputs, arg, reps);
      if (now() - t >= sampleMs / 4) break;
      reps *= 2;
    }
    for (const end = now() + warm * runs.length; now() < end; ) for (const r of runs) sink += r.run(r.fn, inputs, arg, reps);
    {
      const t = now();
      sink += runs[0].run(runs[0].fn, inputs, arg, reps);
      reps = Math.max(1, Math.round((reps * sampleMs) / (now() - t)));
    }
    const calls = reps * inputs.length;
    for (let i = 0; i < samples; i++) {
      // ABBA, so a drift over time hits both the same.
      for (const r of i % 2 ? [...runs].reverse() : runs) {
        const t = now();
        sink += r.run(r.fn, inputs, arg, reps);
        r.times.push(((now() - t) * 1e6) / calls);
      }
    }
    out[c] = runs.map((r) => ({ min: Math.min(...r.times), p25: quantile(r.times, 0.25), median: quantile(r.times, 0.5), mean: r.times.reduce((x, y) => x + y, 0) / r.times.length, check: r.check }));
  }
  console.log(`RESULT ${JSON.stringify({ out, sink })}`);
}

// ---------------------------------------------------------------- parent

function quantile(xs, q) {
  const s = [...xs].sort((a, b) => a - b), at = (s.length - 1) * q, lo = Math.floor(at);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (at - lo);
}
const median = (xs) => quantile(xs, 0.5);

// Two-sided 95% points of Student's t for 1 to 30 degrees of freedom.
const T95 = [12.71, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

async function main() {
  const script = fileURLToPath(import.meta.url);
  const a = resolve(opt('a')), b = resolve(opt('b'));
  const exe = opt('exe', process.execPath);
  const pre = /deno/i.test(basename(exe)) ? ['run', '-A'] : [];
  const prio = opt('prio', 'normal'), affinity = opt('affinity', null);
  if (affinity && process.platform == 'win32') {
    // Children inherit the affinity mask, so setting it here is enough.
    spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${process.pid}).ProcessorAffinity = ${Number(affinity)}`], { stdio: 'inherit' });
  }
  const version = spawnSync(exe, ['--version'], { encoding: 'utf8' }).stdout.split('\n')[0].trim();
  const pass = ['--cases', cases.join(','), '--warm', warm, '--sample', sampleMs, '--samples', samples, '--consume', consume, '--strings', strings, '--arg', optArg].map(String);
  const run = (mods) =>
    new Promise((done, fail) => {
      const child = spawn(exe, [...pre, script, '--worker', '--mods', mods.join(','), ...pass], { stdio: ['ignore', 'pipe', 'inherit'] });
      if (prio == 'high') {
        try {
          os.setPriority(child.pid, os.constants.priority.PRIORITY_HIGH);
        } catch {}
      }
      let text = '';
      child.stdout.on('data', (d) => (text += d));
      child.on('close', (code) => {
        const line = text.split('\n').find((l) => l.startsWith('RESULT '));
        if (code || !line) fail(new Error(`worker failed (${code}): ${text}`));
        else done(JSON.parse(line.slice(7)).out);
      });
    });

  // per case: [A, B] per round, each { min, p25, median, mean } in ns per call
  const data = Object.fromEntries(cases.map((c) => [c, []]));
  for (let r = 0; r < rounds; r++) {
    if (mode == 'same') {
      const out = await run(r % 2 ? [b, a] : [a, b]);
      for (const c of cases) data[c].push(r % 2 ? [out[c][1], out[c][0]] : out[c]);
    } else {
      const first = r % 2 ? b : a, o1 = await run([first]), o2 = await run([first == a ? b : a]);
      const [oa, ob] = r % 2 ? [o2, o1] : [o1, o2];
      for (const c of cases) data[c].push([oa[c][0], ob[c][0]]);
    }
    for (const c of cases) {
      const [x, y] = data[c][data[c].length - 1];
      if (x.check !== y.check) throw new Error(`A and B give different output on ${c}`);
    }
    process.stderr.write('.');
  }
  process.stderr.write('\n');

  console.log(`${version}, ${mode} process, ${rounds} rounds, ${strings} strings, priority ${prio}${affinity ? `, affinity ${affinity}` : ''}`);
  console.log(`A: ${opt('a')}
B: ${opt('b')}`);
  for (const stat of statName == 'all' ? ['min', 'p25', 'median', 'mean'] : [statName]) {
    console.log(`
${stat} of ${samples} samples of ${sampleMs} ms
| case | A ns/call | B ns/call | B/A | 95% CI | B faster in | A spread |
|---|--:|--:|--:|--:|--:|--:|`);
    for (const c of cases) {
      const rows = data[c].map(([x, y]) => [x[stat], y[stat]]), logs = rows.map(([x, y]) => Math.log(y / x));
      const mean = logs.reduce((t, v) => t + v, 0) / logs.length;
      const sd = Math.sqrt(logs.reduce((t, v) => t + (v - mean) ** 2, 0) / (logs.length - 1 || 1));
      const half = (T95[Math.min(logs.length - 2, 29)] ?? 2) * (sd / Math.sqrt(logs.length));
      const as = rows.map((p) => p[0]), bs = rows.map((p) => p[1]);
      const f = (v) => (v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2));
      const lo = Math.exp(mean - half), hi = Math.exp(mean + half);
      const verdict = hi < 1 ? ' faster' : lo > 1 ? ' slower' : '';
      console.log(`| ${c} | ${f(median(as))} | ${f(median(bs))} | ${Math.exp(mean).toFixed(3)}${verdict} | ${lo.toFixed(3)} to ${hi.toFixed(3)} | ${logs.filter((v) => v < 0).length}/${logs.length} | ${(((Math.max(...as) - Math.min(...as)) / median(as)) * 100).toFixed(1)}% |`);
    }
  }
}

if (args.includes('--worker')) await worker();
else await main();
