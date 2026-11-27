// Works out how an encoded string was most likely encoded: Google format at
// which precision, latitude or longitude first, two or three values per
// point (GraphHopper puts elevation third), or HERE's Flexible Polyline.
//
// The string itself doesn't say, so every plausible reading is decoded
// leniently and scored on what real geometry looks like:
//
// - every coordinate in range (a precision 6 string read at 5 gives
//   latitudes ten times too big, usually past 90)
// - points on land (a string read at one precision too many lands near 0,0,
//   mostly in the Gulf of Guinea; a swapped order often lands in an ocean)
// - a typical distance between points of tens to hundreds of meters
// - no jumps thousands of times longer than the typical step (what a wrong
//   number of values per point looks like)
// - elevation in a range people live and drive in, for 3D readings
// - a prior: precision 5 is the most common, then 6; latitude first is the
//   format's own order
//
// The scores become probabilities with a softmax, and the gap between the
// best two is the confidence.
import { decode } from "@duoquote/polytini"
import * as flexible from "@duoquote/polytini/flexible"
import type { Pt } from "./model"
import { haversine, inRange, median } from "./geo"
import { isLand } from "./landmask"

export type Order = "latlng" | "lnglat"

export type Interp =
  | { format: "google"; precision: number; order: Order; dims: 2 | 3; zFactor?: number }
  | { format: "flexible" }

export type StrictIssue = {
  code: string
  message: string
  /** Position in the original input text. */
  index: number
  /** Which polyline, when the input has one per line. */
  part: number
}

export type Candidate = {
  id: string
  interp: Interp
  label: string
  /** One array of lat-first points per polyline in the input. */
  lines: Pt[][]
  /** Log score; higher is more plausible. */
  score: number
  prob: number
  /** What strict decoding would throw for this reading, per polyline. */
  issues: StrictIssue[]
  reasons: string[]
}

export type Confidence = "high" | "medium" | "low"

export type Detection = { candidates: Candidate[]; confidence: Confidence }

const PRECISION_PRIOR: Record<number, number> = { 5: 0, 6: -0.3, 7: -1.2, 4: -2, 8: -2.5 }
const PRECISIONS = [5, 6, 7, 4, 8]

/** Google format characters are ? (63) to ~ (126). */
const GOOGLE_CHAR = /^[?-~]$/
const FLEX = /^[A-Za-z0-9_-]+$/

/** Splits the input into polylines: one per line, quotes and JSON escaping removed. */
export function splitInput(text: string): { str: string; offset: number }[] {
  const parts: { str: string; offset: number }[] = []
  let offset = 0
  for (const raw of text.split("\n")) {
    let s = raw.replace(/\r$/, "")
    let start = offset
    offset += raw.length + 1
    const lead = s.length - s.trimStart().length
    s = s.trim()
    start += lead
    // A trailing comma from a pasted JSON array, and quotes around it.
    if (s.endsWith(",")) s = s.slice(0, -1).trimEnd()
    const q = s[0]
    if ((q === '"' || q === "'" || q === "`") && s.length > 1 && s.endsWith(q)) {
      s = s.slice(1, -1)
      start += 1
      // Inside JSON or JS string quotes, a backslash is written twice.
      if (q !== "`" && s.includes("\\\\")) s = s.replace(/\\\\/g, "\\")
    }
    if (s) parts.push({ str: s, offset: start })
  }
  return parts
}

/** How many values the string holds: one per character below 0x20 after subtracting 63. */
export function valueCount(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i) - 63
    if (c >= 0 && c < 0x20) n++
  }
  return n
}

/** A spread-out sample of consecutive pairs, so long lines stay fast to score. */
function sampleSteps(lines: Pt[][], max = 3000): { pts: Pt[]; steps: number[] } {
  const total = lines.reduce((n, l) => n + l.length, 0)
  const every = Math.max(1, Math.ceil(total / max))
  const pts: Pt[] = []
  const steps: number[] = []
  for (const l of lines) {
    for (let i = 0; i < l.length; i += every) {
      pts.push(l[i])
      if (i + 1 < l.length) steps.push(haversine(l[i], l[i + 1]))
    }
  }
  return { pts, steps }
}

