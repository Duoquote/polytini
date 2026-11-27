# AGENTS.md

Notes for AI coding agents working in this repository. People can read it too; CONTRIBUTING.md is the short version for everyone.

polytini is a Google encoded polyline codec published as `@duoquote/polytini` on npm and JSR. It's plain ESM JavaScript with hand-written types, and it has no runtime dependencies. If you're using polytini in another project rather than changing it, read [llms.txt](llms.txt) instead.

## Setup

Node 22 or newer. Bun and Deno for their test runs.

```sh
npm ci
npm test                      # every test file on Node (test/run.js)
node test/run.js leaflet      # only files whose name contains "leaflet"
```

## Commands

| Command | What it checks |
|---|---|
| `npm test`, `npm run test:bun`, `npm run test:deno` | The whole suite on each runtime. Every codec test runs against every entry: web, browser, node, bun, deno and wasm. |
| `npm run test:workers` | The packed package in workerd through wrangler, locally. No Cloudflare account. |
| `node test/smoke.js` | Packs the tarball and installs it with npm, pnpm, Yarn 4 PnP, Yarn 1, Bun and Deno. Slow; needs those tools. |
| `node test/tools/matrix.mjs` | Packs the tarball and checks which file Jest, Vitest, webpack, Rollup, esbuild, Vite, Parcel, Metro, TypeScript and Electron pick, and that it runs. Needs `npm install --prefix test/tools`. CI runs `--quick`. See docs/platforms.md. |
| `node scripts/size.js` | Minified and gzipped size of every entry against its budget. Also rewrites `assets/badges/size.svg`. |
| `node scripts/check-deps.js` | No runtime dependencies in package.json or in `src/` imports. |
| `node scripts/llms.js --check` | `llms-full.txt` matches what the script generates, and `llms.txt` names every import path. Run `node scripts/llms.js` to regenerate after changing `types/`, `docs/api.md`, `docs/streaming.md`, `docs/integrations.md`, `docs/cli.md` or the top of `llms.txt`. |
| `node scripts/build-wasm.js` | Assembles `wasm/polytini.wat` (wabt) and `wasm/polytini-strings.wat` (binaryen). CI fails if either committed `.wasm` or `src/wasm-bytes.js` differ from the result. |
| `npx c8 --reporter=text-summary --include='src/**' node test/run.js` | Coverage. The codec files are at 100% of lines and branches; keep them there. |
| `for c in test/fixtures/*/tsconfig.json; do npx tsc -p "$c"; done` | The integration types against the real map libraries' types. |
| `node scripts/postgis-fixtures.js --check` | Regenerates the PostGIS fixture with Docker and fails if it changed. Optional; CI runs it by hand only. |

The JSR checks, which need Deno and must run without `node_modules` the way JSR's server sees the package:

```sh
node scripts/check-jsr-types.js
DENO_NO_PACKAGE_JSON=1 deno publish --dry-run --allow-dirty
DENO_NO_PACKAGE_JSON=1 deno doc --lint $(node -p 'Object.values(require("./jsr.json").exports).join(" ")')
DENO_NO_PACKAGE_JSON=1 node scripts/check-jsr-docs.js
```

CI (`.github/workflows/ci.yml`) runs all of this on every push except the PostGIS job.

## Hard constraints

Don't change these without the maintainer asking for it:

- No runtime dependencies. `dependencies`, `peerDependencies` and `optionalDependencies` stay absent, and `src/` imports only its own files and `node:` built-ins. The integrations take their map library from the caller (`install(L)`, `createPolylineFormat({ Polyline, LineString })`). Dev dependencies for tests and benchmarks are fine.
- Size budgets. Every entry has a gzipped budget in `scripts/size.js`, about 4% over its size when it was set. If a change really needs more bytes, raise the budget in the same commit and say why in the commit message.
- Strict by default. Malformed input throws a `PolylineError` with a `code` and an `index`. Don't weaken a check, change a code or make strict mode opt-in. `strict: false` has defined behavior too (see docs/api.md); keep it.
- Output stability. The same input gives the same string and the same numbers on every entry, every runtime and every version. Rounding is half away from zero and exact at 0.49999999999999994; decoding divides by the factor. Don't change either for speed.
- Exact agreement with the fixtures. `test/fixtures/vectors/` holds 354 cases from 22 sources, and `test/fixtures/postgis.json` is PostGIS 3.7 output at precisions 0 to 15. Never edit an expected value to make a test pass. If a source is wrong, the reasoning goes into `test/fixtures/vectors/DISAGREEMENTS.md` or `test/fixtures/POSTGIS.md`.
- The same API everywhere. The web, browser, node, bun, deno and wasm entries export the same functions with the same results. A runtime-specific path only exists where it measured faster on that runtime.
- JSR type files (each `@ts-self-types` target and what it imports) can only import this package's own files, and every JSR export needs a `@module` doc. `scripts/check-jsr-types.js` and `scripts/check-jsr-docs.js` enforce both.
- Don't bump versions, tag or publish. Releases are the maintainer's (RELEASING.md).

