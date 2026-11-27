import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CircleAlertIcon, FileUpIcon, Link2Icon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CopyButton } from "@/components/copy-button"
import { useNearViewport } from "@/lib/use-dark"
import { analyze, type Analysis } from "./analyze"
import { decodeWith, describe as describeInterp, type Interp } from "./detect"
import { encodeCollection, encodeLine, presetOut, PRESET_LIST, type PolylineOut } from "./encode"
import { EXAMPLES, loadLong } from "./examples"
import { allLines, emptyCollection, fromLines, type Collection } from "./model"
import { useGeometry } from "./state"
import { fromHash, toHash } from "./share"
import type { Hover } from "./MapEditor"
import { PointsPanel } from "./PointsPanel"
// The tools behind the tabs load when a tab opens, not with the page.
const FixPanel = lazy(() => import("./FixPanel").then((m) => ({ default: m.FixPanel })))
const CompactPanel = lazy(() => import("./CompactPanel").then((m) => ({ default: m.CompactPanel })))
const StatsPanel = lazy(() => import("./StatsPanel").then((m) => ({ default: m.StatsPanel })))
const ExportPanel = lazy(() => import("./ExportPanel").then((m) => ({ default: m.ExportPanel })))
const Loading = () => <p className="text-xs text-muted-foreground">Loading</p>

const MapEditor = lazy(() => import("./MapEditor"))

const DEFAULT_OUT: PolylineOut = { kind: "google", precision: 5, dims: 2 }

// The output select's values: "g5", "g6", "g7", "preset:<name>", "flexible".
const outKey = (o: PolylineOut) => (o.kind === "flexible" ? "flexible" : o.preset ? `preset:${o.preset}` : `g${o.precision}`)
const fromKey = (k: string, prev: PolylineOut, dims: 2 | 3): PolylineOut => {
  if (k === "flexible") return { kind: "flexible", precision: 5, thirdDim: dims === 3 ? 3 : 0, thirdDimPrecision: dims === 3 ? 1 : 0 }
  if (k.startsWith("preset:")) return presetOut(k.slice(7))
  return { kind: "google", precision: Number(k.slice(1)), dims: prev.kind === "google" ? prev.dims : 2, zFactor: prev.kind === "google" ? prev.zFactor : undefined }
}

const CONF_TEXT = { high: "high confidence", medium: "medium confidence", low: "low confidence" }

