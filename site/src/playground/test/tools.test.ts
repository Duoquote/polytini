import { describe, expect, test } from "vitest"
import { decode } from "@duoquote/polytini"
import * as flexible from "@duoquote/polytini/flexible"
import { fromLines, type Collection, type Pt } from "../model"
import * as F from "../fixes"
import { compact, douglasPeucker, visvalingam, deviation } from "../compact"
import { encodeCollection, presetOut, stats } from "../encode"
import { fromHash, toHash } from "../share"
import { haversine } from "../geo"
import { realWorld } from "./fixtures"

const GOOGLE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
const line = (pts: Pt[], ring = false): Collection => fromLines([{ pts, ring }])
const pts = (c: Collection) => c.features.flatMap((f) => f.lines.map((l) => l.pts))
// A straight-ish walk east along 52°N, about 70 m per step.
const walk = (n: number): Pt[] => Array.from({ length: n }, (_, i) => [52 + (i % 2) * 0.00001, 13 + i * 0.001])

describe("fixes", () => {
  test("swap", () => {
    const r = F.swapLatLng(line([[1, 2], [3, 4, 9]]))
    expect(pts(r.result)).toEqual([[[2, 1], [4, 3, 9]]])
    expect(r.changed).toBe(2)
  })

  test("rescale finds the precision mismatch and divides exactly", () => {
    const wrong = line(decode("sikdcBg`epXaFf@oEb@s@Fu@HYBaAJ", 5))
    expect(F.bestRescale(wrong)).toBe(-1)
    const r = F.runFix("rescale", wrong)
    expect(pts(r.result)[0][0]).toEqual([52.517034, 13.38882])
    expect(r.note).toBe("times 10^-1")
    expect(F.bestRescale(line(decode(GOOGLE)))).toBe(0)
  })

  test("dropTail removes the wrong last point a lenient decoder made up", () => {
    const good = walk(20)
    const r = F.dropTail(line([...good, [52.5, 14]]))
    expect(r.changed).toBe(1)
    expect(pts(r.result)[0]).toEqual(good)
    expect(F.dropTail(line(good)).changed).toBe(0)
  })

  test("dedupe", () => {
    const r = F.dedupe(line([[1, 1], [1, 1], [2, 2], [2, 2], [1, 1]]))
    expect(pts(r.result)[0]).toEqual([[1, 1], [2, 2], [1, 1]])
    expect(r.changed).toBe(2)
  })

  test("despike removes a point that goes far off and comes back", () => {
    const w = walk(20)
    const spiky = [...w.slice(0, 10), [53, 13.0095], ...w.slice(10)]
    const r = F.despike(line(spiky))
    expect(r.changed).toBe(1)
    expect(pts(r.result)[0]).toEqual(w)
    expect(F.despike(line(w)).changed).toBe(0)
  })

  test("range: drop or clamp and wrap", () => {
    const c = line([[10, 10], [95, 10], [10, 190]])
    expect(pts(F.fixRange(c, "drop").result)[0]).toEqual([[10, 10]])
    expect(pts(F.fixRange(c, "clamp").result)[0]).toEqual([[10, 10], [90, 10], [10, -170]])
  })

  test("close and open rings", () => {
    const c = line([[0, 0], [0, 1], [1, 1]])
    const closed = F.closeRings(c)
    expect(closed.changed).toBe(1)
    expect(closed.result.features[0].lines[0]).toEqual({ pts: [[0, 0], [0, 1], [1, 1], [0, 0]], ring: true })
    expect(F.closeRings(closed.result).changed).toBe(0)
    const open = F.openRings(closed.result)
    expect(open.result.features[0].lines[0]).toEqual({ pts: [[0, 0], [0, 1], [1, 1]], ring: false })
  })

  test("reverse", () => {
    expect(pts(F.reverse(line([[1, 1], [2, 2]])).result)[0]).toEqual([[2, 2], [1, 1]])
  })

  test("split at gaps, then merge back", () => {
    const a = walk(10)
    const b = walk(10).map((p) => [p[0] + 1, p[1]])
    const split = F.splitGaps(line([...a, ...b]))
    expect(split.changed).toBe(1)
    expect(pts(split.result)).toEqual([a, b])
    const merged = F.mergeLines(fromLines([{ pts: [...b].reverse(), ring: false }, { pts: a, ring: false }]))
    expect(merged.changed).toBe(1)
    expect(pts(merged.result)[0]).toHaveLength(20)
  })

  test("snap rounds to the grid", () => {
    const r = F.snap(line([[1.234567, 2.345678]]), 3)
    expect(pts(r.result)[0]).toEqual([[1.235, 2.346]])
  })

  test("every fix in the list runs", () => {
    const c = line(decode(GOOGLE))
    for (const f of F.FIXES) expect(F.runFix(f.id, c).result.features.length).toBeGreaterThan(0)
  })
})

