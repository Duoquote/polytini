# API

## Usage

```js
import { encode, decode, decodeFlat, encodeFlat, decodeLatLng, toGeoJSON, fromGeoJSON } from '@duoquote/polytini';

decode(str, 6);                              // precision 6, for OSRM polyline6 or Valhalla
decode(str, { precision: 6, order: 'lnglat' }); // [lng, lat] tuples
encode(points, { factor: 1e5 });             // a factor instead of a precision
encode([{ lat: 38.5, lng: -120.2 }]);        // objects work too: lat/latitude, lng/lon/longitude
decodeLatLng(str);                           // [{ lat, lng }], for Google Maps and Leaflet
toGeoJSON(str);                              // { type: 'LineString', coordinates: [[lng, lat], ...] }
fromGeoJSON(lineStringOrFeature);
decodeFlat(str);                             // one Float64Array [lat0, lng0, lat1, lng1, ...]
encodeFlat(new Float64Array([38.5, -120.2]));
```

Options are a number (the precision) or an object:

- `precision`: decimal places, 0 to 15. Default 5.
- `factor`: multiply by this instead of `10 ** precision`.
- `order`: `'latlng'` (default) or `'lnglat'`. The string itself always stores latitude first; this only changes the tuples you pass in and get back.
- `strict`: default `true`. See below.
- `onIssue`: with `strict: false`, a function that gets each error strict mode would have thrown. See [below](#reporting-what-lenient-mode-skipped).
- `dimensions`: values per point, 1 to 16. Default 2. GraphHopper puts elevation third.
- `zFactor`: the factor for the third and later values, like GraphHopper's elevation multiplier of 100.

The precision isn't stored in the string, so both sides have to agree. A precision 6 string decoded at precision 5 gives coordinates ten times too big, with no error.

### Strict mode

By default, malformed input throws a `PolylineError` with a `code` and, where it makes sense, an `index`:

- `char`: a character outside `?` to `~` (index of the character)
- `truncated`: the string ends inside a value or a point
- `overflow`: a value past 2^53, where Number math stops being exact
- `coordinate`: NaN, Infinity, `null` or a missing coordinate in encode (index of the point)
- `input`: not a string or an array
- `option`: a bad option

```js
decode('_p~iF~ps|U_ulLnnq');                    // throws PolylineError: Truncated at 17 (code 'truncated')
decode('_p~iF~ps|U_ulLnnq', { strict: false }); // [[38.5, -120.2]]
```

With `strict: false` it never throws on bad data: decode skips invalid characters and drops an incomplete last point, and encode treats missing or non-finite coordinates as 0.

### Reporting what lenient mode skipped

`onIssue` tells you what `strict: false` skipped over, so you can decode a broken string and still say what was wrong with it, without decoding it twice:

```js
const issues = [];
decode('_p~iF~ps|U_ul LnnqC_mqNvxq`', { strict: false, onIssue: (e) => issues.push(e) });
// [[38.5, -120.2], [40.7, -120.95]]
// issues: PolylineError 'char' at 13, then 'truncated' at 27
```

It gets a `PolylineError`, created and not thrown, for each problem: every invalid character, every value past 2^53 (once, at the character where it passes), and a string that ends inside a value or a point (once, at the end). The first one is exactly the error strict mode throws for that input: the same code, index and message. Later ones have their index in the input as it is, not in what's left after skipping. Usually there's just one.

Decoding goes on after `onIssue` returns, and the output is the same as `strict: false` without it. To stop at the first problem, throw from it; decode then throws your error. With `strict: true` it's never called, and encode doesn't call it.

Every decoder that takes `strict` takes it: `decode`, `decodeFlat`, `decodeLatLng`, `toGeoJSON` and the presets on every entry, `/wasm` (`decodeMany` reports each line's issues with the index in that line), the integrations that decode, `/stream` (the index is in the whole input, wherever the chunks were cut, and the line decoders add the 1-based `line`) and `/flexible`, which now takes `{ strict: false, onIssue }` too. Its header is always strict, because nothing after it can be read without it.

It costs nothing when you don't use it: only the slow decoder that already handles bad input reads it, so decoding valid input runs the same code as before. In paired runs against 0.1.7 the difference stayed inside the noise ([CHANGELOG.md](../CHANGELOG.md) has the numbers). `import { decode }` grew by 50 bytes gzipped.

I made strict the default because it's cheap: on 10-point lines the checks measured 0 to 4%, and nothing I could separate from the noise on longer ones. The decoder ORs every character code into one integer and checks it once at the end, and the encoder's range check also catches NaN. Most other libraries silently return a wrong last point for a truncated string; see `npm run behavior` in the benchmark repo.

### Rounding

Encoding rounds half away from zero, as Google's algorithm description says: 0.000005 becomes 1 unit at precision 5, and -0.000005 becomes -1. That matches `@googlemaps/polyline-codec`, `@mapbox/polyline`, PostGIS and OSRM.

One difference from most JavaScript libraries: they round with `Math.floor(Math.abs(x) + 0.5)`, which turns 0.49999999999999994 (the largest double below 0.5) into 1, because the addition itself rounds up. polytini gives 0, like C's `round()` and PostGIS. It only matters for that one value at each scale.

Decoding divides by the factor instead of multiplying by its inverse, so 38.5 comes back as exactly 38.5.

## Entry points

The package picks an entry point by export condition, so you don't import these by hand:

| Condition | File | What's different |
|---|---|---|
| `workerd` | `src/deno.js` | Cloudflare Workers; the same file as deno |
| `react-native` | `src/web.js` | Metro on iOS and Android, which has no `node:buffer` |
| `bun` | `src/bun.js` | the same as node |
| `deno` | `src/deno.js` | byte buffers through TextEncoder and TextDecoder |
| `browser` | `src/browser.js` | the core, but long lines encode through TextDecoder (`dist/web.cjs` for `require` in Jest) |
| `node`, `module-sync` | `src/node.js` | Buffer-backed decode and encode |
| `default` | `src/web.js` | the portable core and nothing else |

`@duoquote/polytini/web`, `/browser` and `/node` pick one explicitly. All of them have the same API and give the same output; the test suite runs every check against each of them. `require()` gets the same files on Node 22.12 and newer and on Bun, and the CommonJS build in `dist/` elsewhere; [docs/platforms.md](platforms.md#module-formats-and-tools) has the whole order, the fields for tools that ignore `exports`, and the CDN and `<script>` URLs.

## Streaming

`@duoquote/polytini/stream` decodes a polyline that arrives in chunks and encodes points as they come, with the same results and errors as `decode` and `encode` on the whole input, and reads one polyline per line (NDJSON included). It has TransformStreams, a `PolylineDecoder` and `PolylineEncoder` with `write` and `end`, and async iterables: [streaming.md](streaming.md).


## Smaller: /lite

`@duoquote/polytini/lite` is `decode` and `encode` for `[lat, lng]` tuples at precision 0 to 6, and nothing else. It's the default entry's fast loops without the exact fallback paths and the options:

```js
import { decode, encode } from '@duoquote/polytini/lite';

decode('_p~iF~ps|U_ulLnnqC');              // [[38.5, -120.2], [40.7, -120.95]]
decode(str, 6);                             // precision 6, still [lat, lng]
encode([[38.5, -120.2], [40.7, -120.95]]);  // '_p~iF~ps|U_ulLnnqC'
```

Which one to pick: lite is for bundle size in the browser. On a server (Node, Bun, Deno) use the main entry. It's faster on long lines there, because it has the runtime's own byte paths, and the bytes don't matter.

### Size

Gzipped bytes, each import built the same way with esbuild, Rollup (node-resolve, commonjs, terser) and webpack 5 in production mode:

| import | /lite | default entry | @placemarkio/polyline | @googlemaps/polyline-codec | @pirxpilot/google-polyline |
|---|--:|--:|--:|--:|--:|
| `decode` | 295 / 298 / 296 | 1063 / 1021 / 1043 | 230 / 236 / 234 | 252 / 247 / 245 | 305 / 302 / 300 |
| `encode` | 349 / 352 / 349 | 1432 / 1433 / 1495 | 293 / 297 / 296 | 340 / 340 / 338 | 295 / 298 / 296 |
| both | 503 / 512 / 509 | 1895 / 1907 / 1954 | 424 / 432 / 432 | 472 / 481 / 479 | 491 / 494 / 491 |

So it's a quarter of the default entry, and within about 80 bytes of the small single-purpose libraries. Those bytes buy the checks below and the speed of the default entry's loops. I tried smaller versions, and each was slower:

- A do/while decoder that appends with `push`, like most small libraries: 32 bytes smaller, and 18 to 39% slower than the core on Bun from 100 points, 5 to 11% on Node 24.
- Encoding with a loop per character instead of a table of the 1,024 shortest values: 52 bytes smaller, and 39% slower on the real-world lines on Node 24.
- `10 ** precision` instead of a table of seven factors: 16 bytes smaller, and about 50 ns per call on Node 22, a third of decoding 10 points.

### Speed

Paired runs with `bench/ab.js --mode same` (both modules in one process, sampled in ABBA order, 10 rounds, pinned to 4 cores) and fresh Chrome contexts for Chrome. Time per call, lite divided by the other one, so 0.90 is lite 10% faster; "same" means the 95% interval included 1.00. A against itself came out within about 1% on Node and 3% in Chrome. Every call passes the precision.

Against the portable core (`/web`), which is what the default entry uses for short lines everywhere and for decoding in browsers:

| | Node 24 | Bun 1.4.3 | Deno 2.5 | Chrome 158 |
|---|--:|--:|--:|--:|
| decode, 10 points | 1.03 | 0.94 | 0.93 | same |
| decode, 100 points | 0.97 | same | 0.93 | 0.94 |
| decode, real-world lines | same | same | 0.98 | 0.97 |
| decode, 10,000 points | 0.98 | same | 0.95 | 0.96 |
| encode, 10 points | 0.90 | 0.91 | 0.85 | 0.93 |
| encode, 100 points | 0.83 | 0.87 | 0.82 | 0.83 |
| encode, real-world lines | 0.92 | 0.95 | 0.93 | 0.94 |
| encode, 10,000 points | 0.88 | 0.89 | 0.88 | 0.88 |

Against each runtime's own entry, the one the bare import picks there:

| | Node 22 | Node 24 | Node 26 | Bun 1.4.3 | Deno 2.5 | Chrome 158 |
|---|--:|--:|--:|--:|--:|--:|
| decode, 10 points | 1.01 | same | 0.92 | 0.95 | 0.91 | same |
| decode, 100 points | 1.09 | 1.05 | 1.15 | 0.96 | 0.97 | same |
| decode, real-world lines | 1.29 | 1.29 | 1.32 | 1.11 | 1.22 | same |
| decode, 10,000 points | 1.35 | 1.29 | 1.33 | 1.08 | 1.23 | same |
| encode, 10 points | 1.34 | 1.25 | 1.31 | 1.52 | 0.85 | 0.93 |
| encode, 100 points | 1.46 | 1.38 | 1.51 | 1.82 | 1.28 | 0.84 |
| encode, real-world lines | same | 0.97 | 0.95 | 1.37 | 0.95 | 0.88 |
| encode, 10,000 points | 1.43 | 1.34 | 1.30 | 1.61 | 1.36 | 1.26 |

The Node and Bun entries decode through a `Buffer` and encode into one, and Deno's decodes long lines through `TextEncoder`, so on a server the main entry is up to 1.8 times faster. In Chrome lite is as fast as the browser entry, apart from encoding long lines, where the browser entry builds the string with `TextDecoder`.

Against the small libraries it competes with on size, from 10 rounds with all five in one process (Node, Bun, Deno) or 8 rounds of fresh contexts (Chrome). Their time per call divided by lite's, so 2.0 means lite is twice as fast:

| library | runtime | decode 10 | decode 100 | decode real-world | decode 10,000 | encode 10 | encode 100 | encode real-world | encode 10,000 |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|
| @placemarkio/polyline | Node 24 | 1.09 | 1.16 | 1.15 | 1.10 | 1.43 | 1.43 | 2.41 | 1.80 |
| @placemarkio/polyline | Bun 1.4.3 | 1.07 | 1.38 | 1.33 | 1.22 | 1.70 | 2.11 | 1.92 | 2.36 |
| @placemarkio/polyline | Deno 2.5 | 1.12 | 1.18 | 1.17 | 1.10 | 1.43 | 1.46 | 2.36 | 1.83 |
| @placemarkio/polyline | Chrome 158 | 1.10 | same | 1.09 | same | 1.32 | 1.44 | 2.31 | 1.80 |
| @googlemaps/polyline-codec | Node 24 | 1.34 | same | 1.06 | 0.94 | 3.28 | 3.55 | 5.29 | 6.11 |
| @googlemaps/polyline-codec | Bun 1.4.3 | 1.09 | 1.14 | 1.22 | 1.08 | 4.26 | 4.58 | 4.29 | 5.42 |
| @googlemaps/polyline-codec | Deno 2.5 | 1.30 | same | 1.05 | 0.92 | 3.40 | 3.64 | 5.23 | 6.33 |
| @googlemaps/polyline-codec | Chrome 158 | 1.29 | 0.91 | 1.04 | 0.88 | 2.02 | 2.08 | 3.16 | 2.88 |
| @pirxpilot/google-polyline | Node 24 | 1.46 | 1.50 | 1.38 | 1.38 | 1.17 | 1.30 | 2.01 | 1.52 |
| @pirxpilot/google-polyline | Bun 1.4.3 | 3.10 | 3.13 | 2.74 | 3.01 | 0.94 | 1.25 | 1.48 | 1.50 |
| @pirxpilot/google-polyline | Deno 2.5 | 1.62 | 1.72 | 1.50 | 1.55 | 1.17 | 1.29 | 1.96 | 1.66 |
| @pirxpilot/google-polyline | Chrome 158 | 1.73 | 1.61 | 1.52 | 1.56 | 1.08 | 1.30 | 1.90 | 1.42 |
| google-polyline | Node 24 | 1.05 | 1.31 | 1.27 | 1.25 | 1.12 | 1.22 | 2.11 | 1.74 |
| google-polyline | Bun 1.4.3 | 1.17 | 1.51 | 1.45 | 1.34 | same | 1.11 | 1.43 | 1.66 |
| google-polyline | Deno 2.5 | 1.07 | 1.30 | 1.29 | 1.23 | 1.13 | 1.25 | 2.06 | 1.72 |
| google-polyline | Chrome 158 | 1.17 | 1.10 | 1.19 | 1.12 | 1.04 | 1.18 | 1.98 | 1.59 |

So lite is faster than `@placemarkio/polyline`, the one library that's smaller, on every runtime and line length except two Chrome cells, where they're even: 1.07 to 1.38 times for decoding and 1.32 to 2.41 times for encoding. Against all four it decodes up to 3.1 times and encodes up to 6.3 times as fast. The exceptions: `@googlemaps/polyline-codec` decodes 10,000 points 6 to 12% faster on Node, Deno and Chrome, and 100 points 9% faster in Chrome, and `@pirxpilot/google-polyline` encodes 10 points 6% faster on Bun.

### What it checks

For everything it accepts, lite gives exactly what the default entry gives: the same numbers, the same string, the same rounding (half away from zero, exact at 0.49999999999999994) and the same division by the factor. When it can't, it throws, so it never returns a different number. `test/lite.test.js` checks this against the default entry on the vectors, the PostGIS fixture, the real-world lines and random valid and broken input, on Node, Bun, Deno, Chrome and workerd.

What each check costs in a decode-only bundle, gzipped, from `scripts/size.js`'s esbuild build:

| check | throws | bytes |
|---|---|--:|
| none (what most small libraries do) | | 245 |
| a string cut inside a value, or a latitude without a longitude | `Error('Invalid polyline')` | +31 |
| a character outside `?` to `~` | `Error('Invalid polyline')` | +11 |
| a value of 7 or more chunks, past what 32-bit math decodes | `Error('Invalid polyline')` | +5 |
| a precision other than 0 to 6 | `Error('Invalid polyline')` | +4 |
| `null` as the precision means 5, like the default entry | | +1 |

Most of the first row is the `throw` itself. In `encode`, the check for NaN, Infinity, a missing value or a coordinate past 2^29 units is 48 bytes (301 without it, 349 with). Rejecting `null` there too would be 8 more. Rounding adds 0.49999999999999994, the largest double below 0.5, and truncates, which is exact half away from zero and 16 bytes smaller than the default entry's add-0.5-and-fix.

### Where it differs from the default entry

- The errors are plain `Error`s with the message `'Invalid polyline'` or `'Invalid coordinate'`. There's no `PolylineError`, `code` or `index`, and `err instanceof PolylineError` is false. Use the default entry if you need to tell errors apart.
- Precision is a number from 0 to 6, or `null` and `undefined` for 5. There's no options object, so no `order`, `factor`, `dimensions` or `strict: false`, and presets don't work. `decode` throws on anything else, and `encode` throws on its first point.
- Values have to fit 32-bit math. That's every valid coordinate at precision 6 and below; a value past 2^29 units (536 degrees at precision 6) throws. The default entry switches to exact Number math there instead.
- `encode` reads `p[0]` and `p[1]` of each point, so `{ lat, lng }` objects throw. `null` multiplies to 0, so `[null, 1]` encodes as `[0, 1]`, where the default entry throws. Numeric strings and booleans convert the same way in both.
- `decode` doesn't check that it got a string: `decode(123)` returns `[]`.

Without a bundler, `dist/polytini-lite.iife.js` sets the same global `polytini`, with just `decode` and `encode`.
## Detecting the encoding

A Google-format string doesn't say which precision it was written at, which coordinate comes first or how many values a point has. `@duoquote/polytini/detect` works it out from the numbers:

```js
import { detect, decodeAuto } from '@duoquote/polytini/detect';

// OSRM's polyline6 route through Berlin, from test/fixtures/presets.
detect(geometry)[0];
// { format: 'google', precision: 6, order: 'latlng', dimensions: 2,
//   presets: ['osrm6', 'valhalla', 'stadia', 'mapbox6'], confidence: 0.54, valid: true,
//   issue: null, reasons: [], options: { precision: 6, order: 'latlng', dimensions: 2 }, ... }

const { coordinates, precision, issues } = decodeAuto(geometry); // coordinates: [[lat, lng], ...]
```

The runner-up there is the same precision read longitude first, at 0.25: swapped, Berlin is at 13.4 N, 52.5 E, a plausible place too. That one sits in the Gulf of Aden, so with the land mask below the first reading gets 0.98.

`detect(str, options?)` returns every reading it tried, best first. It tries precision 5, 6, 7, 4 and 8, latitude first and longitude first, two values per point and three (elevation in centimeters, the way GraphHopper and openrouteservice write it), and HERE's Flexible Polyline when the string starts with a valid header. That's 20 Google readings, plus Flexible. Each one has:

- `format`, `precision`, `order`, `dimensions`, and `zFactor` (100) for three values per point. For Flexible they come from the header, with `thirdDim` and `thirdDimPrecision`.
- `confidence`: the reading's probability among all of them, from 0 to 1. They add up to 1.
- `valid` and `issue`: whether strict mode decodes the string this way, and if not, the `PolylineError` it throws. The issue's index is how far strict decoding got.
- `reasons`: what counted against it, like `'100% of points out of range'` or `'cut off with 3 values per point'`.
- `presets`: the presets with that precision and number of values, like `['osrm6', 'valhalla', 'stadia', 'mapbox6']`. A preset's `order` is about the tuples it gives back, not the string, so it says nothing about `order` here.
- `options`: pass them to `decode` or `decodeFlat` to get `[lat, lng]` points for this reading, whichever order the string has.

`decodeAuto(str, options?)` runs `detect`, decodes the string leniently with the best reading, and returns that reading with `coordinates`, the `issues` that `onIssue` reported (empty for a valid string) and all the `candidates`.

Options, all optional: `precisions`, `orders` and `dimensions` (arrays of what to try), `flexible: false` to skip Flexible, `isLand` (below) and `sample`.

### How it scores

Each reading gets a score for how much its points look like real geometry, and the scores become probabilities with a softmax:

- Every point in range. A precision 6 string read at 5 gives latitudes ten times too big, usually past 90, and so does a longitude read as a latitude.
- The typical distance between points: tens to hundreds of meters scores best. It's broad on purpose, because 1 Hz walking tracks (about 1 m) and simplified overview lines (Mapbox's test response has 3.5 km steps, Google's example 250 km) are both real. A line with only a few steps counts for less here.
- No jumps 10,000 times longer than the typical step.
- Each step going on roughly in the direction of the last one. On the 1000 real-world lines the average cosine of the turns was 0.85, and under 0.54 for 1 in 100. A wrong number of values per point mixes latitude, longitude and elevation deltas, and the directions come out random: about 0.
- Elevation between -500 and 9000 m, for three values per point.
- Valid in strict mode: a reading the string is cut off under, while another isn't, loses points. Characters outside the format count against every Google reading, and digits or `-` count for Flexible.
- A prior: precision 5 is the most common, then 6, then 7, and latitude first is the format's own order.
- With `isLand`, points at sea.

The string is decoded once, with the core's `decodeFlat` at factor 1. That gives the integers every Google reading shares: a precision only divides them, an order swaps two, and three values per point regroups them. Scoring then looks at up to `sample` points (default 256) spread over the line, so a long line costs one fast decode and a fixed amount of work. On the 10,000-point benchmark track `detect` took about 1.2 ms on Node 25, where `decode` took 0.15 ms. At 10 points it took 0.07 ms. `decodeAuto` adds one `decode`.

### Accuracy

`node scripts/detect-accuracy.js` (and `--land` for the mask below) prints these tables. "Right" means the best reading has the precision, order and number of values the string was written with.

| Input | Lines | Right | With `isLand` |
|---|--:|--:|--:|
| Real-world lines, precision 5 | 1000 | 100.0% | 100.0% |
| The same, re-encoded at precision 6 | 1000 | 99.9% | 99.9% |
| The same, re-encoded at precision 7 | 1000 | 99.9% | 99.9% |
| The same, longitude first | 1000 | 0.0% | 0.0% |
| Test vectors, decode cases with a known precision | 113 | 71.7% | 68.1% |
| PostGIS fixture: zeros, ties, bounds, one point | 116 | 44.8% | 39.7% |
| Generated tracks in 12 places, precision 5 | 600 | 100.0% | 91.7% |
| The same, precision 6 | 600 | 100.0% | 91.7% |
| The same, longitude first | 600 | 18.5% | 49.0% |
| GraphHopper's test strings with elevation | 2 | 100.0% | 100.0% |
| Generated tracks with elevation | 240 | 100.0% | 91.7% |

The real-world lines are the benchmark's 1000 routes, all in Turkey. The generated tracks are polyline-benchmark's GPS-like tracks (1 Hz, walking to highway speed, with stops), made even in meters: 50 tracks of 200 points around each place in the table below. The vectors and the PostGIS cases are edge cases by design: one or two points, zeros, the ends of the range. Many of them are the same line at more than one precision, so no reading gets all of them right.

Longitude first, per place:

| Place | Without | With `isLand` |
|---|--:|--:|
| Istanbul | 0% | 0% |
| Sao Paulo | 0% | 100% |
| Seattle | 34% | 100% |
| Sydney | 44% | 44% |
| Berlin | 0% | 100% |
| Nairobi | 0% | 100% |
| Singapore | 66% | 66% |
| Quito | 0% | 0% |
| Suva, Fiji (by the antimeridian) | 62% | 62% |
| Chukotka (by the antimeridian) | 16% | 16% |
| Svalbard (78 N) | 0% | 0% |
| McMurdo (78 S) | 0% | 0% |

### Latitude and longitude swaps

A swapped string can only be told apart when the swapped reading is impossible or implausible, and often it's neither. When the longitude is past 90, the latitude-first reading is out of range, but the same reading at precision 6 usually isn't, and then the precision prior and the step lengths decide. That's close to a coin toss (Seattle, Sydney, Singapore). When both readings land on land, nothing in the string tells them apart: Istanbul's routes read swapped land in Saudi Arabia, which is why the real-world lines score 0% longitude first, with or without a mask. I tried right angles at turns too, which a swapped reading stretches out of shape away from the equator. It picked the right order for 75% of the real-world lines, but weighting it enough to matter cost more correct readings of normal strings than it fixed, so it's not in. If you know your data, pass `orders: ['latlng']`.

`@duoquote/polytini/detect/land` has `isLand(lat, lng)`, a 1 by 1 degree grid from Natural Earth's 1:110m land (public domain). Pass it as `detect(str, { isLand })`, or pass your own function for a finer mask. It catches swaps and precision mix-ups that land at sea: Sao Paulo, Berlin and Nairobi swapped go from 0% to 100%, Seattle from 34%. It costs too: a line the mask counts as sea loses to any reading that lands on land. That's what happens to McMurdo, on the Ross Ice Shelf, whose tracks drop to 0% at every precision, and it's the 91.7% rows. Coasts are generous (a cell counts if it has any land in it), but ice shelves and small islands missing from the 1:110m data count as sea.

So the mask isn't in `/detect` itself, and you pick it:

| Mask | Gzipped | Longitude first, generated tracks |
|---|--:|--:|
| none | 0 B | 18.5% |
| 3 degrees | 689 B | 40.7% |
| 2 degrees | 993 B | 40.7% |
| 1 degree (`/detect/land`) | 2,067 B | 49.0% |

`/detect` is 4,051 bytes gzipped: the core's decoder, `/flexible`'s decoder, the presets and the scoring. No other entry includes it. `scripts/landmask.js` builds the mask, with `--cell` for the other sizes.

### Limits

- One polyline per call. Quotes or a trailing newline make every Google reading invalid, so trim the string first.
- A line of one or two points has little to go on beyond the range, so the prior decides most of those.
- Three values per point with an elevation that hardly changes (about 10 cm per point or less) can read as a valid two-value line with small wiggles. In the tests, with a steady climb of 10 cm per point, the two-value reading won for 1 track in 5.
- It doesn't try other `zFactor`s for the third value, `factor`s that aren't a power of ten, or more than three values per point.
