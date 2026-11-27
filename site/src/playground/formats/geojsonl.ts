// GeoJSONL (one Feature per line) and GeoJSON Text Sequences (RFC 8142:
// each record starts with the record separator 0x1E). Read line by line,
// yielding to the browser every few thousand lines so a big file doesn't
// freeze the page.
//
// It also reads NDJSON whose lines are plain objects with an encoded
// polyline in one field, like {"id": 7, "shape": "_p~iF~ps|U..."}: the
// field is found from the first line, and polytini's decodeLines with
// `field` decodes it, keeping the other fields as properties.
import { decode } from "@duoquote/polytini"
import { decodeLines } from "@duoquote/polytini/stream"
import type { Collection, Feature } from "../model"
import type { Converter, ReadOptions } from "./types"
import { asText, featureGeometry, geometryLines, type Geometry, yieldToEventLoop } from "./geo"

const RS = "\x1e"
const BATCH = 2000

/** Records of a GeoJSONL or RS-delimited text, without blank ones. */
export function records(text: string): string[] {
  const parts = text.includes(RS) ? text.split(RS) : text.split(/\r?\n/)
  return parts.map((s) => s.trim()).filter(Boolean)
}

const isPlausible = (pts: number[][]) =>
  pts.length > 1 && pts.every((p) => Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)

/**
 * The name of a string field that holds an encoded polyline, if the record
 * is a plain object (not GeoJSON) and one field decodes to a plausible line.
 */
export function polylineField(record: unknown, precision = 5): string | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null
  const o = record as Record<string, unknown>
  if (typeof o.type === "string" && ("geometry" in o || "coordinates" in o)) return null
  for (const [k, v] of Object.entries(o)) {
    if (typeof v !== "string" || v.length < 4 || !/^[?-~]+$/.test(v)) continue
    try {
      if (isPlausible(decode(v, precision))) return k
    } catch {
      // Not a valid polyline at this precision; try the next field.
    }
  }
  return null
}

async function readPolylineField(lines: string[], field: string, precision: number): Promise<Collection> {
  const features: Feature[] = []
  // decodeLines does the field lookup and the decoding with the same code
  // as the CLI's --field, one record at a time.
  let i = 0
  // decodeLines reads text chunks, so each record gets its newline back.
  for await (const out of decodeLines(lines.map((l) => `${l}\n`), { field, precision })) {
    const rec = out as Record<string, unknown>
    const pts = rec[field] as number[][]
    const props = { ...rec }
    delete props[field]
    if (Array.isArray(pts) && pts.length) features.push({ lines: [{ pts, ring: false }], props })
    if (++i % BATCH === 0) await yieldToEventLoop()
  }
  return { features }
}

export default {
  async read(input, options: ReadOptions = {}) {
    const lines = records(asText(input))
    if (!lines.length) return { features: [] }
    const first = JSON.parse(lines[0])
    const field = polylineField(first, options.precision ?? 5)
    if (field) return readPolylineField(lines, field, options.precision ?? 5)

    const features: Feature[] = []
    for (const [i, line] of lines.entries()) {
      const o = JSON.parse(line) as { type?: string; geometry?: Geometry; properties?: Record<string, unknown>; id?: unknown }
      const isFeature = o.type === "Feature"
      const ls = geometryLines(isFeature ? o.geometry : (o as Geometry))
      if (ls.length) {
        const props = { ...(isFeature ? (o.properties ?? {}) : {}) }
        if (isFeature && o.id !== undefined && !("id" in props)) props.id = o.id
        features.push({ lines: ls, props })
      }
      if ((i + 1) % BATCH === 0) await yieldToEventLoop()
    }
    return { features }
  },
  async write(c, options = {}) {
    const out = c.features.map((f) =>
      JSON.stringify({ type: "Feature", properties: { ...f.props }, geometry: featureGeometry(f) })
    )
    return options.rs ? out.map((s) => RS + s + "\n").join("") : out.join("\n") + "\n"
  },
} satisfies Converter
