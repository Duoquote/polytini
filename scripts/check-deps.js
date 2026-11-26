// Fails when polytini stops being dependency-free:
// - package.json has dependencies, optionalDependencies or peerDependencies
// - a file in src/ imports or requires a package at runtime (anything but
//   relative paths, node: built-ins and polytini's own subpaths)
// The integrations take their map library from the caller (install(L),
// createPolylineFormat({ Polyline, LineString })) and only import types,
// which live in types/ and never load.
//   node scripts/check-deps.js
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const problems = [];
for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'bundleDependencies']) {
  if (pkg[field] !== undefined) problems.push(`package.json has "${field}"`);
}

const allowed = (spec) => spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('node:') || spec === pkg.name || spec.startsWith(pkg.name + '/');
const patterns = [
  /\b(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g, // import x from 'a', import 'a', export * from 'a'
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // import('a')
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // require('a')
];
const dir = new URL('src/', root);
for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  // Comments can mention packages; only code counts.
  const code = readFileSync(new URL(file, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  for (const re of patterns) for (const [, spec] of code.matchAll(re)) if (!allowed(spec)) problems.push(`src/${file} imports '${spec}'`);
}

if (problems.length) {
  console.error(`polytini must have no runtime dependencies:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('no runtime dependencies: package.json has none, and src/ only imports itself and node: built-ins');
