// Fails if a type file that JSR reads imports a package. JSR builds its
// docs on the server without node_modules, so every `@ts-self-types` target
// in src/, and every file those import, may only import other files of this
// package (`./` or `../` paths). The npm types/*.d.ts files can import
// packages' types; their JSR copies (*.jsr.d.ts) can't.
//   node scripts/check-jsr-types.js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
const seen = new Set();

// import/export ... from 'x', import('x'), and triple-slash references.
const specifiers = (code) => [
  ...[...code.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g)].map((m) => m[1]),
  ...[...code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ...[...code.matchAll(/\/\/\/\s*<reference\s+(path|types)\s*=\s*['"]([^'"]+)['"]/g)].map((m) => (m[1] === 'types' ? `types:${m[2]}` : m[2])),
];

function visit(file, from) {
  if (seen.has(file)) return;
  seen.add(file);
  const name = relative(root, file).replace(/\\/g, '/');
  if (!existsSync(file)) return void problems.push(`${from} points at ${name}, which doesn't exist`);
  const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const spec of specifiers(code)) {
    if (spec.startsWith('./') || spec.startsWith('../')) visit(resolve(dirname(file), spec), name);
    else problems.push(`${name} imports '${spec.replace(/^types:/, '')}'${spec.startsWith('types:') ? ' (reference types)' : ''}`);
  }
}

for (const f of readdirSync(`${root}src`).filter((x) => x.endsWith('.js'))) {
  const m = readFileSync(`${root}src/${f}`, 'utf8').match(/@ts-self-types="([^"]+)"/);
  if (m) visit(resolve(`${root}src`, m[1]), `src/${f}`);
}

if (problems.length) {
  console.error(`JSR type files must only import this package's own files:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`${seen.size} JSR type files, no package imports`);
