// Fails if a jsr.json export has no module doc, the `/** ... @module */`
// block JSR shows at the top of each entry's docs page. With @ts-self-types
// deno doc reads the type file, so that is where the block goes.
//   DENO_NO_PACKAGE_JSON=1 node scripts/check-jsr-docs.js   (needs deno)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { exports } = JSON.parse(readFileSync(new URL('../jsr.json', import.meta.url), 'utf8'));
const missing = [];
for (const [name, file] of Object.entries(exports)) {
  const out = execFileSync('deno', ['doc', '--json', file], { cwd: new URL('..', import.meta.url), encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, NO_COLOR: '1' } });
  const { nodes } = JSON.parse(out);
  // Deno 2.5 gives an array with a { kind: 'moduleDoc', jsDoc } node; newer
  // versions (2.9) an object keyed by module, each with module_doc.
  const doc = Array.isArray(nodes) ? nodes.find((n) => n.kind === 'moduleDoc')?.jsDoc?.doc : Object.values(nodes)[0]?.module_doc?.doc;
  if (!doc?.trim()) missing.push(`${name} (${file})`);
}
if (missing.length) {
  console.error(`JSR exports without a module doc:\n- ${missing.join('\n- ')}`);
  process.exit(1);
}
console.log(`${Object.keys(exports).length} JSR exports, each with a module doc`);
