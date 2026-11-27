// The list of formats, their lazy loaders, and the sniffer that guesses a
// format from pasted text or a dropped file. Nothing heavy is imported
// here: each format module (and its library) is its own chunk, loaded by
// loadFormat() when it's used.
import type { Converter, FormatId, FormatInfo, Sniffed } from "./types"

export type { Converter, FormatId, FormatInfo, Sniffed } from "./types"

export const FORMATS: FormatInfo[] = [
  { id: "geojson", label: "GeoJSON", ext: ["geojson", "json"], mime: "application/geo+json", binary: false },
  { id: "geojsonl", label: "GeoJSONL (one Feature per line)", ext: ["geojsonl", "ndjson", "jsonl"], mime: "application/x-ndjson", binary: false },
  { id: "geojsons", label: "GeoJSON Text Sequences (RFC 8142)", ext: ["geojsons"], mime: "application/geo+json-seq", binary: false },
  { id: "kml", label: "KML", ext: ["kml"], mime: "application/vnd.google-earth.kml+xml", binary: false },
  { id: "kmz", label: "KMZ", ext: ["kmz"], mime: "application/vnd.google-earth.kmz", binary: true },
  { id: "gpx", label: "GPX", ext: ["gpx"], mime: "application/gpx+xml", binary: false },
  { id: "wkt", label: "WKT", ext: ["wkt"], mime: "text/plain", binary: false },
  { id: "ewkt", label: "EWKT (SRID=4326)", ext: ["ewkt"], mime: "text/plain", binary: false },
  { id: "wkb", label: "WKB (hex)", ext: ["wkb", "hex"], mime: "text/plain", binary: false },
  { id: "ewkb", label: "EWKB (hex, SRID 4326)", ext: ["ewkb"], mime: "text/plain", binary: false },
  { id: "shapefile", label: "Shapefile (zip)", ext: ["zip", "shp"], mime: "application/zip", binary: true },
  { id: "csv", label: "CSV", ext: ["csv", "tsv", "txt"], mime: "text/csv", binary: false },
  { id: "topojson", label: "TopoJSON", ext: ["topojson"], mime: "application/json", binary: false },
  { id: "flatgeobuf", label: "FlatGeobuf", ext: ["fgb"], mime: "application/octet-stream", binary: true },
  { id: "gpkg", label: "GeoPackage", ext: ["gpkg"], mime: "application/geopackage+sqlite3", binary: true },
]

export const formatInfo = (id: FormatId) => FORMATS.find((f) => f.id === id)!

const LOADERS: Record<FormatId, () => Promise<{ default: Converter }>> = {
  geojson: () => import("./geojson"),
  geojsonl: () => import("./geojsonl"),
  // The same module reads both; writing RS records is an option of it.
  geojsons: () => import("./geojsonl"),
  kml: () => import("./kml"),
  kmz: () => import("./kmz"),
  gpx: () => import("./gpx"),
  wkt: () => import("./wkt"),
  ewkt: () => import("./ewkt"),
  wkb: () => import("./wkb"),
  ewkb: () => import("./ewkb"),
  shapefile: () => import("./shapefile"),
  csv: () => import("./csv"),
  topojson: () => import("./topojson"),
  flatgeobuf: () => import("./flatgeobuf"),
  gpkg: () => import("./gpkg"),
}

/** The converter for a format, loading its chunk on first use. */
export async function loadFormat(id: FormatId): Promise<Converter> {
  const c = (await LOADERS[id]()).default
  if (id !== "geojsons") return c
  return { read: c.read, write: (col, o) => c.write(col, { ...o, rs: true }) }
}

// ---------- sniffing ----------

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))

function sniffBytes(b: Uint8Array): Sniffed[] {
  if (b.length >= 4 && ascii(b, 0, 3) === "fgb" && b[3] === 3) return [{ id: "flatgeobuf", confidence: 0.99, why: "FlatGeobuf magic bytes" }]
  if (b.length >= 16 && ascii(b, 0, 15) === "SQLite format 3") {
    // GeoPackage sets the SQLite application id to "GPKG" (offset 68).
    const gpkg = b.length >= 72 && ascii(b, 68, 72) === "GPKG"
    return [{ id: "gpkg", confidence: gpkg ? 0.99 : 0.8, why: gpkg ? "SQLite with the GPKG application id" : "an SQLite file" }]
  }
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4) {
    // Zip file names are stored uncompressed, so look for them in the raw bytes.
    const names = new TextDecoder("latin1").decode(b.subarray(0, Math.min(b.length, 1 << 20)))
    if (/\.shp\b/i.test(names)) return [{ id: "shapefile", confidence: 0.97, why: "a zip with a .shp inside" }]
    if (/\.kml\b/i.test(names)) return [{ id: "kmz", confidence: 0.95, why: "a zip with a .kml inside" }]
    return [{ id: "shapefile", confidence: 0.3, why: "a zip file" }]
  }
  if (b.length >= 100 && new DataView(b.buffer, b.byteOffset).getInt32(0, false) === 9994)
    return [{ id: "shapefile", confidence: 0.9, why: "a bare .shp file (no attributes)" }]
  return []
}