## Where things live

- `src/core.js`: the portable codec. Each function has a fast loop for the common case and falls back to exact `slow*` functions for everything else: other dimensions, precision 7 and up, huge values, objects and bad input. `src/fast.js` is the `Buffer` path for Node and Bun, `src/text.js` the `TextEncoder`/`TextDecoder` path for Deno, browsers and Workers. `src/error.js` is `PolylineError`.
- `src/web.js`, `browser.js`, `node.js`, `bun.js`, `deno.js`: one entry per runtime, picked by the export conditions in `package.json`. `src/wasm.js` with `wasm/polytini.wat`, `wasm/polytini-strings.wat` (the same loops on JS String Builtins) and the generated `src/wasm-bytes.js` is the opt-in WASM build.
- `src/presets.js`, `leaflet.js`, `turf.js`, `google.js`, `openlayers.js`, `maplibre.js`, `mapbox.js`, `deckgl.js`, `flexible.js`, `stream.js`: the subpath exports. `src/lines.js` is the text and line splitting `stream.js` and the CLI share. `src/cli.js` and `src/cli-lib.js`: the command.
- `types/*.d.ts`: hand-written types with a doc comment on every export. `types/*.jsr.d.ts` are JSR copies with structural types for the entries whose npm types import a map library.
- `dist/`: the CommonJS build and the IIFE (`dist/polytini.iife.js`), generated by `npm run build` (and `prepack`), which also writes one `package.json` per subpath folder (`turf/package.json` ...) for tools that ignore `exports`. None of it is committed. A new subpath export needs its folder's file in `files` too; the build fails otherwise.
- `test/*.test.js`: the tests, on a small runner in `test/lib.js` that works the same on Node, Bun and Deno. `test/reference.js` is a slow codec written to be easy to check. `test/fixtures/` has the vectors, PostGIS data and integration type checks.
- `bench/`: benchmarks for the integrations, and `bench/ab.js` for comparing two versions of the codec. The library-against-library benchmark is a separate repo, [polyline-benchmark](https://github.com/Duoquote/polyline-benchmark).
- `docs/`: the long explanations. The README is short on purpose; put details in `docs/`.

## Code style

- ESM, 2 spaces, single quotes, semicolons. There's no formatter config, so match the file you're in.
- Comments say why, often with the measurement behind a choice ("measured 1.6 times faster on Node 24"). Keep those accurate when you change the code they describe.
- New public API needs types in `types/` (and a `.jsr.d.ts` copy if the npm types import another package), a doc comment on every export, a section in the right `docs/` file and tests that run against every entry.
- Prose in docs and comments is plain and short: no marketing words, no emoji. Claims about speed or size come with numbers.

## Speed claims

A cell in polyline-benchmark's tables moves 5 to 7% between rounds in its pinned run (`npm run bench:clean`) and about 30% on a busy machine, so the tables are good for comparing libraries and not for a 5% change in one loop. For a change to polytini's own code:

- Compare before and after in the same session, on the same machine, paired: alternate A and B runs in separate processes, over several rounds, and report the ratio with its spread or a confidence interval.
- Run A against itself first. That's the noise floor; a difference inside it isn't a result.
- Check each runtime the change touches (Node, Bun, Deno, Chrome). A win on one runtime is often a loss on another, which is why the entries differ.
- Check short lines (10 and 100 points) and the 1000 real-world lines, not only long synthetic ones. `test/bench-fixtures.js` has the benchmark repo's inputs.
- Put the commands and the raw numbers in the PR. "Faster" without numbers won't be merged.

`bench/ab.js` does the paired part: `node bench/ab.js --a ../base/src/node.js --b src/node.js --cases decode:10,decode:real`, with `--exe` for Bun, Deno or another Node. It prints the ratio B/A with a 95% confidence interval per case. Its header has the options and the noise I measured with it.

To see where polytini lands against other libraries, run `npm run bench:quick` in polyline-benchmark with polytini installed from your branch (`npm install github:<you>/polytini#<commit>`).

## Pull requests

- One change per PR. A bug fix starts with a test that fails before the fix.
- `npm test` and the checks above pass. Run the Bun and Deno suites when the change touches a runtime entry.
- Benchmark numbers from a paired comparison for any speed claim, and `node scripts/size.js` output if the size changed.
- Update `docs/`, `types/` and `CHANGELOG.md` (under "Unreleased") when behavior or API changes, and regenerate `llms-full.txt`.
- Say in the PR description that an AI agent wrote or helped with the change, and which one. The PR template has a checklist.
- Don't open an issue or a PR on your own initiative. Ask the person you're working for first.
