import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { compact, type Method } from "./compact"
import { encodeCollection, gzipSize, type PolylineOut } from "./encode"
import { formatMeters } from "./geo"
import type { Collection } from "./model"

// The slider is logarithmic: 0 to 100 maps to 0.1 m to 1 km.
const toMeters = (v: number) => Math.round(0.1 * 10 ** (v / 25) * 100) / 100
const fromMeters = (m: number) => 25 * Math.log10(m / 0.1)

export function CompactPanel({
  collection,
  out,
  onPreview,
  onApply,
}: {
  collection: Collection
  out: PolylineOut
  onPreview: (c: Collection | null) => void
  onApply: (c: Collection) => void
}) {
  const [method, setMethod] = useState<Method>("dp")
  const [slider, setSlider] = useState(fromMeters(5))
  const [digits, setDigits] = useState<string>("keep")
  const [showOriginal, setShowOriginal] = useState(true)
  const tolerance = toMeters(slider)
  const d = digits === "keep" ? undefined : Number(digits)

  const r = useMemo(() => compact(collection, method, tolerance, d), [collection, method, tolerance, d])
  const target = useMemo<PolylineOut>(() => (d !== undefined && out.kind === "google" ? { ...out, precision: Math.min(out.precision, d), preset: undefined } : out), [d, out])
  const before = useMemo(() => encodeCollection(collection, out), [collection, out])
  const after = useMemo(() => encodeCollection(r.result, target), [r, target])
  const [gz, setGz] = useState<[number | null, number | null]>([null, null])
  useEffect(() => {
    let live = true
    Promise.all([gzipSize(before), gzipSize(after)]).then((v) => live && setGz(v))
    return () => {
      live = false
    }
  }, [before, after])

  // The original goes faintly under the map while this tab shows a change.
  useEffect(() => {
    onPreview(showOriginal && r.after !== r.before ? collection : null)
    return () => onPreview(null)
  }, [showOriginal, r, collection, onPreview])

  const pct = (a: number, b: number) => (a ? `${Math.round((1 - b / a) * 100)}% smaller` : "")
  const row = (label: string, a: string, b: string, note = "") => (
    <tr className="border-t">
      <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted-foreground">
        {label}
      </th>
      <td className="py-1.5 pr-3 font-mono whitespace-nowrap tabular-nums">{a}</td>
      <td className="py-1.5 pr-3 font-mono whitespace-nowrap tabular-nums">{b}</td>
      <td className="py-1.5 text-muted-foreground">{note}</td>
    </tr>
  )

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span id="pg-method" className="text-xs">Simplify</span>
          <ToggleGroup type="single" variant="outline" size="sm" value={method} aria-labelledby="pg-method" onValueChange={(v) => v && setMethod(v as Method)}>
            <ToggleGroupItem value="none">Off</ToggleGroupItem>
            <ToggleGroupItem value="dp">Douglas-Peucker</ToggleGroupItem>
            <ToggleGroupItem value="vw">Visvalingam</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="pg-digits">Round to</Label>
          <Select value={digits} onValueChange={setDigits}>
            <SelectTrigger id="pg-digits" className="w-36" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="keep">Keep the digits</SelectItem>
              {[7, 6, 5, 4, 3].map((p) => (
                <SelectItem key={p} value={String(p)}>
                  {p} decimals
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {method !== "none" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="pg-tol">Tolerance</Label>
            <span className="font-mono tabular-nums">{formatMeters(tolerance)}</span>
          </div>
          <Slider id="pg-tol" min={0} max={100} step={1} value={[slider]} thumbLabel="Tolerance in meters" onValueChange={([v]) => setSlider(v)} />
          <p className="text-muted-foreground">
            {method === "dp"
              ? "Douglas-Peucker keeps a point when it's further than this from the simplified line."
              : "Visvalingam removes the point with the flattest triangle until every triangle is at least the tolerance squared, in square meters."}
          </p>
        </div>
      ) : null}
      <table className="w-full">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th scope="col" className="pb-1 font-medium" />
            <th scope="col" className="pb-1 font-medium">Before</th>
            <th scope="col" className="pb-1 font-medium">After</th>
            <th scope="col" className="pb-1 font-medium" />
          </tr>
        </thead>
        <tbody>
          {row("Points", r.before.toLocaleString("en"), r.after.toLocaleString("en"), pct(r.before, r.after))}
          {row("Encoded", `${before.length.toLocaleString("en")} B`, `${after.length.toLocaleString("en")} B`, pct(before.length, after.length))}
          {row("Gzipped", gz[0] === null ? "n/a" : `${gz[0].toLocaleString("en")} B`, gz[1] === null ? "n/a" : `${gz[1].toLocaleString("en")} B`, gz[0] && gz[1] ? pct(gz[0], gz[1]) : "")}
          {row("Max off", "", formatMeters(r.deviation.max), "the furthest an original point is from the result")}
          {row("Mean off", "", formatMeters(r.deviation.mean), "")}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Switch id="pg-orig" checked={showOriginal} onCheckedChange={setShowOriginal} />
          <Label htmlFor="pg-orig">Show the original on the map</Label>
        </div>
        <Button size="sm" disabled={r.after === r.before && d === undefined} onClick={() => onApply(r.result)}>
          Apply
        </Button>
      </div>
      <p className="text-muted-foreground">The encoded sizes use the output format above{d !== undefined && out.kind === "google" ? `, at ${target.precision} decimals after rounding` : ""}.</p>
    </div>
  )
}