describe("compaction", () => {
  const ring = decode(realWorld()[55])

  test("Douglas-Peucker keeps the ends and stays within the tolerance", () => {
    for (const tol of [1, 10, 100]) {
      const kept = douglasPeucker(ring, tol)
      expect(kept[0]).toBe(0)
      expect(kept[kept.length - 1]).toBe(ring.length - 1)
      expect(deviation(ring, kept).max).toBeLessThanOrEqual(tol)
    }
    expect(douglasPeucker(ring, 1000).length).toBeLessThan(douglasPeucker(ring, 1).length)
  })

  test("Visvalingam removes more as the tolerance grows", () => {
    const a = visvalingam(ring, 1).length
    const b = visvalingam(ring, 50).length
    expect(b).toBeLessThan(a)
    expect(visvalingam(ring, 0).length).toBe(ring.length)
  })

  test("a straight line with a bump: only the bump survives", () => {
    const l: Pt[] = [[0, 0], [0, 0.001], [0.001, 0.002], [0, 0.003], [0, 0.004]]
    expect(douglasPeucker(l, 100)).toEqual([0, 2, 4])
    expect(visvalingam(l, 100)).toEqual([0, 2, 4])
    expect(douglasPeucker(l, 10)).toEqual([0, 1, 2, 3, 4])
  })

  test("100,000 points don't overflow the stack", () => {
    const long = Array.from({ length: 100000 }, (_, i): Pt => [Math.sin(i / 50) * 0.01, i * 0.0001])
    expect(douglasPeucker(long, 5).length).toBeGreaterThan(2)
  })

  test("compact with rounding reports the combined deviation", () => {
    const r = compact(line(ring), "dp", 5, 4)
    expect(r.before).toBe(ring.length)
    expect(r.after).toBeLessThan(ring.length)
    expect(r.deviation.max).toBeGreaterThan(0)
    expect(r.deviation.max).toBeLessThan(5 + 10)
  })
})

describe("encode and stats", () => {
  const c = line(decode(GOOGLE))
  test("Google at a precision, and a preset", () => {
    expect(encodeCollection(c, { kind: "google", precision: 5, dims: 2 })).toBe(GOOGLE)
    expect(decode(encodeCollection(c, presetOut("osrm6")), 6)).toEqual(decode(GOOGLE))
  })
  test("GraphHopper 3D keeps the elevation", () => {
    const z = line([[38.5, -120.2, 10], [40.7, -120.95, 20]])
    const s = encodeCollection(z, presetOut("graphhopper3d"))
    expect(decode(s, { dimensions: 3, zFactor: 100 })).toEqual([[38.5, -120.2, 10], [40.7, -120.95, 20]])
  })
  test("HERE Flexible with elevation", () => {
    const z = line([[50.10228, 8.69821, 112.5], [50.10201, 8.69567, 113.1]])
    const s = encodeCollection(z, { kind: "flexible", precision: 5, thirdDim: 3, thirdDimPrecision: 1 })
    expect(flexible.decode(s).polyline).toEqual([[50.10228, 8.69821, 112.5], [50.10201, 8.69567, 113.1]])
  })
  test("stats", () => {
    const s = stats(c, GOOGLE)
    expect(s.points).toBe(3)
    expect(s.charsPerPoint).toBe(9)
    expect(Math.round(s.length / 1000)).toBe(Math.round((haversine([38.5, -120.2], [40.7, -120.95]) + haversine([40.7, -120.95], [43.252, -126.453])) / 1000))
    expect(s.bbox).toEqual([38.5, -126.453, 43.252, -120.2])
  })
})

describe("share", () => {
  test("a round trip through the URL hash", async () => {
    const c: Collection = {
      features: [
        { lines: [{ pts: decode(GOOGLE), ring: false }], props: { name: "Google" } },
        { lines: [{ pts: [[1, 2, 30], [1.5, 2.5, 31], [1, 2, 30]], ring: true, part: 0 }], props: {} },
      ],
    }
    const out = { kind: "google" as const, precision: 6, dims: 2 as const }
    const hash = await toHash({ collection: c, out })
    expect(hash[0]).toBe("z")
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(await fromHash(hash)).toEqual({ collection: c, out })
    expect(await fromHash("znot-valid")).toBeNull()
  })
})
