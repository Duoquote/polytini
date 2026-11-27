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
