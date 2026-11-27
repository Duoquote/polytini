import { describe, expect, test } from "vitest"
import { decode, encode } from "@duoquote/polytini"
import * as flexible from "@duoquote/polytini/flexible"
import { detect, splitInput, valueCount } from "../detect"
import { realWorld, repoJson } from "./fixtures"

const GOOGLE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
const top = (s: string) => detect(s).candidates[0].interp

describe("detect", () => {
  test("Google's example is precision 5, lat/lng", () => {
    const d = detect(GOOGLE)
    expect(d.candidates[0].interp).toMatchObject({ format: "google", precision: 5, order: "latlng", dims: 2 })
    expect(d.candidates[0].issues).toEqual([])
    expect(d.candidates[0].lines[0]).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]])
  })

  test("OSRM polyline6, Valhalla and Mapbox polyline6 are precision 6", () => {
    const osrm = repoJson("test/fixtures/presets/osrm-polyline6.json").routes[0].geometry
    const valhalla = repoJson("test/fixtures/presets/valhalla-route.json").trip.legs[0].shape
    const mapbox = repoJson("test/fixtures/presets/mapbox-directions_v5_precision_6.json").routes[0].geometry
    for (const s of [osrm, valhalla, mapbox]) expect(top(s)).toMatchObject({ precision: 6, order: "latlng", dims: 2 })
  })

  test("OSRM and Mapbox polyline (5) are precision 5", () => {
    const osrm = repoJson("test/fixtures/presets/osrm-polyline.json").routes[0].geometry
    const mapbox = repoJson("test/fixtures/presets/mapbox-directions_v5.json").routes[0].geometry
    for (const s of [osrm, mapbox]) expect(top(s)).toMatchObject({ precision: 5, order: "latlng", dims: 2 })
  })

  test("GraphHopper with elevation is 3D with a z factor of 100", () => {
    const gh = repoJson("test/fixtures/presets/graphhopper.json").tests.decode3d
    const s = gh[gh.length - 1].points
    expect(top(s)).toMatchObject({ precision: 5, dims: 3, zFactor: 100 })
  })

  test("a longitude-first string is read as one", () => {
    const s = encode([[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]])
    const c = detect(s).candidates[0]
    expect(c.interp).toMatchObject({ precision: 5, order: "lnglat" })
    expect(c.lines[0][0]).toEqual([38.5, -120.2])
  })

  test("HERE Flexible Polyline is recognized by its header", () => {
    const s = flexible.encode({ polyline: [[50.10228, 8.69821, 112.5], [50.10201, 8.69567, 113.1], [50.10063, 8.6915, 114.8]], precision: 5, thirdDim: flexible.ELEVATION, thirdDimPrecision: 1 })
    const d = detect(s)
    expect(d.candidates[0].interp).toEqual({ format: "flexible" })
    expect(d.candidates[0].lines[0][0]).toEqual([50.10228, 8.69821, 112.5])
  })

  test("a cut-off string still decodes, with the strict error and its index", () => {
    const c = detect("_p~iF~ps|U_ulLnnq").candidates[0]
    expect(c.interp).toMatchObject({ precision: 5 })
    expect(c.lines[0]).toEqual([[38.5, -120.2]])
    expect(c.issues).toEqual([expect.objectContaining({ code: "truncated", index: 17 })])
  })

  test("an invalid character is skipped, and reported where it is in the input", () => {
    const c = detect('  "_p~iF~ps|U_ul LnnqC_mqNvxq`@"').candidates[0]
    expect(c.lines[0]).toEqual(decode(GOOGLE))
    expect(c.issues[0]).toMatchObject({ code: "char", index: 3 + 13 })
  })

  test("one polyline per line, quotes and JSON escaping removed", () => {
    // A JSON string holding a\b is written "a\\b": two backslashes.
    const bs = String.fromCharCode(92)
    const parts = splitInput(`"a${bs}${bs}b",\n  'xy'\n\nzz`)
    expect(parts).toEqual([
      { str: `a${bs}b`, offset: 1 },
      { str: "xy", offset: 11 },
      { str: "zz", offset: 16 },
    ])
    expect(detect(`${GOOGLE}\n${GOOGLE}`).candidates[0].lines).toHaveLength(2)
  })

  test("value count", () => {
    expect(valueCount(GOOGLE)).toBe(6)
  })

  test("empty input gives no candidates", () => {
    expect(detect("  \n ").candidates).toEqual([])
  })
})

// Accuracy on real lines: the 1000 real-world lines (precision 5), and the
// same points encoded at precision 6 and 7, and longitude first.
describe("accuracy", () => {
  const lines = realWorld()
  const pts = lines.map((s) => decode(s))
  const rate = (strs: string[], want: object) => strs.filter((s) => expect.objectContaining(want).asymmetricMatch(top(s))).length / strs.length
  const results: Record<string, number> = {}

  test("precision 5 as published", () => {
    results.p5 = rate(lines, { precision: 5, order: "latlng", dims: 2 })
    expect(results.p5).toBeGreaterThan(0.95)
  })
  test("re-encoded at precision 6", () => {
    results.p6 = rate(pts.map((p) => encode(p, 6)), { precision: 6, order: "latlng" })
    expect(results.p6).toBeGreaterThan(0.95)
  })
  test("re-encoded at precision 7", () => {
    results.p7 = rate(pts.map((p) => encode(p, 7)), { precision: 7, order: "latlng" })
    expect(results.p7).toBeGreaterThan(0.8)
  })
  test("longitude first", () => {
    results.swapped = rate(pts.map((p) => encode(p, { order: "lnglat" })), { precision: 5, order: "lnglat" })
    // Reported, not required: where both orders land on land, nothing in the
    // string tells them apart.
    console.log("detector accuracy on the 1000 real-world lines:", JSON.stringify(results))
  })
})

// The benchmark's generated GPS-like tracks (1 Hz, walking to highway pace)
// around four cities, 50 tracks of 200 points each per city.
describe("accuracy on generated tracks", async () => {
  const { gpsTrack, ANCHORS } = (await import("../../../../test/fixtures-core.js")) as {
    gpsTrack: (o: { points: number; seed: number; anchor: { lat: number; lng: number }; precision?: number }) => number[][]
    ANCHORS: { name: string; lat: number; lng: number }[]
  }
  test("per city: precision 5, 6, and longitude first", () => {
    const out: Record<string, Record<string, number>> = {}
    for (const anchor of ANCHORS) {
      const tracks = Array.from({ length: 50 }, (_, seed) => gpsTrack({ points: 200, seed: seed + 1, anchor, precision: 6 }))
      const rate = (strs: string[], want: object) => strs.filter((s) => expect.objectContaining(want).asymmetricMatch(top(s))).length / strs.length
      out[anchor.name] = {
        p5: rate(tracks.map((t) => encode(t, 5)), { precision: 5, order: "latlng" }),
        p6: rate(tracks.map((t) => encode(t, 6)), { precision: 6, order: "latlng" }),
        swapped: rate(tracks.map((t) => encode(t, { precision: 5, order: "lnglat" })), { precision: 5, order: "lnglat" }),
      }
      expect(out[anchor.name].p5).toBeGreaterThan(0.9)
      expect(out[anchor.name].p6).toBeGreaterThan(0.9)
    }
    console.log("detector accuracy on generated tracks:", JSON.stringify(out))
  })
})
