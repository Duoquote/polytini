// Shapefile as a zip of .shp, .shx, .dbf, .prj and .cpg, in WGS84.
// Binary, so download and upload only.
//
// Written by hand instead of with shp-write or shpjs: the format is small,
// shpjs pulls in proj4 (over 100 KB) and @mapbox/shp-write hasn't had a
// release since 2023 and brings JSZip. fflate does the zip.
//
// Lines go in a PolyLine layer and rings in a Polygon layer (PolyLineZ and
// PolygonZ with elevation), since a shapefile holds one shape type. Outer
// rings are written clockwise and holes counterclockwise, as the spec says.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import type { Collection, Feature, Line, Pt } from "../model"
import type { Converter, WriteOptions } from "./types"
import { asBytes, closeRing } from "./geo"

const PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]'

const POLYLINE = 3
const POLYGON = 5
const POLYLINE_Z = 13
const POLYGON_Z = 15
const POLYLINE_M = 23
const POLYGON_M = 25

/** Twice the signed area in the x (lng), y (lat) plane: positive counterclockwise, negative clockwise. */
export function signedArea(pts: Pt[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p[1] * q[0] - q[1] * p[0]
  }
  return a
}

// ---------- writing ----------

type Shape = { parts: Pt[][]; props: Record<string, unknown> }

function shapesOf(c: Collection, rings: boolean): Shape[] {
  const out: Shape[] = []
  for (const f of c.features) {
    const lines = f.lines.filter((l) => l.ring === rings && l.pts.length)
    if (!lines.length) continue
    let parts: Pt[][]
    if (rings) {
      // Group by polygon, outer first, then orient: outer clockwise, holes counterclockwise.
      const groups = new Map<number, Line[]>()
      lines.forEach((l, i) => {
        const k = l.part ?? -1 - i
        if (!groups.has(k)) groups.set(k, [])
        groups.get(k)!.push(l)
      })
      parts = [...groups.values()].flatMap((g) =>
        g.map((l, i) => {
          const r = closeRing(l.pts)
          const clockwise = signedArea(r) < 0
          return clockwise === (i === 0) ? r : [...r].reverse()
        })
      )
    } else parts = lines.map((l) => l.pts)
    out.push({ parts, props: f.props })
  }
  return out
}

class Bytes {
  buf: Uint8Array
  view: DataView
  constructor(n: number) {
    this.buf = new Uint8Array(n)
    this.view = new DataView(this.buf.buffer)
  }
}

function bbox(pts: Pt[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p[1]); x1 = Math.max(x1, p[1])
    y0 = Math.min(y0, p[0]); y1 = Math.max(y1, p[0])
    const z = p[2] ?? 0
    z0 = Math.min(z0, z); z1 = Math.max(z1, z)
  }
  return { x0, y0, x1, y1, z0, z1 }
}

