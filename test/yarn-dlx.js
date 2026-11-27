// Runs the CLI through `yarn dlx` from the packed tarball, the way the docs
// show it, in every shell this machine has: bash on Linux and macOS; cmd,
// Windows PowerShell and Git Bash on Windows. It needs Yarn 2 or newer as
// `yarn` (CI gets Yarn 4 through Corepack). Each line is typed into the shell
// as one string, so the shell's own quoting is what's tested.
//   node test/yarn-dlx.js
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const win = process.platform == 'win32';
const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
const work = mkdtempSync(join(tmpdir(), 'polytini-yarn-dlx-'));
const opts = { cwd: work, encoding: 'utf8', env, timeout: 300000 };

const pack = spawnSync('npm', ['pack', root, '--silent', '--pack-destination', work], { ...opts, shell: true });
if (pack.status) throw new Error(`npm pack failed: ${pack.stderr}`);
const tgz = join(work, readdirSync(work).find((f) => f.endsWith('.tgz'))).replace(/\\/g, '/');
const version = spawnSync('yarn', ['--version'], { ...opts, shell: true }).stdout?.trim();
if (!/^[2-9]|^\d{2,}/.test(version ?? '')) throw new Error(`yarn dlx needs Yarn 2 or newer, and yarn is ${version}`);

const bash = win ? ['C:/Program Files/Git/bin/bash.exe'].find(existsSync) : 'bash';
const shells = {
  ...(win && {
    cmd: (line) => spawnSync('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...opts, windowsVerbatimArguments: true }),
    powershell: (line) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(line, 'utf16le').toString('base64')], opts),
  }),
  ...(bash && {
    bash: (line) => {
      writeFileSync(join(work, 'line.sh'), line + '\n');
      return spawnSync(bash, ['line.sh'], opts);
    },
  }),
};

const yarn = `yarn dlx -q -p @duoquote/polytini@file:${tgz} polytini`;
const points = '[[51.5007,-0.1246],[51.5014,-0.1419],[51.5079,-0.1281]]';
const cases = [
  [`${yarn} decode "kviyHviWkCbkBsg@guA"`, points],
  [`${yarn} encode 51.5007,-0.1246 51.5014,-0.1419 51.5079,-0.1281`, 'kviyHviWkCbkBsg@guA'],
  [`${yarn} encode --lnglat -0.1246,51.5007 -0.1419,51.5014 -0.1281,51.5079`, 'kviyHviWkCbkBsg@guA'],
];
let failed = 0;
for (const [shell, sh] of Object.entries(shells))
  for (const [line, want] of cases) {
    const r = sh(line), out = (r.stdout ?? '').trim();
    const ok = out == want;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${shell}: ${line.replace(tgz, '<tarball>')}${ok ? '' : `\n  stdout: ${out}\n  stderr: ${(r.stderr ?? '').trim().slice(0, 800)}`}`);
  }
rmSync(work, { recursive: true, force: true });
console.log(`Yarn ${version}, ${Object.keys(shells).join(', ')}: ${failed ? `${failed} failed` : 'all passed'}`);
if (failed) process.exitCode = 1;
