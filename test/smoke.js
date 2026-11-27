// Packs the package and installs the tarball with every package manager,
// then runs ESM and CJS consumers, the CLI, TypeScript checks and a browser
// bundle against the installed copy.
//
//   node test/smoke.js [npm pnpm yarn yarn-node-modules yarn-classic bun deno]   (default: all that are installed)
//
// Not part of test/run.js: it needs the package managers and takes a minute.
// Yarn runs through Corepack when it's installed, at the versions below, so
// neither Yarn needs a global install; without Corepack, Yarn 4 comes from
// npx and Yarn 1 from a global `yarn`.
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readdirSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const tsc = join(pkgDir, 'node_modules', 'typescript', 'bin', 'tsc');
// esbuild's bin/esbuild is a JS shim on Windows but the native binary on Linux,
// so `node bin/esbuild` only works on Windows. The JS API works everywhere.
const esbuild = createRequire(join(pkgDir, 'package.json'))('esbuild');
const win = process.platform == 'win32';
const want = process.argv.slice(2);
const s = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
// Optional peers a TypeScript user of /turf and /leaflet would have.
const peers = '@types/leaflet @turf/helpers @types/geojson @types/google.maps';

const run = (cmd, cwd, opts = {}) => {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} (in ${cwd}) failed with ${r.status}:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
const has = (cmd) => spawnSync(cmd, ['--version'], { shell: true, encoding: 'utf8' }).status === 0;
// Corepack asks before its first download of a version, which would hang here.
process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';
const corepack = has('corepack');
const YARN4 = '4.19.0', YARN1 = '1.22.22';
const yarn4 = corepack ? `corepack yarn@${YARN4}` : `npx -y -p @yarnpkg/cli-dist@${YARN4} yarn`;
const yarn1 = corepack ? `corepack yarn@${YARN1}` : 'yarn';

// 1. Pack. prepack builds dist/.
const work = mkdtempSync(join(tmpdir(), 'polytini-smoke-'));
run(`npm pack --pack-destination "${work}"`, pkgDir);
const tarball = join(work, readdirSync(work).find((f) => f.endsWith('.tgz'))).replace(/\\/g, '/');
console.log(`packed ${tarball}`);

