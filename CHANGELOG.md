# Changelog

## Unreleased

Packaging: nothing removed, the CommonJS build stays. Checked with `test/tools/matrix.mjs` against the packed tarball; the table is in [docs/platforms.md](docs/platforms.md#module-formats-and-tools).

- `require()` gets the ESM sources on Node 22.12 and newer (the `module-sync` condition) and on Bun (`bun`, now ahead of `require`), so `require()` and `import` share one copy and one `PolylineError` class. Node 22.0 to 22.11, Jest, Deno's `createRequire` and Yarn PnP still get `dist/*.cjs`. Node 22.12.x prints an `ExperimentalWarning` for it; 22.13 and newer don't.
- `/wasm` has a CommonJS build, `dist/wasm.cjs`. `require('@duoquote/polytini/wasm')` threw `ERR_REQUIRE_ESM` on Node 22.0 to 22.11 and in Jest.
- A `react-native` condition (`src/web.js`): Metro's `require()` on iOS and Android used to get `dist/node.cjs`, which imports `node:buffer`.
- `require` inside the `browser` condition (`dist/web.cjs`), for Jest's jsdom environment, which got ESM before. webpack and esbuild still bundle `src/browser.js` there.
- `module`, `browser` and `react-native` fields, and a folder with a `package.json` per subpath, for tools that ignore `exports`: Parcel's defaults (which failed on `/turf`), TypeScript's `node10` (which failed on every subpath) and React Native before 0.79.
- `dist/polytini.iife.js`: the browser entry as a global `polytini` for a `<script>` tag (5,382 bytes, 2,480 gzipped). No import gets bigger.
- CI runs the cheap half of the tool matrix (Jest, Parcel, Metro, TypeScript, Node, the IIFE) on every push.

Fixed:

- JSR types: `MapLike` in the maplibre and mapbox modules didn't accept a real maplibre-gl or mapbox-gl `Map`, so `addPolylineLayer(map, ...)` and `setPolylineData` were type errors for JSR users. Its `addSource` and `addLayer` take any parameters now. The npm types were fine. A new type check (`test/fixtures/jsr`) passes real maplibre-gl, mapbox-gl, Turf, OpenLayers, Google Maps and Leaflet objects to every JSR copy.
- `/wasm` added each line's coordinates in 32-bit integers, so once a running sum passed 2^31 its `decodeFlat` (128 characters and up) and `decodeMany` gave wrapped numbers where every other entry gave the right ones. That happens on real lines at precision 8 and up (30 degrees is 3e9 there). The sums are 64-bit now. It costs about 2% on long `decodeFlat` and `decodeMany` calls through that module (paired runs on Node 24 and Bun: 1.02 to 1.03, noise 0.99 to 1.01).

`/wasm`:

- JS String Builtins: on V8 (Chrome 130+, Node 22.19+ and 24+, Deno), `init()` also compiles a second module, `wasm/polytini-strings.wat` (835 bytes), where strings go in and out of WebAssembly as JS strings instead of through `TextEncoder`, `latin1Slice` or `TextDecoder`. It's feature-detected once at init. Everywhere else (Bun, where it measured slower, Firefox and Safari, which aren't measured, Node 22.12 to 22.18, Workers, and `init(module)`) nothing changes. Against 0.1.4 in paired runs: `decodeFlat` at 10 and 100 points 9 to 26% faster on Node 24 and 26, Deno and Chrome (the 128-character cutoff to the JS core is gone there), and 18 to 20% faster on long lines in Chrome; `decodeMany` 13% faster in Chrome; `encode` at 10 points 2 to 3 times as fast everywhere it's on, and at 100 points 16 to 33% faster on Node 22, Deno and Chrome. Long lines keep the old string path where it measured faster. Outputs and errors are the same: the whole suite runs on both modules, and a 4,323-case comparison against 0.1.4 passed on Node 22, 24 and 25, Bun, Deno and Chrome. The table is in [docs/platforms.md](docs/platforms.md#js-string-builtins). The entry grew from 4,561 to 5,879 bytes gzipped (about 590 of it the second module's base64, the rest the glue that picks a path), and its budget from 4,740 to 6,110.
- `/wasm` finds Node's and Bun's `latin1Slice` without naming their `Buffer` class, so esm.sh stops adding its 8,772-byte (gzipped) `Buffer` polyfill to it. Encoding speed is the same: 0.99 to 1.01 on Node 24 and Bun in paired runs. It costs 30 bytes.
- `/wasm` turns its inlined base64 into bytes with `Uint8Array.fromBase64` where the runtime has it, and a plain loop over `atob` where it doesn't (Node 24). The first `initSync()` in a fresh process went from 0.60 to 0.51 ms on Node 26, 0.63 to 0.51 in Deno, 2.81 to 2.36 on Bun, and 0.62 to 0.51 on Node 24 with the loop (medians of 15). 38 bytes.

