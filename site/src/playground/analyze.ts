// Turns whatever was pasted or dropped into a ranked list of readings:
// a file format the sniffer recognizes, a plain coordinate list, or encoded
// polylines (detect.ts). The playground shows the best one and offers the
// rest as one-click alternatives.
import { detect, plausibility, confidenceOf, type Confidence, type Interp, type StrictIssue } from "./detect"
import { fromLines, type Collection, type Pt, allLines } from "./model"
import { FORMATS, loadFormat, sniff } from "./formats"
import type { FormatId } from "./formats/types"

export type Choice = {
  id: string
  /** What it is, for the summary line. */
  label: string
  kind: "polyline" | "coords" | FormatId
  prob: number
  collection: Collection
  /** For encoded polylines: the reading, so the override controls can start from it. */
  interp?: Interp
  issues: StrictIssue[]
  reasons: string[]
}

export type Analysis = { choices: Choice[]; confidence: Confidence; message?: string }

const EMPTY: Analysis = { choices: [], confidence: "low" }

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** [[a, b], ...], [[[a, b], ...], ...] or [{ lat, lng }, ...] as lines of [a, b] pairs in written order. */
function coordArrays(v: unknown): { lines: number[][][]; named: boolean } | null {
  if (!Array.isArray(v) || !v.length) return null
  const pair = (p: unknown) => Array.isArray(p) && p.length >= 2 && p.length <= 3 && p.every(isNum)
  if (v.every(pair)) return { lines: [v as number[][]], named: false }
  if (v.every((l) => Array.isArray(l) && l.length && l.every(pair))) return { lines: v as number[][][], named: false }
  // Objects with named fields are never ambiguous.
  const obj = (p: unknown): number[] | null => {
    if (!p || typeof p !== "object") return null
    const o = p as Record<string, unknown>
    const lat = o.lat ?? o.latitude
    const lng = o.lng ?? o.lon ?? o.long ?? o.longitude
    if (!isNum(lat) || !isNum(lng)) return null
    const z = o.ele ?? o.elevation ?? o.alt ?? o.altitude
    return isNum(z) ? [lat, lng, z] : [lat, lng]
  }
  const objs = v.map(obj)
  if (objs.every(Boolean)) return { lines: [objs as number[][]], named: true }
  return null
}

const softmaxProbs = (scores: number[]) => {
  const max = Math.max(...scores)
  const e = scores.map((s) => Math.exp(s - max))
  const sum = e.reduce((a, b) => a + b, 0)
  return e.map((x) => x / sum)
}

function coordChoices(lines: number[][][], named: boolean): Analysis {
  const asLatLng = lines.map((l) => l as Pt[])
  if (named) {
    return {
      choices: [{ id: "coords-latlng", label: "{ lat, lng } objects", kind: "coords", prob: 1, collection: fromLines(asLatLng.map((pts) => ({ pts, ring: false }))), issues: [], reasons: [] }],
      confidence: "high",
    }
  }
  const asLngLat = lines.map((l) => l.map((p) => [p[1], p[0], ...p.slice(2)]))
  const a = plausibility(asLatLng)
  // Written longitude first is common for arrays (GeoJSON habits), so no penalty.
  const b = plausibility(asLngLat)
  const [pa, pb] = softmaxProbs([a.score, b.score])
  const choices: Choice[] = [
    { id: "coords-latlng", label: "coordinate list, [lat, lng]", kind: "coords" as const, prob: pa, collection: fromLines(asLatLng.map((pts) => ({ pts, ring: false }))), issues: [], reasons: a.reasons },
    { id: "coords-lnglat", label: "coordinate list, [lng, lat]", kind: "coords" as const, prob: pb, collection: fromLines(asLngLat.map((pts) => ({ pts, ring: false }))), issues: [], reasons: b.reasons },
  ].sort((x, y) => y.prob - x.prob)
  return { choices, confidence: choices[0].prob >= 0.85 ? "high" : choices[0].prob >= 0.6 ? "medium" : "low" }
}

const label = (id: FormatId) => FORMATS.find((f) => f.id === id)?.label ?? id

