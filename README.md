<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Duoquote/polytini/main/assets/polytini-dark.png">
    <img src="https://raw.githubusercontent.com/Duoquote/polytini/main/assets/polytini-light.png" width="160" alt="polytini logo: a small bird sitting on a line">
  </picture>
</p>

# polytini

<p align="center">
  <a href="https://www.npmjs.com/package/@duoquote/polytini"><img alt="npm" src="https://img.shields.io/npm/v/@duoquote/polytini?style=flat"></a>
  <a href="https://jsr.io/@duoquote/polytini"><img alt="JSR" src="https://img.shields.io/jsr/v/@duoquote/polytini?style=flat"></a>
  <a href="https://github.com/Duoquote/polytini/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Duoquote/polytini/ci.yml?branch=main&style=flat&label=CI"></a>
  <a href="docs/platforms.md#size"><img alt="gzipped size: decode only, and every export of the browser entry" src="https://raw.githubusercontent.com/Duoquote/polytini/main/assets/badges/size.svg"></a>
  <a href="scripts/check-deps.js"><img alt="dependencies: 0" src="https://img.shields.io/badge/dependencies-0-brightgreen?style=flat"></a>
  <a href="LICENSE"><img alt="license: MIT" src="https://img.shields.io/github/license/Duoquote/polytini?style=flat"></a>
</p>

