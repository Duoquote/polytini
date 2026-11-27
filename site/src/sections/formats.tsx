import { useId, useMemo, useState, type ReactNode } from "react"
import {
  decodeFlat,
  decodeLatLng,
  encode,
  encodeFlat,
  fromGeoJSON,
  toGeoJSON,
} from "@duoquote/polytini"
import * as flexible from "@duoquote/polytini/flexible"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CodeBlock } from "@/components/code-block"
import { ErrorBox } from "@/components/error-box"
import { Section } from "@/components/section"
import { GOOGLE } from "@/lib/examples"
import { errorInfo } from "@/lib/geo"

function Converter({
  title,
  call,
  initial,
  run,
  rows = 4,
}: {
  title: string
  call: string
  initial: string
  run: (input: string) => string
  rows?: number
}) {
  const id = useId()
  const [input, setInput] = useState(initial)
  const result = useMemo(() => {
    try {
      return { out: run(input) }
    } catch (e) {
      return { error: errorInfo(e) }
    }
  }, [input, run])
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{title}</Label>
      <Textarea
        id={id}
        value={input}
        rows={rows}
        spellCheck={false}
        autoComplete="off"
        className="font-mono text-xs break-all"
        onChange={(e) => setInput(e.target.value)}
      />
      <p className="font-mono text-xs text-muted-foreground">{call}</p>
      {result.error ? <ErrorBox error={result.error} /> : <CodeBlock code={result.out ?? ""} maxHeight="16rem" />}
    </div>
  )
}

const compact = (v: unknown) =>
  JSON.stringify(v, null, 2).replace(/\[\s+([-\d.e]+),\s+([-\d.e]+)(?:,\s+([-\d.e]+))?\s+\]/g, (_, a, b, c) =>
    c === undefined ? `[${a}, ${b}]` : `[${a}, ${b}, ${c}]`
  )

const geoOut = (s: string) => compact(toGeoJSON(s.trim()))
const geoIn = (s: string) => fromGeoJSON(JSON.parse(s))
const objOut = (s: string) => compact(decodeLatLng(s.trim())).replace(/\{\s+"lat": ([^,]+),\s+"lng": ([^\s]+)\s+\}/g, '{ "lat": $1, "lng": $2 }')
const objIn = (s: string) => encode(JSON.parse(s))
const flatOut = (s: string) => {
  const a = decodeFlat(s.trim())
  return `Float64Array(${a.length}) [${Array.from(a).join(", ")}]`
}
const flatIn = (s: string) => encodeFlat(new Float64Array(JSON.parse(s)))
const flexOut = (s: string) => compact(flexible.decode(s.trim()))

const THIRD = [
  ["0", "ABSENT"],
  ["1", "LEVEL"],
  ["2", "ALTITUDE"],
  ["3", "ELEVATION"],
  ["6", "CUSTOM1"],
  ["7", "CUSTOM2"],
] as const

function Flexible() {
  const [thirdDim, setThirdDim] = useState("3")
  const [precision, setPrecision] = useState("5")
  const [thirdDimPrecision, setThirdDimPrecision] = useState("1")
  const name = THIRD.find(([v]) => v === thirdDim)?.[1]
  const run = useMemo(
    () => (s: string) =>
      flexible.encode({
        polyline: JSON.parse(s),
        precision: Number(precision),
        thirdDim: Number(thirdDim) as flexible.EncodableThirdDimension,
        thirdDimPrecision: Number(thirdDimPrecision),
      }),
    [thirdDim, precision, thirdDimPrecision]
  )
  const select = (label: string, value: string, set: (v: string) => void, items: readonly (readonly [string, string])[]) => {
    const id = `flex-${label.replace(/\W/g, "")}`
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Select value={value} onValueChange={set}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }
  const digits = Array.from({ length: 8 }, (_, i) => [String(i), String(i)] as const)
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          {select("Precision", precision, setPrecision, digits)}
          {select("Third value", thirdDim, setThirdDim, THIRD)}
          {select("Its precision", thirdDimPrecision, setThirdDimPrecision, digits)}
        </div>
        <Converter
          title="Points with elevation, as [lat, lng, z]"
          call={`encode({ polyline, precision: ${precision}, thirdDim: ${name}, thirdDimPrecision: ${thirdDimPrecision} })`}
          initial={"[\n  [50.10228, 8.69821, 112.5],\n  [50.10201, 8.69567, 113.1],\n  [50.10063, 8.6915, 114.8],\n  [50.09878, 8.68752, 116.2]\n]"}
          run={run}
          rows={6}
        />
      </div>
      <Converter
        title="A Flexible Polyline to decode"
        call="decode(str) // the header and the points"
        initial={flexible.encode({
          polyline: [
            [50.10228, 8.69821, 112.5],
            [50.10201, 8.69567, 113.1],
            [50.10063, 8.6915, 114.8],
            [50.09878, 8.68752, 116.2],
          ],
          precision: 5,
          thirdDim: flexible.ELEVATION,
          thirdDimPrecision: 1,
        })}
        run={flexOut}
        rows={2}
      />
    </div>
  )
}