function writeShpShx(shapes: Shape[], rings: boolean, z: boolean): { shp: Uint8Array; shx: Uint8Array } {
  const type = rings ? (z ? POLYGON_Z : POLYGON) : z ? POLYLINE_Z : POLYLINE
  const contentLength = (s: Shape) => {
    const n = s.parts.reduce((a, p) => a + p.length, 0)
    return 44 + 4 * s.parts.length + 16 * n + (z ? 16 + 8 * n : 0)
  }
  const lengths = shapes.map(contentLength)
  const shpSize = 100 + lengths.reduce((a, n) => a + 8 + n, 0)
  const shxSize = 100 + 8 * shapes.length
  const shp = new Bytes(shpSize)
  const shx = new Bytes(shxSize)
  const all = bbox(shapes.flatMap((s) => s.parts.flat()))
  for (const [f, size] of [[shp, shpSize], [shx, shxSize]] as const) {
    f.view.setInt32(0, 9994, false)
    f.view.setInt32(24, size / 2, false)
    f.view.setInt32(28, 1000, true)
    f.view.setInt32(32, type, true)
    if (shapes.length) {
      f.view.setFloat64(36, all.x0, true)
      f.view.setFloat64(44, all.y0, true)
      f.view.setFloat64(52, all.x1, true)
      f.view.setFloat64(60, all.y1, true)
      if (z) {
        f.view.setFloat64(68, all.z0, true)
        f.view.setFloat64(76, all.z1, true)
      }
    }
  }
  let at = 100
  shapes.forEach((s, i) => {
    const v = shp.view
    shx.view.setInt32(100 + 8 * i, at / 2, false)
    shx.view.setInt32(104 + 8 * i, lengths[i] / 2, false)
    v.setInt32(at, i + 1, false)
    v.setInt32(at + 4, lengths[i] / 2, false)
    at += 8
    const pts = s.parts.flat()
    const b = bbox(pts)
    v.setInt32(at, type, true)
    v.setFloat64(at + 4, b.x0, true)
    v.setFloat64(at + 12, b.y0, true)
    v.setFloat64(at + 20, b.x1, true)
    v.setFloat64(at + 28, b.y1, true)
    v.setInt32(at + 36, s.parts.length, true)
    v.setInt32(at + 40, pts.length, true)
    at += 44
    let start = 0
    for (const p of s.parts) {
      v.setInt32(at, start, true)
      at += 4
      start += p.length
    }
    for (const p of pts) {
      v.setFloat64(at, p[1], true)
      v.setFloat64(at + 8, p[0], true)
      at += 16
    }
    if (z) {
      v.setFloat64(at, b.z0, true)
      v.setFloat64(at + 8, b.z1, true)
      at += 16
      for (const p of pts) {
        v.setFloat64(at, p[2] ?? 0, true)
        at += 8
      }
    }
  })
  return { shp: shp.buf, shx: shx.buf }
}

type Field = { name: string; key: string; type: "C" | "N" | "L"; length: number; decimals: number }

function dbfFields(shapes: Shape[]): Field[] {
  const keys = [...new Set(shapes.flatMap((s) => Object.keys(s.props)))]
  const used = new Set<string>()
  const enc = new TextEncoder()
  const fields: Field[] = keys.map((key) => {
    // dBASE names are at most 10 bytes, ASCII, unique.
    const base = key.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 10) || "field"
    let name = base
    for (let n = 1; used.has(name.toUpperCase()); n++) name = base.slice(0, 10 - String(n).length) + n
    used.add(name.toUpperCase())
    const values = shapes.map((s) => s.props[key]).filter((v) => v !== null && v !== undefined)
    if (values.length && values.every((v) => typeof v === "boolean")) return { name, key, type: "L", length: 1, decimals: 0 }
    if (values.length && values.every((v) => typeof v === "number" && Number.isFinite(v))) {
      const ints = values.every((v) => Number.isInteger(v))
      return { name, key, type: "N", length: ints ? 18 : 24, decimals: ints ? 0 : 15 }
    }
    const longest = Math.max(1, ...values.map((v) => enc.encode(typeof v === "object" ? JSON.stringify(v) : String(v)).length))
    return { name, key, type: "C", length: Math.min(254, longest), decimals: 0 }
  })
  // A dbf needs at least one field.
  return fields.length ? fields : [{ name: "id", key: "\0id", type: "N", length: 10, decimals: 0 }]
}

