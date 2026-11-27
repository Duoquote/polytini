// The CLI: run() directly, then the real command in a subprocess.
import { test, eq, ok, throws, json } from './lib.js';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, command, lineOf, VERSION } from '../src/cli-lib.js';
import { decode as decodeAll, encode as encodeAll } from '../src/web.js';
import { benchFixtures } from './bench-fixtures.js';

const s = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const pts = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const runtime = globalThis.Deno ? [Deno.execPath(), ['run', '-A', cli]] : [process.execPath, [cli]];
const sh = (args, input) => spawnSync(runtime[0], [...runtime[1], ...args], { input, encoding: 'utf8', maxBuffer: 1 << 26 });

test('version matches package.json and jsr.json', async () => {
  eq(VERSION, (await json('../package.json')).version);
  eq(VERSION, (await json('../jsr.json')).version);
  eq(run(['--version']), VERSION);
  eq(run(['-v']), VERSION);
});

test('help', () => {
  const h = run(['--help']);
  ok(h.startsWith(`polytini ${VERSION}`) && h.includes('--precision') && h.includes('--lnglat') && h.includes('--no-strict'));
  eq(run(['-h']), h);
});

test('decode formats', () => {
  eq(run(['decode', s]), JSON.stringify(pts));
  eq(run(['decode', s, '-f', 'json']), JSON.stringify(pts));
  eq(JSON.parse(run(['decode', s, '--format=geojson'])), { type: 'LineString', coordinates: pts.map(([a, b]) => [b, a]) });
  eq(run(['decode', s, '-f', 'csv']), 'lat,lng\n38.5,-120.2\n40.7,-120.95\n43.252,-126.453');
  eq(run(['decode', s, '-f', 'csv', '--lnglat']), 'lng,lat\n-120.2,38.5\n-120.95,40.7\n-126.453,43.252');
  eq(run(['decode', s, '-f', 'lines']), '38.5,-120.2\n40.7,-120.95\n43.252,-126.453');
  eq(run(['decode', '']), '[]');
});

test('decode several lines', () => {
  const two = `${s}\n\n${s}\n`;
  eq(JSON.parse(run(['decode'], () => two)), [pts, pts]);
  eq(JSON.parse(run(['decode', '-f', 'geojson'], () => two)).features.length, 2);
  ok(run(['decode', '-f', 'csv'], () => two).startsWith('line,lat,lng\n0,38.5,-120.2'));
});

test('decode precision and strictness', () => {
  const s6 = run(['encode', JSON.stringify(pts), '-p', '6']);
  eq(run(['decode', s6, '--precision', '6']), JSON.stringify(pts));
  eq(run(['decode', s6, '--precision=6']), JSON.stringify(pts));
  throws(() => run(['decode', s.slice(0, -1)]), 'truncated');
  eq(run(['decode', s.slice(0, -1), '--no-strict']), JSON.stringify(pts.slice(0, 2)));
});

test('encode inputs', () => {
  eq(run(['encode', JSON.stringify(pts)]), s);
  eq(run(['encode', JSON.stringify(pts.map(([a, b]) => [b, a])), '--lnglat']), s);
  eq(run(['encode', JSON.stringify([pts, pts.slice(0, 1)])]), `${s}\n_p~iF~ps|U`);
  eq(run(['encode'], () => '38.5,-120.2\n40.7,-120.95\n43.252,-126.453\n'), s);
  eq(run(['encode'], () => '38.5 -120.2\n40.7\t-120.95\n43.252; -126.453'), s);
  eq(run(['encode'], () => 'name,lon,lat\na,-120.2,38.5\nb,-120.95,40.7\nc,-126.453,43.252'), s);
  eq(run(['encode'], () => '"Latitude","Longitude"\n38.5,-120.2\n40.7,-120.95\n43.252,-126.453'), s);
  const line = { type: 'LineString', coordinates: pts.map(([a, b]) => [b, a]) };
  eq(run(['encode', JSON.stringify(line)]), s);
  eq(run(['encode', JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: line }, { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [line.coordinates] } }] })]), `${s}\n${s}`);
  eq(run(['encode', '']), '');
  const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
  eq(run(['encode', JSON.stringify({ type: 'Polygon', coordinates: [ring] })]).split('\n').length, 1);
  eq(run(['encode', JSON.stringify({ type: 'MultiPolygon', coordinates: [[ring], [ring]] })]).split('\n').length, 2);
  eq(run(['encode', JSON.stringify({ type: 'GeometryCollection', geometries: [line, line] })]), `${s}\n${s}`);
  ok(run(['encode', JSON.stringify([[1, 2]]), '--lnglat']) == run(['encode', JSON.stringify([[2, 1]])]));
});