const WKT = /^\s*(SRID=\d+\s*;\s*)?(MULTI)?(POINT|LINESTRING|POLYGON)\b|^\s*(SRID=\d+\s*;\s*)?GEOMETRYCOLLECTION\b/i

function sniffHexWkb(text: string): Sniffed | null {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  if (!lines.length || !lines.every((l) => /^(\\x)?[0-9a-f]+$/i.test(l) && l.length % 2 === 0 && l.length >= 18)) return null
  const h = lines[0].replace(/^\\x/i, "")
  const order = h.slice(0, 2)
  if (order !== "00" && order !== "01") return null
  const bytes = h.slice(2, 10).match(/../g)!.map((x) => parseInt(x, 16))
  const type = order === "01" ? (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0 : (bytes[3] | (bytes[2] << 8) | (bytes[1] << 16) | (bytes[0] << 24)) >>> 0
  const base = (type & 0x0fffffff) % 1000
  if (base < 1 || base > 7) return null
  const ewkb = (type & 0xe0000000) !== 0
  return { id: ewkb ? "ewkb" : "wkb", confidence: 0.92, why: ewkb ? "hex EWKB with PostGIS flags" : "hex WKB" }
}

function isFeatureish(o: unknown) {
  if (!o || typeof o !== "object") return false
  const t = (o as { type?: unknown }).type
  return typeof t === "string" && /^(Feature|FeatureCollection|LineString|MultiLineString|Polygon|MultiPolygon|Point|MultiPoint|GeometryCollection)$/.test(t)
}

function sniffText(text: string): Sniffed[] {
  const t = text.trim()
  if (!t) return []
  if (t.startsWith("<")) {
    if (/<kml[\s>]/i.test(t)) return [{ id: "kml", confidence: 0.98, why: "an XML document with a <kml> root" }]
    if (/<gpx[\s>]/i.test(t)) return [{ id: "gpx", confidence: 0.98, why: "an XML document with a <gpx> root" }]
    return []
  }
  if (t.includes("\x1e")) return [{ id: "geojsons", confidence: 0.95, why: "records starting with the RS character (RFC 8142)" }]
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const o = JSON.parse(t) as { type?: string }
      if (o && o.type === "Topology") return [{ id: "topojson", confidence: 0.98, why: "a TopoJSON Topology" }]
      if (isFeatureish(o)) return [{ id: "geojson", confidence: 0.97, why: `a GeoJSON ${o.type}` }]
      return []
    } catch {
      // Not one JSON value: maybe one per line.
    }
    const lines = t.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length > 1) {
      const sample = lines.slice(0, 20)
      try {
        const parsed = sample.map((l) => JSON.parse(l))
        if (parsed.every(isFeatureish)) return [{ id: "geojsonl", confidence: 0.95, why: "one GeoJSON Feature per line" }]
        if (parsed.every((o) => o && typeof o === "object" && !Array.isArray(o)))
          return [{ id: "geojsonl", confidence: 0.6, why: "NDJSON objects; reading a polyline field from them" }]
      } catch {
        return []
      }
    }
    return []
  }
  if (WKT.test(t)) {
    const ewkt = /^\s*SRID=/i.test(t)
    return [{ id: ewkt ? "ewkt" : "wkt", confidence: 0.96, why: ewkt ? "WKT with an SRID prefix" : "WKT geometry keywords" }]
  }
  const hex = sniffHexWkb(t)
  if (hex) return [hex]
  const rows = t.split(/\r?\n/).filter((l) => l.trim())
  const header = rows[0]
  if (/\b(lat|latitude)\b/i.test(header) && /\b(lng|lon|long|longitude)\b/i.test(header) && rows.length > 1)
    return [{ id: "csv", confidence: 0.93, why: "CSV with lat and lng columns" }]
  const numeric = /^\s*-?\d+(\.\d+)?\s*[,;\t ]\s*-?\d+(\.\d+)?(\s*[,;\t ]\s*-?\d+(\.\d+)?)?\s*$/
  if (rows.length > 1 && rows.every((r) => numeric.test(r))) return [{ id: "csv", confidence: 0.75, why: "rows of two or three numbers" }]
  return []
}

/**
 * Likely formats of a pasted text or a dropped file, best first. An empty
 * list means none of these fit, so it may be an encoded polyline.
 */
export function sniff(input: string | Uint8Array, fileName?: string): Sniffed[] {
  const ext = fileName?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  let found: Sniffed[]
  if (typeof input !== "string") {
    found = sniffBytes(input)
    if (!found.length) {
      // Text formats arrive as bytes when dropped.
      const text = new TextDecoder("utf-8", { fatal: false }).decode(input.subarray(0, 4 << 20))
      if (!text.includes("\u0000")) found = sniffText(text)
    }
  } else found = sniffText(input)
  if (ext) {
    const byExt = FORMATS.filter((f) => f.ext.includes(ext)).map((f) => f.id)
    found = found.map((s) => (byExt.includes(s.id) ? { ...s, confidence: Math.min(1, s.confidence + 0.02) } : s))
    // The extension alone when the content said nothing, for example an empty file.
    if (!found.length && byExt.length) found = [{ id: byExt[0], confidence: 0.5, why: `the .${ext} extension` }]
  }
  return found.sort((a, b) => b.confidence - a.confidence)
}
