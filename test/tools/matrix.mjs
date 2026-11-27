// Which file each bundler, test runner and type checker takes from the packed
// package, and whether the result runs. Packs the package, installs the
// tarball here, builds or runs a tiny consumer per check and prints the file
// the tool picked or the error.
//
//   npm install --prefix test/tools                 every tool (Electron too)
//   node test/tools/matrix.mjs                      every check
//   node test/tools/matrix.mjs --quick              what CI runs: Jest, Parcel, Metro, TypeScript, identity on this Node, the IIFE
//   node test/tools/matrix.mjs jest                 only checks whose name contains "jest"
//   node test/tools/matrix.mjs --runtimes "node@22.0.0 node@22.11.0 node@22.12.0 node@24 bun deno"
//   node test/tools/matrix.mjs --cdn 0.1.5          the published version from esm.sh, jsDelivr and unpkg in Chrome
//
// --quick only needs `npm install --prefix test/tools --omit=dev`. Exits 1 if
// a check fails or picks a different file than it should. The CDN checks
// need the version on npm and a Chrome (CHROME=<path>, or playwright's).
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync, readdirSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const quick = flag('--quick');
const only = args.find((a, i) => !a.startsWith('--') && !['--runtimes', '--cdn', '--tarball'].includes(args[i - 1]));
const work = join(here, 'work');
const sh = (cmd, { cwd = here, env = {}, input } = {}) => {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 300000, input });
  return { ok: r.status === 0, out: (r.stdout ?? '') + (r.stderr ?? '') };
};
const bin = (n) => `node "${join(here, 'node_modules', n)}"`;
const w = (name, text) => (mkdirSync(dirname(join(work, name)), { recursive: true }), writeFileSync(join(work, name), text));
const err = (out) => (out.replace(/\x1b\[[0-9;]*m/g, '').match(/(Error|error|ERR_)[^\n]{0,160}/) ?? [out.slice(-200)])[0].trim();
// Which polytini entry a bundle holds, from its text.
const picked = (code) => {
  code = code.replace(/AGFzbQ[A-Za-z0-9+/=]*/g, '');
  if (/allocUnsafeSlow|utf8Write/.test(code)) return 'node entry (Buffer)';
  if (/fromCharCodeArray|polytini\.wasm|instantiate\(/.test(code)) return 'wasm';
  if (/new TextDecoder\(["']latin1/.test(code)) return 'browser entry (TextDecoder)';
  if (/charCodeAt/.test(code)) return 'web entry (core)';
  return '?';
};

async function matrix() {
  // Pack and install, the way a user gets the package.
  // --tarball <file> checks that package instead, for a before and after.
  const tmp = mkdtempSync(join(tmpdir(), 'polytini-matrix-'));
  if (!opt('--tarball')) {
    const pack = sh(`npm pack --pack-destination "${tmp}"`, { cwd: repo });
    if (!pack.ok) throw new Error(pack.out);
  }
  const tgz = (opt('--tarball') ?? join(tmp, readdirSync(tmp).find((f) => f.endsWith('.tgz')))).replace(/\\/g, '/');
  const inst = sh(`npm install --no-save --no-audit --no-fund ${quick ? '--omit=dev ' : ''}"${tgz}"`);
  if (!inst.ok) throw new Error(inst.out);
  rmSync(tmp, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const version = JSON.parse(readFileSync(join(here, 'node_modules/@duoquote/polytini/package.json'), 'utf8')).version;

  const esmUse = `import { encode, decode, PolylineError } from '@duoquote/polytini';
import { toFeature } from '@duoquote/polytini/turf';
if (encode([[38.5, -120.2]]) !== '_p~iF~ps|U' || decode('_p~iF~ps|U').length !== 1 || toFeature('??').type !== 'Feature') throw new Error('wrong result');
let e; try { decode('!'); } catch (x) { e = x; }
if (!(e instanceof PolylineError)) throw new Error('not a PolylineError');
console.log('RESULT ok');
`;
  const cjsUse = esmUse.replace(/import \{([^}]+)\} from ('[^']+');/g, (_, names, mod) => `const {${names}} = require(${mod});`);
  const wasmUse = `import { init, decodeMany } from '@duoquote/polytini/wasm';
await init();
if (decodeMany(['_p~iF~ps|U']).coords.length !== 2) throw new Error('wasm');
console.log('RESULT ok');
`;
  const noRun = (s) => s.replace("console.log('RESULT ok');", '');

  // [name, run, expected (a regexp the result has to match), in --quick]
  const checks = [
    ['jest cjs (node env)', () => jest('jest', 'node', `test('polytini', () => { ${noRun(cjsUse)} console.log('PICKED ' + require.resolve('@duoquote/polytini')); });`), /^ok, dist\/node\.cjs/, true],
    ['jest cjs (jsdom env)', () => jest('jestdom', 'jsdom', `test('polytini', () => { ${noRun(cjsUse)} console.log('PICKED ' + require.resolve('@duoquote/polytini')); });`), /^ok, dist\/web\.cjs/, true],
    ['jest cjs require /wasm', () => jest('jestw', 'node', `test('wasm', async () => { const { init, decodeMany } = require('@duoquote/polytini/wasm'); await init(); expect(decodeMany(['_p~iF~ps|U']).coords.length).toBe(2); console.log('PICKED ' + require.resolve('@duoquote/polytini/wasm')); });`), /^ok, dist\/wasm\.cjs/, true],
    ['jest esm (vm modules)', () => jest('jestesm', 'node', `import { test, expect } from '@jest/globals';\n${noRun(esmUse)}\ntest('ok', () => expect(1).toBe(1));`, { NODE_OPTIONS: '--experimental-vm-modules' }, 'mjs'), /^ok/, true],
    ['vitest', () => vitest('vitest', `import { test } from 'vitest';\n${noRun(esmUse)}\nimport { init, decodeMany } from '@duoquote/polytini/wasm';\ntest('ok', async () => { await init(); if (decodeMany(['??']).coords.length !== 2) throw new Error('wasm'); });`), /^ok/],
    ['vitest jsdom', () => vitest('vitestdom', `// @vitest-environment jsdom\nimport { test } from 'vitest';\n${noRun(esmUse)}\ntest('ok', () => {});`), /^ok/],
    ['webpack web', () => webpack('web', esmUse), /^ok, browser entry/],
    ['webpack node', () => webpack('node', esmUse), /^ok, node entry/],
    ['webpack web (require)', () => webpack('web', cjsUse, 'cjs'), /^ok, browser entry/],
    ['webpack web /wasm', () => webpack('web', wasmUse, 'wasm'), /^ok, wasm/],
    ['rollup + node-resolve (browser)', () => rollup(true, esmUse), /^ok, browser entry/],
    ['rollup + node-resolve (default)', () => rollup(false, esmUse), /^ok, web entry/],
    ['esbuild browser', () => esbuild('browser', esmUse), /^ok, browser entry/],
    ['esbuild node', () => esbuild('node', esmUse), /^ok, node entry/],
    ['esbuild neutral', () => esbuild('neutral', esmUse), /^ok, web entry/],
    ['vite build', () => vite(esmUse + noRun(wasmUse).replace('await init();', 'init().then(() => {') + "console.log('RESULT ok'); });"), /^ok/],
    ['parcel build', () => parcel(esmUse), /^ok, browser entry/, true],
    ['metro (react-native, android)', () => metro('android'), /^ok, src\/web\.js/, true],
    ['metro (react-native, android, require)', () => metro('android', false), /^ok, src\/web\.js/, true],
    ['metro (react-native, no package exports)', () => metro('android', true, false), /^ok, src\/web\.js/, true],
    ['metro (web platform)', () => metro('web'), /^ok, src\/browser\.js/, true],
    ['metro (web platform, require)', () => metro('web', false), /^ok, dist\/web\.cjs/, true],
    ['ts node10', () => ts('node10'), /^5\.9: ok; 6\.0: ok; 7: n\/a/, true],
    ['ts node16', () => ts('node16'), /^5\.9: ok; 6\.0: ok; 7: ok$/, true],
    ['ts bundler', () => ts('bundler'), /^5\.9: ok; 6\.0: ok; 7: ok$/, true],
    ['ts classic (removed in TS 6, not fixable)', () => ts('classic'), /./],
    [`identity (node ${process.versions.node})`, () => identity('node'), /"sameErrorClass":true.*"wasmRequire":"function"/, true],
    ['iife global', () => iife(), /^ok/, true],
    ['electron main', () => electron(), /"sameErrorClass":true/],
  ];
  for (const r of (opt('--runtimes') ?? '').split(/\s+/).filter(Boolean)) checks.push([`identity (${r})`, () => identity(r), /./]);

  console.log(`@duoquote/polytini ${version}, ${quick ? 'quick' : 'all'} checks`);
  let bad = 0;
  const results = {};
  for (const [name, fn, expect, inQuick] of checks) {
    if (quick && !inQuick) continue;
    if (only && !name.includes(only)) continue;
    let r;
    try {
      r = fn();
    } catch (e) {
      r = 'FAIL ' + e.message.split('\n')[0];
    }
    const good = expect.test(r);
    if (!good) bad++;
    results[name] = r;
    console.log(`${good ? '   ' : 'XX '}${name.padEnd(42)} ${r}`);
  }
  writeFileSync(join(here, 'matrix.json'), JSON.stringify({ version, results }, null, 1) + '\n');
  if (bad) {
    console.error(`${bad} check${bad == 1 ? '' : 's'} failed or picked an unexpected file (marked XX)`);
    process.exitCode = 1;
  }

  function jest(dir, env, test, extraEnv = {}, ext = 'js') {
    w(`${dir}/a.test.${ext}`, test);
    w(`${dir}/jest.config.cjs`, `module.exports = { rootDir: __dirname, testEnvironment: '${env}', testMatch: ['**/*.test.?(m)js'], transform: {} };`);
    const r = sh(`${bin('jest/bin/jest.js')} --config work/${dir}/jest.config.cjs`, { env: extraEnv });
    const file = (r.out.match(/PICKED (.+)/) ?? [])[1];
    return r.ok ? 'ok' + (file ? ', ' + file.trim().split(/[\\/]/).slice(-2).join('/') : '') : 'FAIL ' + err(r.out.replace(/PICKED.*/g, ''));
  }
  function vitest(dir, test) {
    w(`${dir}/a.test.js`, test);
    const r = sh(`${bin('vitest/vitest.mjs')} run --root work/${dir}`);
    return r.ok ? 'ok' : 'FAIL ' + err(r.out);
  }
  function webpack(target, code, tag = 'esm') {
    const dir = `webpack-${target}-${tag}`, main = `main.${tag == 'cjs' ? 'cjs' : 'mjs'}`, out = `out.${target == 'node' ? 'cjs' : 'js'}`;
    w(`${dir}/${main}`, code);
    w(`${dir}/webpack.config.cjs`, `module.exports = { mode: 'production', target: '${target}', entry: __dirname + '/${main}', output: { path: __dirname + '/dist', filename: '${out}' }, experiments: { topLevelAwait: true }, optimization: { minimize: false } };`);
    const r = sh(`${bin('webpack/bin/webpack.js')} --config work/${dir}/webpack.config.cjs`);
    if (!r.ok) return 'FAIL ' + err(r.out);
    const run = sh(`node work/${dir}/dist/${out}`);
    return (run.out.includes('RESULT ok') ? 'ok' : 'built, run FAIL ' + err(run.out)) + ', ' + picked(readFileSync(join(work, dir, 'dist', out), 'utf8'));
  }
  function rollup(browser, code) {
    const dir = `rollup-${browser}`, p = (f) => join(work, dir, f).replace(/\\/g, '/');
    w(`${dir}/main.mjs`, code);
    w(`${dir}/rollup.config.mjs`, `import { nodeResolve } from '@rollup/plugin-node-resolve';\nexport default { input: '${p('main.mjs')}', output: { file: '${p('out.mjs')}', format: 'es' }, external: [/^node:/], plugins: [nodeResolve({ browser: ${browser} })] };`);
    const r = sh(`${bin('rollup/dist/bin/rollup')} -c work/${dir}/rollup.config.mjs --silent`);
    if (!r.ok) return 'FAIL ' + err(r.out);
    const run = sh(`node work/${dir}/out.mjs`);
    return (run.out.includes('RESULT ok') ? 'ok' : 'run FAIL ' + err(run.out)) + ', ' + picked(readFileSync(join(work, dir, 'out.mjs'), 'utf8'));
  }
  function esbuild(platform, code) {
    const dir = `esbuild-${platform}`;
    w(`${dir}/main.mjs`, code);
    const r = sh(`node -e "require('esbuild').buildSync({ entryPoints: ['work/${dir}/main.mjs'], bundle: true, platform: '${platform}', format: 'esm', outfile: 'work/${dir}/out.mjs', logLevel: 'error' })"`);
    if (!r.ok) return 'FAIL ' + err(r.out);
    const run = sh(`node work/${dir}/out.mjs`);
    return (run.out.includes('RESULT ok') ? 'ok' : 'run FAIL ' + err(run.out)) + ', ' + picked(readFileSync(join(work, dir, 'out.mjs'), 'utf8'));
  }
  function vite(code) {
    w('vite/index.html', '<script type="module" src="./main.js"></script>');
    w('vite/main.js', code);
    const r = sh(`${bin('vite/bin/vite.js')} build work/vite --outDir dist --emptyOutDir --logLevel error`);
    if (!r.ok) return 'FAIL ' + err(r.out);
    const dist = join(work, 'vite/dist/assets');
    return 'ok, ' + picked(readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dist, f), 'utf8')).join(''));
  }
  // Parcel's defaults ignore "exports" and read the browser, module and main
  // fields, and the subpath folders' package.json files.
  function parcel(code) {
    w('parcel/index.html', '<script type="module" src="./main.js"></script>');
    w('parcel/main.js', code);
    const r = sh(`${bin('parcel/lib/bin.js')} build work/parcel/index.html --dist-dir work/parcel/dist --no-cache --no-source-maps --log-level error`);
    if (!r.ok) return 'FAIL ' + err(r.out);
    const dist = join(work, 'parcel/dist');
    return 'ok, ' + picked(readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dist, f), 'utf8')).join(''));
  }
  // Metro's own resolver with the settings React Native 0.8x uses: package
  // exports on, conditions require/import plus react-native (or browser on
  // web). `exportsOn = false` is React Native before 0.79, which reads the
  // react-native, browser and main fields instead.
  function metro(platform, esm = true, exportsOn = true) {
    const file = `metro-${platform}-${esm}-${exportsOn}.cjs`;
    w(file, `const ESM = ${esm};
const { resolve } = require('metro-resolver');
const fs = require('fs'), path = require('path');
const root = ${JSON.stringify(here)};
const getPackage = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
function ctx(origin) {
  return {
    allowHaste: false, assetExts: new Set(['png']), sourceExts: ['js', 'mjs', 'cjs', 'json', 'ts', 'tsx'],
    customResolverOptions: {}, disableHierarchicalLookup: false, extraNodeModules: null, mainFields: ${platform == 'web' ? "['browser', 'module', 'main']" : "['react-native', 'browser', 'main']"},
    nodeModulesPaths: [], originModulePath: origin, preferNativePlatform: true, redirectModulePath: (p) => p,
    resolveAsset: () => null, resolveHasteModule: () => null, resolveHastePackage: () => null,
    doesFileExist: (p) => fs.existsSync(p) && fs.statSync(p).isFile(),
    fileSystemLookup: (p) => { try { const s = fs.statSync(p); return { exists: true, type: s.isDirectory() ? 'd' : 'f', realPath: fs.realpathSync(p) }; } catch { return { exists: false }; } },
    getPackage, getPackageForModule: (p) => { let d = p; while (d !== path.dirname(d)) { const f = path.join(d, 'package.json'); if (fs.existsSync(f)) return { packageJson: getPackage(f), rootPath: d, packageRelativePath: path.relative(d, p) }; d = path.dirname(d); } return null; },
    unstable_conditionNames: [], unstable_conditionsByPlatform: { ios: ['react-native'], android: ['react-native'], web: ['browser'] },
    unstable_enablePackageExports: ${exportsOn}, unstable_logWarning: () => {}, unstable_getRealPath: (p) => fs.realpathSync(p),
    dev: false, isESMImport: ESM,
  };
}
// Resolve the package, then every import of every file it reaches.
const seen = new Set(), files = [];
const walk = (spec, from) => {
  const r = resolve(ctx(from), spec, '${platform}');
  if (r.type !== 'sourceFile' || seen.has(r.filePath)) return;
  seen.add(r.filePath); files.push(path.relative(path.join(root, 'node_modules/@duoquote/polytini'), r.filePath).replace(/\\\\/g, '/'));
  const src = fs.readFileSync(r.filePath, 'utf8');
  for (const m of src.matchAll(/(?:from|import|require\\()\\s*['"]([^'"]+)['"]/g)) {
    if (m[1].startsWith('node:')) throw new Error(r.filePath.split(/[\\\\/]/).slice(-2).join('/') + ' imports ' + m[1] + ', which React Native does not have');
    walk(m[1], r.filePath);
  }
};
try { walk('@duoquote/polytini', path.join(root, 'index.js')); walk('@duoquote/polytini/turf', path.join(root, 'index.js')); console.log('RESULT ok, ' + files[0]); } catch (e) { console.log('RESULT FAIL ' + e.message.split('\\n')[0]); }
`);
    const r = sh(`node work/${file}`);
    return (r.out.match(/RESULT (.*)/) ?? [, 'FAIL ' + err(r.out)])[1];
  }
  function ts(resolution) {
    const out = [];
    for (const [name, tsc] of [['5.9', 'node_modules/ts59/bin/tsc'], ['6.0', 'node_modules/ts6/bin/tsc'], ['7', '../../node_modules/typescript/bin/tsc']]) {
      // TypeScript 7 removed node10 and classic.
      if (name == '7' && (resolution == 'node10' || resolution == 'classic')) {
        out.push('7: n/a (removed)');
        continue;
      }
      const dir = `ts-${resolution}-${name}`;
      w(`${dir}/a.ts`, `import { encode, type Point } from '@duoquote/polytini';\nimport { toFeature } from '@duoquote/polytini/turf';\nimport { osrm6 } from '@duoquote/polytini/presets';\nimport { init, decodeMany } from '@duoquote/polytini/wasm';\nconst p: Point[] = [[1, 2]];\nconst s: string = encode(p, osrm6);\nconst n: number = toFeature(s).geometry.coordinates.length;\nconst c: Float64Array = decodeMany([s]).coords;\nexport { n, c, init };\n`);
      const module = resolution == 'node16' ? 'node16' : resolution == 'bundler' ? 'esnext' : 'commonjs';
      w(`${dir}/tsconfig.json`, JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, module, moduleResolution: resolution, target: 'es2022', lib: ['es2022', 'dom'], types: [], typeRoots: [], ...(name == '7' ? {} : { ignoreDeprecations: name == '5.9' ? '5.0' : '6.0' }) }, files: ['a.ts'] }));
      const r = sh(`node "${join(here, tsc)}" -p work/${dir}/tsconfig.json`);
      out.push(`${name}: ${r.ok ? 'ok' : (r.out.match(/error (TS\d+)[^\n]{0,90}/) ?? [r.out.slice(0, 120)])[0].trim()}`);
    }
    return out.join('; ');
  }
  function identity(runtime) {
    w('identity/identity.mjs', IDENTITY);
    w('identity/plain.cjs', PLAIN);
    const exe = runtime == 'node' ? `"${process.execPath}"` : runtime == 'bun' ? 'bun' : runtime == 'deno' ? 'deno run -A' : `npx -y -p ${runtime} node`;
    const a = sh(`${exe} work/identity/identity.mjs`), b = runtime == 'deno' ? { out: '' } : sh(`${exe} work/identity/plain.cjs`);
    const line = (o) => (o.match(/^\{.*\}$/m) ?? ['FAIL ' + err(o)])[0];
    const warn = /ExperimentalWarning/.test(a.out + b.out) ? ' (prints an ExperimentalWarning)' : '';
    return line(a.out) + (runtime == 'deno' ? '' : ' ' + line(b.out)) + warn;
  }
  function iife() {
    const code = readFileSync(join(here, 'node_modules/@duoquote/polytini/dist/polytini.iife.js'), 'utf8');
    const g = {};
    new Function('window', 'self', code + '\nwindow.polytini = polytini;')(g, g);
    return g.polytini?.encode([[38.5, -120.2]]) === '_p~iF~ps|U' && g.polytini.decode('_p~iF~ps|U').length === 1 ? `ok, ${code.length} B` : 'FAIL';
  }
  function electron() {
    w('electron/main.cjs', ELECTRON);
    const r = sh(`${bin('electron/cli.js')} work/electron/main.cjs`, { env: { ELECTRON_ENABLE_LOGGING: '1' } });
    return (r.out.match(/RESULT (.*)/) ?? [, 'FAIL ' + err(r.out)])[1];
  }
}

