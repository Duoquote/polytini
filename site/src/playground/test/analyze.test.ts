import { describe, expect, test } from "vitest"
import { encode } from "@duoquote/polytini"
import { analyze } from "../analyze"
import { EXAMPLES, loadLong } from "../examples"
import { allLines } from "../model"
import { gpsTrack } from "../track"

const GOOGLE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
const first = async (input: string | Uint8Array, name?: string) => (await analyze(input, name)).choices[0]

describe("analyze", () => {
  test("empty input", async () => {
    expect((await analyze("  ")).choices).toEqual([])
  })

  test("a polyline", async () => {
    const c = await first(GOOGLE)
    expect(c.kind).toBe("polyline")
    expect(c.interp).toMatchObject({ precision: 5 })
  })

  test("a JSON array of polylines", async () => {
    const c = await first(JSON.stringify([GOOGLE, GOOGLE]))
    expect(allLines(c.collection)).toHaveLength(2)
  })

  test("coordinate arrays: the order comes from what's plausible", async () => {
    const latlng = await first("[[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]")
    expect(latlng.id).toBe("coords-latlng")
    const lnglat = await first("[[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]")
    expect(lnglat.id).toBe("coords-lnglat")
    expect(allLines(lnglat.collection)[0].line.pts[0]).toEqual([38.5, -120.2])
  })

  test("{ lat, lng } objects are never ambiguous", async () => {
    const a = await analyze('[{"lat": 38.5, "lon": -120.2}, {"latitude": 40.7, "longitude": -120.95, "ele": 12}]')
    expect(a.choices).toHaveLength(1)
    expect(allLines(a.choices[0].collection)[0].line.pts).toEqual([[38.5, -120.2], [40.7, -120.95, 12]])
  })

  test("GeoJSON and WKT go through their formats", async () => {
    expect((await first('{"type":"LineString","coordinates":[[-120.2,38.5],[-120.95,40.7]]}')).kind).toBe("geojson")
    expect((await first("LINESTRING (-120.2 38.5, -120.95 40.7)")).kind).toBe("wkt")
  })

  test("CSV without names is offered both ways, the plausible one first", async () => {
    const a = await analyze("38.5,-120.2\n40.7,-120.95\n43.252,-126.453")
    expect(a.choices.map((c) => c.id)).toContain("csv-lnglat")
    expect(a.choices[0].id).toBe("csv-latlng")
  })

  test("a binary file that isn't a format says so", async () => {
    const a = await analyze(new Uint8Array([0, 1, 2, 3, 4, 5, 255, 254]), "x.bin")
    expect(a.choices).toEqual([])
    expect(a.message).toBeTruthy()
  })

  test("a text file with a polyline in it", async () => {
    expect((await first(new TextEncoder().encode(GOOGLE + "\n"), "route.txt")).kind).toBe("polyline")
  })
})

describe("examples", () => {
  // What each example in the gallery should be read as.
  const want: Record<string, (c: Awaited<ReturnType<typeof first>>) => void> = {
    google: (c) => expect(c.interp).toMatchObject({ precision: 5, order: "latlng" }),
    osrm6: (c) => expect(c.interp).toMatchObject({ precision: 6 }),
    valhalla: (c) => expect(c.interp).toMatchObject({ precision: 6 }),
    graphhopper3d: (c) => expect(c.interp).toMatchObject({ dims: 3, zFactor: 100 }),
    mapbox6: (c) => expect(c.interp).toMatchObject({ precision: 6 }),
    flexible: (c) => expect(c.interp).toEqual({ format: "flexible" }),
    ring: (c) => expect(allLines(c.collection)[0].line.ring).toBe(true),
    multi: (c) => {
      expect(c.kind).toBe("geojson")
      expect(allLines(c.collection)).toHaveLength(2)
    },
    wkt: (c) => expect(c.kind).toBe("wkt"),
    swapped: (c) => expect(c.interp).toMatchObject({ order: "lnglat" }),
    truncated: (c) => expect(c.issues[0]).toMatchObject({ code: "truncated", index: 17 }),
    invalid: (c) => expect(c.issues[0]).toMatchObject({ code: "char", index: 14 }),
    mismatch: (c) => expect(allLines(c.collection)[0].line.pts[0][0]).toBeGreaterThan(90),
  }
  for (const ex of EXAMPLES.filter((e) => e.id !== "long")) {
    test(ex.id, async () => want[ex.id](await first(ex.text())))
  }
  test("long: 10,000 points at precision 5, the same every time", async () => {
    const s = await loadLong()
    expect(s).toBe(await loadLong())
    const c = await first(s)
    expect(c.interp).toMatchObject({ precision: 5 })
    expect(allLines(c.collection)[0].line.pts).toHaveLength(10000)
  })
  test("the track generator matches the benchmark's", async () => {
    const { gpsTrack: original, ANCHORS } = (await import("../../../../test/fixtures-core.js")) as {
      gpsTrack: (o: object) => number[][]
      ANCHORS: { lat: number; lng: number }[]
    }
    expect(encode(gpsTrack(500, 7, ANCHORS[2]))).toBe(encode(original({ points: 500, seed: 7, anchor: ANCHORS[2], precision: 5 })))
  })
})
