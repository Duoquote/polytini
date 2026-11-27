import { describe, expect, test } from "vitest"
import { geometryReducer, initialGeometry, type GeomAction, type GeomState } from "../state"
import { compact } from "../compact"
import { defaultGap, fixDefault, runFix } from "../fixes"
import { fromLines, type Collection } from "../model"

const line = (...pts: number[][]): Collection => fromLines([{ pts, ring: false }])
const A = line([52.5, 13.4], [52.51, 13.41], [52.52, 13.42])
const B = line([52.5, 13.4], [52.52, 13.42])
const C = line([40.7, -74], [40.71, -74.01])
const run = (s: GeomState, ...actions: GeomAction[]) => actions.reduce(geometryReducer, s)
const start = () => run(initialGeometry(), { type: "set", collection: A, origin: "input" })

describe("preview, then apply", () => {
  test("a preview commits nothing", () => {
    const s0 = start()
    const s = run(s0, { type: "preview", source: "compact", result: B, label: "x" })
    expect(s.collection).toBe(A)
    expect(s.past).toBe(s0.past)
    expect(s.version).toBe(s0.version)
    expect(s.pending).toEqual({ source: "compact", label: "x", result: B })
  })

  test("live updates replace the preview, still without committing", () => {
    const s = run(start(), { type: "preview", source: "compact", result: B }, { type: "preview", source: "compact", result: C })
    expect(s.pending?.result).toBe(C)
    expect(s.collection).toBe(A)
    expect(s.past).toHaveLength(1)
  })

  test("apply commits the preview as one undo step", () => {
    const s0 = start()
    const s = run(s0, { type: "preview", source: "fix", result: B }, { type: "apply" })
    expect(s.collection).toBe(B)
    expect(s.pending).toBeNull()
    expect(s.past).toHaveLength(s0.past.length + 1)
    expect(s.version).toBe(s0.version + 1)
    expect(s.origin).toBe("tool")
    const u = run(s, { type: "undo" })
    expect(u.collection).toBe(A)
    expect(run(u, { type: "redo" }).collection).toBe(B)
  })

  test("cancel restores: nothing committed, nothing pending", () => {
    const s0 = start()
    const s = run(s0, { type: "preview", source: "compact", result: B }, { type: "cancel" })
    expect(s.collection).toBe(A)
    expect(s.pending).toBeNull()
    expect(s.past).toBe(s0.past)
    expect(s.version).toBe(s0.version)
  })

  test("apply and cancel without a preview do nothing", () => {
    const s0 = start()
    expect(run(s0, { type: "apply" })).toBe(s0)
    expect(run(s0, { type: "cancel" })).toBe(s0)
  })

  test("a tab closing drops only its own preview", () => {
    const s = run(start(), { type: "preview", source: "reading", result: C })
    expect(run(s, { type: "preview", source: "compact", result: null }).pending?.source).toBe("reading")
    expect(run(s, { type: "preview", source: "reading", result: null }).pending).toBeNull()
  })

  test("a hand edit keeps the preview for the tool to recompute; new input drops it", () => {
    const s = run(start(), { type: "preview", source: "compact", result: B })
    const edited = run(s, { type: "set", collection: C, origin: "table" })
    expect(edited.collection).toBe(C)
    expect(edited.pending?.result).toBe(B)
    expect(run(s, { type: "set", collection: C, origin: "input" }).pending).toBeNull()
  })

  test("undo while previewing keeps the preview", () => {
    const s = run(start(), { type: "set", collection: C, origin: "map" }, { type: "preview", source: "fix", result: B }, { type: "undo" })
    expect(s.collection).toBe(A)
    expect(s.pending?.result).toBe(B)
  })

  test("a vertex drag in progress and then a preview applied are separate steps", () => {
    const s = run(
      start(),
      { type: "set", collection: C, origin: "map", commit: false },
      { type: "set", collection: C, origin: "map" },
      { type: "preview", source: "compact", result: B },
      { type: "apply" }
    )
    expect(s.past.map((c) => c)).toEqual([initialGeometry().collection, A, C])
  })
})

describe("the tools' previews", () => {
  test("compaction with Off and no rounding changes nothing, so nothing is pending", () => {
    const r = compact(A, "none", 5)
    expect(r.after).toBe(r.before)
    expect(r.deviation.max).toBe(0)
  })

  test("fix settings: rescale by a chosen power, snap to chosen decimals, split at a chosen gap", () => {
    const big = line([525.17, 134.05], [525.18, 134.06])
    expect(fixDefault("rescale", big)).toBe(-1)
    const p0 = runFix("rescale", big, 5, { k: -1 }).result.features[0].lines[0].pts[0]
    expect(p0[0]).toBeCloseTo(52.517, 10)
    expect(p0[1]).toBeCloseTo(13.405, 10)
    expect(runFix("rescale", big, 5, { k: -2 }).result.features[0].lines[0].pts[0][0]).toBeCloseTo(5.2517, 10)
    expect(runFix("snap", A, 5, { digits: 1 }).result.features[0].lines[0].pts[2]).toEqual([52.5, 13.4])
    expect(runFix("snap", A, 5, { digits: 1 }).note).toBe("1 decimals")
    const gappy = line([0, 0], [0, 0.001], [0, 0.002], [0, 0.5], [0, 0.501])
    expect(fixDefault("split", gappy)).toBe(defaultGap(gappy))
    expect(runFix("split", gappy, 5, { gap: 100_000 }).changed).toBe(0)
    expect(runFix("split", gappy, 5, { gap: 1_000 }).changed).toBe(1)
  })

  test("a bigger spike factor leaves more spikes", () => {
    // Ten steps of about 110 m and one 5.5 km detour out and back.
    const spiky = line(...[0, 1, 2, 3, 4, 5].map((i) => [0, i * 0.001]), [0.05, 0.0055], ...[6, 7, 8, 9, 10].map((i) => [0, i * 0.001]))
    expect(runFix("spikes", spiky, 5, { factor: 5 }).changed).toBe(1)
    expect(runFix("spikes", spiky, 5, { factor: 100 }).changed).toBe(0)
  })
})