[Demo](https://duoquote.github.io/polytini/): try it in your browser, with a map, the strict mode and precision examples, and a benchmark you can run on your machine.

polytini encodes and decodes [Google encoded polylines](https://developers.google.com/maps/documentation/utilities/polylinealgorithm), the strings Google Maps, OSRM, Valhalla, GraphHopper and Mapbox return for route geometry. It's strict by default, so a cut-off or corrupted string throws instead of drawing a wrong line. Node, Bun, Deno and browsers each get the code path that measured fastest there, and it has no dependencies. I wrote it while rebuilding [polyline-benchmark](https://github.com/Duoquote/polyline-benchmark), where it's compared with every other JavaScript polyline library.

## Install

```sh
pnpm add @duoquote/polytini
```

```sh
bun add @duoquote/polytini
```

```sh
deno add jsr:@duoquote/polytini
```

```sh
yarn add @duoquote/polytini
```

```sh
npm i @duoquote/polytini
```

ESM and CommonJS, with TypeScript types. Node 22 or newer, Bun, Deno, browsers and Cloudflare Workers.

Without a bundler, import `https://esm.sh/@duoquote/polytini` (on jsDelivr, add `/+esm`), or load `dist/polytini.iife.js` with a `<script>` tag for a global `polytini`. URLs: [docs/platforms.md](docs/platforms.md#cdns).

## Usage

```js
import { encode, decode } from '@duoquote/polytini';

encode([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]); // '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
decode('_p~iF~ps|U_ulLnnqC_mqNvxq`@');                         // [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]
decode(osrmGeometry, { precision: 6, order: 'lnglat' });        // OSRM polyline6, as [lng, lat]
```

## Speed

From the [benchmark](https://github.com/Duoquote/polyline-benchmark)'s 27 November 2026 run with 0.1.4, on Bun, Node 22 to 26, Deno and Chrome. Encoding is about twice as fast as the next library on every runtime. Decoding is ahead on long and real-world lines on most runtimes, behind at 10 points everywhere except Bun (by 11 to 21%), and behind in Chrome at most lengths. A cell moved by 5 to 7% between rounds, and the hatched cells are inside that.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Duoquote/polyline-benchmark/main/docs/charts/overview-dark.svg">
  <img alt="Heatmap of polytini against the fastest other polyline library: a row per runtime (Bun, Node 22 to 26, Deno, Chrome) and a column per case (decode and encode at 10 to 100,000 points and on real-world lines). Each cell gives the ratio and names the fastest other library; hatched cells are within the noise." src="https://raw.githubusercontent.com/Duoquote/polyline-benchmark/main/docs/charts/overview-light.svg">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Duoquote/polyline-benchmark/main/docs/charts/grouped-decode-dark.svg">
  <img alt="Decode speed of polytini and four other libraries relative to @mapbox/polyline, a panel per runtime and a group of bars per line length, on a log scale." src="https://raw.githubusercontent.com/Duoquote/polyline-benchmark/main/docs/charts/grouped-decode-light.svg">
</picture>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Duoquote/polyline-benchmark/main/docs/charts/grouped-encode-dark.svg">
  <img alt="Encode speed of polytini and four other libraries relative to @mapbox/polyline, a panel per runtime and a group of bars per line length, on a log scale." src="https://raw.githubusercontent.com/Duoquote/polyline-benchmark/main/docs/charts/grouped-encode-light.svg">
</picture>

## Best at what

<!-- best -->
From the same run, across every runtime (geometric mean over runtimes and line lengths). A lead smaller than the noise, about 6%, is marked.

| Situation | Best | Runner-up | Margin |
|---|---|---|--:|
| Decode short lines (10 and 100 points) | **@duoquote/polytini** | @placemarkio/polyline | 1.01x faster, within the noise |
| Decode long lines (10,000 and 100,000 points) | **@duoquote/polytini** | @googlemaps/polyline-codec | 1.20x faster |
| Decode real-world lines (median 82 points) | **@duoquote/polytini** | @googlemaps/polyline-codec | 1.27x faster |
| Encode, any length | **@duoquote/polytini** | google-polyline | 2.01x faster |
| Decode to typed arrays | **@duoquote/polytini (Float64Array)** | @duoquote/polytini (wasm, Float64Array) | 1.00x faster, within the noise |
| Encode from typed arrays | **@duoquote/polytini (wasm, Float64Array)** | @duoquote/polytini (Float64Array) | 1.03x faster, within the noise |
| Decode 1000 lines in one call | **@duoquote/polytini (wasm decodeMany/encodeMany)** | @duoquote/polytini (wasm, Float64Array) | 1.57x faster |
| Least memory per decode (10,000 points, [lat, lng] arrays) | **@duoquote/polytini (764.8 KB)** | @googlemaps/polyline-codec (766.2 KB) | 0.2% less |
| Smallest bundle, decode only (gzipped) | @placemarkio/polyline (230 B) | @googlemaps/polyline-codec (252 B) | 22 B smaller |
| Smallest bundle, decode and encode (gzipped) | @placemarkio/polyline (424 B) | google-polyline (464 B) | 40 B smaller |
| Strict validation (throws on bad input) | **@duoquote/polytini** | @lp-labs/polyline-codec | 17x faster |
| HERE Flexible Polyline (encode and decode) | **@duoquote/polytini (flexible)** | @here/flexpolyline | 25x faster |
<!-- /best -->

## API

| Function | Does |
|---|---|
| `decode(str, options?)` | String to `[[lat, lng], ...]` |
| `encode(points, options?)` | `[lat, lng]` tuples or `{ lat, lng }` objects to a string |
| `decodeFlat` / `encodeFlat` | The same with one `Float64Array`: `[lat0, lng0, lat1, lng1, ...]` |
| `decodeLatLng(str)` | String to `[{ lat, lng }, ...]` |
| `toGeoJSON(str)` / `fromGeoJSON(geo)` | GeoJSON LineString in and out |
| `PolylineError` | What strict mode throws, with a `code` and an `index` |

Options are a precision number or `{ precision, factor, order, strict, dimensions, zFactor }`. Details, errors and rounding: [docs/api.md](docs/api.md).

## Integrations

| Import | For |
|---|---|
| `@duoquote/polytini/presets` | Options for OSRM, Valhalla, GraphHopper, Mapbox, Strava and others |
| `@duoquote/polytini/leaflet` | `L.Polyline.fromEncoded`, `toEncoded`, factories; Leaflet 1.9 and 2 |
| `@duoquote/polytini/turf` | Turf Features and FeatureCollections, any GeoJSON line encoded |
| `@duoquote/polytini/google` | Drop-in `decodePath` and `encodePath` for the Maps JavaScript API |
| `@duoquote/polytini/openlayers` | Drop-in `ol/format/Polyline` that doesn't overwrite your geometry |
| `@duoquote/polytini/maplibre`, `/mapbox` | GeoJSON sources, add a line layer, update it |
| `@duoquote/polytini/deckgl` | deck.gl binary paths and polygons, no array per point |
| `@duoquote/polytini/flexible` | HERE's Flexible Polyline, a drop-in for `@here/flexpolyline` |
| `@duoquote/polytini/stream` | Decode a polyline as it downloads, encode points as they come, one polyline per line (NDJSON) |
| `@duoquote/polytini/wasm` | Opt-in WebAssembly build, with batch calls |

None of them import their map library; you pass it in or use what they return. Examples for each: [docs/integrations.md](docs/integrations.md).

## Notes

- The precision isn't stored in the string. A `polyline6` string decoded at 5 gives coordinates ten times too big, with no error.
- Strict mode throws on invalid characters, cut-off strings and NaN coordinates. Pass `strict: false` to never throw.
- `/wasm` pays off for typed arrays (`decodeFlat`, `encodeFlat`) and for many lines in one call (`decodeMany`). On V8 (Chrome, Node, Deno) it also uses JS String Builtins, which made short lines 10 to 65% faster. For `[lat, lng]` arrays the default entry is as fast or faster. Numbers: [docs/platforms.md](docs/platforms.md#wasm).
- Size depends on what you import, because bundlers drop what you don't use. In a browser bundle `import { decode }` is 1,065 bytes gzipped, `import { decode, encode }` 1,898, and every export 2,205. The small single-purpose polyline libraries are 230 to 500 bytes; the difference is strict mode, the exact path for precision 7 and up, and the options. Every import and bundler: [docs/platforms.md](docs/platforms.md#size).
- Each runtime gets its own entry through package.json conditions (`node`, `bun`, `deno`, `workerd`, `browser`, `react-native`). Why each one exists, and what Jest, webpack, Vite, Parcel, Metro and TypeScript pick: [docs/platforms.md](docs/platforms.md).

## Cloudflare Workers

The default import works as is. For `/wasm`, Workers won't compile WebAssembly at runtime, so import the `.wasm` file and pass it in:

```js
import { init, decodeMany } from '@duoquote/polytini/wasm';
import wasm from '@duoquote/polytini/polytini.wasm';

await init(wasm);
```

`npm run test:workers` runs the tests in workerd locally. More, and how fast it is there: [docs/platforms.md](docs/platforms.md#cloudflare-workers).

## CLI

```sh
pnpm dlx @duoquote/polytini decode "kviyHviWkCbkBsg@guA"
```

```sh
bunx @duoquote/polytini encode 51.5007,-0.1246 51.5014,-0.1419 51.5079,-0.1281
```

```sh
deno run -R jsr:@duoquote/polytini/cli decode --lines --file routes.txt
```

```sh
yarn dlx @duoquote/polytini decode "kviyHviWkCbkBsg@guA"
```

```sh
npx @duoquote/polytini decode -p 6 -f geojson --file route.txt
```

These work as written in bash, PowerShell and cmd. `yarn dlx` needs Yarn 2 or newer; on Yarn 1, use `npx`. Yarn 4.19 and newer won't install a release in its first day, so use another launcher then. For your own polylines, use single quotes in bash, zsh and PowerShell and double quotes in cmd: a polyline can contain `` ` ``, `\`, `|` and `^`. It reads `--file`, stdin or `-`, streams big inputs, and `--lines` gives one result per line. JSON, GeoJSON, CSV and NDJSON. All options: [docs/cli.md](docs/cli.md).

## Streaming

```js
import { DecodeStream } from '@duoquote/polytini/stream';

const res = await fetch(url);
for await (const points of res.body.pipeThrough(new DecodeStream())) draw(points);
```

Points come out as each chunk completes them, and they're exactly what `decode` gives on the whole string, errors included. There's also `PolylineDecoder` with `write` and `end` for code without streams, encoders, NDJSON lines and async iterables: [docs/streaming.md](docs/streaming.md).

## More

[Tests and coverage](docs/testing.md), [contributing](CONTRIBUTING.md), [releasing](RELEASING.md), and the [benchmark](https://github.com/Duoquote/polyline-benchmark) with every table and chart.

For AI agents: [llms.txt](llms.txt) has the API, the import paths and the mistakes to avoid. [CONTRIBUTING.md](CONTRIBUTING.md#for-ai-agents) says how to report a bug or send a PR.

## License

MIT, see [LICENSE](LICENSE).