// What require() and import resolve to, and whether they share one
// PolylineError class (the dual-package hazard).
const IDENTITY = `import { createRequire } from 'node:module';
import * as esm from '@duoquote/polytini';
import * as esmTurf from '@duoquote/polytini/turf';
const require = createRequire(import.meta.url);
const r = { runtime: globalThis.Bun ? 'bun ' + Bun.version : globalThis.Deno ? 'deno ' + Deno.version.deno : 'node ' + process.versions.node };
const short = (p) => p.split(/[\\\\/]/).slice(-2).join('/');
const thrown = (fn) => { try { fn(); } catch (e) { return e; } };
try {
  const cjs = require('@duoquote/polytini');
  r.require = short(require.resolve('@duoquote/polytini'));
  r.works = cjs.encode([[38.5, -120.2]]) === '_p~iF~ps|U';
  r.sameErrorClass = cjs.PolylineError === esm.PolylineError;
  r.instanceofAcross = thrown(() => cjs.decode('!')) instanceof esm.PolylineError;
  r.subpathInstanceof = thrown(() => require('@duoquote/polytini/turf').toFeature('!')) instanceof cjs.PolylineError;
  r.esmSubpathInstanceof = thrown(() => esmTurf.toFeature('!')) instanceof esm.PolylineError;
} catch (e) {
  r.error = e.code + ' ' + e.message.split('\\n')[0];
}
r.import = import.meta.resolve ? short(import.meta.resolve('@duoquote/polytini')) : 'n/a';
console.log(JSON.stringify(r));
`;
const PLAIN = `const root = require('@duoquote/polytini');
let wasmRequire;
try { wasmRequire = typeof require('@duoquote/polytini/wasm').init; } catch (x) { wasmRequire = x.code; }
console.log(JSON.stringify({ require: require.resolve('@duoquote/polytini').split(/[\\\\/]/).slice(-2).join('/'), works: root.encode([[38.5, -120.2]]) === '_p~iF~ps|U', wasmRequire }));
`;
const ELECTRON = `const { app } = require('electron');
app.whenReady().then(async () => {
  const r = { electron: process.versions.electron, node: process.versions.node };
  try {
    const c = require('@duoquote/polytini');
    r.require = require.resolve('@duoquote/polytini').split(/[\\\\/]/).slice(-2).join('/');
    const m = await import('@duoquote/polytini');
    r.works = c.encode([[38.5, -120.2]]) === '_p~iF~ps|U';
    r.sameErrorClass = c.PolylineError === m.PolylineError;
    const w = require('@duoquote/polytini/wasm');
    await w.init();
    r.wasm = w.decodeMany(['??']).coords.length === 2;
  } catch (e) {
    r.error = e.message.split('\\n')[0];
  }
  console.log('RESULT ' + JSON.stringify(r));
  app.quit();
});
`;