export type Plausibility = { score: number; reasons: string[] }

/** How much a set of lat-first lines looks like real geometry. */
export function plausibility(lines: Pt[][], zFactorUsed = false): Plausibility {
  const reasons: string[] = []
  const { pts, steps } = sampleSteps(lines)
  if (!pts.length) return { score: -20, reasons: ["no points"] }
  let score = 0

  const ok = pts.filter(inRange)
  const inFrac = ok.length / pts.length
  if (inFrac < 1) {
    score += -8 - 20 * (1 - inFrac)
    reasons.push(`${Math.round((1 - inFrac) * 100)}% of points out of range`)
  }

  if (ok.length) {
    const land = ok.filter((p) => isLand(p[0], p[1])).length / ok.length
    score += 1.5 * Math.log(0.1 + land)
    if (land < 0.5) reasons.push(`${Math.round(land * 100)}% on land`)
  }

  const moving = steps.filter((d) => d > 0)
  if (moving.length) {
    const med = median(moving)
    // Broad and capped: sparse lines (Google's own example has 250 km
    // steps) and 1 Hz walking tracks (about 1 m) are both real, so this only
    // tips close calls. Range and land decide the rest.
    const decades = Math.log10(med) - 1.8
    score += Math.max(-3, -(decades * decades) / (2 * 1.5 * 1.5))
    if (Math.abs(decades) > 1.5) reasons.push(`typical step ${med < 1 ? med.toFixed(2) + " m" : Math.round(med) + " m"}`)
    if (moving.length > 10) {
      const jump = Math.max(...moving) / med
      if (jump > 1e4) {
        score -= Math.min(4, Math.log10(jump / 1e4) + 1)
        reasons.push("huge jumps between points")
      }
    }
  }

  if (zFactorUsed) {
    const zs = pts.map((p) => p[2]).filter((z) => z !== undefined)
    const sane = zs.filter((z) => z > -500 && z < 9000).length / Math.max(1, zs.length)
    score += 2 * Math.log(0.02 + sane)
    if (sane < 0.9) reasons.push("elevation out of range")
  }
  return { score, reasons }
}

function strictIssues(parts: { str: string; offset: number }[], opts: object): StrictIssue[] {
  const issues: StrictIssue[] = []
  parts.forEach((p, part) => {
    try {
      decode(p.str, opts)
    } catch (e) {
      const err = e as { code?: string; index?: number; message?: string }
      issues.push({ code: err.code ?? "input", message: err.message ?? String(e), index: p.offset + (err.index ?? 0), part })
    }
  })
  return issues
}

const swap = (lines: Pt[][]): Pt[][] => lines.map((l) => l.map((p) => [p[1], p[0], ...p.slice(2)]))

export function describe(i: Interp): string {
  if (i.format === "flexible") return "HERE Flexible Polyline"
  const who: Record<number, string> = {
    5: "Google, OSRM polyline, Mapbox polyline",
    6: "OSRM polyline6, Valhalla, Mapbox polyline6",
    7: "unusual",
  }
  let s = `precision ${i.precision}`
  if (i.dims === 3) s += " with elevation (GraphHopper style)"
  else if (who[i.precision]) s += ` (${who[i.precision]})`
  if (i.order === "lnglat") s += ", longitude first"
  return s
}

