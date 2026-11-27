// The bridge between the playground's model (lat first, rings as lines with
// a part number) and GeoJSON (lng first, typed geometries). Most formats go
// through GeoJSON, so this is the one place that swaps the axes and groups
// rings into polygons.
import type { Collection, Feature, Line, Pt } from "../model"

export type Position = number[]
export type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "MultiPoint"; coordinates: Position[] }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] }
  | { type: "GeometryCollection"; geometries: Geometry[] }
export type GeoFeature = { type: "Feature"; id?: string | number; properties: Record<string, unknown> | null; geometry: Geometry | null }
export type GeoCollection = { type: "FeatureCollection"; features: GeoFeature[] }

/** [lng, lat, z?] to [lat, lng, z?]. */
export const toPt = (p: Position): Pt => (p.length > 2 && Number.isFinite(p[2]) ? [p[1], p[0], p[2]] : [p[1], p[0]])
/** [lat, lng, z?] to [lng, lat, z?]. */
export const toPos = (p: Pt): Position => (p.length > 2 ? [p[1], p[0], p[2]] : [p[1], p[0]])

const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1]

/** A ring with its first point repeated at the end, as GeoJSON and the model both want. */
export function closeRing(pts: Pt[]): Pt[] {
  if (pts.length > 1 && !same(pts[0], pts[pts.length - 1])) return [...pts, pts[0].slice()]
  return pts
}

const validPos = (p: unknown): p is Position =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])

/** The lines of one geometry. Points are skipped: the playground only edits lines. */
export function geometryLines(g: Geometry | null | undefined, next = { part: 0 }): Line[] {
  if (!g || typeof g !== "object") return []
  const line = (cs: unknown): Line | null => {
    const pts = Array.isArray(cs) ? cs.filter(validPos).map(toPt) : []
    return pts.length ? { pts, ring: false } : null
  }
  const polygon = (rings: unknown): Line[] => {
    if (!Array.isArray(rings)) return []
    const part = next.part++
    return rings
      .map((r) => line(r))
      .filter((l): l is Line => !!l)
      .map((l) => ({ pts: closeRing(l.pts), ring: true, part }))
  }
  switch (g.type) {
    case "LineString":
      return [line(g.coordinates)].filter((l): l is Line => !!l)
    case "MultiLineString":
      return (g.coordinates ?? []).map(line).filter((l): l is Line => !!l)
    case "Polygon":
      return polygon(g.coordinates)
    case "MultiPolygon":
      return (g.coordinates ?? []).flatMap(polygon)
    case "GeometryCollection":
      return (g.geometries ?? []).flatMap((x) => geometryLines(x, next))
    default:
      return []
  }
}

/** Any GeoJSON object (FeatureCollection, Feature, geometry) to a collection. */
export function fromGeoJSON(obj: unknown): Collection {
  const features: Feature[] = []
  const add = (geometry: Geometry | null | undefined, props: Record<string, unknown> | null | undefined, id?: unknown) => {
    const lines = geometryLines(geometry)
    if (!lines.length) return
    const p = { ...(props ?? {}) }
    if (id !== undefined && id !== null && !("id" in p)) p.id = id
    features.push({ lines, props: p })
  }
  const walk = (o: unknown) => {
    if (!o || typeof o !== "object") return
    const x = o as { type?: string; features?: unknown[]; geometry?: Geometry; properties?: Record<string, unknown>; id?: unknown }
    if (x.type === "FeatureCollection" && Array.isArray(x.features)) x.features.forEach(walk)
    else if (x.type === "Feature") add(x.geometry, x.properties, x.id)
    else if (typeof x.type === "string") add(x as Geometry, null)
  }
  walk(obj)
  return { features }
}

/** One feature to a GeoJSON geometry: lines, polygons by part, or a collection of both. */
export function featureGeometry(f: Feature): Geometry | null {
  const lines = f.lines.filter((l) => !l.ring && l.pts.length)
  const rings = f.lines.filter((l) => l.ring && l.pts.length)
  const parts = new Map<number, Position[][]>()
  for (const [i, r] of rings.entries()) {
    const key = r.part ?? -1 - i
    if (!parts.has(key)) parts.set(key, [])
    parts.get(key)!.push(closeRing(r.pts).map(toPos))
  }
  const geoms: Geometry[] = []
  if (lines.length === 1) geoms.push({ type: "LineString", coordinates: lines[0].pts.map(toPos) })
  else if (lines.length > 1) geoms.push({ type: "MultiLineString", coordinates: lines.map((l) => l.pts.map(toPos)) })
  const polys = [...parts.values()]
  if (polys.length === 1) geoms.push({ type: "Polygon", coordinates: polys[0] })
  else if (polys.length > 1) geoms.push({ type: "MultiPolygon", coordinates: polys })
  if (!geoms.length) return null
  return geoms.length === 1 ? geoms[0] : { type: "GeometryCollection", geometries: geoms }
}

export function toGeoJSON(c: Collection): GeoCollection {
  return {
    type: "FeatureCollection",
    features: c.features.map((f) => ({ type: "Feature", properties: { ...f.props }, geometry: featureGeometry(f) })),
  }
}

/** Text in a Uint8Array or a string, as a string (UTF-8). */
export const asText = (input: string | Uint8Array) => (typeof input === "string" ? input : new TextDecoder().decode(input))
/** Bytes from a string or a Uint8Array. */
export const asBytes = (input: string | Uint8Array) => (typeof input === "string" ? new TextEncoder().encode(input) : input)

/** Lets the browser paint between chunks of a long loop. */
export const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0))

export const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Shortest round-trippable text for a coordinate. */
export const num = (x: number) => String(Math.round(x * 1e9) / 1e9)

/** Whether any position in the geometry has a third value. */
export function hasZ(g: Geometry): boolean {
  if (g.type === "GeometryCollection") return g.geometries.some(hasZ)
  const walk = (c: unknown): boolean =>
    Array.isArray(c) && (typeof c[0] === "number" ? c.length > 2 : c.some(walk))
  return walk(g.coordinates)
}
