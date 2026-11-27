// Every static code snippet on the page. vite.config.ts highlights these
// with Shiki at build time, so the page ships HTML and no highlighter.
// Keep this file free of browser code: the config imports it in Node.

export type Lang = "bash" | "js" | "json"
export type Snippet = { code: string; lang: Lang }

export const INSTALL = [
  ["pnpm", "pnpm add @duoquote/polytini"],
  ["Bun", "bun add @duoquote/polytini"],
  ["Deno", "deno add jsr:@duoquote/polytini"],
  ["Yarn", "yarn add @duoquote/polytini"],
  ["npm", "npm i @duoquote/polytini"],
] as const

// The examples from docs/cli.md: Westminster, Buckingham Palace and
// Trafalgar Square, one way and back. The string has no backtick,
// backslash, | or ^, and polylines never contain ' " $ % or !, so double
// quotes keep it intact in every shell; the coordinates need no quotes.
// Checked by running each line in cmd, PowerShell 5.1 and Git Bash.
export const CLI_POLYLINE = "kviyHviWkCbkBsg@guA"
export const CLI_POINTS = "51.5007,-0.1246 51.5014,-0.1419 51.5079,-0.1281"

const runners = [
  "pnpm dlx @duoquote/polytini",
  "bunx @duoquote/polytini",
  "deno run jsr:@duoquote/polytini/cli",
  "yarn dlx @duoquote/polytini",
  "npx @duoquote/polytini",
]
export const CLI_DECODE = runners.map((r) => `${r} decode "${CLI_POLYLINE}"`)
export const CLI_ENCODE = runners.map((r) => `${r} encode ${CLI_POINTS}`)

export const INTEGRATIONS: { id: string; label: string; code: string; note: string }[] = [
  {
    id: "maplibre",
    label: "MapLibre / Mapbox GL",
    code: `import { addPolylineLayer, setPolylineData } from '@duoquote/polytini/maplibre'; // or /mapbox
import { osrm6 } from '@duoquote/polytini/presets';

map.on('load', () => addPolylineLayer(map, 'route', route.geometry, { ...osrm6, layer: { paint: { 'line-width': 4 } } }));
setPolylineData(map, 'route', [a.geometry, b.geometry], { ...osrm6, properties: [{ name: 'a' }, { name: 'b' }] });`,
    note: "polylineSource() and polylineData() build the GeoJSON source and FeatureCollection without touching a map. The map below runs the first call.",
  },
  {
    id: "leaflet",
    label: "Leaflet",
    code: `import L from 'leaflet';
import { install } from '@duoquote/polytini/leaflet';
install(L); // or: import '@duoquote/polytini/leaflet/auto' when Leaflet is the global L

const line = L.Polyline.fromEncoded(str, { color: 'red', precision: 6 }).addTo(map);
line.toEncoded();                                  // '...'
L.Polygon.fromEncoded([outer, hole]).toEncoded();  // ['...', '...']`,
    note: "Leaflet 1.9 and the Leaflet 2 betas. Leaflet 2's namespace is frozen, so there install skips the lower-case factories.",
  },
  {
    id: "turf",
    label: "Turf",
    code: `import { toFeature, toFeatureCollection, fromGeoJSON } from '@duoquote/polytini/turf';

turf.length(toFeature(str, { precision: 6, properties: { id: 1 }, bbox: true }));
fromGeoJSON(turf.simplify(toFeature(str), { tolerance: 0.001 })); // ['...']`,
    note: "fromGeoJSON here takes any GeoJSON and returns one string per line: LineStrings, MultiLineString parts and polygon rings.",
  },
  {
    id: "openlayers",
    label: "OpenLayers",
    code: `import Polyline from 'ol/format/Polyline.js';
import LineString from 'ol/geom/LineString.js';
import { createPolylineFormat } from '@duoquote/polytini/openlayers';

const FastPolyline = createPolylineFormat({ Polyline, LineString });
const format = new FastPolyline({ factor: 1e6 });
const feature = format.readFeature(route.geometry, { featureProjection: 'EPSG:3857' });`,
    note: "A subclass of ol/format/Polyline with the same options and output. Unlike ol's own, writeGeometry leaves your geometry alone.",
  },
  {
    id: "deckgl",
    label: "deck.gl",
    code: `import { PathLayer } from '@deck.gl/layers';
import { binaryPaths } from '@duoquote/polytini/deckgl';

const data = binaryPaths(routes.map((r) => r.geometry), { precision: 6, float32: true });
new PathLayer({ id: 'routes', data, _pathType: 'open', getWidth: 3, widthUnits: 'pixels' });`,
    note: "Decodes straight into deck.gl's binary attributes: one buffer for all lines, no array per point. binaryPolygons() does the same for fills.",
  },
  {
    id: "google",
    label: "Google Maps",
    code: `import { decodePath, encodePath } from '@duoquote/polytini/google';

const path = decodePath(route.polyline.encodedPolyline); // LatLng[] once Maps has loaded
new google.maps.Polyline({ path, map });
encodePath(polyline.getPath());                           // MVCArray<LatLng> to string`,
    note: "A drop-in for google.maps.geometry.encoding.decodePath and encodePath, strict by default too.",
  },
  {
    id: "stream",
    label: "Streaming",
    code: `import { DecodeStream } from '@duoquote/polytini/stream';

const res = await fetch(url);
for await (const points of res.body.pipeThrough(new DecodeStream(6))) {
  draw(points); // the points each chunk completed
}`,
    note: "For a polyline that arrives in pieces. The points are exactly what decode gives on the whole string, errors included, wherever the chunks are cut. There are also encoders, PolylineDecoder with write and end for code without streams, and one polyline per line for NDJSON.",
  },
]

export const LIVE = `addPolylineLayer(map, 'route', BERLIN, {
  ...osrm6,
  layer: { paint: { 'line-width': 4, 'line-color': '#0e7490' } },
});`

/** Everything to highlight at build time. */
export const SNIPPETS: Snippet[] = [
  ...INSTALL.map(([, code]) => ({ code, lang: "bash" as const })),
  ...[...CLI_DECODE, ...CLI_ENCODE].map((code) => ({ code, lang: "bash" as const })),
  ...INTEGRATIONS.map(({ code }) => ({ code, lang: "js" as const })),
  { code: LIVE, lang: "js" },
]

export const snippetKey = (code: string, lang: string) => `${lang}\n${code}`
