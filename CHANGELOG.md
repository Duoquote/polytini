# Changelog

## 0.1.7

Streaming, and a CLI whose documented commands work the same in bash, PowerShell and cmd. Nothing else changed: no other entry got bigger or slower, and every output is the same.

`@duoquote/polytini/stream`, a new entry, for input that arrives in pieces. Docs: [docs/streaming.md](docs/streaming.md).

- One long polyline in chunks, like a fetch body or a file: `res.body.pipeThrough(new DecodeStream())` gives the points each chunk completes. `PolylineDecoder` does the same with `write(chunk)` and `end()`, without streams. Chunks can be strings or bytes and can end anywhere, even inside a value.
- Points to a string as they come: `EncodeStream`, and `PolylineEncoder` with `write(points)` and `end()`.
- One polyline per line, or NDJSON with a polyline field: `DecodeLinesStream` and `EncodeLinesStream`, with `errors: 'skip'` and `onError` for bad lines.
- `decodeIterable`, `encodeIterable`, `decodeLines` and `encodeLines` for `for await` over async generators, Node Readables and ReadableStreams.
- They take the same options as `decode` and `encode`, presets included, plus `flat` for `Float64Array` batches.
- Wherever the input is cut, the result is what `decode` and `encode` give on the whole input: the same numbers, the same string, and the same `PolylineError` code, index and message. `test/stream.test.js` checks that by cutting random, broken and fixture inputs (the vectors, PostGIS and the real-world lines) at every position, as strings and as UTF-8 bytes, and at random chunk sizes, on Node, Bun, Deno, headless Chrome and workerd.
- Speed, 1,000,000 points in 64 KB chunks against one call on the whole string, paired runs with `bench/ab.js`: decoding to tuples costs 0 to 8% on Node 22 to 25 and Deno and is 7 to 9% faster on Bun, both for string chunks and for byte chunks against `decode(await res.text())`. Flat output costs up to 19% (Node 22) and is 13 to 20% faster on Bun. Encoding costs up to 15%, except on Node 22, where it's almost three times as fast in pieces. In Chrome, tuples were 6% faster and flat output 12% slower. The tables are in [docs/streaming.md](docs/streaming.md#speed).
- 3,628 bytes gzipped for the whole entry, 1,722 for `PolylineDecoder` alone.

CLI:

- `encode` takes points as arguments: `polytini encode 51.5007,-0.1246 51.5014,-0.1419`. No JSON quoting, and a negative number is a coordinate, not an option. In PowerShell an unquoted pair reaches the command as `51.5007 -0.1246` through the `pnpm`, `bunx` and `npx` shims, which works too.
- `-` and `--file -` read stdin, and `decode` takes several polylines as arguments.
- `--lines` reads one input per line and writes one output per line, so a file of any size goes through with constant memory: `polytini decode --lines --file routes.txt`. `--field <name>` decodes or encodes one field of each line's JSON object, and `--skip-errors` reports a bad line and goes on. Errors say which line.
- stdin and `--file` are read in chunks and output is written as it's ready, so a polyline of a million points needs little memory too. The output is byte for byte what 0.1.4 printed for the same input.
- In cmd, a polyline that ends in `\` reaches the command with a `"` instead, because Windows reads `\"` as a quote. The error now says to double that backslash.
- The CLI is 6,921 bytes gzipped, up from 3,839: it carries the stream decoder and encoder. No library entry includes it.

Docs:

- The CLI examples in the README, docs/cli.md and llms.txt use polylines without `` ` ``, `\`, `|` or `^`, in double quotes, so they work in every shell as written. The old example, `` '_p~iF~ps|U_ulLnnqC_mqNvxq`@' ``, didn't work in cmd, where single quotes aren't quotes and `|` starts a pipe. I ran every documented command in cmd, PowerShell 5.1 and Git Bash with `pnpm dlx`, `bunx`, `deno run` and `npx`. docs/cli.md says how to quote your own polylines in each shell.
- `deno run` needs `-R` for `--file`, and the docs say so.

## 0.1.6

Smaller bundles for what people actually import, with the same output, the same errors and the same speed. Nothing was removed.

Gzipped bytes with esbuild for the browser, from `node scripts/size.js`. The first rows are what an app ships when it imports one or two functions; browser bundlers resolve the bare import to the browser entry.

| | 0.1.5 | 0.1.6 |
|---|--:|--:|
| `import { decode }` | 1,164 | 1,065 |
| `import { encode }` | 1,507 | 1,435 |
| `import { decode, encode }` | 2,045 | 1,898 |
| `import { decodeLatLng }` | 1,240 | 1,140 |
| `/web`, `import { decode, encode }` | 1,770 | 1,692 |
| browser entry, every export | 2,262 | 2,205 |
| `/web`, every export | 1,984 | 1,992 |
| node entry, every export | 2,621 | 2,607 |
| `/wasm`, every export | 5,879 | 5,585 |
| `/leaflet` | 1,989 | 1,910 |
| `/maplibre` | 1,634 | 1,537 |
| `/deckgl` | 2,039 | 1,913 |