function Pair({ children }: { children: ReactNode }) {
  return <div className="grid gap-6 md:grid-cols-2">{children}</div>
}

export function Formats() {
  return (
    <Section
      id="formats"
      title="Formats"
      intro="Besides [lat, lng] tuples, polytini reads and writes GeoJSON, {lat, lng} objects and typed arrays, and has HERE's Flexible Polyline as a separate import. Edit any input."
    >
      <Tabs defaultValue="geojson">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger className="flex-none" value="geojson">GeoJSON</TabsTrigger>
          <TabsTrigger className="flex-none" value="objects">{"{lat, lng}"}</TabsTrigger>
          <TabsTrigger className="flex-none" value="flat">Typed arrays</TabsTrigger>
          <TabsTrigger className="flex-none" value="flexible">HERE Flexible Polyline</TabsTrigger>
        </TabsList>
        <TabsContent value="geojson" className="mt-4">
          <Pair>
            <Converter title="Polyline to GeoJSON" call="toGeoJSON(str) // always [lng, lat]" initial={GOOGLE} run={geoOut} rows={2} />
            <Converter
              title="GeoJSON to polyline"
              call="fromGeoJSON(lineStringOrFeature)"
              initial={compact({
                type: "Feature",
                properties: { name: "Google's example" },
                geometry: { type: "LineString", coordinates: [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]] },
              })}
              run={geoIn}
              rows={8}
            />
          </Pair>
        </TabsContent>
        <TabsContent value="objects" className="mt-4">
          <Pair>
            <Converter title="Polyline to objects" call="decodeLatLng(str) // for Google Maps and Leaflet" initial={GOOGLE} run={objOut} rows={2} />
            <Converter
              title="Objects to polyline"
              call="encode(objects) // lat/latitude, lng/lon/longitude"
              initial={'[\n  { "lat": 38.5, "lng": -120.2 },\n  { "latitude": 40.7, "longitude": -120.95 },\n  { "lat": 43.252, "lon": -126.453 }\n]'}
              run={objIn}
              rows={5}
            />
          </Pair>
        </TabsContent>
        <TabsContent value="flat" className="mt-4">
          <Pair>
            <Converter
              title="Polyline to a Float64Array"
              call="decodeFlat(str) // [lat0, lng0, lat1, lng1, ...], no array per point"
              initial={GOOGLE}
              run={flatOut}
              rows={2}
            />
            <Converter
              title="Flat numbers to polyline"
              call="encodeFlat(new Float64Array(numbers))"
              initial="[38.5, -120.2, 40.7, -120.95, 43.252, -126.453]"
              run={flatIn}
              rows={2}
            />
          </Pair>
          <p className="mt-4 max-w-2xl text-xs text-muted-foreground">
            The typed-array calls skip the array per point, which is most of the work on long lines. The opt-in{" "}
            <code>@duoquote/polytini/wasm</code> build has the same calls, plus <code>decodeMany</code> and{" "}
            <code>encodeMany</code> for many lines in one call. WASM only pays off there: for{" "}
            <code>[lat, lng]</code> arrays the default build is as fast or faster.
          </p>
        </TabsContent>
        <TabsContent value="flexible" className="mt-4">
          <Flexible />
          <p className="mt-4 max-w-2xl text-xs text-muted-foreground">
            <code>@duoquote/polytini/flexible</code> takes the same arguments and returns the same shapes as{" "}
            <code>@here/flexpolyline</code>, so it's a drop-in. It's a different format from Google's: a header with
            the precision and an optional third value such as elevation.
          </p>
        </TabsContent>
      </Tabs>
    </Section>
  )
}