const softmax = (cs: Candidate[]) => {
  const max = Math.max(...cs.map((c) => c.score))
  const exps = cs.map((c) => Math.exp(c.score - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  cs.forEach((c, i) => (c.prob = exps[i] / sum))
}

export const confidenceOf = (cs: Candidate[]): Confidence =>
  !cs.length ? "low" : cs[0].prob >= 0.85 ? "high" : cs[0].prob >= 0.6 ? "medium" : "low"

/** Decodes the input with one explicit reading, for the manual override. */
export function decodeWith(text: string, interp: Interp): Candidate {
  const parts = splitInput(text)
  if (interp.format === "flexible") {
    const lines = parts.map((p) => {
      try {
        return flexible.decode(p.str).polyline as Pt[]
      } catch {
        return []
      }
    })
    const issues: StrictIssue[] = []
    parts.forEach((p, part) => {
      try {
        flexible.decode(p.str)
      } catch (e) {
        const err = e as { code?: string; index?: number; message?: string }
        issues.push({ code: err.code ?? "input", message: err.message ?? String(e), index: p.offset + (err.index ?? 0), part })
      }
    })
    const pl = plausibility(lines, lines.some((l) => l.some((pt) => pt.length > 2)))
    return { id: "flexible", interp, label: describe(interp), lines, score: pl.score, prob: 1, issues, reasons: pl.reasons }
  }
  const opts = { precision: interp.precision, dimensions: interp.dims, zFactor: interp.dims === 3 ? interp.zFactor : undefined }
  const raw = parts.map((p) => decode(p.str, { ...opts, strict: false }) as Pt[])
  const lines = interp.order === "lnglat" ? swap(raw) : raw
  const pl = plausibility(lines, interp.dims === 3)
  return {
    id: idOf(interp),
    interp,
    label: describe(interp),
    lines,
    score: pl.score,
    prob: 1,
    issues: strictIssues(parts, opts),
    reasons: pl.reasons,
  }
}

const idOf = (i: Interp) =>
  i.format === "flexible" ? "flexible" : `g${i.precision}-${i.order}-${i.dims}${i.dims === 3 ? "-" + i.zFactor : ""}`

/** Every plausible reading of the input, best first. */
export function detect(text: string): Detection {
  const parts = splitInput(text)
  if (!parts.length) return { candidates: [], confidence: "low" }
  const all = parts.map((p) => p.str).join("")
  const candidates: Candidate[] = []

  const invalid = [...all].filter((c) => !GOOGLE_CHAR.test(c)).length
  const flexChars = parts.every((p) => FLEX.test(p.str))
  const values = parts.map((p) => valueCount(p.str))

  // Google format readings. With characters outside ? to ~, the string is
  // either damaged or not Google format; lenient decoding skips them.
  const invalidPenalty = invalid ? -1.5 - 6 * (invalid / all.length) : 0
  for (const dims of [2, 3] as const) {
    // Three values per point only when every polyline has a multiple of 3.
    if (dims === 3 && !values.every((v) => v % 3 === 0)) continue
    for (const precision of PRECISIONS) {
      const base = { format: "google" as const, precision, dims, zFactor: dims === 3 ? 100 : undefined }
      const one = decodeWith(text, { ...base, order: "latlng" })
      const raw = one.lines
      for (const order of ["latlng", "lnglat"] as const) {
        const lines = order === "latlng" ? raw : swap(raw)
        const pl = order === "latlng" ? { score: one.score, reasons: one.reasons } : plausibility(lines, dims === 3)
        // A truncated error under this reading that another reading doesn't
        // have means the value count doesn't fit it.
        const truncated = one.issues.some((i) => i.code === "truncated") ? -2 : 0
        const interp: Interp = { ...base, order }
        candidates.push({
          id: idOf(interp),
          interp,
          label: describe(interp),
          lines,
          score:
            pl.score +
            PRECISION_PRIOR[precision] +
            (order === "lnglat" ? -0.8 : 0) +
            (dims === 3 ? -0.5 : 0) +
            truncated +
            invalidPenalty,
          prob: 0,
          issues: one.issues,
          reasons: pl.reasons,
        })
      }
    }
  }

  // HERE Flexible Polyline: its own alphabet (letters, digits, - and _) and
  // a header whose first character is the version, 1, written as B.
  if (flexChars && parts.every((p) => p.str[0] === "B")) {
    const c = decodeWith(text, { format: "flexible" })
    if (c.lines.some((l) => l.length)) {
      // Digits and - can't appear in Google format at all.
      c.score += /[0-9-]/.test(all) ? 1.5 : 0
      candidates.push(c)
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  softmax(candidates)
  return { candidates, confidence: confidenceOf(candidates) }
}
