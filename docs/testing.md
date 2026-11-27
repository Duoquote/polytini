# Testing

`npm test` runs everything under Node, `npm run test:bun` and `npm run test:deno` under the others. It's 581 tests in 14 files, and the same 581 pass on Node 22 to 26, Bun 1.4.3 and Deno 2.5.4. Every codec test runs against every entry point: web, browser, node, bun, deno and wasm.

- `core.test.js`: the reference codec at precisions 0 to 13, the edge cases (0, ±90, ±180, the antimeridian, repeats, empty input, one-unit steps), every strict error code, lenient mode, options, objects and GeoJSON.
- `property.test.js`: fast-check round trips and agreement with the reference, with a fixed seed (20261126) so a failure is reproducible.
- `vectors.test.js`: 354 cases from 22 sources, other libraries' own tests and Google's, OSRM's, Valhalla's and GraphHopper's docs. Sources, licenses and attributions are in [`test/fixtures/SOURCES.md`](test/fixtures/SOURCES.md) and [`NOTICE`](test/fixtures/NOTICE). Where a source disagrees with polytini, [`DISAGREEMENTS.md`](test/fixtures/vectors/DISAGREEMENTS.md) says why. One of them is a wrong expected value in `@googlemaps/polyline-codec`'s own test.
- `postgis.test.js`: parity with PostGIS 3.7 `ST_AsEncodedPolyline` and `ST_LineFromEncodedPolyline` at precisions 0 to 15. The fixture is committed, so the tests don't need Docker. `node scripts/postgis-fixtures.js` regenerates it, and [`POSTGIS.md`](test/fixtures/POSTGIS.md) lists where PostGIS differs.
- The integration tests use the real libraries: Leaflet 1.9 and 2 in jsdom, Turf, ol 10.11, and maplibre-gl, mapbox-gl and deck.gl rendering in headless Chrome. CI also type-checks a usage file for each one against the library's own types.
- `test/smoke.js` packs the tarball and installs it with npm, pnpm (isolated, strict), Yarn 4 with Plug'n'Play, Yarn 1, Bun and Deno, then runs ESM and CommonJS imports, the CLI, `tsc` with `node16` and `bundler` resolution, and an esbuild browser bundle. The type check is skipped under Plug'n'Play, which needs Yarn's TypeScript patch; Yarn 1 covers the types for Yarn.

`npx c8 --include='src/**' node test/run.js` reports coverage under Node. The codec itself, `core.js`, `fast.js`, `text.js`, `web.js` and `browser.js`, is at 100% of lines and branches, and all of `src/` is at 99.6% of lines. What's left:

- the V8 12 branch in `node.js`, which only Node 22 and 23 take (the tests run that path on every runtime through `fast(Buffer, 0)`)
- the Deno side of the switch point in `deno.js`, which the Deno run covers
- the `encodeInto` path in `wasm.js` for runtimes without `Buffer`, which the Deno run covers
- a few argument-error branches in the CLI and the map integrations
