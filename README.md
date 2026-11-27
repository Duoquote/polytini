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
  <a href="docs/platforms.md#size"><img alt="gzipped size of the default entry" src="https://raw.githubusercontent.com/Duoquote/polytini/main/assets/badges/size.svg"></a>
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
| Smallest bundle (gzipped) | google-polyline (551 B) | @googlemaps/polyline-codec (568 B) | 17 B smaller |
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
| `@duoquote/polytini/wasm` | Opt-in WebAssembly build, with batch calls |

None of them import their map library; you pass it in or use what they return. Examples for each: [docs/integrations.md](docs/integrations.md).

## Notes

- The precision isn't stored in the string. A `polyline6` string decoded at 5 gives coordinates ten times too big, with no error.
- Strict mode throws on invalid characters, cut-off strings and NaN coordinates. Pass `strict: false` to never throw.
- `/wasm` only pays off for typed arrays on long lines and for many lines in one call (`decodeMany`). For `[lat, lng]` arrays the default entry is as fast or faster. Numbers: [docs/platforms.md](docs/platforms.md#wasm).
- Each runtime gets its own entry through package.json conditions (`node`, `bun`, `deno`, `workerd`, `browser`). Why each one exists: [docs/platforms.md](docs/platforms.md).

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
pnpm dlx @duoquote/polytini decode '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
```

```sh
bunx @duoquote/polytini decode '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
```

```sh
deno run jsr:@duoquote/polytini/cli decode '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
```

```sh
npx @duoquote/polytini decode '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
```

It reads stdin too: `echo '[[38.5,-120.2],[40.7,-120.95]]' | bunx @duoquote/polytini encode`. JSON, GeoJSON, CSV and plain lines. All options: [docs/cli.md](docs/cli.md).

## More

[Tests and coverage](docs/testing.md), [contributing](CONTRIBUTING.md), [releasing](RELEASING.md), and the [benchmark](https://github.com/Duoquote/polyline-benchmark) with every table and chart.

For AI agents: [llms.txt](llms.txt) has the API, the import paths and the mistakes to avoid. [CONTRIBUTING.md](CONTRIBUTING.md#for-ai-agents) says how to report a bug or send a PR.

## License

MIT, see [LICENSE](LICENSE).