function writeDbf(shapes: Shape[]): Uint8Array {
  const fields = dbfFields(shapes)
  const recordLength = 1 + fields.reduce((a, f) => a + f.length, 0)
  const headerLength = 32 + 32 * fields.length + 1
  const out = new Bytes(headerLength + recordLength * shapes.length + 1)
  const v = out.view
  const now = new Date()
  v.setUint8(0, 0x03)
  v.setUint8(1, now.getUTCFullYear() - 1900)
  v.setUint8(2, now.getUTCMonth() + 1)
  v.setUint8(3, now.getUTCDate())
  v.setUint32(4, shapes.length, true)
  v.setUint16(8, headerLength, true)
  v.setUint16(10, recordLength, true)
  // Language driver 0x57 (ANSI); the .cpg says UTF-8, which GDAL and QGIS honor.
  v.setUint8(29, 0x57)
  fields.forEach((f, i) => {
    const at = 32 + 32 * i
    out.buf.set(strToU8(f.name), at)
    v.setUint8(at + 11, f.type.charCodeAt(0))
    v.setUint8(at + 16, f.length)
    v.setUint8(at + 17, f.decimals)
  })
  v.setUint8(headerLength - 1, 0x0d)
  const enc = new TextEncoder()
  shapes.forEach((s, r) => {
    let at = headerLength + r * recordLength
    out.buf[at++] = 0x20
    for (const f of fields) {
      const raw = f.key === "\0id" ? r + 1 : s.props[f.key]
      let text = ""
      if (raw !== null && raw !== undefined) {
        if (f.type === "L") text = raw ? "T" : "F"
        else if (f.type === "N") text = (raw as number).toFixed(f.decimals)
        else text = typeof raw === "object" ? JSON.stringify(raw) : String(raw)
      }
      let bytes = enc.encode(text)
      if (bytes.length > f.length) bytes = bytes.slice(0, f.length)
      // Numbers right-aligned, text left-aligned, padded with spaces.
      const pad = new Uint8Array(f.length).fill(0x20)
      pad.set(bytes, f.type === "N" ? f.length - bytes.length : 0)
      out.buf.set(pad, at)
      at += f.length
    }
  })
  v.setUint8(out.buf.length - 1, 0x1a)
  return out.buf
}

export function writeShapefile(c: Collection, options: WriteOptions = {}): Uint8Array {
  const base = (options.name ?? "lines").replace(/[^\w.-]+/g, "_")
  const z = c.features.some((f) => f.lines.some((l) => l.pts.some((p) => p.length > 2)))
  const files: Record<string, Uint8Array> = {}
  const layers = [
    { rings: false, shapes: shapesOf(c, false) },
    { rings: true, shapes: shapesOf(c, true) },
  ].filter((l) => l.shapes.length)
  // An empty collection still makes a valid, empty line layer.
  if (!layers.length) layers.push({ rings: false, shapes: [] })
  for (const layer of layers) {
    const name = layers.length > 1 ? `${base}_${layer.rings ? "polygons" : "lines"}` : base
    const { shp, shx } = writeShpShx(layer.shapes, layer.rings, z)
    files[`${name}.shp`] = shp
    files[`${name}.shx`] = shx
    files[`${name}.dbf`] = writeDbf(layer.shapes)
    files[`${name}.prj`] = strToU8(PRJ)
    files[`${name}.cpg`] = strToU8("UTF-8")
  }
  return zipSync(files, { level: 9 })
}

// ---------- reading ----------

function readDbf(buf: Uint8Array, encoding: string): Record<string, unknown>[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const n = v.getUint32(4, true)
  const headerLength = v.getUint16(8, true)
  const recordLength = v.getUint16(10, true)
  const fields: { name: string; type: string; length: number }[] = []
  for (let at = 32; at < headerLength - 1 && buf[at] !== 0x0d; at += 32) {
    const raw = buf.slice(at, at + 11)
    const end = raw.indexOf(0)
    fields.push({
      name: strFromU8(end < 0 ? raw : raw.slice(0, end), true),
      type: String.fromCharCode(buf[at + 11]),
      length: buf[at + 16],
    })
  }
  let dec: TextDecoder
  try {
    dec = new TextDecoder(encoding)
  } catch {
    dec = new TextDecoder("utf-8")
  }
  const rows: Record<string, unknown>[] = []
  for (let r = 0; r < n; r++) {
    let at = headerLength + r * recordLength
    if (buf[at] === 0x2a) continue // deleted
    at += 1
    const row: Record<string, unknown> = {}
    for (const f of fields) {
      const text = dec.decode(buf.slice(at, at + f.length)).trim()
      at += f.length
      if (f.type === "N" || f.type === "F") row[f.name] = text === "" || /^\*+$/.test(text) ? null : Number(text)
      else if (f.type === "L") row[f.name] = /^[TtYy]$/.test(text) ? true : /^[FfNn]$/.test(text) ? false : null
      else row[f.name] = text
    }
    rows.push(row)
  }
  return rows
}