// Consumers, written into each project.
const esm = `
import { encode, decode, decodeFlat, toGeoJSON, PolylineError } from '@duoquote/polytini';
import { toFeature } from '@duoquote/polytini/turf';
import { osrm6 } from '@duoquote/polytini/presets';
import { init, decode as wdecode } from '@duoquote/polytini/wasm';
import * as flex from '@duoquote/polytini/flexible';
import { PolylineDecoder, DecodeStream, PolylineError as StreamError } from '@duoquote/polytini/stream';
const pts = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
const ok = (c, m) => { if (!c) throw new Error(m); };
const sd = new PolylineDecoder();
ok(sd.write(${JSON.stringify(s.slice(0, 9))}).length + sd.write(${JSON.stringify(s.slice(9))}).length === 3 && sd.end().length === 0, 'stream');
let batches = 0;
for await (const b of new Response(${JSON.stringify(s)}).body.pipeThrough(new DecodeStream())) batches += b.length;
ok(batches === 3, 'DecodeStream');
ok(StreamError === PolylineError, 'one PolylineError class');
ok(encode(pts) === ${JSON.stringify(s)}, 'encode');
ok(JSON.stringify(decode(${JSON.stringify(s)})) === JSON.stringify(pts), 'decode');
ok(decodeFlat(${JSON.stringify(s)}).length === 6, 'decodeFlat');
ok(toGeoJSON(${JSON.stringify(s)}).type === 'LineString', 'geojson');
ok(toFeature(${JSON.stringify(s)}).type === 'Feature', 'turf');
ok(osrm6.precision === 6, 'presets');
await init();
ok(wdecode(${JSON.stringify(s)}).length === 3, 'wasm');
ok(flex.decode(flex.encode({ polyline: pts })).polyline.length === 3, 'flexible');
try { decode('_p~iF~ps|U_ulLnnq'); ok(false, 'strict'); } catch (e) { ok(e instanceof PolylineError && e.code === 'truncated', 'error'); }
console.log('esm ok', import.meta.resolve?.('@duoquote/polytini').split('/').slice(-2).join('/'));
`;
const cjs = `
const { encode, decode, PolylineError } = require('@duoquote/polytini');
const { toFeature } = require('@duoquote/polytini/turf');
const presets = require('@duoquote/polytini/presets');
const { PolylineEncoder } = require('@duoquote/polytini/stream');
const ok = (c, m) => { if (!c) throw new Error(m); };
const se = new PolylineEncoder();
ok(se.write([38.5, -120.2]) + se.write([[40.7, -120.95], [43.252, -126.453]]) + se.end() === ${JSON.stringify(s)}, 'stream');
ok(encode([[38.5, -120.2]]) === '_p~iF~ps|U', 'encode');
ok(decode(${JSON.stringify(s)}).length === 3, 'decode');
ok(toFeature(${JSON.stringify(s)}).geometry.coordinates.length === 3, 'turf');
ok(presets.valhalla.precision === 6, 'presets');
try { decode('!'); } catch (e) { ok(e.name === 'PolylineError' && e.code === 'char', 'error'); }
console.log('cjs ok', require.resolve('@duoquote/polytini').split(/[\\\\/]/).slice(-2).join('/'));
`;
const ts = `
import { encode, decode, type Options, type Point, PolylineError } from '@duoquote/polytini';
import { toFeature, fromGeoJSON } from '@duoquote/polytini/turf';
import { osrm6 } from '@duoquote/polytini/presets';
import { init, decodeFlat } from '@duoquote/polytini/wasm';
import { install } from '@duoquote/polytini/leaflet';
import * as flex from '@duoquote/polytini/flexible';
import { decodePath, encodePath } from '@duoquote/polytini/google';
import { PolylineDecoder, DecodeStream } from '@duoquote/polytini/stream';
const streamed: Point[] = new PolylineDecoder().write('??');
const flatStream: Float64Array = new PolylineDecoder({ flat: true }).write('??');
const ds: TransformStream = new DecodeStream(6);
export { streamed, flatStream, ds };
const literals = decodePath('??', { LatLng: false });
const back: string = encodePath(literals);
const o: Options = { precision: 6, order: 'lnglat', strict: false };
const p: Point[] = decode('', o);
const s: string = encode(p, osrm6);
const f = toFeature(s, { properties: { a: 1 } });
const n: number = f.properties.a;
const strs: string[] = fromGeoJSON(f);
await init();
const flat: Float64Array = decodeFlat(s);
const L = install({ Polyline: class {}, Polygon: class {} });
const d = flex.decode(flex.encode({ polyline: [[1, 2]] }));
const e: PolylineError['code'] = 'truncated';
export { p, s, n, strs, flat, L, d, e, back };
`;
const cts = `
import polytini = require('@duoquote/polytini');
const s: string = polytini.encode([[1, 2]]);
export = s;
`;
const browser = `import { decode } from '@duoquote/polytini'; console.log(decode('??'));`;

function project(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'smoke', version: '1.0.0', private: true, type: 'module' }, null, 2));
  writeFileSync(join(dir, 'esm.mjs'), esm);
  writeFileSync(join(dir, 'cjs.cjs'), cjs);
  writeFileSync(join(dir, 'types.ts'), ts);
  writeFileSync(join(dir, 'types.cts'), cts);
  writeFileSync(join(dir, 'browser.js'), browser);
  const tsconfig = (resolution) => ({
    compilerOptions: { strict: true, noEmit: true, skipLibCheck: false, target: 'es2022', lib: ['es2022', 'dom'], types: [], module: resolution == 'bundler' ? 'esnext' : 'node16', moduleResolution: resolution },
    files: resolution == 'bundler' ? ['types.ts'] : ['types.ts', 'types.cts'],
  });
  writeFileSync(join(dir, 'tsconfig.node16.json'), JSON.stringify(tsconfig('node16')));
  writeFileSync(join(dir, 'tsconfig.bundler.json'), JSON.stringify(tsconfig('bundler')));
}

