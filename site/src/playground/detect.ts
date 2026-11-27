// Works out how an encoded string was most likely encoded, with polytini's
// own detector (@duoquote/polytini/detect): Google format at which
// precision, latitude or longitude first, two or three values per point
// (GraphHopper puts elevation third), or HERE's Flexible Polyline. This
// file adds what the playground needs on top: one polyline per line of
// input, indexes in the whole text, and the decoded lines for the readings
// it shows.
//
// Each line of input is scored by the library on its own, and a reading's
// scores are added up over the lines (they're log scores), so every line
// has to fit the same reading. The land mask is the library's too
// (@duoquote/polytini/detect/land): a 1 degree grid of Natural Earth land.
//
// The lines of a reading come from one lenient decode with onIssue, which
// also gives the strict error: no second, strict decode.
import { decode } from "@duoquote/polytini"
import * as flexible from "@duoquote/polytini/flexible"
import { detect as detectOne, type Candidate as LibCandidate } from "@duoquote/polytini/detect"
import { isLand } from "@duoquote/polytini/detect/land"
import type { Pt } from "./model"
import { haversine, inRange, median } from "./geo"

export { isLand }

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

/** The precisions the playground offers. */
const PRECISIONS = [5, 6, 7, 4, 8]

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

/**
 * How much a set of lat-first lines looks like real geometry. For inputs
 * that aren't polylines (coordinate lists, CSV) and for the fixes; the
 * polyline readings are scored by the library.
 */
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

export const confidenceOf = (cs: Candidate[]): Confidence =>
  !cs.length ? "low" : cs[0].prob >= 0.85 ? "high" : cs[0].prob >= 0.6 ? "medium" : "low"

const idOf = (i: Interp) =>
  i.format === "flexible" ? "flexible" : `g${i.precision}-${i.order}-${i.dims}${i.dims === 3 ? "-" + i.zFactor : ""}`

const interpOf = (c: LibCandidate): Interp =>
  c.format === "flexible"
    ? { format: "flexible" }
    : { format: "google", precision: c.precision, order: c.order, dims: c.dimensions, ...(c.dimensions === 3 ? { zFactor: c.zFactor } : {}) }

/**
 * Decodes the input with one reading, leniently, and collects what strict
 * decoding would throw from onIssue: the first issue of each polyline is
 * that error.
 */
export function decodeWith(text: string, interp: Interp): Candidate {
  const parts = splitInput(text)
  const issues: StrictIssue[] = []
  const lines = parts.map((p, part) => {
    // The Google-format and Flexible errors differ only in their codes.
    type Issue = { code: string; index?: number; message: string }
    const seen: Issue[] = []
    const onIssue = (e: Issue) => void seen.push(e)
    let pts: Pt[] = []
    try {
      pts =
        interp.format === "flexible"
          ? (flexible.decode(p.str, { strict: false, onIssue }).polyline as Pt[])
          : (decode(p.str, { precision: interp.precision, order: interp.order, dimensions: interp.dims, zFactor: interp.dims === 3 ? interp.zFactor : undefined, strict: false, onIssue }) as Pt[])
    } catch (e) {
      // A Flexible header that doesn't parse: nothing to decode.
      seen.push(e as Issue)
    }
    // Strict mode stops at the first one, so that's the one to report.
    const e = seen[0]
    if (e) issues.push({ code: e.code ?? "input", message: e.message, index: p.offset + (e.index ?? 0), part })
    return pts
  })
  // Lines decoded with the swapped order come out latitude first already:
  // the options of a lnglat reading undo the swap.
  const pl = plausibility(lines, interp.format === "google" ? interp.dims === 3 : lines.some((l) => l.some((pt) => pt.length > 2)))
  return { id: idOf(interp), interp, label: describe(interp), lines, score: pl.score, prob: 1, issues, reasons: pl.reasons }
}

/** Every plausible reading of the input, best first. */
export function detect(text: string): Detection {
  const parts = splitInput(text)
  if (!parts.length) return { candidates: [], confidence: "low" }
  // Each line's readings, added up by reading. A reading has to be there for
  // every line: Flexible only is when every line has a Flexible header.
  const sums = new Map<string, { interp: Interp; score: number; reasons: Set<string>; n: number }>()
  for (const p of parts) {
    for (const c of detectOne(p.str, { precisions: PRECISIONS, isLand })) {
      const interp = interpOf(c), id = idOf(interp)
      const s = sums.get(id) ?? { interp, score: 0, reasons: new Set<string>(), n: 0 }
      s.score += c.score
      s.n++
      for (const r of c.reasons) s.reasons.add(r)
      sums.set(id, s)
    }
  }
  const ranked = [...sums.entries()].filter(([, s]) => s.n === parts.length).sort((a, b) => b[1].score - a[1].score)
  const max = ranked.length ? ranked[0][1].score : 0
  const total = ranked.reduce((t, [, s]) => t + Math.exp(s.score - max), 0)
  // Lines only for the readings the playground shows.
  const candidates: Candidate[] = ranked.map(([id, s], i) => {
    const c = i < 6 ? decodeWith(text, s.interp) : null
    return {
      id,
      interp: s.interp,
      label: describe(s.interp),
      lines: c?.lines ?? [],
      score: s.score,
      prob: Math.exp(s.score - max) / total,
      issues: c?.issues ?? [],
      reasons: [...s.reasons],
    }
  })
  return { candidates, confidence: confidenceOf(candidates) }
}
