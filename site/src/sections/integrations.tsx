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
import { CLI_DECODE, CLI_ENCODE, INTEGRATIONS, LIVE } from "@/snippets"

export function Integrations() {
  const dark = useDark()
  const onStyle = useCallback(
    (map: MapLibreMap) => {
      // The LIVE snippet, run for real.
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
          {INTEGRATIONS.map((s) => (
            <TabsTrigger key={s.id} value={s.id} className="flex-none">
              {s.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="cli" className="flex-none">
            CLI
          </TabsTrigger>
        </TabsList>
        {INTEGRATIONS.map((s) => (
          <TabsContent key={s.id} value={s.id} className="mt-4 flex flex-col gap-2">
            <CodeBlock code={s.code} lang="js" />
            <p className="max-w-3xl text-xs text-muted-foreground">{s.note}</p>
          </TabsContent>
        ))}
        <TabsContent value="cli" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium">Decode</h3>
            {CLI_DECODE.map((c) => (
              <CommandLine key={c} command={c} />
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium">Encode</h3>
            {CLI_ENCODE.map((c) => (
              <CommandLine key={c} command={c} />
            ))}
          </div>
          <div className="max-w-3xl space-y-2 text-xs text-muted-foreground">
            <p>
              Quoting your own polylines: single quotes in bash, zsh and PowerShell, double quotes in cmd.
            </p>
            <p>
              The example is a short walk in Berlin, from the Brandenburg Gate past the Reichstag to the main station. It
              has none of the characters shells treat specially, so these lines work as they are in bash, zsh, fish,
              PowerShell and cmd. Your own polylines can contain <code>`</code>, <code>\</code>, <code>|</code> and{" "}
              <code>^</code>, which is why they need the quotes above. For a long line or many points, use{" "}
              <code>--file points.json</code> (JSON, GeoJSON, CSV or one point per line), <code>-p 6</code> for
              precision 6 and <code>-f geojson</code> for GeoJSON out.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-medium">Live: the MapLibre helper</h3>
          <p className="text-xs text-muted-foreground">
            This map runs the call below with the Berlin route from the playground. <code>osrm6</code> says precision 6,
            and the helper adds a GeoJSON source and a line layer.
          </p>
          <CodeBlock code={LIVE} lang="js" />
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