// The checks each package manager gets. `bin` runs the CLI the way that
// manager's users would; `node` runs the consumers.
function checks(name, dir, { bin, node = 'node', types = true, resolveFrom = dir }) {
  const lines = [];
  lines.push(run(`${node} esm.mjs`, dir).trim());
  lines.push(run(`${node} cjs.cjs`, dir).trim());
  // Through stdin: shells quote backticks and backslashes differently.
  const out = run(`${bin} decode`, dir, { input: s }).trim();
  if (out != '[[38.5,-120.2],[40.7,-120.95],[43.252,-126.453]]') throw new Error(`${name} cli: ${out}`);
  lines.push(`cli ok (${run(`${bin} --version`, dir).trim()})`);
  if (types) {
    run(`node "${tsc}" -p tsconfig.node16.json`, resolveFrom);
    run(`node "${tsc}" -p tsconfig.bundler.json`, resolveFrom);
    lines.push('types ok (node16, bundler)');
  }
  esbuild.buildSync({
    absWorkingDir: dir, entryPoints: ['browser.js'], bundle: true, format: 'esm',
    platform: 'browser', outfile: 'out.js', logLevel: 'warning',
  });
  const bundled = readFileSync(join(dir, 'out.js'), 'utf8');
  if (/node:buffer|ucs2Write/.test(bundled)) throw new Error(`${name}: browser bundle pulled in the node entry`);
  lines.push('browser bundle ok (web entry, no Node globals)');
  return lines;
}

// A Yarn 4 project with the given linker and the tarball installed.
function yarnProject(name, linker, extra = '') {
  const dir = join(work, name);
  project(dir);
  writeFileSync(join(dir, '.yarnrc.yml'), `nodeLinker: ${linker}\nenableGlobalCache: false\n`);
  writeFileSync(join(dir, 'yarn.lock'), '');
  run(`${yarn4} add "@duoquote/polytini@file:${tarball}" ${extra}`, dir);
  return dir;
}

// The bin the other ways Yarn 4 users run it: `yarn exec`, and `yarn dlx`
// from the tarball, which installs it into a temporary project of its own.
function yarnBins(dir) {
  const want = 'kviyHviWkCbkBsg@guA';
  const exec = run(`${yarn4} exec polytini encode 51.5007,-0.1246 51.5014,-0.1419 51.5079,-0.1281`, dir).trim();
  if (exec != want) throw new Error(`yarn exec polytini: ${exec}`);
  const dlx = run(`${yarn4} dlx -q -p "@duoquote/polytini@file:${tarball}" polytini decode "${want}"`, work).trim();
  if (dlx != '[[51.5007,-0.1246],[51.5014,-0.1419],[51.5079,-0.1281]]') throw new Error(`yarn dlx: ${dlx}`);
  return [`Yarn ${run(`${yarn4} --version`, dir).trim()}`, 'yarn exec polytini ok', 'yarn dlx from the tarball ok'];
}

