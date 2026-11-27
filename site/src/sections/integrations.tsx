import { useCallback } from "react"
import type { Map as MapLibreMap } from "maplibre-gl"
import { addPolylineLayer } from "@duoquote/polytini/maplibre"
import { osrm6 } from "@duoquote/polytini/presets"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CodeBlock } from "@/components/code-block"
import { CommandLine } from "@/components/copy-button"
import { MapView, MAP_COLORS } from "@/components/map-view"
import { Section } from "@/components/section"
import { BERLIN } from "@/lib/examples"
import { useDark } from "@/lib/use-dark"

const SNIPPETS: { id: string; label: string; code: string; note: string }[] = [
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
]

const CLI = [
  "pnpm dlx @duoquote/polytini decode '_p~iF~ps|U_ulLnnqC_mqNvxq`@'",
  "bunx @duoquote/polytini decode '_p~iF~ps|U_ulLnnqC_mqNvxq`@'",
  "deno run jsr:@duoquote/polytini/cli decode '_p~iF~ps|U_ulLnnqC_mqNvxq`@'",
  "npx @duoquote/polytini decode '_p~iF~ps|U_ulLnnqC_mqNvxq`@'",
]

const LIVE = `addPolylineLayer(map, 'route', BERLIN, {
  ...osrm6,
  layer: { paint: { 'line-width': 4, 'line-color': '${MAP_COLORS.light.route}' } },
});`

export function Integrations() {
  const dark = useDark()
  const onStyle = useCallback(
    (map: MapLibreMap) => {
      // The snippet above, run for real.
      addPolylineLayer(map, "route", BERLIN, {
        ...osrm6,
        layer: { paint: { "line-width": 4, "line-color": dark ? MAP_COLORS.dark.route : MAP_COLORS.light.route } },
      })
    },
    [dark]
  )

  return (
    <Section
      id="integrations"
      title="Integrations"
      intro="Each one is its own import, so none of them add bytes to the main entry, and none of them import their map library: you pass it in, or hand it what they return."
    >
      <Tabs defaultValue="maplibre">
        <TabsList className="h-auto flex-wrap">
          {SNIPPETS.map((s) => (
            <TabsTrigger key={s.id} value={s.id} className="flex-none">
              {s.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="cli" className="flex-none">CLI</TabsTrigger>
        </TabsList>
        {SNIPPETS.map((s) => (
          <TabsContent key={s.id} value={s.id} className="mt-4 flex flex-col gap-2">
            <CodeBlock code={s.code} />
            <p className="max-w-3xl text-xs text-muted-foreground">{s.note}</p>
          </TabsContent>
        ))}
        <TabsContent value="cli" className="mt-4 flex flex-col gap-2">
          {CLI.map((c) => (
            <CommandLine key={c} command={c} />
          ))}
          <p className="max-w-3xl text-xs text-muted-foreground">
            It reads stdin too: <code>{"echo '[[38.5,-120.2],[40.7,-120.95]]' | bunx @duoquote/polytini encode"}</code>.
            JSON, GeoJSON, CSV and plain lines; <code>-p 6</code> for precision 6, <code>-f geojson</code> for
            GeoJSON out.
          </p>
        </TabsContent>
      </Tabs>

      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-medium">Live: the MapLibre helper</h3>
          <p className="text-xs text-muted-foreground">
            This map runs the call below with the Berlin route from the playground. <code>osrm6</code> says precision 6,
            and the helper adds a GeoJSON source and a line layer.
          </p>
          <CodeBlock code={LIVE} />
        </div>
        <MapView
          onStyle={onStyle}
          fitTo={[[13.38719, 52.51701], [13.42856, 52.52944]]}
          label="Map drawn by addPolylineLayer from @duoquote/polytini/maplibre"
          className="h-72 sm:h-80"
        />
      </div>
    </Section>
  )
}
