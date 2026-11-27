// Making a line smaller: fewer points (Douglas-Peucker, Visvalingam) and
// fewer digits (a lower precision), with the cost in meters.
import { allLines, mapLines, type Collection, type Line, type Pt } from "./model"
import { meanLat, projector, segDist, haversine } from "./geo"

/**
 * Douglas-Peucker: keeps the point furthest from the line between the ends
 * when it's more than `tolerance` meters away, and recurses on both halves.
 * Returns the indices kept, always including both ends.
 */
export function douglasPeucker(pts: Pt[], tolerance: number): number[] {
  const n = pts.length
  if (n < 3) return pts.map((_, i) => i)
  const project = projector(meanLat(pts))
  const xy = pts.map(project)
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  // An explicit stack instead of recursion, so 100,000 points don't
  // overflow the call stack.
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let maxD = -1
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = segDist(xy[i], xy[a], xy[b])
      if (d > maxD) [maxD, idx] = [d, i]
    }
    if (idx > 0 && maxD > tolerance) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  const out: number[] = []
  keep.forEach((k, i) => k && out.push(i))
  return out
}

/**
 * Visvalingam-Whyatt: repeatedly removes the point whose triangle with its
 * neighbours has the smallest area, until every remaining triangle is at
 * least tolerance² square meters. That's the area of a spike `tolerance`
 * high on a base of 2 × `tolerance`, so the same slider value removes about
 * as much detail as Douglas-Peucker. Returns the indices kept.
 */
export function visvalingam(pts: Pt[], tolerance: number): number[] {
  const n = pts.length
  if (n < 3) return pts.map((_, i) => i)
  const project = projector(meanLat(pts))
  const xy = pts.map(project)
  const prev = Int32Array.from({ length: n }, (_, i) => i - 1)
  const next = Int32Array.from({ length: n }, (_, i) => i + 1)
  const area = new Float64Array(n).fill(Infinity)
  const tri = (i: number) => {
    const a = xy[prev[i]], b = xy[i], c = xy[next[i]]
    return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
  }
  // A binary min-heap of [area, index], with stale entries skipped on pop.
  const heap: [number, number][] = []
  const push = (e: [number, number]) => {
    heap.push(e)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  for (let i = 1; i < n - 1; i++) push([(area[i] = tri(i)), i])
  const removed = new Uint8Array(n)
  const limit = tolerance * tolerance
  // Areas are made non-decreasing, so a point is never kept for being
  // flatter than one already removed (the usual Visvalingam rule).
  let floor = 0
  while (heap.length) {
    const [a, i] = pop()
    if (removed[i] || a !== area[i]) continue
    const eff = Math.max(a, floor)
    if (eff >= limit) break
    floor = eff
    removed[i] = 1
    const p = prev[i], q = next[i]
    next[p] = q
    prev[q] = p
    if (p > 0) push([(area[p] = tri(p)), p])
    if (q < n - 1) push([(area[q] = tri(q)), q])
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (!removed[i]) out.push(i)
  return out
}

export type Deviation = { max: number; mean: number }

/**
 * How far the original points are from the simplified line, in meters.
 * The kept indices are a subsequence, so each original point is measured
 * against the one simplified segment that replaced it.
 */
export function deviation(pts: Pt[], kept: number[]): Deviation {
  if (pts.length < 2 || kept.length < 2) return { max: 0, mean: 0 }
  const project = projector(meanLat(pts))
  const xy = pts.map(project)
  let max = 0
  let sum = 0
  for (let k = 0; k + 1 < kept.length; k++) {
    const a = kept[k], b = kept[k + 1]
    for (let i = a + 1; i < b; i++) {
      const d = segDist(xy[i], xy[a], xy[b])
      max = Math.max(max, d)
      sum += d
    }
  }
  return { max, mean: sum / pts.length }
}

/** Point-by-point distance between two lines of the same length, for rounding. */
export function shift(a: Pt[], b: Pt[]): Deviation {
  let max = 0
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = haversine(a[i], b[i])
    max = Math.max(max, d)
    sum += d
  }
  return { max, mean: a.length ? sum / a.length : 0 }
}

export type Method = "none" | "dp" | "vw"

export type CompactResult = {
  result: Collection
  before: number
  after: number
  deviation: Deviation
}

/** Simplifies every line, then rounds to `digits` decimals if given. */
export function compact(c: Collection, method: Method, tolerance: number, digits?: number): CompactResult {
  let before = 0
  let after = 0
  let max = 0
  let sum = 0
  const result = mapLines(c, (l): Line => {
    before += l.pts.length
    let kept = l.pts.map((_, i) => i)
    if (method === "dp") kept = douglasPeucker(l.pts, tolerance)
    else if (method === "vw") kept = visvalingam(l.pts, tolerance)
    const dev = deviation(l.pts, kept)
    let pts = kept.map((i) => l.pts[i])
    let dmax = dev.max
    let dsum = dev.mean * l.pts.length
    if (digits !== undefined) {
      const f = 10 ** digits
      const rounded = pts.map((p) => [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f, ...p.slice(2)])
      const s = shift(pts, rounded)
      dmax += s.max
      dsum += s.mean * pts.length
      // Rounding can make neighbours equal; one is enough.
      pts = rounded.filter((p, i) => i === 0 || p[0] !== rounded[i - 1][0] || p[1] !== rounded[i - 1][1] || i === rounded.length - 1)
    }
    after += pts.length
    max = Math.max(max, dmax)
    sum += dsum
    return { ...l, pts }
  })
  return { result, before, after, deviation: { max, mean: before ? sum / before : 0 } }
}

export const totalPoints = (c: Collection) => allLines(c).reduce((n, l) => n + l.line.pts.length, 0)
