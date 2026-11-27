// Type check of the JSR copies (types/*.jsr.d.ts) against the real map
// libraries' types: what a JSR user passes has to fit the structural types.
// Not run, only compiled: npx tsc -p test/fixtures/jsr
/// <reference types="google.maps" />
import type * as MapLibre from '../../../types/maplibre.jsr.d.ts';
import type * as Mapbox from '../../../types/mapbox.jsr.d.ts';
import type * as Turf from '../../../types/turf.jsr.d.ts';
import type * as OpenLayers from '../../../types/openlayers.jsr.d.ts';
import type * as Google from '../../../types/google.jsr.d.ts';
import type * as Leaflet from '../../../types/leaflet.jsr.d.ts';
import * as maplibregl from 'maplibre-gl';
import mapboxgl from 'mapbox-gl';
import * as L from 'leaflet';
import OlPolyline from 'ol/format/Polyline.js';
import LineString from 'ol/geom/LineString.js';
import * as turf from '@turf/helpers';
import type { Feature, FeatureCollection, LineString as GeoLine } from 'geojson';

declare const ml: typeof MapLibre, mb: typeof Mapbox, tf: typeof Turf, olp: typeof OpenLayers, gm: typeof Google, lf: typeof Leaflet;
const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

// MapLibre: a real Map in and out, and the source for addSource and a style.
declare const mlMap: maplibregl.Map;
const mlSame: maplibregl.Map = ml.addPolylineLayer(mlMap, 'route', encoded, { precision: 6, layer: { paint: { 'line-width': 4 } }, beforeId: 'labels' });
ml.setPolylineData(mlMap, 'route', [encoded, encoded]);
mlMap.addSource('route2', ml.polylineSource(encoded, { source: { lineMetrics: true } }));
new maplibregl.Map({ container: 'map', style: { version: 8, sources: { route: ml.polylineSource(encoded) }, layers: [{ id: 'route', type: 'line', source: 'route' }] } });
(mlMap.getSource('route') as maplibregl.GeoJSONSource).setData(ml.polylineData(encoded));
const fc: FeatureCollection<GeoLine, { name: string }> = ml.polylineData(encoded, { properties: { name: 'x' } });

// Mapbox GL: the same functions on a mapbox-gl Map.
declare const mbMap: mapboxgl.Map;
const mbSame: mapboxgl.Map = mb.addPolylineLayer(mbMap, 'route', encoded, { layer: { paint: { 'line-width': 4 }, slot: 'top' } });
mb.setPolylineData(mbMap, 'route', encoded);
mbMap.addSource('route2', mb.polylineSource([encoded], { properties: [{ n: 1 }] }));
(mbMap.getSource('route') as mapboxgl.GeoJSONSource).setData(mb.polylineData(encoded));

// Turf: the features go into Turf's helpers and back.
const feature = tf.toFeature(encoded, { properties: { name: 'a' }, id: 1 });
const turfLine: Feature<GeoLine, { name: string }> = feature;
tf.fromGeoJSON(turf.lineString([[1, 2], [3, 4]]));
tf.fromGeoJSON(turf.featureCollection([turf.lineString([[1, 2], [3, 4]])]));
const collection: FeatureCollection<GeoLine> = tf.toFeatureCollection([encoded, encoded]);

// OpenLayers: ol's classes in, a subclass of ol's Polyline out.
const Format = olp.createPolylineFormat({ Polyline: OlPolyline, LineString });
const format: OlPolyline = new Format({ factor: 1e6 });

// Google Maps: real LatLngs and MVCArrays.
declare const gLine: google.maps.Polyline;
const path: Google.LatLng[] = gm.decodePath(encoded, { LatLng: google.maps.LatLng });
const gPath: google.maps.LatLng[] = gm.decodePath(encoded, { LatLng: google.maps.LatLng }) as google.maps.LatLng[];
gm.encodePath(gLine.getPath());
gm.encodePath([new google.maps.LatLng(1, 2), { lat: 1, lng: 2 }]);
new google.maps.Polyline({ path: gm.decodePath(encoded, { LatLng: false }) });

// Leaflet: install takes the real namespace and gives it back.
const sameL: typeof L = lf.install(L);

export { mlSame, fc, mbSame, turfLine, collection, format, path, gPath, sameL };
