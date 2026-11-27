// WKB and EWKB, as hex text, one geometry per line. PostGIS takes either:
// ST_GeomFromEWKB(decode('...', 'hex')) or ST_GeomFromWKB(..., 4326).
//
// Written little-endian. Read in both byte orders, with ISO Z/M/ZM types
// (1000s, 2000s, 3000s) and EWKB's high flag bits (Z 0x80000000,
// M 0x40000000, SRID 0x20000000). The GeoPackage module reuses encodeWkb
// and decodeWkb, since a GPKG geometry blob is a header plus ISO WKB.
import type { Collection, Feature } from "../model"
import type { Converter } from "./types"
import { asText, featureGeometry, geometryLines, hasZ, type Geometry, type Position } from "./geo"

const TYPES: Record<string, number> = {
  Point: 1,
  LineString: 2,
  Polygon: 3,
  MultiPoint: 4,
  MultiLineString: 5,
  MultiPolygon: 6,
  GeometryCollection: 7,
}
const NAMES = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [v, k])) as Record<number, string>

const EWKB_Z = 0x80000000
const EWKB_M = 0x40000000
const EWKB_SRID = 0x20000000

class Writer {
  private buf = new ArrayBuffer(256)
  private view = new DataView(this.buf)
  length = 0
  private grow(n: number) {
    if (this.length + n <= this.buf.byteLength) return
    const next = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.length + n))
    new Uint8Array(next).set(new Uint8Array(this.buf, 0, this.length))
    this.buf = next
    this.view = new DataView(next)
  }
  u8(x: number) {
    this.grow(1)
    this.view.setUint8(this.length, x)
    this.length += 1
  }
  u32(x: number) {
    this.grow(4)
    this.view.setUint32(this.length, x >>> 0, true)
    this.length += 4
  }
  f64(x: number) {
    this.grow(8)
    this.view.setFloat64(this.length, x, true)
    this.length += 8
  }
  bytes() {
    return new Uint8Array(this.buf, 0, this.length).slice()
  }
}

export type WkbOptions = {
  /** EWKB flags and SRID instead of ISO types. */
  ewkb?: boolean
  /** With ewkb: the SRID to write on the outer geometry. */
  srid?: number
  /** Force Z (missing third values become 0). Default: when any position has one. */
  z?: boolean
}

/** One geometry to WKB bytes, little-endian. */
export function encodeWkb(g: Geometry, options: WkbOptions = {}): Uint8Array {
  const w = new Writer()
  const z = options.z ?? hasZ(g)
  const write = (g: Geometry, outer: boolean) => {
    w.u8(1)
    let type = TYPES[g.type]
    if (options.ewkb) {
      if (z) type |= EWKB_Z
      if (outer && options.srid !== undefined) type |= EWKB_SRID
      w.u32(type)
      if (outer && options.srid !== undefined) w.u32(options.srid)
    } else w.u32(type + (z ? 1000 : 0))
    const pos = (p: Position) => {
      w.f64(p[0])
      w.f64(p[1])
      if (z) w.f64(p[2] ?? 0)
    }
    const list = (ps: Position[]) => {
      w.u32(ps.length)
      ps.forEach(pos)
    }
    switch (g.type) {
      case "Point":
        pos(g.coordinates)
        break
      case "LineString":
        list(g.coordinates)
        break
      case "Polygon":
        w.u32(g.coordinates.length)
        g.coordinates.forEach(list)
        break
      case "MultiPoint":
        w.u32(g.coordinates.length)
        g.coordinates.forEach((c) => write({ type: "Point", coordinates: c }, false))
        break
      case "MultiLineString":
        w.u32(g.coordinates.length)
        g.coordinates.forEach((c) => write({ type: "LineString", coordinates: c }, false))
        break
      case "MultiPolygon":
        w.u32(g.coordinates.length)
        g.coordinates.forEach((c) => write({ type: "Polygon", coordinates: c }, false))
        break
      case "GeometryCollection":
        w.u32(g.geometries.length)
        g.geometries.forEach((c) => write(c, false))
        break
    }
  }
  write(g, true)
  return w.bytes()
}

/** One WKB or EWKB geometry from `bytes` at `offset`; returns where it ended too. */
export function decodeWkb(bytes: Uint8Array, offset = 0): { geometry: Geometry; srid?: number; end: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = offset
  let srid: number | undefined
  const read = (): Geometry => {
    const order = view.getUint8(at)
    if (order > 1) throw new SyntaxError(`WKB: bad byte order ${order} at ${at}`)
    const le = order === 1
    at += 1
    const u32 = () => {
      const x = view.getUint32(at, le)
      at += 4
      return x
    }
    const f64 = () => {
      const x = view.getFloat64(at, le)
      at += 8
      return x
    }
    const raw = u32()
    let z = !!(raw & EWKB_Z)
    let m = !!(raw & EWKB_M)
    if (raw & EWKB_SRID) srid = u32()
    let type = raw & 0x0fffffff
    // ISO: 1001 is LineString Z, 2001 LineString M, 3001 ZM.
    if (type >= 1000) {
      const dim = Math.floor(type / 1000)
      type %= 1000
      z ||= dim === 1 || dim === 3
      m ||= dim === 2 || dim === 3
    }
    const pos = (): Position => {
      const p = [f64(), f64()]
      if (z) p.push(f64())
      if (m) f64()
      return p
    }
    const list = () => Array.from({ length: u32() }, pos)
    const many = () => Array.from({ length: u32() }, read)
    switch (NAMES[type]) {
      case "Point":
        return { type: "Point", coordinates: pos() }
      case "LineString":
        return { type: "LineString", coordinates: list() }
      case "Polygon":
        return { type: "Polygon", coordinates: Array.from({ length: u32() }, list) }
      case "MultiPoint":
        return { type: "MultiPoint", coordinates: many().map((g) => (g as { coordinates: Position }).coordinates) }
      case "MultiLineString":
        return { type: "MultiLineString", coordinates: many().map((g) => (g as { coordinates: Position[] }).coordinates) }
      case "MultiPolygon":
        return { type: "MultiPolygon", coordinates: many().map((g) => (g as { coordinates: Position[][] }).coordinates) }
      case "GeometryCollection":
        return { type: "GeometryCollection", geometries: many() }
      default:
        throw new SyntaxError(`WKB: unknown geometry type ${type}`)
    }
  }
  const geometry = read()
  return { geometry, srid, end: at }
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase()

export function fromHex(hex: string): Uint8Array {
  const s = hex.replace(/^\\x/i, "").replace(/\s+/g, "")
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new SyntaxError("WKB: not hex")
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function readWkbHex(text: string): Collection {
  const features: Feature[] = []
  for (const line of text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    const { geometry, srid } = decodeWkb(fromHex(line))
    if (srid !== undefined && srid !== 4326) throw new SyntaxError(`EWKB: SRID ${srid} isn't WGS84 (4326); reproject it first`)
    const lines = geometryLines(geometry)
    if (lines.length) features.push({ lines, props: {} })
  }
  return { features }
}

export function writeWkbHex(c: Collection, ewkb: boolean): string {
  return (
    c.features
      .map(featureGeometry)
      .filter((g): g is Geometry => !!g)
      .map((g) => toHex(encodeWkb(g, ewkb ? { ewkb: true, srid: 4326 } : {})))
      .join("\n") + "\n"
  )
}

export default {
  async read(input) {
    return readWkbHex(asText(input))
  },
  async write(c) {
    return writeWkbHex(c, false)
  },
} satisfies Converter