const managers = {
  npm: () => {
    const dir = join(work, 'npm');
    project(dir);
    run(`npm install --no-audit --no-fund "${tarball}" ${peers}`, dir);
    return checks('npm', dir, { bin: 'npx --no-install polytini' });
  },
  pnpm: () => {
    const dir = join(work, 'pnpm');
    project(dir);
    // The default isolated layout: only declared dependencies are visible.
    run(`pnpm add "${tarball}" ${peers} --config.node-linker=isolated`, dir);
    return checks('pnpm', dir, { bin: 'pnpm exec polytini' });
  },
  yarn: () => {
    // Yarn 4 (berry) with Plug'n'Play: no node_modules at all.
    const dir = yarnProject('yarn', 'pnp');
    // Under PnP, node needs Yarn's loader: `yarn node` sets it up. TypeScript
    // can't read PnP without its patched build, so types are checked by the
    // other managers.
    const lines = checks('yarn', dir, { bin: `${yarn4} polytini`, node: `${yarn4} node`, types: false });
    return [...lines, ...yarnBins(dir)];
  },
  'yarn-node-modules': () => {
    // Yarn 4 with a node_modules folder, the linker most projects moving from Yarn 1 pick.
    const dir = yarnProject('yarn-node-modules', 'node-modules', peers);
    return [...checks('yarn-node-modules', dir, { bin: `${yarn4} polytini` }), ...yarnBins(dir)];
  },
  'yarn-classic': () => {
    const dir = join(work, 'yarn-classic');
    project(dir);
    const version = run(`${yarn1} --version`, dir).trim();
    if (!version.startsWith('1.')) throw new Error(`expected Yarn 1, got ${version}`);
    run(`${yarn1} add "file:${tarball}" ${peers} --no-lockfile`, dir);
    const lines = checks('yarn-classic', dir, { bin: `${yarn1} --silent polytini` });
    const out = run(`${yarn1} --silent run polytini encode 38.5,-120.2`, dir).trim();
    if (out != '_p~iF~ps|U') throw new Error(`yarn run polytini: ${out}`);
    return [`Yarn ${version}`, ...lines, 'yarn run polytini ok'];
  },
  bun: () => {
    const dir = join(work, 'bun');
    project(dir);
    run(`bun add "${tarball}" ${peers}`, dir);
    const lines = checks('bun', dir, { bin: 'bun x polytini', node: 'bun' });
    lines.push(run('bun esm.mjs', dir).trim().replace('esm ok', 'esm ok under bun'));
    return lines;
  },
  deno: () => {
    // npm: specifier, resolved from a local node_modules installed from the
    // tarball. The JSR side is checked with `deno publish --dry-run` (the
    // package isn't published, so jsr: imports can't resolve yet).
    const dir = join(work, 'deno');
    project(dir);
    run(`npm install --no-audit --no-fund "${tarball}"`, dir);
    writeFileSync(join(dir, 'deno.json'), JSON.stringify({ nodeModulesDir: 'manual' }));
    writeFileSync(join(dir, 'npm-spec.mjs'), `import { decode } from 'npm:@duoquote/polytini'; if (decode(${JSON.stringify(s)}).length !== 3) throw new Error('x'); console.log('npm: specifier ok', import.meta.resolve('npm:@duoquote/polytini').split('/').slice(-2).join('/'));`);
    const lines = [run('deno run -A esm.mjs', dir).trim().replace('esm ok', 'esm ok under deno'), run('deno run -A npm-spec.mjs', dir).trim()];
    const out = run('deno run -A node_modules/@duoquote/polytini/src/cli.js decode', dir, { input: s }).trim();
    if (!out.startsWith('[[38.5')) throw new Error(`deno cli: ${out}`);
    lines.push('cli ok under deno');
    run('deno publish --dry-run --allow-dirty', pkgDir);
    lines.push('deno publish --dry-run ok (JSR)');
    return lines;
  },
};

const results = {};
let failed = 0;
for (const [name, fn] of Object.entries(managers)) {
  if (want.length && !want.includes(name)) continue;
  const tool = name.startsWith('yarn') ? (corepack ? 'corepack' : name == 'yarn-classic' ? 'yarn' : 'npx') : name;
  if (!has(tool)) {
    results[name] = ['skipped: not installed'];
    continue;
  }
  try {
    results[name] = fn();
  } catch (e) {
    failed++;
    results[name] = [`FAILED: ${e.message.split('\n').slice(0, 8).join('\n  ')}`];
  }
  console.log(`\n${name}:\n  ${results[name].join('\n  ')}`);
}
rmSync(work, { recursive: true, force: true });
console.log(`\n${Object.keys(results).length - failed} of ${Object.keys(results).length} package managers passed`);
if (failed) process.exitCode = 1;
