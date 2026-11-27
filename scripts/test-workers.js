// Runs polytini in Cloudflare's Workers runtime (workerd), locally: no
// Cloudflare account, nothing deployed.
//   node scripts/test-workers.js
//
// It packs the package the way npm would publish it, installs the tarball
// and wrangler into a temporary project, bundles two Workers with wrangler
// (so the export conditions are the ones wrangler's esbuild picks) and runs
// them in workerd:
// unstable_dev is the server `wrangler dev` runs, as an API.
//   - package: only the published package's entry points, without
//     nodejs_compat: the default entry, the subpaths, and /wasm both without
//     and with the compiled module from @duoquote/polytini/polytini.wasm.
//   - suite: the test files that need no DOM, browser or CLI, against the
//     npm default entry, JSR's default entry (src/deno.js) and /wasm. It
//     needs nodejs_compat for fast-check and the test files' node: imports,
//     not for polytini.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Pinned so a new wrangler can't change the result silently. Raise both
// together: the date has to be one this wrangler's workerd supports.
const WRANGLER = '4.168.0';
const DATE = '2026-11-20';
// Test files left out: the CLI (no processes in a Worker), Leaflet (needs a
// DOM through jsdom), deck.gl (imports deck.gl's tesselators by computed
// URL, which a bundle can't follow) and wasm.test.js (fresh copies of the
// module through ?query imports). The package Worker covers /deckgl and
// the WASM init paths.
const SKIP = ['cli.test.js', 'leaflet.test.js', 'deckgl.test.js', 'wasm.test.js'];
const FIXTURES = ['fixtures/vectors/', 'fixtures/presets/', 'fixtures/flexible/', 'fixtures/postgis.json', 'fixtures/real-world.csv'];

const root = fileURLToPath(new URL('..', import.meta.url));
// One fixed directory, emptied at the start of each run: on Windows workerd
// keeps it locked until this process exits, so it can't be removed at the end.
const dir = join(tmpdir(), 'polytini-workers');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
const q = (a) => (/^[\w./:=@-]+$/.test(a) ? a : JSON.stringify(a));
const sh = (cmd, args, opts = {}) => execSync([cmd, ...args].map(q).join(' '), { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts });
const rel = (p) => JSON.stringify(relative(dir, p).replace(/\\/g, '/'));

try {
  // The package as published: npm pack runs prepack (the CommonJS build).
  const tgz = sh('npm', ['pack', root, '--silent', '--pack-destination', dir]).trim().split('\n').pop();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { '@duoquote/polytini': `file:./${tgz}`, wrangler: WRANGLER } }));
  sh('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error']);
  const req = createRequire(join(dir, 'package.json'));
  const workerd = req('workerd/package.json').version;

  // The fixture files the suite reads, by path relative to test/.
  const files = {};
  for (const f of FIXTURES) {
    const names = f.endsWith('/') ? readdirSync(join(root, 'test', f)).filter((n) => /\.(json|txt|csv)$/.test(n)).map((n) => f + n) : [f];
    for (const n of names) files[n] = readFileSync(join(root, 'test', n), 'utf8');
  }
  writeFileSync(join(dir, 'files.json'), JSON.stringify(files));

  const testFiles = readdirSync(join(root, 'test')).filter((f) => f.endsWith('.test.js') && !SKIP.includes(f)).sort();
  writeFileSync(join(dir, 'setup.js'), `
import * as npmDefault from '@duoquote/polytini';
import * as wasm from '@duoquote/polytini/wasm';
import * as stream from '@duoquote/polytini/stream';
import * as lite from '@duoquote/polytini/lite';
import wasmModule from '@duoquote/polytini/polytini.wasm';
import * as jsrDefault from ${rel(join(root, 'src/deno.js'))};
import files from './files.json';
wasm.initSync(wasmModule);
globalThis.__polytiniTest = {
  files,
  stream,
  lite,
  entries: [
    { name: 'npm default', api: npmDefault },
    { name: 'jsr default (src/deno.js)', api: jsrDefault },
    { name: 'wasm', api: wasm },
  ],
};
`);
  writeFileSync(join(dir, 'suite.js'), `
import './setup.js';
import { tests, AssertionError } from ${rel(join(root, 'test/lib.js'))};
// Namespace imports that get used: the repository's package.json lists only
// src/ files under sideEffects, so esbuild drops bare imports of test files.
${testFiles.map((f, i) => `import * as t${i} from ${rel(join(root, 'test', f))};`).join('\n')}
const loaded = [${testFiles.map((_, i) => `t${i}`).join(', ')}];
const files = ${JSON.stringify(testFiles)}.filter((_, i) => loaded[i]);
export default {
  async fetch() {
    let passed = 0;
    const failures = [];
    for (const t of tests) {
      try {
        await t.fn();
        passed++;
      } catch (err) {
        failures.push(t.name + ': ' + (err instanceof AssertionError ? err.message : err?.stack ?? String(err)));
      }
    }
    return Response.json({ passed, failed: failures.length, failures, files });
  },
};
`);
  writeFileSync(join(dir, 'package-worker.js'), readFileSync(join(root, 'test/workers/package-worker.js'), 'utf8'));

  const { unstable_dev } = await import(pathToFileURL(req.resolve('wrangler')).href);
  // wrangler dev keeps its local state in .wrangler/ under the working directory.
  process.chdir(dir);
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' };
  const results = {};
  for (const [name, main, flags] of [['package', 'package-worker.js', []], ['suite', 'suite.js', ['nodejs_compat']]]) {
    const out = join(dir, 'out-' + name);
    sh('npx', ['wrangler', 'deploy', main, '--dry-run', '--outdir', out, '--metafile', join(out, 'meta.json'), '--name', 'polytini-' + name, '--compatibility-date', DATE, ...flags.flatMap((f) => ['--compatibility-flag', f])], { env });
    // Which of the package's files the bundle took, to show the export conditions wrangler used.
    const inputs = Object.keys(JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8')).inputs);
    const picked = inputs.filter((p) => p.includes('node_modules/@duoquote/polytini/')).map((p) => p.replace(/^.*node_modules\/@duoquote\/polytini\//, '')).sort();
    // wrangler dev's server, in workerd, with the same bundling.
    const worker = await unstable_dev(join(dir, main), {
      compatibilityDate: DATE,
      compatibilityFlags: flags,
      ip: '127.0.0.1',
      logLevel: 'warn',
      experimental: { disableExperimentalWarning: true, disableDevRegistry: true },
    });
    try {
      const res = await worker.fetch('/');
      const body = await res.text();
      try {
        results[name] = { ...JSON.parse(body), picked };
      } catch {
        results[name] = { passed: 0, failed: 1, failures: [`HTTP ${res.status}: ${body.slice(0, 2000)}`], picked };
      }
    } finally {
      await worker.stop();
    }
  }

  console.log(`workerd ${workerd} (wrangler ${WRANGLER}), compatibility date ${DATE}`);
  let failed = 0;
  for (const [name, r] of Object.entries(results)) {
    console.log(`\n${name}: ${r.passed} passed, ${r.failed} failed`);
    console.log(`  bundled from the package: ${r.picked.join(', ') || 'nothing'}`);
    if (r.files) console.log(`  test files: ${r.files.join(', ')}`);
    if (r.notes) for (const n of r.notes) console.log(`  ${n}`);
    for (const f of r.failures) console.error(`  FAIL ${f}`);
    failed += r.failed;
  }
  if (failed) process.exitCode = 1;
} finally {
  console.log(`
working directory: ${dir}`);
}
