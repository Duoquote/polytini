// CSV: one point per row. With a header, the columns are found by name
// (lat/latitude/y, lng/lon/longitude/x, ele/elevation/alt/z, and feature
// and line ids so several lines survive a round trip). Without one, the
// first two numbers are the coordinates, in `order` (lat,lng by default,
// or lng,lat when the first column goes past ±90).
//
// A closed line of four or more points comes back as a ring. Properties
// don't go through CSV.
import type { Collection, Feature, Line, Pt } from "../model"
import type { Converter, ReadOptions, WriteOptions } from "./types"
import { asText, num } from "./geo"

const NAMES = {
  lat: /^(lat|latitude|y)$/i,
  lng: /^(lng|lon|long|longitude|x)$/i,
  z: /^(ele|elev|elevation|alt|altitude|z|height)$/i,
  feature: /^(feature|feature_id|fid|id|track|name)$/i,
  line: /^(line|line_id|segment|seg|part)$/i,
}

const split = (row: string, sep: RegExp) => row.split(sep).map((s) => s.trim().replace(/^"(.*)"$/, "$1"))

function separator(row: string): RegExp {
  if (row.includes("\t")) return /\t/
  if (row.includes(";")) return /;/
  if (row.includes(",")) return /,/
  return /\s+/
}

const isNum = (s: string) => s !== "" && Number.isFinite(Number(s))

export function readCsv(text: string, options: ReadOptions = {}): Collection {
  const rows = text.split(/\r?\n/).filter((r) => r.trim())
  if (!rows.length) return { features: [] }
  const sep = separator(rows[0])
  const first = split(rows[0], sep)
  const header = first.some((c) => !isNum(c)) ? first : null
  const body = (header ? rows.slice(1) : rows).map((r) => split(r, sep))

  let lat: number, lng: number, z = -1, feature = -1, line = -1
  if (header) {
    const find = (re: RegExp) => header.findIndex((h) => re.test(h))
    lat = find(NAMES.lat)
    lng = find(NAMES.lng)
    z = find(NAMES.z)
    feature = find(NAMES.feature)
    line = find(NAMES.line)
    if (lat < 0 || lng < 0) throw new SyntaxError("CSV: no lat and lng columns in the header")
  } else {
    // The first numeric columns are the coordinates.
    const numeric = body[0].map((c, i) => (isNum(c) ? i : -1)).filter((i) => i >= 0)
    if (numeric.length < 2) throw new SyntaxError("CSV: need two numbers per row")
    let order = options.order ?? "latlng"
    if (!options.order && body.some((r) => Math.abs(Number(r[numeric[0]])) > 90)) order = "lnglat"
    ;[lat, lng] = order === "latlng" ? [numeric[0], numeric[1]] : [numeric[1], numeric[0]]
    if (numeric.length > 2) z = numeric[2]
  }

  const features: Feature[] = []
  const byFeature = new Map<string, Map<string, Pt[]>>()
  for (const r of body) {
    if (!isNum(r[lat]) || !isNum(r[lng])) continue
    const p: Pt = [Number(r[lat]), Number(r[lng])]
    if (z >= 0 && isNum(r[z])) p.push(Number(r[z]))
    const f = feature >= 0 ? r[feature] : ""
    const l = line >= 0 ? r[line] : ""
    if (!byFeature.has(f)) byFeature.set(f, new Map())
    const lines = byFeature.get(f)!
    if (!lines.has(l)) lines.set(l, [])
    lines.get(l)!.push(p)
  }
  for (const [f, lines] of byFeature) {
    const ls: Line[] = [...lines.values()].map((pts, i) => {
      const closed = pts.length >= 4 && pts[0][0] === pts.at(-1)![0] && pts[0][1] === pts.at(-1)![1]
      return closed ? { pts, ring: true, part: i } : { pts, ring: false }
    })
    features.push({ lines: ls, props: f !== "" && feature >= 0 ? { [header![feature]]: f } : {} })
  }
  return { features }
}

export function writeCsv(c: Collection, options: WriteOptions = {}): string {
  const z = c.features.some((f) => f.lines.some((l) => l.pts.some((p) => p.length > 2)))
  const latlng = (options.order ?? "latlng") === "latlng"
  const head = ["feature", "line", ...(latlng ? ["lat", "lng"] : ["lng", "lat"]), ...(z ? ["elevation"] : [])]
  const out = [head.join(",")]
  c.features.forEach((f, fi) =>
    f.lines.forEach((l, li) =>
      l.pts.forEach((p) => {
        const xy = latlng ? [p[0], p[1]] : [p[1], p[0]]
        out.push([fi, li, ...xy.map(num), ...(z ? [p.length > 2 ? num(p[2]) : ""] : [])].join(","))
      })
    )
  )
  return out.join("\n") + "\n"
}

export default {
  async read(input, options) {
    return readCsv(asText(input), options)
  },
  async write(c, options) {
    return writeCsv(c, options)
  },
} satisfies Converter