export function Playground() {
  const geo = useGeometry()
  // Stable callbacks: depending on the whole geo object would rerun the input
  // analysis after every edit and throw the edit away.
  const { set: setGeom, undo, redo } = geo
  // A shared link (#s=...) starts empty and fills in below; otherwise the OSRM example.
  const shared = /^#s=/.test(location.hash)
  const [text, setText] = useState(() => (shared ? "" : EXAMPLES[1].text()))
  const [fileName, setFileName] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [choice, setChoice] = useState<string | null>(null)
  const [override, setOverride] = useState<Interp | null>(null)
  const [out, setOut] = useState<PolylineOut>(DEFAULT_OUT)
  const [scope, setScope] = useState<"all" | "selected">("all")
  const [selected, setSelected] = useState(0)
  const [hover, setHover] = useState<Hover>(null)
  const [ghost, setGhost] = useState<Collection | null>(null)
  const [fitKey, setFitKey] = useState(0)
  const [credit, setCredit] = useState<string | null>(() => (shared ? null : `${EXAMPLES[1].note} Source: ${EXAMPLES[1].credit}`))
  const [shareState, setShareState] = useState<"idle" | "copied" | "error">("idle")
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const section = useRef<HTMLElement>(null)
  // MapLibre is 300 KB gzipped: load it when the map itself scrolls into view.
  const mapBox = useRef<HTMLDivElement>(null)
  const near = useNearViewport(mapBox, "0px")
  const run = useRef(0)
  // Set once someone types, picks an example or opens a file. Until then an
  // empty input (a shared link loading) leaves the geometry alone.
  const touched = useRef(false)

  const apply = useCallback(
    (c: Collection) => {
      setGeom(c, "input")
      setSelected(0)
      setHover(null)
      setGhost(null)
      setFitKey((k) => k + 1)
    },
    [setGeom]
  )

  // Analysis runs a moment after typing stops, and only the latest result counts.
  const runAnalysis = useCallback(
    async (value: string | Uint8Array, name?: string) => {
      const id = ++run.current
      const a = await analyze(value, name)
      if (id !== run.current) return
      setAnalysis(a)
      setOverride(null)
      const first = a.choices[0]
      setChoice(first?.id ?? null)
      if (first) apply(first.collection)
      // Clearing the input clears the map, as an undo step, so drawing starts fresh.
      else if (typeof value === "string" && !value.trim() && touched.current) apply(emptyCollection())
      // Start the output in the input's own format when it was a polyline.
      if (first?.interp?.format === "google") setOut({ kind: "google", precision: first.interp.precision, dims: first.interp.dims, zFactor: first.interp.zFactor })
      else if (first?.interp?.format === "flexible") setOut({ kind: "flexible", precision: 5, thirdDim: 3, thirdDimPrecision: 1 })
    },
    [apply]
  )

  useEffect(() => {
    if (fileName) return
    const t = setTimeout(() => runAnalysis(text), 250)
    return () => clearTimeout(t)
  }, [text, fileName, runAnalysis])

  // A shared link: #s=... restores the geometry and the output format.
  useEffect(() => {
    const m = location.hash.match(/^#s=(.+)$/)
    if (!m) return
    fromHash(m[1]).then((s) => {
      if (!s) return
      run.current++
      setAnalysis(null)
      setText("")
      setCredit("Loaded from a shared link.")
      setOut(s.out)
      apply(s.collection)
      section.current?.scrollIntoView()
    })
  }, [apply])

  // Undo and redo from the keyboard, outside text fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest("input, textarea, select, [contenteditable=true]")) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [undo, redo])

  const current = analysis?.choices.find((c) => c.id === choice) ?? null
  const polylineInput = current?.kind === "polyline"
  const reading: Interp | null = override ?? current?.interp ?? null
  const overridden = useMemo(() => (override && text ? decodeWith(text, override) : null), [override, text])
  const issues = overridden ? overridden.issues : (current?.issues ?? [])

  const pickChoice = (id: string) => {
    const c = analysis?.choices.find((x) => x.id === id)
    if (!c) return
    setChoice(id)
    setOverride(null)
    apply(c.collection)
  }
  const pickOverride = (i: Interp) => {
    setOverride(i)
    const c = decodeWith(text, i)
    apply(fromLines(c.lines.map((pts) => ({ pts, ring: false }))))
  }

  const lines = allLines(geo.collection)
  const dims = lines.some((l) => l.line.pts.some((p) => p.length > 2)) ? 3 : 2
  const output = useMemo(() => {
    try {
      if (scope === "selected") {
        const l = lines[selected]
        return l ? encodeLine(l.line, out) : ""
      }
      return encodeCollection(geo.collection, out)
    } catch (e) {
      return `Can't encode this: ${e instanceof Error ? e.message : String(e)}`
    }
  }, [geo.collection, out, scope, selected, lines])

  const loadFile = async (file: File) => {
    touched.current = true
    setFileName(file.name)
    setCredit(null)
    const bytes = new Uint8Array(await file.arrayBuffer())
    setText("")
    await runAnalysis(bytes, file.name)
  }

  const share = async () => {
    try {
      const hash = await toHash({ collection: geo.collection, out })
      const url = `${location.origin}${location.pathname}#s=${hash}`
      history.replaceState(null, "", `#s=${hash}`)
      await navigator.clipboard.writeText(url)
      setShareState("copied")
    } catch {
      setShareState("error")
    }
    setTimeout(() => setShareState("idle"), 2000)
  }

  const g = reading?.format === "google" ? reading : null

  return (
    <section ref={section} id="playground" aria-labelledby="playground-title" className="scroll-mt-14 border-t py-8 sm:py-10">
      <div className="mx-auto max-w-[96rem] px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="playground-title" className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
              <a href="#playground" className="hover:underline">
                Playground
              </a>
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Paste an encoded polyline, GeoJSON, WKT, coordinates or a GIS file, and it works out what it is. Then draw,
              fix and shrink it on the map and copy it out in any format. Everything runs in your browser.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="pg-example" className="sr-only">
              Load an example
            </Label>
            <Select
              value=""
              onValueChange={async (id) => {
                const ex = EXAMPLES.find((e) => e.id === id)
                if (!ex) return
                touched.current = true
                setFileName(null)
                setCredit(`${ex.note} Source: ${ex.credit}`)
                setText(id === "long" ? await loadLong() : ex.text())
              }}
            >
              <SelectTrigger id="pg-example" className="w-56">
                <SelectValue placeholder="Load an example" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Examples</SelectLabel>
                  {EXAMPLES.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={share} disabled={!lines.length}>
              <Link2Icon /> {shareState === "copied" ? "Link copied" : shareState === "error" ? "Couldn't copy" : "Share"}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
          {/* Map first on small screens, on the right from lg up. */}
          <div className="order-first min-w-0 lg:order-last">
            <div ref={mapBox} className="h-[55vh] min-h-80 lg:sticky lg:top-14 lg:h-[calc(100vh-4.5rem)]">
              {near ? (
                <Suspense fallback={<div className="flex h-full items-center justify-center border bg-muted text-xs text-muted-foreground">Loading map</div>}>
                  <MapEditor
                    className="h-full"
                    collection={geo.collection}
                    version={geo.version}
                    origin={geo.origin}
                    fitKey={fitKey}
                    ghost={ghost}
                    hover={hover}
                    selectedLine={selected}
                    onChange={(c, commit) => geo.set(c, "map", commit)}
                    onHover={setHover}
                    onSelectLine={setSelected}
                    undo={geo.undo}
                    redo={geo.redo}
                    canUndo={geo.canUndo}
                    canRedo={geo.canRedo}
                  />
                </Suspense>
              ) : (
                <div className="h-full border bg-muted" />
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            {/* Input */}
            <div
              className={`flex flex-col gap-1.5 ${dragging ? "outline-2 outline-primary outline-dashed" : ""}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const f = e.dataTransfer.files[0]
                if (f) loadFile(f)
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="pg-input">Input</Label>
                <div className="flex items-center gap-1">
                  <label className="inline-flex h-7 cursor-pointer items-center gap-1 border px-2 text-xs hover:bg-muted focus-within:ring-1 focus-within:ring-ring">
                    <FileUpIcon className="size-3.5" aria-hidden />
                    Open a file
                    <input
                      type="file"
                      className="sr-only"
                      accept=".geojson,.json,.geojsonl,.geojsons,.ndjson,.kml,.kmz,.gpx,.wkt,.wkb,.csv,.txt,.zip,.shp,.topojson,.fgb,.gpkg"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) loadFile(f)
                        e.target.value = ""
                      }}
                    />
                  </label>
                  <CopyButton text={text} label="Copy the input" />
                </div>
              </div>
              <Textarea
                id="pg-input"
                ref={input}
                value={fileName ? `File: ${fileName}` : text}
                readOnly={!!fileName}
                spellCheck={false}
                autoComplete="off"
                placeholder="Paste a polyline, GeoJSON, WKT, GPX, KML, CSV or coordinates, or drop a file here"
                className="max-h-56 min-h-24 font-mono text-xs break-all"
                aria-describedby="pg-detected"
                onFocus={() => {
                  if (fileName) {
                    setFileName(null)
                    setText("")
                  }
                }}
                onChange={(e) => {
                  touched.current = true
                  setFileName(null)
                  setCredit(null)
                  setText(e.target.value)
                }}
              />
              <p className="text-xs text-muted-foreground">
                Reads Google and HERE Flexible polylines, GeoJSON, GeoJSONL, TopoJSON, KML, KMZ, GPX, WKT, WKB hex,
                CSV, shapefiles, FlatGeobuf and GeoPackage.
              </p>
              {credit ? <p className="text-xs text-muted-foreground">{credit}</p> : null}
            </div>

            {/* What it is */}
            <div id="pg-detected" className="flex flex-col gap-2 border p-3 text-xs" aria-live="polite">
              {!analysis ? (
                <p className="text-muted-foreground">{lines.length ? `${lines.length} line${lines.length === 1 ? "" : "s"} loaded.` : "Waiting for input."}</p>
              ) : analysis.message && !analysis.choices.length ? (
                <p className="text-muted-foreground">{analysis.message}</p>
              ) : current ? (
                <>
                  <p>
                    <span className="text-muted-foreground">Looks like </span>
                    <strong className="font-medium">{override ? describeInterp(override) : current.label}</strong>
                    <span className="text-muted-foreground">
                      {override ? ", set by hand" : `, ${CONF_TEXT[analysis.confidence]} (${Math.round(current.prob * 100)}%)`}.
                    </span>
                  </p>
                  {analysis.choices.length > 1 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-muted-foreground">Also possible:</span>
                      {analysis.choices
                        .filter((c) => c.id !== choice && c.prob >= 0.005)
                        .slice(0, 4)
                        .map((c) => (
                          <Button key={c.id} variant="outline" size="xs" className="h-auto max-w-full py-1 text-left whitespace-normal" onClick={() => pickChoice(c.id)} title={c.reasons.join(", ")}>
                            {c.label} · {c.prob < 0.01 ? "<1" : Math.round(c.prob * 100)}%
                          </Button>
                        ))}
                    </div>
                  ) : null}
                  {polylineInput && g ? (
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="pg-prec">Precision</Label>
                        <Select value={String(g.precision)} onValueChange={(v) => pickOverride({ ...g, precision: Number(v) })}>
                          <SelectTrigger id="pg-prec" className="w-full" size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 11 }, (_, i) => i + 1).map((p) => (
                              <SelectItem key={p} value={String(p)}>
                                {p}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="pg-order">Order</Label>
                        <Select value={g.order} onValueChange={(v) => pickOverride({ ...g, order: v as "latlng" | "lnglat" })}>
                          <SelectTrigger id="pg-order" className="w-full" size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="latlng">lat, lng</SelectItem>
                            <SelectItem value="lnglat">lng, lat</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor="pg-dims">Values per point</Label>
                        <Select
                          value={g.dims === 3 ? `3-${g.zFactor ?? 100}` : "2"}
                          onValueChange={(v) => pickOverride(v === "2" ? { ...g, dims: 2, zFactor: undefined } : { ...g, dims: 3, zFactor: Number(v.slice(2)) })}
                        >
                          <SelectTrigger id="pg-dims" className="w-full" size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="2">2</SelectItem>
                            <SelectItem value="3-100">3, elevation ×100</SelectItem>
                            <SelectItem value={`3-${10 ** g.precision}`}>3, same factor</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : null}
                  {issues.length ? (
                    <div role="alert" className="mt-1 flex gap-2 border border-amber-600/40 bg-amber-500/10 p-2.5">
                      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
                      <div className="min-w-0 space-y-1.5">
                        <p>
                          This input isn't valid as it is. What you see is the lenient decode (<code>strict: false</code>):
                          invalid characters skipped and an incomplete last point dropped.
                        </p>
                        {issues.slice(0, 3).map((i) => (
                          <div key={`${i.part}-${i.index}`} className="font-mono">
                            <p>
                              Strict decoding throws PolylineError: {i.message} · code <span className="text-foreground">'{i.code}'</span>, index{" "}
                              <span className="text-foreground">{i.index}</span>
                            </p>
                            <p className="mt-0.5 break-all text-muted-foreground">
                              {text.slice(Math.max(0, i.index - 16), i.index)}
                              <mark className="bg-amber-400 px-px text-black">{text[i.index] ?? "∎"}</mark>
                              {text.slice(i.index + 1, i.index + 8)}
                            </p>
                            <Button
                              variant="link"
                              size="xs"
                              className="h-auto px-0"
                              onClick={() => {
                                input.current?.focus()
                                input.current?.setSelectionRange(i.index, Math.min(text.length, i.index + 1))
                              }}
                            >
                              Show it in the input
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            {/* Output */}
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex min-w-40 flex-1 flex-col gap-1">
                  <Label htmlFor="pg-out">Output</Label>
                  <Select value={outKey(out)} onValueChange={(k) => setOut(fromKey(k, out, dims))}>
                    <SelectTrigger id="pg-out" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Google format</SelectLabel>
                        <SelectItem value="g5">Precision 5</SelectItem>
                        <SelectItem value="g6">Precision 6</SelectItem>
                        <SelectItem value="g7">Precision 7</SelectItem>
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>Presets</SelectLabel>
                        {PRESET_LIST.map((p) => (
                          <SelectItem key={p} value={`preset:${p}`}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>HERE</SelectLabel>
                        <SelectItem value="flexible">Flexible Polyline</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                {out.kind === "flexible" ? (
                  <>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="pg-fprec">Precision</Label>
                      <Select value={String(out.precision)} onValueChange={(v) => setOut({ ...out, precision: Number(v) })}>
                        <SelectTrigger id="pg-fprec" className="w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[4, 5, 6, 7].map((p) => (
                            <SelectItem key={p} value={String(p)}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="pg-third">Third value</Label>
                      <Select value={String(out.thirdDim)} onValueChange={(v) => setOut({ ...out, thirdDim: Number(v) as 0 | 3 })}>
                        <SelectTrigger id="pg-third" className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">None</SelectItem>
                          <SelectItem value="3">Elevation</SelectItem>
                          <SelectItem value="2">Altitude</SelectItem>
                          <SelectItem value="1">Level</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : null}
                {lines.length > 1 ? (
                  <ToggleGroup type="single" variant="outline" size="sm" value={scope} onValueChange={(v) => v && setScope(v as "all" | "selected")} aria-label="What to encode">
                    <ToggleGroupItem value="all">All lines</ToggleGroupItem>
                    <ToggleGroupItem value="selected">Line {selected + 1}</ToggleGroupItem>
                  </ToggleGroup>
                ) : null}
              </div>
              <div className="relative border bg-muted/40">
                <pre className="max-h-40 overflow-auto p-3 pr-10 font-mono text-xs break-all whitespace-pre-wrap" tabIndex={0} aria-label="Encoded output">
                  {output || " "}
                </pre>
                <CopyButton text={output} label="Copy the output" className="absolute top-1 right-1 bg-background/80" />
              </div>
              <p className="text-xs text-muted-foreground">
                {output.length.toLocaleString("en")} characters
                {lines.length > 1 && scope === "all" ? ", one line per row" : ""}. Other formats are under Export.
              </p>
            </div>

            <Tabs defaultValue="points">
              <TabsList className="h-auto w-full flex-wrap justify-start">
                {["points", "fix", "compact", "stats", "export"].map((t) => (
                  <TabsTrigger key={t} value={t} className="flex-none capitalize">
                    {t === "fix" ? "Fix" : t === "compact" ? "Compact" : t}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="points" className="mt-3">
                <PointsPanel collection={geo.collection} selected={selected} onSelect={setSelected} hover={hover} onHover={setHover} onChange={(c) => geo.set(c, "table")} />
              </TabsContent>
              <TabsContent value="fix" className="mt-3">
                <Suspense fallback={<Loading />}><FixPanel collection={geo.collection} precision={out.precision} onPreview={setGhost} onApply={(c) => { setGhost(null); geo.set(c, "tool") }} /></Suspense>
              </TabsContent>
              <TabsContent value="compact" className="mt-3">
                <Suspense fallback={<Loading />}><CompactPanel collection={geo.collection} out={out} onPreview={setGhost} onApply={(c) => { setGhost(null); geo.set(c, "tool") }} /></Suspense>
              </TabsContent>
              <TabsContent value="stats" className="mt-3">
                <Suspense fallback={<Loading />}><StatsPanel collection={geo.collection} out={out} /></Suspense>
              </TabsContent>
              <TabsContent value="export" className="mt-3">
                <Suspense fallback={<Loading />}><ExportPanel collection={geo.collection} out={out} selected={selected} /></Suspense>
              </TabsContent>
            </Tabs>
            {analysis?.message && analysis.choices.length ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CircleAlertIcon className="size-3.5" aria-hidden /> {analysis.message}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