With Rollup (terser) and webpack 5, the same imports: `decode` 1,046 to 1,021 and 1,134 to 1,056, `encode` 1,438 to 1,433 and 1,515 to 1,508, both 1,897 to 1,907 and 2,058 to 1,967, every export 2,297 to 2,287 and 2,408 to 2,419. Every import and bundler is in [docs/platforms.md](docs/platforms.md#size).

What changed:

- `decode` and `decodeFlat` have their own fast loops, so decoding to arrays doesn't bring the `Float64Array` path. Both loops take the same parameters, declare their variables in the same order and use nothing from outside, so esbuild and terser name them alike and gzip finds the second in the first. A bundle with every export still pays 10 to 30 bytes for the second loop, which is why `/web` with every export is 8 bytes bigger.
- The Deno and Workers decoders share the core's decode wrappers instead of repeating the option checks and the fallback to the exact path.
- The browser entry's `TextEncoder`, `TextDecoder` and scratch buffer are created with `/* @__PURE__ */`, so a browser `encode` bundle drops the `TextEncoder` it never used. An unused `2 ** 29` is a plain number now, which esbuild can drop.
- The exact decoder and encoder (precision 7 and up, other dimensions, objects, bad input) are a bit shorter. Same numbers, same error codes, indexes and messages.
- `/turf` and `/deckgl` use the core's option helper instead of their own copy.
- `/wasm` inlines its two modules as hex instead of base64. Hex keeps the same bytes as the same text, so gzip finds what the two modules share: 1,018 bytes gzipped for both, against 1,320. The file is 1.4 KB bigger before gzip. On Node 24, which has no `Uint8Array.fromHex`, the first `initSync()` in a process takes about 0.1 ms longer (0.81 to 0.87 ms before, 0.91 to 1.03 after); Node 26, Deno and Bun stayed within 0.03 ms.
- `scripts/size.js` has a budget per import, so CI fails when a change pins code into a bundle that doesn't use it. The other budgets are lower. The size badge shows decode only and the whole browser entry.

Tried and dropped, with the reasons in docs/platforms.md: a Node entry that bundlers can split (decode only would have been 1,507 bytes instead of 2,560, but decoding long lines got 2 to 3% slower on Node 24), one encode wrapper shared with the browser entry's TextDecoder path (`encodeFlat` got 6% slower in Chrome), short property names on the options object, and a table of error messages.

Same behavior: the test suite on every entry and runtime, and a differential check that gave 0.1.5 and 0.1.6 the same 200,000 random and hand-picked calls on every entry, `/wasm` and the integrations (strict and not, every option, bad input) and compared results and errors: name, code, index and message. No differences.

Same speed. Paired runs of `bench/ab.js` against 0.1.4's code (0.1.5 only changed `/wasm`), 10 rounds pinned to 4 cores. The machine was busy with other work, so the Node, Bun and Deno runs used `--mode same`: both versions in one process, sampled in ABBA order, which the tool allows for code that shares nothing. Chrome 156 ran each version in a fresh context, 12 rounds. Time per call, new divided by old, so 0.92 is 8% faster; "same" means the 95% interval included 1.00. 0.1.4 against itself stayed within 0.97 to 1.04.

| | Node 22 | Node 24 | Node 26 | Bun 1.4.3 | Deno 2.5 | Chrome 156 |
|---|--:|--:|--:|--:|--:|--:|
| decode, 10 points | 0.93 | 0.92 | 0.98 | same | same | 0.92 |
| decode, 100 points | same | same | same | same | same | 0.96 |
| decode, 10,000 points | same | same | same | same | same | 0.98 |
| decode, real-world lines | same | same | same | 1.01 | same | 0.95 |
| decodeFlat, 10 points | same | same | same | 0.96 | 0.96 | 0.95 |
| decodeFlat, real-world lines | same | 1.02 | same | same | 0.98 | 0.98 |
| encode, 10 points | same | same | same | same | same | same |
| encode, 100 points | same | 1.01 | same | same | same | same |
| encode, 10,000 points | same | 0.99 | same | same | same | 0.99 |
| encode, real-world lines | same | same | same | same | 0.99 | same |
| encodeFlat, 10 points | same | same | same | same | same | same |
| encodeFlat, real-world lines | same | same | same | same | 1.00 | same |

Node 24's 1.02 for `decodeFlat` is inside what 0.1.4 against itself gave for that case (0.97), and the same code measured 0.99 in an earlier run. The `/web` entry on Node 24 decoded 2 to 9% faster at every length; Chrome's `/web` matched the browser entry. `/wasm` against 0.1.5 on Node 24, Bun and Chrome: no case outside the noise except faster ones: Chrome's `decode` (0.83 at 10 points, 0.96 on the real-world lines, from the core) and Bun's `decodeFlat` at 10 points (0.95).

## 0.1.5

Packaging for the tools that couldn't use 0.1.4, a faster `/wasm` on V8, and two fixes. Nothing was removed.

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

Docs:

- CDNs: jsDelivr needs `/+esm` (its bare URL fails for `import`), with esm.sh and unpkg URLs next to it, and the `<script>` tag for the IIFE. In [docs/platforms.md](docs/platforms.md#cdns), and one line in the README.
- Sending many lines: `CompressionStream('gzip')` on encoded polylines, with sizes. Gzip took the 1000 real-world lines from 457.9 to 311.9 KB and a 10,000-point track from 26.6 to 12.7 KB, smaller than the coordinates as JSON, Float64Array or Int32 deltas, even with Brotli. In [docs/platforms.md](docs/platforms.md#sending-many-lines).
- The export conditions, the tool matrix and the Node 22.12.x `ExperimentalWarning` in [docs/platforms.md](docs/platforms.md#module-formats-and-tools); docs/api.md, docs/integrations.md and llms.txt point there.

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