export function readShp(buf: Uint8Array, rows: Record<string, unknown>[] = []): Feature[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (v.getInt32(0, false) !== 9994) throw new SyntaxError("Shapefile: not a .shp file")
  const end = Math.min(buf.byteLength, v.getInt32(24, false) * 2)
  const features: Feature[] = []
  let at = 100
  let index = 0
  while (at + 8 <= end) {
    const length = v.getInt32(at + 4, false) * 2
    const rec = at + 8
    at = rec + length
    const props = rows[index++] ?? {}
    const type = v.getInt32(rec, true)
    const rings = type === POLYGON || type === POLYGON_Z || type === POLYGON_M
    const lines = type === POLYLINE || type === POLYLINE_Z || type === POLYLINE_M
    if (!rings && !lines) continue // null shapes and points
    const numParts = v.getInt32(rec + 36, true)
    const numPoints = v.getInt32(rec + 40, true)
    const starts = Array.from({ length: numParts }, (_, i) => v.getInt32(rec + 44 + 4 * i, true))
    const pAt = rec + 44 + 4 * numParts
    const pts: Pt[] = Array.from({ length: numPoints }, (_, i) => [v.getFloat64(pAt + 16 * i + 8, true), v.getFloat64(pAt + 16 * i, true)])
    // The Z array comes after the points and the Z range, if the record has it.
    if ((type === POLYLINE_Z || type === POLYGON_Z) && pAt + 16 * numPoints + 16 + 8 * numPoints <= rec + length) {
      const zAt = pAt + 16 * numPoints + 16
      pts.forEach((p, i) => p.push(v.getFloat64(zAt + 8 * i, true)))
    }
    const parts = starts.map((s, i) => pts.slice(s, i + 1 < starts.length ? starts[i + 1] : numPoints))
    let ls: Line[]
    if (rings) {
      // Clockwise rings start a polygon; counterclockwise ones are its holes.
      let part = -1
      ls = parts.map((p) => {
        if (signedArea(p) < 0 || part < 0) part++
        return { pts: p, ring: true, part }
      })
    } else ls = parts.map((p) => ({ pts: p, ring: false }))
    features.push({ lines: ls.filter((l) => l.pts.length), props })
  }
  return features
}

export function readShapefile(input: Uint8Array): Collection {
  // A bare .shp works too, without attributes.
  if (input[0] !== 0x50 || input[1] !== 0x4b) return { features: readShp(input) }
  const files = unzipSync(input)
  const shps = Object.keys(files).filter((n) => /\.shp$/i.test(n) && !n.startsWith("__MACOSX"))
  if (!shps.length) throw new SyntaxError("Shapefile: no .shp in the zip")
  const features: Feature[] = []
  for (const shp of shps) {
    const base = shp.slice(0, -4)
    const find = (ext: string) => Object.keys(files).find((n) => n.toLowerCase() === `${base}.${ext}`.toLowerCase())
    const prj = find("prj")
    if (prj && /PROJCS/i.test(strFromU8(files[prj]))) throw new SyntaxError(`Shapefile: ${shp} is in a projected system; reproject it to WGS84 first`)
    const cpg = find("cpg")
    const dbf = find("dbf")
    const rows = dbf ? readDbf(files[dbf], cpg ? strFromU8(files[cpg]).trim() || "utf-8" : "utf-8") : []
    features.push(...readShp(files[shp], rows))
  }
  return { features }
}

export default {
  async read(input) {
    return readShapefile(asBytes(input))
  },
  async write(c, options) {
    return writeShapefile(c, options)
  },
} satisfies Converter
