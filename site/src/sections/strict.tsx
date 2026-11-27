import { useMemo, useState } from "react"
import mapbox from "@mapbox/polyline"
import { decode } from "@duoquote/polytini"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { MapView, features } from "@/components/map-view"
import { Section } from "@/components/section"
import { ErrorBox } from "@/components/error-box"
import { BERLIN, GOOGLE } from "@/lib/examples"
import { distance, errorInfo, formatDistance } from "@/lib/geo"

const SOURCES = {
  google: { label: "Google's example", str: GOOGLE, precision: 5, cut: 17 },
  berlin: { label: "Berlin route", str: BERLIN, precision: 6, cut: 699 },
}
type SourceId = keyof typeof SOURCES

const fmt = (p: ArrayLike<number> | undefined) =>
  p ? `[${Array.from(p).slice(0, 2).join(", ")}]` : "none"
const ll = (p: ArrayLike<number>): [number, number] => [p[1], p[0]]

export function Strict() {
  const [source, setSource] = useState<SourceId>("google")
  const [cut, setCut] = useState(SOURCES.google.cut)
  const [fitKey, setFitKey] = useState(0)
  const src = SOURCES[source]

  const r = useMemo(() => {
    const truth = decode(src.str, src.precision)
    const part = src.str.slice(0, cut)
    let strictError: ReturnType<typeof errorInfo> | null = null
    let strictPoints: number[][] | null = null
    try {
      strictPoints = decode(part, src.precision)
    } catch (e) {
      strictError = errorInfo(e)
    }
    const loose = decode(part, { precision: src.precision, strict: false })
    const naive = mapbox.decode(part, src.precision)
    const k = naive.length - 1
    const off = k >= 0 ? distance(naive[k], truth[k]) : 0
    return { truth, part, strictError, strictPoints, loose, naive, k, off }
  }, [src, cut])

  const wrong = r.off > 0.5
  const data = useMemo(() => {
    const { truth, naive, k } = r
    return features(
      [
        { coords: truth.map(ll), kind: "ghost" },
        { coords: naive.slice(0, Math.max(k, 1)).map(ll), kind: "route" },
        ...(wrong && k > 0 ? [{ coords: [ll(naive[k - 1]), ll(naive[k])], kind: "wrong" as const }] : []),
      ],
      k >= 0
        ? wrong
          ? [
              { coord: ll(truth[k]), kind: "true" },
              { coord: ll(naive[k]), kind: "wrong" },
            ]
          : [{ coord: ll(naive[k]), kind: "true" }]
        : []
    )
  }, [r, wrong])

  // Show the end of what's kept and the start of what's cut off.
  const shown = 28
  const kept = r.part.length > shown ? "…" + r.part.slice(-shown) : r.part
  const dropped = src.str.slice(cut, cut + 16) + (cut + 16 < src.str.length ? "…" : "")

  return (
    <Section
      id="strict"
      title="Strict by default"
      intro={
        <>
          A cut-off polyline still looks like a polyline. Strings get cut by URL length limits, database
          columns and log lines. Drag the slider to cut one anywhere, and compare polytini with{" "}
          <code>@mapbox/polyline</code>, which returns a point anyway.
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <ToggleGroup
            type="single"
            variant="outline"
            value={source}
            aria-label="Which polyline to cut"
            onValueChange={(v) => {
              if (!v) return
              setSource(v as SourceId)
              setCut(SOURCES[v as SourceId].cut)
              setFitKey((n) => n + 1)
            }}
          >
            {Object.entries(SOURCES).map(([id, s]) => (
              <ToggleGroupItem key={id} value={id}>
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="cut">Cut after character</Label>
              <span className="font-mono text-xs text-muted-foreground">
                {cut} of {src.str.length}
              </span>
            </div>
            <Slider
              id="cut"
              min={1}
              max={src.str.length}
              step={1}
              value={[cut]}
              thumbLabel="Cut position"
              onValueChange={([v]) => setCut(v)}
              onValueCommit={() => setFitKey((n) => n + 1)}
            />
            <p className="overflow-hidden font-mono text-xs break-all" aria-label="The cut string">
              <span>{kept}</span>
              <span className="text-muted-foreground line-through decoration-destructive">{dropped}</span>
            </p>
          </div>

          <div className="flex flex-col gap-3 text-xs">
            <div className="border p-3">
              <p className="mb-2 font-mono font-medium">polytini: decode(str, {src.precision})</p>
              {r.strictError ? (
                <ErrorBox error={r.strictError} />
              ) : (
                <p className="text-muted-foreground">
                  No error, {r.strictPoints?.length} points. The cut is between two points, so the shorter string
                  is valid. Nothing can tell it was cut; the line is just shorter.
                </p>
              )}
            </div>

            <div className="border p-3">
              <p className="mb-2 font-mono font-medium">@mapbox/polyline: decode(str, {src.precision})</p>
              <p>
                No error, {r.naive.length} point{r.naive.length === 1 ? "" : "s"}. Last point{" "}
                <span className="font-mono">{fmt(r.naive[r.k])}</span>
                {wrong ? (
                  <>
                    , but the real one is <span className="font-mono">{fmt(r.truth[r.k])}</span>. That's{" "}
                    <strong className="text-destructive">{formatDistance(r.off)}</strong> off, and on a map it
                    looks like any other point.
                  </>
                ) : (
                  <>, which is right.</>
                )}
              </p>
            </div>

            <div className="border p-3">
              <p className="mb-2 font-mono font-medium">
                polytini: decode(str, {"{"} precision: {src.precision}, strict: false {"}"})
              </p>
              <p className="text-muted-foreground">
                No error, {r.loose.length} point{r.loose.length === 1 ? "" : "s"}. It drops an incomplete last point instead of guessing, so every
                point it returns is right. Use it when you'd rather draw a shorter line than none.
              </p>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <MapView
            data={data}
            fitKey={`${source}-${fitKey}`}
            label="Map comparing the real line with what @mapbox/polyline decoded from the cut string"
            className="h-80 sm:h-96 lg:h-full lg:min-h-[28rem]"
          />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Map legend">
            <li className="flex items-center gap-1.5">
              <span className="inline-block h-0 w-5 border-t-2 border-dashed border-slate-500" aria-hidden />
              the whole line
            </li>
            <li className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-cyan-700 dark:bg-cyan-400" aria-hidden />
              the real point
            </li>
            <li className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-red-600 dark:bg-red-400" aria-hidden />
              @mapbox/polyline's last point
            </li>
          </ul>
        </div>
      </div>
    </Section>
  )
}
