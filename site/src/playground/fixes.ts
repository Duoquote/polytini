// Geometry fixes. Each one is a pure function from a collection to a new
// collection plus how many points it changed, added or removed, so the UI
// can preview it with a count before anything is applied.
import { allLines, mapLines, type Collection, type Line, type Pt } from "./model"
import { haversine, inRange, median, steps } from "./geo"
import { plausibility } from "./detect"

export type FixResult = { result: Collection; changed: number; note?: string }

const same = (a: Pt, b: Pt) => a.length === b.length && a.every((v, i) => v === b[i])
const isClosed = (pts: Pt[]) => pts.length > 2 && same(pts[0], pts[pts.length - 1])

/** Swaps latitude and longitude in every point. */
export function swapLatLng(c: Collection): FixResult {
  let changed = 0
  const result = mapLines(c, (l) => ({
    ...l,
    pts: l.pts.map((p) => {
      if (p[0] !== p[1]) changed++
      return [p[1], p[0], ...p.slice(2)]
    }),
  }))
  return { result, changed }
}

/** Multiplies latitude and longitude by 10^k, the fix for a precision mismatch. */
export function rescale(c: Collection, k: number): FixResult {
  const f = 10 ** k
  let changed = 0
  const result = mapLines(c, (l) => ({
    ...l,
    pts: l.pts.map((p) => {
      if (k !== 0 && (p[0] || p[1])) changed++
      // Divide for negative k, so 525.17034 * 10^-1 comes out as 52.517034.
      return k < 0 ? [p[0] / 10 ** -k, p[1] / 10 ** -k, ...p.slice(2)] : [p[0] * f, p[1] * f, ...p.slice(2)]
    }),
  }))
  return { result, changed }
}

/** The power of ten that makes the geometry most plausible, from -3 to 3. */
export function bestRescale(c: Collection): number {
  const lines = allLines(c).map((l) => l.line.pts)
  let best = 0
  let bestScore = -Infinity
  for (let k = -3; k <= 3; k++) {
    const scaled = k ? lines.map((l) => l.map((p) => [p[0] * 10 ** k, p[1] * 10 ** k])) : lines
    // A small preference for leaving it alone.
    const s = plausibility(scaled).score - (k ? 0.5 : 0)
    if (s > bestScore) {
      bestScore = s
      best = k
    }
  }
  return best
}

/**
 * Drops points at the end that jump far away from the rest: what a cut-off
 * string decoded by a lenient decoder leaves behind. "Far" is more than
 * `factor` times the median step and more than 50 m.
 */
export function dropTail(c: Collection, factor = 20): FixResult {
  let changed = 0
  const result = mapLines(c, (l) => {
    const pts = [...l.pts]
    const med = median(steps(pts).filter((d) => d > 0))
    if (!(med > 0)) return l
    // At most two points: a cut can damage only the last point or two.
    for (let k = 0; k < 2 && pts.length > 2; k++) {
      const d = haversine(pts[pts.length - 2], pts[pts.length - 1])
      if (d > factor * med && d > 50) {
        pts.pop()
        changed++
      } else break
    }
    return { ...l, pts }
  })
  return { result, changed }
}

/** Removes a point when it equals the one before it. */
export function dedupe(c: Collection): FixResult {
  let changed = 0
  const result = mapLines(c, (l) => {
    const pts = l.pts.filter((p, i) => {
      // Keep the closing point of a ring even though it repeats the first.
      const dup = i > 0 && same(p, l.pts[i - 1])
      if (dup) changed++
      return !dup
    })
    return { ...l, pts }
  })
  return { result, changed }
}

/**
 * Removes spikes: a point that goes far off the path and comes straight
 * back. A point counts when the detour through it is more than `factor`
 * times the direct distance between its neighbours, and its step is more
 * than `factor` times the median step.
 */
export function despike(c: Collection, factor = 5): FixResult {
  let changed = 0
  const result = mapLines(c, (l) => {
    let pts = l.pts
    const med = median(steps(pts).filter((d) => d > 0))
    if (!(med > 0)) return l
    for (let pass = 0; pass < 3; pass++) {
      const keep: Pt[] = [pts[0]]
      let removed = 0
      for (let i = 1; i < pts.length - 1; i++) {
        const a = keep[keep.length - 1]
        const p = pts[i]
        const b = pts[i + 1]
        const out = haversine(a, p)
        const direct = haversine(a, b)
        if (out > factor * med && out + haversine(p, b) > factor * Math.max(direct, med)) removed++
        else keep.push(p)
      }
      if (pts.length > 1) keep.push(pts[pts.length - 1])
      pts = keep
      changed += removed
      if (!removed) break
    }
    return { ...l, pts }
  })
  return { result, changed }
}

