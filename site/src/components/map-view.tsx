import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { FeatureCollection } from "geojson"
import type { Map as MapLibreMap, LngLatBoundsLike } from "maplibre-gl"
import { cn } from "cn"
import { useDark, useNearViewport } from "@/lib/use-dark"

// OpenFreeMap: free, no API key, no limit on map views, attribution required
// (https://openfreemap.org). MapLibre shows the attribution from the style.
const STYLE = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
}

// More room at the bottom, where the attribution sits (two lines on a phone).
const MAX_ZOOM = 15
const PADDING = { top: 40, right: 48, bottom: 72, left: 40 }

export const MAP_COLORS = {
  light: { route: "#0e7490", wrong: "#dc2626", ghost: "#64748b", halo: "#ffffff" },
  dark: { route: "#22d3ee", wrong: "#f87171", ghost: "#94a3b8", halo: "#0a0a0a" },
}

type Kind = "route" | "wrong" | "ghost" | "vertex" | "true" | "start"

export type MapFeatures = FeatureCollection

/** Builds a FeatureCollection from lines and points, each with a kind that picks its style. */
export function features(
  lines: { coords: [number, number][]; kind: Kind }[],
  points: { coord: [number, number]; kind: Kind }[] = []
): MapFeatures {
  return {
    type: "FeatureCollection",
    features: [
      ...lines
        .filter((l) => l.coords.length > 1)
        .map((l) => ({
          type: "Feature" as const,
          properties: { kind: l.kind },
          geometry: { type: "LineString" as const, coordinates: l.coords },
        })),
      ...points.map((p) => ({
        type: "Feature" as const,
        properties: { kind: p.kind },
        geometry: { type: "Point" as const, coordinates: p.coord },
      })),
    ],
  }
}

function bounds(data: MapFeatures): LngLatBoundsLike | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const add = (c: number[]) => {
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return
    if (Math.abs(c[1]) > 90 || Math.abs(c[0]) > 180) return
    w = Math.min(w, c[0]); e = Math.max(e, c[0])
    s = Math.min(s, c[1]); n = Math.max(n, c[1])
  }
  for (const f of data.features) {
    const g = f.geometry
    if (g.type === "LineString") g.coordinates.forEach(add)
    else if (g.type === "Point") add(g.coordinates)
  }
  return w <= e ? [[w, s], [e, n]] : null
}

export function MapView({
  data,
  fitKey,
  onMapClick,
  onStyle,
  label,
  className,
  fitTo,
}: {
  /** Bounds to start with when there's no data to fit. */
  fitTo?: [[number, number], [number, number]]
  data?: MapFeatures
  /** Fit the map to the data whenever this changes. */
  fitKey?: string
  onMapClick?: (lng: number, lat: number) => void
  /** Runs after every style load, to add your own sources and layers. */
  onStyle?: (map: MapLibreMap) => void
  label: string
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const near = useNearViewport(box)
  const dark = useDark()
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const latest = useRef({ data, dark, onMapClick, onStyle })
  // Event handlers read the latest props from here. A layout effect runs
  // before the effects below, so they see this render's values.
  useLayoutEffect(() => {
    latest.current = { data, dark, onMapClick, onStyle }
  })

  const draw = (m: MapLibreMap) => {
    const { data, dark } = latest.current
    const c = dark ? MAP_COLORS.dark : MAP_COLORS.light
    const empty: MapFeatures = { type: "FeatureCollection", features: [] }
    if (!m.getSource("data")) {
      m.addSource("data", { type: "geojson", data: data ?? empty })
      const color = ["match", ["get", "kind"], "wrong", c.wrong, "ghost", c.ghost, c.route] as never
      m.addLayer({
        id: "data-ghost",
        type: "line",
        source: "data",
        filter: ["==", ["get", "kind"], "ghost"],
        paint: { "line-color": c.ghost, "line-width": 2, "line-dasharray": [2, 2] },
      })
      m.addLayer({
        id: "data-line",
        type: "line",
        source: "data",
        filter: ["all", ["==", ["geometry-type"], "LineString"], ["!=", ["get", "kind"], "ghost"]],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": color, "line-width": 3 },
      })
      m.addLayer({
        id: "data-point",
        type: "circle",
        source: "data",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": color,
          "circle-radius": ["match", ["get", "kind"], "vertex", 3, 6],
          "circle-stroke-color": c.halo,
          "circle-stroke-width": ["match", ["get", "kind"], "vertex", 1, 2],
        },
      })
    }
    latest.current.onStyle?.(m)
  }

  useEffect(() => {
    if (!near || map.current) return
    let cancelled = false
    setState("loading")
    Promise.all([
      import("maplibre-gl"),
      // MapLibre 6 loads its worker from a separate file next to its own
      // module, which the bundle doesn't have, so point it at the copy Vite
      // emits.
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?url"),
      import("maplibre-gl/dist/maplibre-gl.css"),
    ])
      .then(([maplibregl, worker]) => {
        if (cancelled || !container.current) return
        maplibregl.setWorkerUrl(worker.default)
        const b = data ? bounds(data) : (fitTo ?? null)
        const m = new maplibregl.Map({
          container: container.current,
          style: latest.current.dark ? STYLE.dark : STYLE.light,
          ...(b
            ? { bounds: b, fitBoundsOptions: { padding: PADDING, maxZoom: MAX_ZOOM } }
            : { center: [0, 20], zoom: 1 }),
          attributionControl: { compact: true },
          cooperativeGestures: false,
          dragRotate: false,
          pitchWithRotate: false,
        })
        m.touchZoomRotate.disableRotation()
        m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")
        m.on("style.load", () => draw(m))
        m.on("click", (e) => latest.current.onMapClick?.(e.lngLat.lng, e.lngLat.lat))
        m.on("load", () => {
          setState("ready")
          // The page can still be settling (fonts, the other column), so fit
          // again at the final size.
          m.resize()
          const fit = latest.current.data ? bounds(latest.current.data) : (fitTo ?? null)
          if (fit) m.fitBounds(fit, { padding: PADDING, maxZoom: MAX_ZOOM, duration: 0 })
        })
        if (latest.current.onMapClick) m.getCanvas().style.cursor = "crosshair"
        m.getCanvas().setAttribute("aria-label", label)
        map.current = m
      })
      .catch(() => setState("error"))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near])

  useEffect(() => () => {
    map.current?.remove()
    map.current = null
  }, [])

  // New data.
  useEffect(() => {
    const m = map.current
    const source = m?.getSource("data") as { setData?: (d: MapFeatures) => void } | undefined
    if (data && source?.setData) source.setData(data)
  }, [data])

  // Refit when asked to.
  useEffect(() => {
    const m = map.current
    if (!m || !data) return
    const b = bounds(data)
    if (b) m.fitBounds(b, { padding: PADDING, maxZoom: MAX_ZOOM, duration: 400 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])

  // Theme: a different basemap. Our layers come back through style.load.
  useEffect(() => {
    const m = map.current
    if (!m) return
    m.setStyle(dark ? STYLE.dark : STYLE.light, { diff: false })
  }, [dark])

  return (
    <div
      ref={box}
      className={cn("relative overflow-hidden border bg-muted", className)}
      role="group"
      aria-label={label}
    >
      <div ref={container} className="h-full w-full" />
      {state !== "ready" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          {state === "error" ? "The map couldn't load. The rest of the page still works." : "Loading map"}
        </div>
      ) : null}
    </div>
  )
}
