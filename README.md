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

polytini encodes and decodes [Google encoded polylines](https://developers.google.com/maps/documentation/utilities/polylinealgorithm), the strings Google Maps, OSRM, Valhalla, GraphHopper and Mapbox return for route geometry. It's strict by default, so a cut-off or corrupted string throws instead of drawing a wrong line. Node, Bun, Deno and browsers each get the code path that measured fastest there, and it has no dependencies. I wrote it while rebuilding [polyline-benchmark](https://github.com/Duoquote/polyline-benchmark), where it's compared with every other JavaScript polyline library.

## Install

```sh
npm install @duoquote/polytini      # or pnpm add, yarn add, bun add
deno add jsr:@duoquote/polytini
```

ESM and CommonJS, with TypeScript types. Node 22 or newer, Bun, Deno, browsers and Cloudflare Workers.

## Usage

```js
import { encode, decode } from '@duoquote/polytini';

encode([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]); // '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
decode('_p~iF~ps|U_ulLnnqC_mqNvxq`@');                         // [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]
decode(osrmGeometry, { precision: 6, order: 'lnglat' });        // OSRM polyline6, as [lng, lat]
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Duoquote/polyline-benchmark/main/docs/charts/speed-bun-decode-dark.svg">
  <img alt="Bun: decode speed of every polyline library relative to @mapbox/polyline on real-world lines; polytini is highlighted" src="https://raw.githubusercontent.com/Duoquote/polyline-benchmark/main/docs/charts/speed-bun-decode-light.svg">
</picture>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Duoquote/polyline-benchmark/main/docs/charts/speed-bun-encode-dark.svg">
  <img alt="Bun: encode speed of every polyline library relative to @mapbox/polyline on real-world lines; polytini is highlighted" src="https://raw.githubusercontent.com/Duoquote/polyline-benchmark/main/docs/charts/speed-bun-encode-light.svg">
</picture>

## Best at what

<!-- best -->
From the [benchmark](https://github.com/Duoquote/polyline-benchmark)'s 27 November 2026 run, across Bun, Node 22 to 26, Deno and Chrome. Leads under 1.3x are marked, because cells moved about 30% between rounds.

| Situation | Best | Runner-up | Margin |
|---|---|---|--:|
| Decode short lines (10 and 100 points) | @googlemaps/polyline-codec | @mapbox/polyline | 1.05x faster, within the noise |
| Decode long lines (10,000 and 100,000 points) | **@duoquote/polytini** | @googlemaps/polyline-codec | 1.14x faster, within the noise |
| Decode real-world lines (median 82 points) | **@duoquote/polytini** | @googlemaps/polyline-codec | 1.22x faster, within the noise |
| Encode, any length | **@duoquote/polytini** | google-polyline | 2.05x faster |
| Decode to typed arrays | **@duoquote/polytini (wasm, Float64Array)** | @duoquote/polytini (Float64Array) | 1.08x faster, within the noise |
| Encode from typed arrays | **@duoquote/polytini (wasm, Float64Array)** | @duoquote/polytini (Float64Array) | 1.05x faster, within the noise |
| Decode 1000 lines in one call | **@duoquote/polytini (wasm decodeMany/encodeMany)** | @duoquote/polytini (wasm, Float64Array) | 1.61x faster |
| Least memory per decode (10,000 points, [lat, lng] arrays) | **@duoquote/polytini (765.4 KB)** | @googlemaps/polyline-codec (766.2 KB) | 0.1% less |
| Smallest bundle (gzipped) | google-polyline (551 B) | @googlemaps/polyline-codec (568 B) | 17 B smaller |
| Strict validation (throws on bad input) | **@duoquote/polytini** | @lp-labs/polyline-codec | 15x faster |
| HERE Flexible Polyline (encode and decode) | **@duoquote/polytini (flexible)** | @here/flexpolyline | 24x faster |
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
npx @duoquote/polytini decode '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
echo '[[38.5,-120.2],[40.7,-120.95]]' | npx @duoquote/polytini encode
```

JSON, GeoJSON, CSV and plain lines; works with `bunx`, `pnpm dlx`, `yarn dlx` and `deno run jsr:@duoquote/polytini/cli`. All options: [docs/cli.md](docs/cli.md).

## More

[Tests and coverage](docs/testing.md), [releasing](RELEASING.md), and the [benchmark](https://github.com/Duoquote/polyline-benchmark) with every table and chart.

## License

MIT, see [LICENSE](LICENSE).
