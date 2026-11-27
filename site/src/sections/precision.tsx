import { useMemo, useState } from "react"
import { decode } from "@duoquote/polytini"
import { presets } from "@duoquote/polytini/presets"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { MapView, features } from "@/components/map-view"
import { Section } from "@/components/section"
import { CodeBlock } from "@/components/code-block"
import { BERLIN } from "@/lib/examples"
import { distance, formatDistance } from "@/lib/geo"
import { PRESET_NOTES } from "@/lib/presets"

const CHOICES = [4, 5, 6, 7, 8]
const truth = decode(BERLIN, 6)
const ll = (p: ArrayLike<number>): [number, number] => [p[1], p[0]]

const FIX = `import { decode } from '@duoquote/polytini';
import { osrm6 } from '@duoquote/polytini/presets';

decode(route.geometry, osrm6); // precision 6, [lng, lat] like OSRM's GeoJSON`

export function Precision() {
  const [precision, setPrecision] = useState(5)
  const points = useMemo(() => decode(BERLIN, precision), [precision])
  const first = points[0]
  const valid = points.every((p) => Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)
  const data = useMemo(
    () =>
      features(
        [
          { coords: truth.map(ll), kind: "route" },
          ...(valid && precision !== 6 ? [{ coords: points.map(ll), kind: "wrong" as const }] : []),
        ],
        [
          { coord: ll(truth[0]), kind: "true" },
          ...(valid && precision !== 6 ? [{ coord: ll(first), kind: "wrong" as const }] : []),
        ]
      ),
    [points, valid, precision, first]
  )

  let verdict: string
  if (precision === 6) verdict = "Right. That's central Berlin."
  else if (!valid)
    verdict = `Latitude ${first[0]}. That isn't on Earth, and nothing threw: the string itself is fine.`
  else
    verdict = `Looks like a valid coordinate, but it's ${formatDistance(
      distance(first, truth[0])
    )} from Berlin. Nothing threw. This is the worse case, because nothing looks wrong.`

  return (
    <Section
      id="precision"
      title="The precision isn't in the string"
      intro={
        <>
          The same characters decode to different numbers at a different precision, and both sides have to agree.
          Google, Strava and OSRM's <code>polyline</code> use 5. OSRM's <code>polyline6</code>, Valhalla and Mapbox's{" "}
          <code>polyline6</code> use 6. Here's the Berlin route, which is polyline6, read at other precisions.
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4 text-sm">
          <div className="flex flex-col gap-1.5">
            <span id="prec-label" className="text-xs font-medium">
              Decode at precision
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              value={String(precision)}
              aria-labelledby="prec-label"
              onValueChange={(v) => v && setPrecision(Number(v))}
            >
              {CHOICES.map((p) => (
                <ToggleGroupItem key={p} value={String(p)} className="w-10 font-mono">
                  {p}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="border p-3 text-xs">
            <p className="font-mono">
              decode(str, {precision})[0] = [{first[0]}, {first[1]}]
            </p>
            {precision !== 6 ? (
              <p className="mt-1 font-mono text-muted-foreground">
                {precision < 6
                  ? `${10 ** (6 - precision)} times too big`
                  : `${10 ** (precision - 6)} times too small`}
              </p>
            ) : null}
            <p className={precision === 6 ? "mt-2" : "mt-2 text-destructive"}>{verdict}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            The presets carry the precision and the coordinate order each routing engine uses, so you don't have to
            remember either:
          </p>
          <CodeBlock code={FIX} />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <MapView
            data={data}
            fitKey={String(precision)}
            maxZoom={12}
            label="Map of the Berlin route and where it lands when decoded at the wrong precision"
            className="h-72 sm:h-80 lg:h-full lg:min-h-[22rem]"
          />
          <p className="text-xs text-muted-foreground">
            The teal line is the route at precision 6. Red is the same string at the precision you picked, when it still
            lands on Earth.
          </p>
        </div>
      </div>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-xs">
          <caption className="mb-2 text-left text-sm font-medium">
            Presets in <code>@duoquote/polytini/presets</code>
          </caption>
          <thead className="border-b text-muted-foreground">
            <tr>
              <th scope="col" className="py-1.5 pr-4 font-medium">Preset</th>
              <th scope="col" className="py-1.5 pr-4 font-medium">For</th>
              <th scope="col" className="py-1.5 pr-4 font-medium">Precision</th>
              <th scope="col" className="py-1.5 pr-4 font-medium">Order</th>
              <th scope="col" className="py-1.5 font-medium">Third value</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {Object.entries(presets).map(([name, o]) => {
              const opt = o as { precision: number; order: string; dimensions?: number; zFactor?: number }
              return (
                <tr key={name} className="border-b">
                  <td className="py-1.5 pr-4">{name}</td>
                  <td className="py-1.5 pr-4 font-sans">{PRESET_NOTES[name]}</td>
                  <td className="py-1.5 pr-4">{opt.precision}</td>
                  <td className="py-1.5 pr-4">{opt.order}</td>
                  <td className="py-1.5">{opt.dimensions ? `elevation, zFactor ${opt.zFactor}` : ""}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
