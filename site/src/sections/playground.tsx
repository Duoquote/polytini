import { useMemo, useState } from "react"
import { decode, encode, type Options } from "@duoquote/polytini"
import { polylineData } from "@duoquote/polytini/maplibre"
import { EraserIcon, Undo2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CopyButton } from "@/components/copy-button"
import { CodeInput } from "@/components/code-input"
import { MapView, features, type MapFeatures } from "@/components/map-view"
import { Section } from "@/components/section"
import { ErrorBox } from "@/components/error-box"
import { EXAMPLES } from "@/lib/examples"
import { errorInfo, pointsJson, toLngLat } from "@/lib/geo"
import { PRESET_NAMES, PRESET_NOTES, describe, presetOptions, type Order } from "@/lib/presets"

type Side = "polyline" | "coords"
type Point = number[]

const ROWS = 200
const PRECISIONS = Array.from({ length: 16 }, (_, i) => i)

function parseCoords(text: string): Point[] {
  const value = JSON.parse(text)
  if (!Array.isArray(value)) throw new Error("Expected a JSON array of points")
  return value
}

export function Playground() {
  const first = EXAMPLES[0]
  const [preset, setPreset] = useState(first.preset)
  const [opts, setOpts] = useState<Options>(() => ({ ...presetOptions(first.preset) }))
  const [polyline, setPolyline] = useState(first.polyline)
  const [coordsText, setCoordsText] = useState(() => pointsJson(decode(first.polyline, opts)))
  const [side, setSide] = useState<Side>("polyline")
  const [error, setError] = useState<unknown>(null)
  const [points, setPoints] = useState<Point[]>(() => decode(first.polyline, opts))
  const [fitKey, setFitKey] = useState(0)

  const credit = EXAMPLES.find((ex) => ex.polyline === polyline.trim())?.credit
  const order: Order = opts.order ?? "latlng"
  const dims = opts.dimensions ?? 2

  // One place that turns the edited side into the other.
  function fromPolyline(str: string, o: Options) {
    setPolyline(str)
    setSide("polyline")
    try {
      const p = decode(str.trim(), o)
      setPoints(p)
      setCoordsText(pointsJson(p))
      setError(null)
    } catch (e) {
      setError(e)
    }
  }
  function fromCoords(text: string, o: Options) {
    setCoordsText(text)
    setSide("coords")
    try {
      const p = parseCoords(text)
      setPolyline(encode(p, o))
      setPoints(p)
      setError(null)
    } catch (e) {
      setError(e)
    }
  }
  function rerun(o: Options) {
    setOpts(o)
    if (side === "polyline") fromPolyline(polyline, o)
    else fromCoords(coordsText, o)
  }

  function choosePreset(name: string) {
    setPreset(name)
    const p = presetOptions(name)
    if (p) rerun({ ...p })
  }

  function addPoint(lng: number, lat: number) {
    const digits = Math.min(opts.precision ?? 5, 7)
    const r = (x: number) => Number(x.toFixed(digits))
    const p: Point = order === "latlng" ? [r(lat), r(lng)] : [r(lng), r(lat)]
    if (dims > 2) p.push(...Array(dims - 2).fill(0))
    const base = error ? [] : points
    fromCoords(pointsJson([...base, p]), opts)
  }

  const mapData = useMemo<MapFeatures>(() => {
    let lines: MapFeatures = { type: "FeatureCollection", features: [] }
    try {
      if (!error && points.length > 1) lines = polylineData(polyline.trim(), opts) as MapFeatures
    } catch {
      // Drawn from the points below instead.
    }
    const vertices = points.length <= 400 ? toLngLat(points, order) : []
    const extra = features([], vertices.map((coord) => ({ coord, kind: "vertex" as const })))
    return { type: "FeatureCollection", features: [...lines.features, ...extra.features] }
  }, [points, polyline, opts, order, error])

  const call = `${side === "polyline" ? "decode(str" : "encode(points"}, ${
    preset !== "custom" ? preset : describe(opts)
  })`

  return (
    <Section
      id="playground"
      title="Playground"
      intro="Paste a polyline to see its coordinates, or edit the coordinates to see the string. Click the map to add points. It all runs in your browser."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Examples:</span>
            {EXAMPLES.map((ex) => (
              <Button
                key={ex.id}
                variant="outline"
                size="sm"
                onClick={() => {
                  setPreset(ex.preset)
                  const o = { ...presetOptions(ex.preset) }
                  setOpts(o)
                  fromPolyline(ex.polyline, o)
                  setFitKey((k) => k + 1)
                }}
              >
                {ex.label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pg-preset">Preset</Label>
              <Select value={preset} onValueChange={choosePreset}>
                <SelectTrigger id="pg-preset" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom</SelectItem>
                  {PRESET_NAMES.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pg-precision">Precision</Label>
              <Select
                value={String(opts.precision ?? 5)}
                onValueChange={(v) => {
                  setPreset("custom")
                  rerun({ ...opts, precision: Number(v) })
                }}
              >
                <SelectTrigger id="pg-precision" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRECISIONS.map((p) => (
                    <SelectItem key={p} value={String(p)}>
                      {p}
                      {p === 5 ? " (Google)" : p === 6 ? " (polyline6)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
              <Label asChild>
                <span id="pg-order-label">Tuple order</span>
              </Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={order}
                aria-labelledby="pg-order-label"
                onValueChange={(v) => {
                  if (!v) return
                  setPreset("custom")
                  rerun({ ...opts, order: v as Order })
                }}
              >
                <ToggleGroupItem value="latlng" className="font-mono">
                  [lat, lng]
                </ToggleGroupItem>
                <ToggleGroupItem value="lnglat" className="font-mono">
                  [lng, lat]
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {preset !== "custom" ? (
              <>
                <code className="text-foreground">{preset}</code> is {PRESET_NOTES[preset]}:{" "}
                <code className="text-foreground">{describe(opts)}</code>.{" "}
              </>
            ) : null}
            The string always stores latitude first. The order only changes the tuples you pass in and get
            back.
          </p>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="pg-polyline">Encoded polyline</Label>
              <CopyButton text={polyline} label="Copy the polyline" />
            </div>
            <Textarea
              id="pg-polyline"
              value={polyline}
              spellCheck={false}
              autoComplete="off"
              className="min-h-24 font-mono text-xs break-all"
              aria-invalid={!!error && side === "polyline"}
              onChange={(e) => {
                fromPolyline(e.target.value, opts)
                setFitKey((k) => k + 1)
              }}
            />
            <p className="font-mono text-xs text-muted-foreground">
              {call}
              {!error ? ` gives ${points.length} point${points.length === 1 ? "" : "s"}` : ""}, {polyline.length}{" "}
              characters
            </p>
          </div>

          {error ? <ErrorBox error={errorInfo(error)} /> : null}

          <Tabs defaultValue="table">
            <div className="flex items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="table">Table</TabsTrigger>
                <TabsTrigger value="json">JSON (editable)</TabsTrigger>
              </TabsList>
              <CopyButton text={coordsText} label="Copy the coordinates as JSON" />
            </div>
            <TabsContent value="table">
              <div className="max-h-80 overflow-auto border" tabIndex={0} role="region" aria-label="Decoded coordinates">
                <table className="w-full font-mono text-xs">
                  <thead className="sticky top-0 bg-muted text-left">
                    <tr>
                      <th scope="col" className="px-3 py-1.5 font-medium">#</th>
                      <th scope="col" className="px-3 py-1.5 font-medium">lat</th>
                      <th scope="col" className="px-3 py-1.5 font-medium">lng</th>
                      {dims > 2 ? <th scope="col" className="px-3 py-1.5 font-medium">z</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {points.slice(0, ROWS).map((p, i) => {
                      const [lat, lng] = order === "latlng" ? [p[0], p[1]] : [p[1], p[0]]
                      return (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1 text-muted-foreground">{i}</td>
                          <td className="px-3 py-1">{lat}</td>
                          <td className="px-3 py-1">{lng}</td>
                          {dims > 2 ? <td className="px-3 py-1">{p.slice(2).join(", ")}</td> : null}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {points.length > ROWS ? (
                  <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
                    The first {ROWS} of {points.length} points. The JSON tab has all of them.
                  </p>
                ) : null}
              </div>
            </TabsContent>
            <TabsContent value="json">
              <Label htmlFor="pg-coords" className="sr-only">
                Coordinates as JSON
              </Label>
              <CodeInput
                id="pg-coords"
                value={coordsText}
                className="h-80"
                invalid={!!error && side === "coords"}
                onChange={(text) => fromCoords(text, opts)}
              />
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <MapView
            data={mapData}
            fitKey={String(fitKey)}
            onMapClick={addPoint}
            label="Map of the decoded line. Click to add a point."
            className="h-80 sm:h-[28rem] lg:h-full lg:min-h-[32rem]"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Click the map to add a point. The line is drawn with{" "}
              <code className="text-foreground">polylineData</code> from{" "}
              <code className="text-foreground">@duoquote/polytini/maplibre</code>.
            </p>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={!points.length}
                onClick={() => fromCoords(pointsJson(points.slice(0, -1)), opts)}
              >
                <Undo2Icon /> Undo point
              </Button>
              <Button variant="outline" size="sm" onClick={() => fromCoords("[]", opts)}>
                <EraserIcon /> Clear
              </Button>
            </div>
          </div>
          {credit ? <p className="text-xs text-muted-foreground">{credit}</p> : null}
        </div>
      </div>
    </Section>
  )
}
