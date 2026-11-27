// WKT and EWKT (PostGIS's `SRID=4326;` prefix). One geometry per line of
// text: LINESTRING, MULTILINESTRING, POLYGON, MULTIPOLYGON and
// GEOMETRYCOLLECTION, with or without Z. Points are read and dropped, like
// in the other formats. WKT is x y, so lng lat.
import type { Collection, Feature } from "../model"
import type { Converter } from "./types"
import { asText, featureGeometry, geometryLines, hasZ, num, type Geometry, type Position } from "./geo"

type Tok = string

function tokens(s: string): Tok[] {
  return s.match(/[A-Za-z]+|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|[(),]/g) ?? []
}

/** Parses one WKT geometry (without an SRID prefix) into a GeoJSON geometry. */
export function parseWkt(s: string): Geometry {
  const t = tokens(s)
  let i = 0
  const peek = () => t[i]
  const next = () => t[i++]
  const expect = (x: string) => {
    if (next() !== x) throw new SyntaxError(`WKT: expected ${x} near token ${i}`)
  }
  const position = (): Position => {
    const p: number[] = []
    while (peek() !== undefined && peek() !== "," && peek() !== ")") p.push(Number(next()))
    if (p.length < 2 || p.some((x) => !Number.isFinite(x))) throw new SyntaxError("WKT: bad coordinate")
    return p
  }
  // Lists of positions; MULTIPOINT may write its points with or without parens.
  const positions = (): Position[] => {
    expect("(")
    const out: Position[] = []
    do {
      if (peek() === "(") {
        next()
        out.push(position())
        expect(")")
      } else out.push(position())
    } while (peek() === "," && next())
    expect(")")
    return out
  }
  const list = <T,>(item: () => T): T[] => {
    expect("(")
    const out: T[] = []
    do out.push(item())
    while (peek() === "," && next())
    expect(")")
    return out
  }
  const geometry = (): Geometry => {
    const type = (next() ?? "").toUpperCase()
    // Z, M and ZM modifiers: keep the numbers, the z is the third.
    while (/^(Z|M|ZM)$/i.test(peek() ?? "")) next()
    if (/^EMPTY$/i.test(peek() ?? "")) {
      next()
      return { type: "GeometryCollection", geometries: [] }
    }
    switch (type) {
      case "POINT":
        return { type: "Point", coordinates: positions()[0] }
      case "MULTIPOINT":
        return { type: "MultiPoint", coordinates: positions() }
      case "LINESTRING":
        return { type: "LineString", coordinates: positions() }
      case "MULTILINESTRING":
        return { type: "MultiLineString", coordinates: list(positions) }
      case "POLYGON":
        return { type: "Polygon", coordinates: list(positions) }
      case "MULTIPOLYGON":
        return { type: "MultiPolygon", coordinates: list(() => list(positions)) }
      case "GEOMETRYCOLLECTION":
        return { type: "GeometryCollection", geometries: list(geometry) }
      default:
        throw new SyntaxError(`WKT: unknown geometry type ${type}`)
    }
  }
  const g = geometry()
  if (i < t.length) throw new SyntaxError("WKT: trailing text")
  return g
}

const SRID = /^\s*SRID=(\d+)\s*;\s*/i

/** Geometries one per line (or separated by blank lines), with an optional SRID prefix each. */
export function readWkt(text: string): Collection {
  const features: Feature[] = []
  const chunks = text.split(/\r?\n(?=\s*(?:SRID=|[A-Za-z]))/).map((s) => s.trim()).filter(Boolean)
  for (const chunk of chunks) {
    const m = chunk.match(SRID)
    if (m && m[1] !== "4326") throw new SyntaxError(`EWKT: SRID ${m[1]} isn't WGS84 (4326); reproject it first`)
    const lines = geometryLines(parseWkt(chunk.replace(SRID, "")))
    if (lines.length) features.push({ lines, props: {} })
  }
  return { features }
}

export function geometryWkt(g: Geometry): string {
  const hz = hasZ(g)
  const z = hz ? " Z" : ""
  // A Z geometry needs three numbers in every position.
  const pos = (p: Position) => (hz ? [p[0], p[1], p[2] ?? 0] : [p[0], p[1]]).map(num).join(" ")
  const ring = (cs: Position[]) => `(${cs.map(pos).join(", ")})`
  switch (g.type) {
    case "Point":
      return `POINT${z} (${pos(g.coordinates)})`
    case "MultiPoint":
      return `MULTIPOINT${z} (${g.coordinates.map((p) => `(${pos(p)})`).join(", ")})`
    case "LineString":
      return `LINESTRING${z} ${ring(g.coordinates)}`
    case "MultiLineString":
      return `MULTILINESTRING${z} (${g.coordinates.map(ring).join(", ")})`
    case "Polygon":
      return `POLYGON${z} (${g.coordinates.map(ring).join(", ")})`
    case "MultiPolygon":
      return `MULTIPOLYGON${z} (${g.coordinates.map((p) => `(${p.map(ring).join(", ")})`).join(", ")})`
    case "GeometryCollection":
      return `GEOMETRYCOLLECTION (${g.geometries.map(geometryWkt).join(", ")})`
  }
}

export function writeWkt(c: Collection, ewkt: boolean): string {
  return (
    c.features
      .map(featureGeometry)
      .filter((g): g is Geometry => !!g)
      .map((g) => (ewkt ? "SRID=4326;" : "") + geometryWkt(g))
      .join("\n") + "\n"
  )
}

export default {
  async read(input) {
    return readWkt(asText(input))
  },
  async write(c) {
    return writeWkt(c, false)
  },
} satisfies Converter