test('errors', () => {
  for (const args of [[], ['frob'], ['decode', '--frob'], ['decode', '-p'], ['decode', 'a', '-'], ['decode', 'a', '--file', 'x'], ['encode', '1,2', '3'], ['encode', 'a,b'], ['decode', '--skip-errors', 'a'], ['decode', '--lines', '--field', 'g', '-f', 'csv', 'a'], ['decode', s, '-f', 'xml']]) {
    let e;
    try {
      run(args);
    } catch (x) {
      e = x;
    }
    ok(e && !e.code, `${args.join(' ')} should be a usage error`);
  }
  throws(() => run(['encode', '[[1, 2], [3]]']), 'coordinate');
  throws(() => run(['encode', 'name,x\n1,2']), undefined);
  throws(() => run(['decode', s, '-p', '99']), 'option');
});

test('the real command: argument, stdin, file and exit codes', () => {
  let r = sh(['decode', s]);
  eq([r.status, r.stdout], [0, JSON.stringify(pts) + '\n'], r.stderr);
  r = sh(['encode'], JSON.stringify(pts));
  eq([r.status, r.stdout], [0, s + '\n'], r.stderr);
  const dir = mkdtempSync(join(tmpdir(), 'polytini-'));
  try {
    writeFileSync(join(dir, 'in.txt'), s + '\n');
    r = sh(['decode', '--file', join(dir, 'in.txt'), '-f', 'lines']);
    eq([r.status, r.stdout], [0, '38.5,-120.2\n40.7,-120.95\n43.252,-126.453\n'], r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  r = sh(['decode', 'ab!']);
  eq(r.status, 1);
  ok(r.stderr.includes('Invalid character at 2'), r.stderr);
  r = sh(['nope']);
  eq(r.status, 2);
  ok(r.stderr.includes('--help'));
  r = sh(['--version']);
  eq(r.stdout.trim(), VERSION);
});

// What 0.1.4 printed for decoded lines, before the output was streamed.
function oldFormat(lines, fmt, order) {
  const [a, b] = order == 'lnglat' ? ['lng', 'lat'] : ['lat', 'lng'];
  const many = lines.length > 1;
  if (fmt == 'json') return JSON.stringify(many ? lines : lines[0]);
  if (fmt == 'geojson') {
    const geo = (l) => ({ type: 'LineString', coordinates: order == 'lnglat' ? l : l.map(([x, y]) => [y, x]) });
    return JSON.stringify(many ? { type: 'FeatureCollection', features: lines.map((l) => ({ type: 'Feature', properties: {}, geometry: geo(l) })) } : geo(lines[0]));
  }
  if (fmt == 'csv') return [many ? `line,${a},${b}` : `${a},${b}`, ...lines.flatMap((l, i) => l.map((p) => (many ? `${i},` : '') + p.join(',')))].join('\n');
  return lines.map((l) => l.map((p) => p.join(',')).join('\n')).join('\n\n');
}
const london = 'kviyHviWkCbkBsg@guA';
const lpts = [[51.5007, -0.1246], [51.5014, -0.1419], [51.5079, -0.1281]];

// The command fed in chunks of the given sizes, the way main() feeds it.
function chunked(argv, input, sizes) {
  const c = command(argv), parts = [];
  const m = c.make((x) => parts.push(x), () => {});
  for (let i = 0, k = 0; i < input.length; k++) m.push(input.slice(i, (i += sizes[k % sizes.length])));
  m.end();
  return parts.join('').replace(/\n$/, '');
}

test('decode output is what 0.1.4 printed, in any chunks', () => {
  const inputs = ['', '\n\n', london, `${london}\n`, `  ${london} \r\n`, `${s}\n\n${london}\r\n${s}`, `\n ${london}\n\n\t${s}\n`, '?', `${s}\n??`];
  for (const input of inputs)
    for (const fmt of ['json', 'geojson', 'csv', 'lines'])
      for (const [order, strict] of [['latlng', true], ['lnglat', true], ['latlng', false]]) {
        const argv = ['decode', '-f', fmt, ...(order == 'lnglat' ? ['--lnglat'] : []), ...(strict ? [] : ['--no-strict'])];
        const strs = input.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        let want;
        try {
          want = oldFormat(strs.length ? strs.map((x) => decodeAll(x, { order, strict })) : [[]], fmt, order);
        } catch (e) {
          throws(() => run(argv, () => input), e.code);
          throws(() => chunked(argv, input, [1]), e.code);
          continue;
        }
        eq(run(argv, () => input), want, `${JSON.stringify(input)} ${fmt} ${order}`);
        for (const sizes of [[1], [2, 5], [7, 1, 3]]) eq(chunked(argv, input, sizes), want, `${JSON.stringify(input)} ${fmt} ${order} in chunks of ${sizes}`);
      }
});

test('decode errors in chunks name the line', () => {
  for (const sizes of [[1], [3], [100]]) {
    let e = throws(() => chunked(['decode'], `${london}\n\n${s.slice(0, -1)}\n`, sizes), 'truncated');
    eq([e.index, lineOf.get(e)], [26, 3]);
    e = throws(() => chunked(['decode'], `${london} x${s}`, sizes), 'char');
    eq([e.index, lineOf.get(e)], [19, undefined]);
  }
  eq(run(['decode', '--no-strict'], () => `${london} !${london}`), JSON.stringify(decodeAll(london + london, { strict: false })));
});

test('encode takes lat,lng pairs as arguments, in any shell', () => {
  eq(run(['encode', '51.5007,-0.1246', '51.5014,-0.1419', '51.5079,-0.1281']), london);
  // What PowerShell passes on for an unquoted 51.5007,-0.1246 through a .ps1 shim.
  eq(run(['encode', '51.5007 -0.1246', '51.5014 -0.1419', '51.5079 -0.1281']), london);
  eq(run(['encode', '--lnglat', '-0.1246,51.5007', '-0.1419,51.5014', '-0.1281,51.5079']), london);
  eq(run(['encode', '-p', '6', '--', '-0.1246,51.5007']), encodeAll([[-0.1246, 51.5007]], 6));
  eq(run(['encode', '51.5007;-0.1246']), encodeAll([lpts[0]]));
  eq(run(['decode', london, s]), JSON.stringify([lpts, pts]));
});

test('- and --file - read stdin', () => {
  eq(run(['decode', '-'], () => london), JSON.stringify(lpts));
  eq(run(['decode', '--file', '-'], () => london), JSON.stringify(lpts));
  eq(run(['encode', '-'], () => '51.5007,-0.1246\n51.5014,-0.1419\n51.5079,-0.1281'), london);
});

test('--lines: one result per line', () => {
  const input = `${london}\n\n  ${s}\r\n`;
  eq(run(['decode', '--lines'], () => input), `${JSON.stringify(lpts)}\n${JSON.stringify(pts)}`);
  eq(run(['decode', '--lines', '-f', 'geojson'], () => input).split('\n').map((l) => JSON.parse(l).coordinates[0]), [[-0.1246, 51.5007], [-120.2, 38.5]]);
  eq(run(['decode', '--lines', '-f', 'csv'], () => input).split('\n').slice(0, 2), ['line,lat,lng', '0,51.5007,-0.1246']);
  eq(run(['decode', '--lines', '-f', 'lines'], () => input), '51.5007,-0.1246 51.5014,-0.1419 51.5079,-0.1281\n38.5,-120.2 40.7,-120.95 43.252,-126.453');
  const geo = JSON.stringify({ type: 'Feature', geometry: { type: 'LineString', coordinates: lpts.map(([a, b]) => [b, a]) } });
  eq(run(['encode', '--lines'], () => `${JSON.stringify(lpts)}\n51.5007,-0.1246 51.5014,-0.1419 51.5079,-0.1281\n${geo}\n`), `${london}\n${london}\n${london}`);
  eq(chunked(['decode', '--lines'], input, [1]), run(['decode', '--lines'], () => input));
  const nd = `{"id":1,"shape":"${london}"}\n{"id":2,"shape":"${s}"}\n`;
  const decoded = run(['decode', '--field', 'shape'], () => nd);
  eq(decoded.split('\n').map((l) => JSON.parse(l)), [{ id: 1, shape: lpts }, { id: 2, shape: pts }]);
  eq(run(['encode', '--field', 'shape'], () => decoded), nd.trim());
  eq(JSON.parse(run(['decode', '--field', 'shape', '-f', 'geojson'], () => nd).split('\n')[0]).shape.type, 'LineString');
  // A bad line stops the command, or with --skip-errors is reported and left out.
  const e = throws(() => run(['decode', '--lines'], () => `${london}\n!\n${s}`), 'char');
  eq(lineOf.get(e), 2);
  const quiet = () => {};
  eq(run(['decode', '--lines', '--skip-errors'], () => `${london}\n!\n{\n${s}`, quiet),`${JSON.stringify(lpts)}\n${JSON.stringify(pts)}`);
  const multi = JSON.stringify({ type: 'MultiLineString', coordinates: [[[1, 2]], [[3, 4]]] });
  eq(run(['encode', '--lines', '--skip-errors'], () => `[[1,2]]\n[[NaN]]\n1,2,3\n${multi}\n[[1,2]]`, quiet),`${encodeAll([[1, 2]])}\n${encodeAll([[1, 2]])}`);
  throws(() => run(['decode', '--field', 'shape'], () => '{"id":1}'), 'input');
  throws(() => run(['decode', '--field', 'shape'], () => '7'), 'input');
});

test('the real command streams big input in chunks, through stdin and --file', () => {
  const long = benchFixtures(5).find((f) => f.name == '100,000 pts');
  const str = long.encoded[0], want = JSON.stringify(long.coords[0]);
  let r = sh(['decode'], str + '\n');
  eq([r.status, r.stdout.length, r.stdout == want + '\n'], [0, want.length + 1, true], r.stderr);
  const dir = mkdtempSync(join(tmpdir(), 'polytini-'));
  try {
    writeFileSync(join(dir, 'big.txt'), `${str}\n${london}\n`);
    r = sh(['decode', '--file', join(dir, 'big.txt')]);
    eq([r.status, r.stdout == JSON.stringify([long.coords[0], lpts]) + '\n'], [0, true], r.stderr);
    r = sh(['decode', '--lines', '-f', 'geojson', '--file', join(dir, 'big.txt')]);
    eq([r.status, r.stdout.split('\n').length], [0, 3], r.stderr);
    writeFileSync(join(dir, 'pts.csv'), 'lat,lng\n' + long.coords[0].map((p) => p.join(',')).join('\n'));
    r = sh(['encode', '--file', join(dir, 'pts.csv')]);
    eq([r.status, r.stdout == str + '\n'], [0, true], r.stderr);
    r = sh(['encode', '-'], long.coords[0].map((p) => p.join(' ')).join('\r\n'));
    eq([r.status, r.stdout == str + '\n'], [0, true], r.stderr);
    // A bad line after the first megabyte of output: what came before stays.
    writeFileSync(join(dir, 'bad.txt'), `${str}\n${str}\n!\n`);
    r = sh(['decode', '--lines', '--file', join(dir, 'bad.txt')]);
    eq([r.status, r.stdout.split('\n').length, r.stderr.includes('line 3: Invalid character at 0')], [1, 3, true], r.stderr);
    r = sh(['decode', '--file', join(dir, 'missing.txt')]);
    eq([r.status, /^polytini: ENOENT/.test(r.stderr)], [1, true], r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  r = sh(['decode', `${london}x`]);
  eq([r.status, r.stdout], [1, ''], r.stderr);
  r = sh(['encode', '51.5007,-0.1246', '51.5014,-0.1419', '51.5079,-0.1281']);
  eq([r.status, r.stdout], [0, london + '\n'], r.stderr);
});
