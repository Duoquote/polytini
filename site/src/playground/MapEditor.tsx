// The playground's map: MapLibre with terra-draw for drawing and editing.
// Loaded with React.lazy, and MapLibre and terra-draw are dynamic imports
// inside it, so none of this is in the main bundle.
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl"
import type { TerraDraw as TD, GeoJSONStoreFeatures } from "terra-draw"
import { MousePointer2Icon, SplineIcon, PentagonIcon, Undo2Icon, Redo2Icon, Trash2Icon, ScanIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { useDark } from "@/lib/use-dark"
import { allLines, type Collection, type Line, type Pt } from "./model"
import { inRange } from "./geo"
import type { Origin } from "./state"

const STYLE = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
}
const COLORS = {
  light: { line: "#0e7490", ghost: "#94a3b8", hover: "#dc2626", halo: "#ffffff", static: "#b45309" },
  dark: { line: "#22d3ee", ghost: "#64748b", hover: "#f87171", halo: "#0a0a0a", static: "#fbbf24" },
}
const PADDING = { top: 48, right: 48, bottom: 72, left: 48 }

export type Hover = { line: number; index: number } | null
type Mode = "select" | "linestring" | "polygon"

type Props = {
  collection: Collection
  version: number
  /** Where the last change came from; the map skips redrawing its own. */
  origin: Origin
  /** Fit the view when this changes. */
  fitKey: number
  /** Drawn faintly under the geometry: the original under a compaction, or a fix's preview. */
  ghost: Collection | null
  hover: Hover
  selectedLine: number
  onChange: (c: Collection, commit: boolean) => void
  onHover: (h: Hover) => void
  onSelectLine: (n: number) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  className?: string
}

const r9 = (x: number) => Math.round(x * 1e9) / 1e9
const lngLat = (pts: Pt[]) => pts.map((p) => [r9(p[1]), r9(p[0])])

/** Keeps the third value of each point through an edit, by position, or from the nearest original point. */
function carryZ(before: Pt[], coords: number[][]): Pt[] {
  const z = before.some((p) => p.length > 2)
  return coords.map((c, i) => {
    const pt: Pt = [c[1], c[0]]
    if (!z) return pt
    const same = before[i] && before[i][0] === c[1] && before[i][1] === c[0] ? before[i] : null
    const near = same ?? before.reduce((best, p) => ((p[0] - c[1]) ** 2 + (p[1] - c[0]) ** 2 < (best[0] - c[1]) ** 2 + (best[1] - c[0]) ** 2 ? p : best), before[0])
    return [c[1], c[0], near?.[2] ?? 0]
  })
}

function geojsonOf(c: Collection | null, filter?: (l: Line) => boolean) {
  return {
    type: "FeatureCollection" as const,
    features: (c ? allLines(c) : [])
      .filter((l) => l.line.pts.length > 0 && l.line.pts.every(inRange) && (!filter || filter(l.line)))
      // A line with one point (a cut-off polyline often decodes to one) is a dot.
      .map((l) =>
        l.line.pts.length === 1
          ? { type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: lngLat(l.line.pts)[0] } }
          : { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: lngLat(l.line.pts) } }
      ),
  }
}