/** Points outside ±90 latitude or ±180 longitude: drop them, or clamp and wrap them. */
export function fixRange(c: Collection, mode: "drop" | "clamp"): FixResult {
  let changed = 0
  const result = mapLines(c, (l) => {
    const pts: Pt[] = []
    for (const p of l.pts) {
      if (inRange(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push(p)
      else if (Number.isFinite(p[0]) && Number.isFinite(p[1])) {
        changed++
        if (mode === "clamp") {
          const lat = Math.max(-90, Math.min(90, p[0]))
          const lng = ((((p[1] + 180) % 360) + 360) % 360) - 180
          pts.push([lat, lng, ...p.slice(2)])
        }
      } else changed++
    }
    return { ...l, pts }
  })
  return { result, changed }
}

/** Closes every line into a ring by repeating its first point. */
export function closeRings(c: Collection): FixResult {
  let changed = 0
  const result = mapLines(c, (l) => {
    if (l.pts.length < 3) return l
    if (isClosed(l.pts)) return l.ring ? l : { ...l, ring: true }
    changed++
    return { ...l, ring: true, pts: [...l.pts, [...l.pts[0]]] }
  })
  return { result, changed }
}

/** Opens rings into plain lines by dropping the repeated last point. */
export function openRings(c: Collection): FixResult {
  let changed = 0
  const result = mapLines(c, (l) => {
    if (!isClosed(l.pts)) return l.ring ? { ...l, ring: false } : l
    changed++
    return { pts: l.pts.slice(0, -1), ring: false }
  })
  return { result, changed }
}

/** Reverses the direction of every line. */
export function reverse(c: Collection): FixResult {
  let changed = 0
  const result = mapLines(c, (l) => {
    changed += l.pts.length > 1 ? l.pts.length : 0
    return { ...l, pts: [...l.pts].reverse() }
  })
  return { result, changed }
}

/** The step above which splitGaps cuts by default: 20 times the median, at least 1 km. */
export function defaultGap(c: Collection): number {
  const all = allLines(c).flatMap((l) => steps(l.line.pts)).filter((d) => d > 0)
  return Math.max(1000, 20 * (median(all) || 0))
}

/** Splits lines where two points are further apart than `meters`. */
export function splitGaps(c: Collection, meters = defaultGap(c)): FixResult {
  let changed = 0
  const result = mapLines(c, (l) => {
    if (l.ring) return l
    const out: Line[] = []
    let cur: Pt[] = []
    l.pts.forEach((p, i) => {
      if (i > 0 && haversine(l.pts[i - 1], p) > meters) {
        out.push({ pts: cur, ring: false })
        cur = []
        changed++
      }
      cur.push(p)
    })
    out.push({ pts: cur, ring: false })
    return out
  })
  return { result, changed }
}

/**
 * Merges every line into one, in the order that keeps the jumps between
 * them shortest: from the first line, it keeps adding the nearest remaining
 * line, reversed if its far end is nearer.
 */
export function mergeLines(c: Collection): FixResult {
  const lines = allLines(c).map((l) => l.line.pts).filter((p) => p.length)
  if (lines.length < 2) return { result: c, changed: 0 }
  const rest = lines.slice(1)
  let merged = [...lines[0]]
  while (rest.length) {
    const end = merged[merged.length - 1]
    let best = 0
    let flip = false
    let bestD = Infinity
    rest.forEach((l, i) => {
      const a = haversine(end, l[0])
      const b = haversine(end, l[l.length - 1])
      if (a < bestD) [bestD, best, flip] = [a, i, false]
      if (b < bestD) [bestD, best, flip] = [b, i, true]
    })
    const next = rest.splice(best, 1)[0]
    const pts = flip ? [...next].reverse() : next
    // Joining at a shared point: don't repeat it.
    merged = merged.concat(same(end, pts[0]) ? pts.slice(1) : pts)
  }
  const props = c.features[0]?.props ?? {}
  return { result: { features: [{ lines: [{ pts: merged, ring: false }], props }] }, changed: lines.length - 1 }
}

/** Rounds latitude and longitude to `digits` decimals (the grid of that precision). */
export function snap(c: Collection, digits: number): FixResult {
  const f = 10 ** digits
  let changed = 0
  const r = (x: number) => Math.round(x * f) / f
  const result = mapLines(c, (l) => ({
    ...l,
    pts: l.pts.map((p) => {
      const q = [r(p[0]), r(p[1]), ...p.slice(2)]
      if (q[0] !== p[0] || q[1] !== p[1]) changed++
      return q
    }),
  }))
  return { result, changed }
}

export type FixId =
  | "swap"
  | "rescale"
  | "tail"
  | "dedupe"
  | "spikes"
  | "range-drop"
  | "range-clamp"
  | "close"
  | "open"
  | "reverse"
  | "split"
  | "merge"
  | "snap"

export const FIXES: { id: FixId; label: string; explain: string }[] = [
  { id: "swap", label: "Swap lat/lng", explain: "For lines written longitude first. Each point's two values trade places." },
  { id: "rescale", label: "Fix precision mismatch", explain: "Scales by the power of ten that puts the line back where it's plausible, like 525.17 to 52.517." },
  { id: "tail", label: "Drop the dangling tail", explain: "Removes the last point or two when they jump far from the rest, what a cut-off string leaves." },
  { id: "dedupe", label: "Remove duplicates", explain: "Drops a point that repeats the one before it." },
  { id: "spikes", label: "Remove spikes", explain: "Drops a point that shoots far off the path and comes straight back." },
  { id: "range-drop", label: "Drop out-of-range points", explain: "Removes points past ±90 latitude or ±180 longitude." },
  { id: "range-clamp", label: "Clamp out-of-range points", explain: "Clamps latitude to ±90 and wraps longitude into ±180." },
  { id: "close", label: "Close rings", explain: "Repeats the first point at the end, for polygon rings." },
  { id: "open", label: "Open rings", explain: "Drops the repeated last point, so a ring becomes a plain line." },
  { id: "reverse", label: "Reverse direction", explain: "Runs each line from its end to its start." },
  { id: "split", label: "Split at gaps", explain: "Cuts a line where two points are far apart: 20 times the usual step, and at least 1 km." },
  { id: "merge", label: "Merge lines", explain: "Joins every line into one, picking the order with the shortest jumps." },
  { id: "snap", label: "Round to precision", explain: "Rounds every coordinate to the output precision's grid." },
]

/** The fixes' settings. Each fix reads the ones it has; anything left out takes its default. */
export type FixParams = {
  /** rescale: the power of ten, instead of the most plausible one. */
  k?: number
  /** tail and spikes: how many times the usual step counts as a jump. */
  factor?: number
  /** split: the gap in meters, instead of defaultGap(). */
  gap?: number
  /** snap: decimals, instead of the output precision. */
  digits?: number
}

/** The setting each fix has, for the Fix tab's controls. */
export const FIX_PARAM: Partial<Record<FixId, keyof FixParams>> = {
  rescale: "k",
  tail: "factor",
  spikes: "factor",
  split: "gap",
  snap: "digits",
}

/** The value a fix uses when its setting is left out, so the control can start there. */
export function fixDefault(id: FixId, c: Collection, precision = 5): number | undefined {
  switch (id) {
    case "rescale":
      return bestRescale(c)
    case "tail":
      return 20
    case "spikes":
      return 5
    case "split":
      return defaultGap(c)
    case "snap":
      return precision
  }
  return undefined
}

export function runFix(id: FixId, c: Collection, precision = 5, p: FixParams = {}): FixResult {
  switch (id) {
    case "swap":
      return swapLatLng(c)
    case "rescale": {
      const k = p.k ?? bestRescale(c)
      return { ...rescale(c, k), note: k ? `times 10^${k}` : "already plausible" }
    }
    case "tail":
      return dropTail(c, p.factor ?? 20)
    case "dedupe":
      return dedupe(c)
    case "spikes":
      return despike(c, p.factor ?? 5)
    case "range-drop":
      return fixRange(c, "drop")
    case "range-clamp":
      return fixRange(c, "clamp")
    case "close":
      return closeRings(c)
    case "open":
      return openRings(c)
    case "reverse":
      return reverse(c)
    case "split":
      return splitGaps(c, p.gap ?? defaultGap(c))
    case "merge":
      return mergeLines(c)
    case "snap": {
      const d = p.digits ?? precision
      return { ...snap(c, d), note: `${d} decimals` }
    }
  }
}
