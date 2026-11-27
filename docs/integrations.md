# Integrations

Each one is its own subpath, so none of them add bytes to the main entry. None of them import their map library either: you pass it in (`install(L)`, `createPolylineFormat({ Polyline, LineString })`), or they only return data the library takes. Their type files import the library's types, which TypeScript finds in your own install.

## Presets for routing engines

```js
import { decode, toGeoJSON } from '@duoquote/polytini';
import { osrm6, valhalla, graphhopper3d } from '@duoquote/polytini/presets';

decode(route.geometry, osrm6);          // [[lng, lat], ...], same as geometries=geojson
decode(leg.shape, valhalla);            // Valhalla and Stadia shapes, precision 6
toGeoJSON(path.points, graphhopper3d);  // GraphHopper elevation=true: [lng, lat, ele]
decode(path.points, { ...graphhopper3d, factor: path.points_encoded_multiplier });
```

`google`, `osrm`, `osrm6`, `valhalla`, `stadia`, `graphhopper`, `graphhopper3d`, `openrouteservice`, `openrouteservice3d`, `mapbox`, `mapbox6`, `strava` and `otp`. Each one is a plain options object with the precision, the order the engine uses for its own coordinates, and the elevation factor where there is one. The sources are cited in `src/presets.js`. Decoding matches every engine exactly. Encoding can differ by one unit from GraphHopper and openrouteservice on negative exact halves, and from OpenTripPlanner, which floors.

## Leaflet

A real plugin for Leaflet 1.9 and the Leaflet 2 betas, and a superset of the old `Polyline.encoded.js` plugin:

```js
import L from 'leaflet';
import { install } from '@duoquote/polytini/leaflet';
install(L); // or: import '@duoquote/polytini/leaflet/auto' when Leaflet is the global L

const line = L.Polyline.fromEncoded(str, { color: 'red', precision: 6 }).addTo(map);
line.toEncoded();                                  // '...'
L.Polygon.fromEncoded([outer, hole]).toEncoded();  // ['...', '...']
L.polylineEncoded(str).addTo(map);                 // factories, Leaflet 1.9 only
```

Multi-polylines and polygons with holes are arrays of strings. Leaflet 2 exports a frozen module namespace, so there `install` adds the static and prototype methods but skips the lower-case factories.

On a page without a bundler, Leaflet is often a `<script>` tag. polytini's IIFE (`dist/polytini.iife.js`, see [CDNs](platforms.md#cdns)) has the main API as the global `polytini`, not the plugin, so there `L.polyline(polytini.decode(str))` draws the line.

## Turf

```js
import { toFeature, toFeatureCollection, fromGeoJSON } from '@duoquote/polytini/turf';

turf.length(toFeature(str, { precision: 6, properties: { id: 1 }, bbox: true }));
fromGeoJSON(turf.simplify(toFeature(str), { tolerance: 0.001 })); // ['...']
```

`fromGeoJSON` takes any GeoJSON and returns one string per line: LineStrings, MultiLineString parts and polygon rings. There's also `toPolygonFeature(rings)` for Google-style encoded polygons.

## Google Maps

A drop-in for `google.maps.geometry.encoding.decodePath` and `encodePath`:

```js
import { decodePath, encodePath } from '@duoquote/polytini/google';

const path = decodePath(route.polyline.encodedPolyline); // LatLng[] once Maps has loaded
new google.maps.Polyline({ path, map });
encodePath(polyline.getPath());                           // MVCArray<LatLng> to string
decodePath(str, { LatLng: false });                       // {lat, lng} literals, in Node too
```

It's strict by default too. Google's documentation doesn't say what `decodePath` does with bad input.

## OpenLayers

A subclass of `ol/format/Polyline`, with the same options and output. You pass in ol's classes, so polytini doesn't import ol:

```js
import Polyline from 'ol/format/Polyline.js';
import LineString from 'ol/geom/LineString.js';
import { createPolylineFormat } from '@duoquote/polytini/openlayers';

const FastPolyline = createPolylineFormat({ Polyline, LineString }); // or createPolylineFormat(ol) with the full build
const format = new FastPolyline({ factor: 1e6 });
const feature = format.readFeature(route.geometry, { featureProjection: 'EPSG:3857' });
```

On Node 25 it read 1.1 to 1.8 times and wrote 1.2 to 1.9 times as fast as ol's own format, depending on line length (`node --expose-gc bench/openlayers.js`). One thing it fixes: ol's own `writeGeometry` overwrites the geometry's coordinates with the deltas when no projection change is involved, so writing the same geometry twice gives garbage. This one leaves the geometry alone. Unusual input (bad strings, huge values, tile-pixel projections) goes to ol's own methods on a copy, so the output stays identical to ol's.

## MapLibre GL and Mapbox GL

```js
import { addPolylineLayer, setPolylineData } from '@duoquote/polytini/maplibre'; // or /mapbox
import { osrm6 } from '@duoquote/polytini/presets';

map.on('load', () => addPolylineLayer(map, 'route', route.geometry, { ...osrm6, layer: { paint: { 'line-width': 4 } } }));
setPolylineData(map, 'route', [a.geometry, b.geometry], { ...osrm6, properties: [{ name: 'a' }, { name: 'b' }] });
```

`polylineSource()` and `polylineData()` build the GeoJSON source and FeatureCollection without touching a map. Both map libraries take the same calls, so `/mapbox` re-exports `/maplibre` with Mapbox's types. On JSR, where the types can't import maplibre-gl or mapbox-gl, the map parameter is a structural `MapLike` that any real `Map` fits; before 0.1.5 it rejected them. `test/fixtures/jsr` checks every JSR type file against the real libraries' objects.

## deck.gl

Decodes straight into deck.gl's binary attribute format, with one buffer for all lines and no array per point:

```js
import { PathLayer } from '@deck.gl/layers';
import { binaryPaths } from '@duoquote/polytini/deckgl';

const data = binaryPaths(routes.map((r) => r.geometry), { precision: 6, float32: true });
new PathLayer({ id: 'routes', data, _pathType: 'open', getWidth: 3, widthUnits: 'pixels' });
```

`binaryPolygons()` does the same for polygon fills. In deck.gl 9.4 the composite `PolygonLayer` doesn't take binary data, so use `SolidPolygonLayer`, plus a `PathLayer` over the same buffer for outlines. TripsLayer timestamps come out as a Float32Array, because a Float64Array drew nothing.

## HERE Flexible Polyline

A different format, with a header and an optional third dimension, fully separate from the Google-format code:

```js
import { encode, decode, ELEVATION } from '@duoquote/polytini/flexible';

const str = encode({ polyline: [[50.10228, 8.69821, 112.5], [50.10201, 8.69567, 113.1]], precision: 5, thirdDim: ELEVATION, thirdDimPrecision: 1 });
const { precision, thirdDim, polyline } = decode(str);
```

The same arguments and results as `@here/flexpolyline`, so it's a drop-in. It matches every line of HERE's official test data, including precision 11 and up, where `@here/flexpolyline` itself doesn't.