export default function MapEditor(props: Props) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const drawRef = useRef<TD | null>(null)
  // terra-draw feature id -> position of the line in the collection.
  const ids = useRef(new Map<string, { feature: number; index: number }>())
  const latest = useRef(props)
  const [ready, setReady] = useState(false)
  const [mode, setModeState] = useState<Mode>("select")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dark = useDark()
  const loaded = useRef<{ dark: boolean } | null>(null)
  // Each load gets new ids, so terra-draw never sees an id twice.
  const loads = useRef(0)
  // True while load() fills terra-draw: its clear and add fire change
  // events that aren't edits.
  const loading = useRef(false)

  useLayoutEffect(() => {
    latest.current = props
  })

  const colors = dark ? COLORS.dark : COLORS.light

  // Puts the collection into terra-draw. Lines it refuses (out of range, a
  // single point) are drawn read-only in our own layer.
  const load = (c: Collection) => {
    const draw = drawRef.current
    const map = mapRef.current
    if (!draw || !map) return
    loading.current = true
    draw.clear()
    ids.current = new Map()
    const feats: GeoJSONStoreFeatures[] = []
    allLines(c).forEach(({ line, feature, index }, n) => {
      if (line.pts.length < 2 || !line.pts.every(inRange)) return
      const id = `L${n}-${(loads.current++).toString(36)}`
      const coords = lngLat(line.pts)
      const polygon = line.ring && coords.length >= 4
      ids.current.set(id, { feature, index })
      feats.push({
        id,
        type: "Feature",
        geometry: polygon ? { type: "Polygon", coordinates: [coords] } : { type: "LineString", coordinates: coords },
        properties: { mode: polygon ? "polygon" : "linestring" },
      } as GeoJSONStoreFeatures)
    })
    const results = feats.length ? draw.addFeatures(feats) : []
    loading.current = false
    const refused = new Set(results.filter((r) => !r.valid).map((r) => String(r.id)))
    for (const id of refused) ids.current.delete(id)
    const kept = new Set([...ids.current.values()].map((v) => `${v.feature}/${v.index}`))
    const rest = allLines(c).filter((l) => !kept.has(`${l.feature}/${l.index}`))
    ;(map.getSource("pg-static") as GeoJSONSource | undefined)?.setData(geojsonOf({ features: rest.map((l) => ({ lines: [l.line], props: {} })) }))
  }

  // Reads terra-draw back into a collection, keeping features, properties
  // and the third value of each point.
  const read = (): Collection | null => {
    const draw = drawRef.current
    if (!draw) return null
    const prev = latest.current.collection
    const snap = draw.getSnapshot().filter((f) => (f.geometry.type === "LineString" || f.geometry.type === "Polygon") && (f.properties.mode === "linestring" || f.properties.mode === "polygon"))
    const byId = new Map(snap.map((f) => [String(f.id), f]))
    const where = new Map([...ids.current].map(([id, pos]) => [`${pos.feature}/${pos.index}`, id]))
    const nextIds = new Map<string, { feature: number; index: number }>()
    const features: Collection["features"] = []
    prev.features.forEach((f, fi) => {
      const lines: Line[] = []
      f.lines.forEach((l, li) => {
        const id = where.get(`${fi}/${li}`)
        if (!id) return void lines.push(l) // never in terra-draw: unchanged
        const sf = byId.get(id)
        if (!sf) return // deleted on the map
        const coords = (sf.geometry.type === "Polygon" ? sf.geometry.coordinates[0] : sf.geometry.coordinates) as number[][]
        nextIds.set(id, { feature: features.length, index: lines.length })
        lines.push({ ...l, pts: carryZ(l.pts, coords) })
      })
      if (lines.length) features.push({ ...f, lines })
    })
    for (const sf of snap) {
      const id = String(sf.id)
      if (ids.current.has(id)) continue
      const polygon = sf.geometry.type === "Polygon"
      const coords = (polygon ? sf.geometry.coordinates[0] : sf.geometry.coordinates) as number[][]
      if (coords.length < 2) continue
      nextIds.set(id, { feature: features.length, index: 0 })
      features.push({ lines: [{ pts: coords.map((c) => [c[1], c[0]]), ring: polygon, ...(polygon ? { part: 0 } : {}) }], props: {} })
    }
    ids.current = nextIds
    return { features }
  }

  const fit = (c: Collection) => {
    const map = mapRef.current
    if (!map) return
    let w = 180, s = 90, e = -180, n = -90
    for (const { line } of allLines(c))
      for (const p of line.pts)
        if (inRange(p)) {
          w = Math.min(w, p[1]); e = Math.max(e, p[1]); s = Math.min(s, p[0]); n = Math.max(n, p[0])
        }
    if (w <= e) map.fitBounds([[w, s], [e, n]], { padding: PADDING, maxZoom: 16, duration: 0 })
  }

  // Our own layers, under terra-draw's.
  const addLayers = (map: MapLibreMap) => {
    const c = loaded.current?.dark ? COLORS.dark : COLORS.light
    const empty = { type: "FeatureCollection" as const, features: [] }
    map.addSource("pg-ghost", { type: "geojson", data: empty })
    map.addSource("pg-static", { type: "geojson", data: empty })
    map.addSource("pg-hover", { type: "geojson", data: empty })
    map.addLayer({ id: "pg-ghost", type: "line", source: "pg-ghost", paint: { "line-color": c.ghost, "line-width": 3, "line-opacity": 0.6, "line-dasharray": [2, 1.5] } })
    map.addLayer({ id: "pg-static", type: "line", source: "pg-static", paint: { "line-color": c.static, "line-width": 2 } })
    map.addLayer({ id: "pg-static-dots", type: "circle", source: "pg-static", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": c.static, "circle-stroke-color": c.halo, "circle-stroke-width": 2 } })
    map.addLayer({ id: "pg-hover", type: "circle", source: "pg-hover", paint: { "circle-radius": 7, "circle-color": c.hover, "circle-stroke-color": c.halo, "circle-stroke-width": 2 } })
  }

  const startDraw = async (map: MapLibreMap) => {
    const [{ TerraDraw, TerraDrawSelectMode, TerraDrawLineStringMode, TerraDrawPolygonMode }, { TerraDrawMapLibreGLAdapter }] = await Promise.all([
      import("terra-draw"),
      import("terra-draw-maplibre-gl-adapter"),
    ])
    const c = loaded.current?.dark ? COLORS.dark : COLORS.light
    const editable = {
      feature: {
        draggable: true,
        coordinates: { midpoints: true, draggable: true, deletable: true },
      },
    }
    // Our own ids: the default strategy accepts only UUIDs, and ours say
    // which line of the collection a feature is.
    let next = 0
    const draw = new TerraDraw({
      idStrategy: { isValidId: (id) => typeof id === "string" && id.length > 0, getId: () => `D${Date.now().toString(36)}-${next++}` },
      adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 9 }),
      modes: [
        new TerraDrawSelectMode({
          flags: { linestring: editable, polygon: editable },
          styles: { selectedLineStringColor: c.hover as `#${string}`, selectedPolygonOutlineColor: c.hover as `#${string}`, selectionPointColor: c.hover as `#${string}`, midPointColor: c.line as `#${string}` },
        }),
        new TerraDrawLineStringMode({ styles: { lineStringColor: c.line as `#${string}`, lineStringWidth: 3 } }),
        new TerraDrawPolygonMode({ styles: { outlineColor: c.line as `#${string}`, fillColor: c.line as `#${string}`, fillOpacity: 0.12 } }),
      ],
    })
    draw.start()
    draw.setMode("select")
    drawRef.current = draw
    let frame = 0
    draw.on("change", (_ids, type) => {
      if (type === "styling" || loading.current) return
      // Many changes per drag; read once per frame, without an undo step.
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const c = read()
        if (c) latest.current.onChange(c, type === "delete")
      })
    })
    draw.on("finish", () => {
      cancelAnimationFrame(frame)
      const c = read()
      if (c) latest.current.onChange(c, true)
      if (draw.getMode() !== "select") {
        draw.setMode("select")
        setModeState("select")
      }
    })
    draw.on("select", (id) => {
      setSelectedId(String(id))
      let n = 0
      const pos = ids.current.get(String(id))
      if (pos) {
        for (const l of allLines(latest.current.collection)) {
          if (l.feature === pos.feature && l.index === pos.index) break
          n++
        }
        latest.current.onSelectLine(n)
      }
    })
    draw.on("deselect", () => setSelectedId(null))
  }

  // Create the map once it's needed.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      import("maplibre-gl"),
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?url"),
      import("maplibre-gl/dist/maplibre-gl.css"),
    ]).then(([maplibregl, worker]) => {
      if (cancelled || !box.current) return
      maplibregl.setWorkerUrl(worker.default)
      loaded.current = { dark }
      const map = new maplibregl.Map({
        container: box.current,
        style: dark ? STYLE.dark : STYLE.light,
        center: [0, 20],
        zoom: 1,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      })
      map.touchZoomRotate.disableRotation()
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")
      // On a phone the open attribution covers a third of the map; start it
      // folded to its (i) button there.
      map.once("load", () => {
        if (box.current && box.current.clientWidth < 640) box.current.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show")
      })
      map.getCanvas().setAttribute("aria-label", "Map editor. Use the toolbar to draw lines and polygons or select one to edit its points.")
      mapRef.current = map
      map.once("style.load", async () => {
        addLayers(map)
        await startDraw(map)
        load(latest.current.collection)
        fit(latest.current.collection)
        setReady(true)
      })
      // Hover: the nearest point of the selected line within 10 pixels.
      let frame = 0
      map.on("mousemove", (e) => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          const lines = allLines(latest.current.collection)
          const sel = lines[latest.current.selectedLine]
          if (!sel || sel.line.pts.length > 20000) return
          let best = -1
          let bestD = 100
          sel.line.pts.forEach((p, i) => {
            if (!inRange(p)) return
            const q = map.project([p[1], p[0]])
            const d = (q.x - e.point.x) ** 2 + (q.y - e.point.y) ** 2
            if (d < bestD) [bestD, best] = [d, i]
          })
          const cur = latest.current.hover
          const next = best >= 0 ? { line: latest.current.selectedLine, index: best } : null
          if (cur?.index !== next?.index || cur?.line !== next?.line) latest.current.onHover(next)
        })
      })
    })
    return () => {
      cancelled = true
      drawRef.current?.stop()
      mapRef.current?.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The geometry changed somewhere other than the map: redraw it.
  useEffect(() => {
    if (!ready || props.version === 0) return
    if (latest.current.origin !== "map") load(props.collection)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.version, ready])

  useEffect(() => {
    if (ready) fit(latest.current.collection)
  }, [props.fitKey, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    ;(map.getSource("pg-ghost") as GeoJSONSource | undefined)?.setData(geojsonOf(props.ghost))
  }, [props.ghost, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const l = props.hover ? allLines(props.collection)[props.hover.line]?.line.pts[props.hover.index] : null
    ;(map.getSource("pg-hover") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: l && inRange(l) ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [l[1], l[0]] } }] : [],
    })
  }, [props.hover, props.collection, ready])

  // A different basemap for dark mode. terra-draw's layers go with the old
  // style, so it's started again on the new one.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || loaded.current?.dark === dark) return
    loaded.current = { dark }
    drawRef.current?.stop()
    drawRef.current = null
    map.setStyle(dark ? STYLE.dark : STYLE.light, { diff: false })
    map.once("style.load", async () => {
      addLayers(map)
      await startDraw(map)
      load(latest.current.collection)
      ;(map.getSource("pg-ghost") as GeoJSONSource | undefined)?.setData(geojsonOf(latest.current.ghost))
      setModeState("select")
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark, ready])

  const setMode = (m: Mode) => {
    drawRef.current?.setMode(m)
    setModeState(m)
  }

  const tool = (m: Mode, label: string, Icon: typeof SplineIcon) => (
    <Button
      type="button"
      size="icon-sm"
      variant={mode === m ? "default" : "outline"}
      aria-pressed={mode === m}
      aria-label={label}
      title={label}
      disabled={!ready}
      onClick={() => setMode(m)}
    >
      <Icon />
    </Button>
  )

  return (
    <div className={cn("relative flex flex-col overflow-hidden border bg-muted", props.className)}>
      <div role="toolbar" aria-label="Map tools" className="flex flex-wrap items-center gap-1 border-b bg-background p-1.5">
        {tool("select", "Select and edit", MousePointer2Icon)}
        {tool("linestring", "Draw a line", SplineIcon)}
        {tool("polygon", "Draw a polygon", PentagonIcon)}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button type="button" size="icon-sm" variant="outline" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!props.canUndo} onClick={props.undo}>
          <Undo2Icon />
        </Button>
        <Button type="button" size="icon-sm" variant="outline" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!props.canRedo} onClick={props.redo}>
          <Redo2Icon />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label="Delete the selected line"
          title="Delete the selected line"
          disabled={!selectedId}
          onClick={() => {
            if (!selectedId || !drawRef.current) return
            drawRef.current.removeFeatures([selectedId])
            setSelectedId(null)
            const c = read()
            if (c) props.onChange(c, true)
          }}
        >
          <Trash2Icon />
        </Button>
        <Button type="button" size="icon-sm" variant="outline" aria-label="Zoom to the geometry" title="Zoom to the geometry" disabled={!ready} onClick={() => fit(props.collection)}>
          <ScanIcon />
        </Button>
        <span className="ml-auto hidden px-1 text-xs text-muted-foreground sm:block">
          {mode === "select"
            ? "Click a line to edit. Drag points, drag a midpoint to add one, right-click a point to delete it."
            : mode === "linestring"
              ? "Click to add points, click the last one again to finish."
              : "Click to add corners, click the first one to close."}
        </span>
      </div>
      <div ref={box} className="relative min-h-0 flex-1" style={{ ["--line" as string]: colors.line }}>
        {!ready ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-xs text-muted-foreground">Loading map</div>
        ) : null}
      </div>
    </div>
  )
}