## 0.1.4

Faster, with the same output. The numbers are paired before and after runs with `bench/ab.js`; the table is in [docs/platforms.md](docs/platforms.md#what-changed-after-013).

- Short lines, when you pass a precision or options: `10 ** precision` was computed on every such call, and it's a table lookup now. A plain `decode(str)` never computed it and is as fast as before. Decoding 10 points got 30% faster on Node 22, 18% on Node 24, 16% on Node 26, 13% in Deno and 17% in Chrome. Encoding 10 points got 33%, 17%, 12%, 8% and 9% faster. Bun didn't change.
- Node and Bun: the decoder copies the string with `utf8Write` instead of `ucs2Write`. Lines of 100 to 1,000 points decode 10 to 15% faster on Node 22 and 26 and 6 to 8% on Bun. Node 24 stayed about the same.
- Deno: encoding makes its string with a UTF-8 `TextDecoder` instead of a `'latin1'` one, and from 16 points instead of 512. 44% faster at 100 points, 10 to 12% from 1,000 points up, 7% on the real-world lines.
- `/wasm` in Deno: the glue makes encoded strings with a UTF-8 `TextDecoder` too. Encoding 100 points got 25% faster and the real-world lines 15% faster (paired runs, 8 of 8 rounds); other runtimes take the same path as before. The wasm entry's size budget went from 4550 to 4740 bytes for it (now 4561).
- `bench/ab.js`: a paired A/B benchmark for changes to the codec, with a confidence interval. AGENTS.md says how to use it.
- More tests for the byte-buffer paths: characters outside ASCII anywhere in a long string, and every length around the points where an entry switches paths.

## 0.1.3

Fixed:

- `decodeLatLng` with a `'lnglat'` preset (`osrm`, `osrm6`, `valhalla`, `stadia`, `graphhopper`, `openrouteservice`, `mapbox`, `mapbox6`) returned `lat` and `lng` swapped. It now always uses `[lat, lng]` order internally, like `toGeoJSON` always uses `[lng, lat]`. With a plain precision or the `google`, `strava` and `otp` presets it was already right.
- Removed the `test:browser` script, which pointed at a file that doesn't exist. The browser checks run in the MapLibre and deck.gl tests.

Added, no code changes:

- `llms.txt` for AI agents: install, the main calls, every import path and the mistakes to avoid (coordinate order, precision, strict mode, WASM on Workers). It ships in the npm and JSR packages, so an agent reading `node_modules` finds it.
- `llms-full.txt` in the repository: `llms.txt` plus every type file and the API, integrations and CLI docs, generated by `scripts/llms.js`. CI fails if it's out of date.
- `AGENTS.md` (with a `CLAUDE.md` that imports it), `CONTRIBUTING.md`, issue templates and a pull request template.
- package.json: a longer description and more keywords. `context7.json` for the Context7 docs index.

## 0.1.2

- Cloudflare Workers: a `workerd` export condition, which gives Workers the Deno entry (`src/deno.js`). Wrangler used to pick the browser entry, and the Deno entry decoded faster than it in workerd.
- `/wasm`: `init(module)` and `initSync(module)` take a compiled `WebAssembly.Module` or the `.wasm` bytes, and the package exports the file as `@duoquote/polytini/polytini.wasm`. Workers don't compile WebAssembly from bytes, so there you import the file and pass it in. Without it, `init()` throws a `PolylineError` with code `'init'` that says how, instead of the runtime's own error.
- `npm run test:workers` runs the package and the test files that need no DOM in workerd, locally through wrangler. CI runs it.
- JSR: every entry has a module doc, and CI checks that.

## 0.1.1

No changes to the code. The npm types only gained doc comments.

- JSR: the mapbox, maplibre, turf and openlayers entries have their own type files now (`types/*.jsr.d.ts`), with structural types and the GeoJSON types written out. JSR builds docs without node_modules, so its first 0.1.0 publish failed on types that import `geojson`, `mapbox-gl`, `maplibre-gl`, `@turf/helpers` and `ol`. JSR's 0.1.0 already has these files; this is the first npm release with them.
- Every JSR export has doc comments, so `deno doc --lint` passes.
- CI checks the JSR package the way the server sees it: a clean checkout with no npm install, a script that fails if a JSR type file imports a package, then `deno publish --dry-run` and `deno doc --lint`.
- The smoke test bundles with esbuild's JS API instead of the CLI.
- The npm dry-run check runs `npm pack --dry-run` once the version is already on npm, because a publish dry run of a published version fails.
- The release workflow no longer installs dependencies before `deno publish`. It only needed Deno to skip package.json.

## 0.1.0

First release.