async function readFormats(input: string | Uint8Array, fileName?: string): Promise<Analysis | null> {
  const sniffed = sniff(input, fileName).filter((s) => s.confidence >= 0.3)
  if (!sniffed.length) return null
  const choices: Choice[] = []
  const errors: string[] = []
  for (const s of sniffed.slice(0, 3)) {
    try {
      const conv = await loadFormat(s.id)
      if (s.id === "csv") {
        // CSV without names in the header can be either order.
        for (const order of ["latlng", "lnglat"] as const) {
          const c = await conv.read(input, { order, name: fileName })
          const pl = plausibility(allLines(c).map((l) => l.line.pts))
          choices.push({ id: `csv-${order}`, label: `CSV, ${order === "latlng" ? "lat, lng" : "lng, lat"}`, kind: "csv", prob: pl.score, collection: c, issues: [], reasons: pl.reasons })
        }
        continue
      }
      const c = await conv.read(input, { name: fileName })
      if (!allLines(c).length) {
        errors.push(`${label(s.id)}: no lines or polygons in it`)
        continue
      }
      choices.push({ id: s.id, label: label(s.id), kind: s.id, prob: s.confidence, collection: c, issues: [], reasons: [s.why] })
    } catch (e) {
      errors.push(`${label(s.id)}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (!choices.length) return { choices: [], confidence: "low", message: errors.join("; ") || "Couldn't read it." }
  // CSV scores are plausibility logs; everything else is the sniffer's confidence.
  const csv = choices.filter((c) => c.kind === "csv")
  if (csv.length) {
    const p = softmaxProbs(csv.map((c) => c.prob))
    const sniffP = sniffed.find((s) => s.id === "csv")?.confidence ?? 1
    csv.forEach((c, i) => (c.prob = p[i] * sniffP))
  }
  const total = choices.reduce((s, c) => s + c.prob, 0)
  choices.forEach((c) => (c.prob /= total))
  choices.sort((a, b) => b.prob - a.prob)
  return { choices, confidence: choices[0].prob >= 0.85 ? "high" : choices[0].prob >= 0.6 ? "medium" : "low" }
}

// Control characters other than tab, newline and carriage return mean binary.
const isBinary = (s: string) => [...s].some((c) => { const n = c.charCodeAt(0); return n < 9 || (n > 13 && n < 32) })

export async function analyze(input: string | Uint8Array, fileName?: string): Promise<Analysis> {
  if (typeof input !== "string") {
    const read = await readFormats(input, fileName)
    if (read?.choices.length) return read
    // An unknown file might still be text with polylines in it.
    const text = new TextDecoder().decode(input)
    if (isBinary(text.slice(0, 2000))) return read ?? { ...EMPTY, message: "Not a format the playground reads." }
    return analyze(text, fileName)
  }
  const text = input.trim()
  if (!text) return EMPTY

  if (text[0] === "[" || text[0] === "{") {
    try {
      const v = JSON.parse(text)
      const arrays = coordArrays(v)
      if (arrays) return coordChoices(arrays.lines, arrays.named)
      // An array of strings: one polyline each.
      if (Array.isArray(v) && v.length && v.every((s) => typeof s === "string")) return polylines(v.join("\n"))
    } catch {
      // Not JSON. A polyline can start with [ or { too.
    }
  }
  const read = await readFormats(input, fileName)
  if (read?.choices.length) return read
  return polylines(input)
}

function polylines(text: string): Analysis {
  const d = detect(text)
  const choices: Choice[] = d.candidates.slice(0, 6).map((c) => ({
    id: c.id,
    label: c.label,
    kind: "polyline",
    prob: c.prob,
    collection: fromLines(c.lines.map((pts) => ({ pts, ring: pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] }))),
    interp: c.interp,
    issues: c.issues,
    reasons: c.reasons,
  }))
  if (!choices.length || choices[0].collection.features.every((f) => f.lines.every((l) => !l.pts.length)))
    return { choices: [], confidence: "low", message: "Nothing to decode here. Paste an encoded polyline, GeoJSON, WKT, coordinates or a GIS file." }
  return { choices, confidence: confidenceOf(d.candidates) }
}