// Each CDN URL imported in headless Chrome: encode, decode, and init for
// /wasm. Also says if the CDN added a Buffer polyfill.
async function cdn(v) {
  const { chromium } = await import('playwright-core');
  const p = `@duoquote/polytini@${v}`;
  const urls = {
    'esm.sh': `https://esm.sh/${p}`,
    'esm.sh /wasm': `https://esm.sh/${p}/wasm`,
    'esm.sh /turf': `https://esm.sh/${p}/turf`,
    'jsDelivr /+esm': `https://cdn.jsdelivr.net/npm/${p}/+esm`,
    'jsDelivr /wasm/+esm': `https://cdn.jsdelivr.net/npm/${p}/wasm/+esm`,
    'jsDelivr bare (expected to fail)': `https://cdn.jsdelivr.net/npm/${p}`,
    'unpkg bare': `https://unpkg.com/${p}`,
    'unpkg ?module': `https://unpkg.com/${p}?module`,
    'unpkg /src/wasm.js': `https://unpkg.com/${p}/src/wasm.js`,
  };
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>cdn</title>');
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  for (const [name, url] of Object.entries(urls)) {
    requests.length = 0;
    const r = await page.evaluate(async (u) => {
      try {
        const m = await import(u);
        if (m.init) await m.init();
        const enc = m.encode ? m.encode([[38.5, -120.2], [40.7, -120.95]]) : null;
        return { ok: m.encode ? enc === '_p~iF~ps|U_ulLnnqC' && m.decode(enc).length === 2 : typeof m.toFeature == 'function' };
      } catch (e) {
        return { ok: false, error: String(e.message).slice(0, 100) };
      }
    }, url);
    console.log(name.padEnd(34), JSON.stringify(r), `${requests.length} requests`, requests.some((u) => /buffer/.test(u)) ? '(loads a Buffer polyfill)' : '');
  }
  // The IIFE through a <script> tag.
  for (const [name, url] of [['jsDelivr <script> iife', `https://cdn.jsdelivr.net/npm/${p}/dist/polytini.iife.js`], ['unpkg <script> iife', `https://unpkg.com/${p}/dist/polytini.iife.js`]]) {
    const page2 = await browser.newPage();
    await page2.setContent(`<!doctype html><script src="${url}"></script>`);
    const ok = await page2.evaluate(() => globalThis.polytini?.encode([[38.5, -120.2]]) === '_p~iF~ps|U').catch(() => false);
    console.log(name.padEnd(34), JSON.stringify({ ok }));
    await page2.close();
  }
  await browser.close();
}

if (opt('--cdn')) await cdn(opt('--cdn'));
else await matrix();
