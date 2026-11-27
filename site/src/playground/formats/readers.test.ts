// @vitest-environment jsdom
// Files written by other tools (GDAL, Google Earth, Garmin Connect) and the
// odd corners of each reader: other byte orders, envelope variants, SRIDs,
// NDJSON with a polyline field, RS records.
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createRequire } from "node:module"
import { beforeAll, describe, expect, test } from "vitest"
import { encode } from "@duoquote/polytini"
import { loadFormat, sniff } from "./index"
import { configureSql, decodeGpkgBlob, encodeGpkgBlob } from "./gpkg"
import { decodeWkb, encodeWkb, fromHex, toHex } from "./wkb"
import { parseWkt } from "./wkt"
import { records } from "./geojsonl"

// Vitest runs from site/.
const fixture = (name: string) => new Uint8Array(readFileSync(resolve("src/playground/formats/fixtures", name)))
const text = (name: string) => new TextDecoder().decode(fixture(name))

beforeAll(() => {
  const require = createRequire(import.meta.url)
  configureSql({ wasmBinary: readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm")) as unknown as ArrayBuffer })
})

describe("files from other tools", () => {
  test("a GDAL shapefile export (the driver QGIS uses)", async () => {
    const c = await (await loadFormat("shapefile")).read(fixture("gdal-shapefile.shp.zip"))
    expect(c.features).toHaveLength(2)
    expect(c.features[0].lines[0].pts).toEqual([[51.5007, -0.1246], [51.5014, -0.1419], [51.5079, -0.1281]])
    expect(c.features[0].props).toEqual({ name: "Westminster to Trafalgar Square", km: 2.4, walk: 1 })
    // UTF-8 attributes, through the .cpg.
    expect(c.features[1].props.name).toBe("Google example, Çağlayan")
  })

  test("a GDAL GeoPackage with mixed geometry types", async () => {
    const c = await (await loadFormat("gpkg")).read(fixture("gdal.gpkg"))
    expect(c.features.map((f) => f.lines.length)).toEqual([1, 2, 2])
    expect(c.features[2].lines.every((l) => l.ring && l.part === 0)).toBe(true)
    expect(c.features[0].props).toMatchObject({ name: "Westminster to Trafalgar Square", km: 2.4, walk: 1 })
  })

  test("a GDAL FlatGeobuf", async () => {
    const c = await (await loadFormat("flatgeobuf")).read(fixture("gdal.fgb"))
    // GDAL writes features in its spatial index's order, so look them up by name.
    const byName = (n: string) => c.features.find((f) => f.props.name === n)!
    expect(c.features).toHaveLength(3)
    expect(byName("Two legs").lines).toHaveLength(2)
    expect(byName("Park with a pond").lines[1].pts[0]).toEqual([52.513, 13.373])
    expect(byName("Park with a pond").lines.every((l) => l.ring)).toBe(true)
    expect(byName("Westminster to Trafalgar Square").props).toMatchObject({ km: 2.4, walk: 1 })
  })

  test("a Google Earth KML with a style map, a polygon and a gx:Track", async () => {
    const c = await (await loadFormat("kml")).read(text("google-earth.kml"))
    expect(c.features.map((f) => f.props.name)).toEqual(["Westminster to Trafalgar Square", "St James's Park", "Recorded track"])
    expect(c.features[0].props).toMatchObject({ description: "Past Buckingham Palace", km: "2.4" })
    expect(c.features[0].props.styleUrl).toBeUndefined()
    expect(c.features[1].lines[0].ring).toBe(true)
    expect(c.features[2].lines[0].pts[2]).toEqual([51.5012, -0.135, 15])
  })

  test("a Garmin Connect GPX with a track and a route", async () => {
    const c = await (await loadFormat("gpx")).read(text("garmin.gpx"))
    expect(c.features.map((f) => f.props.name)).toEqual(["London Running", "Planned route"])
    expect(c.features[0].lines[0].pts[1]).toEqual([51.5014, -0.1419, 14])
    expect(c.features[1].lines[0].pts).toHaveLength(2)
  })
})

describe("sniffing", () => {
  test.each([
    ["gdal-shapefile.shp.zip", "shapefile"],
    ["gdal.gpkg", "gpkg"],
    ["gdal.fgb", "flatgeobuf"],
    ["google-earth.kml", "kml"],
    ["garmin.gpx", "gpx"],
    ["source.geojson", "geojson"],
  ])("%s is %s", (name, id) => {
    expect(sniff(fixture(name), name)[0].id).toBe(id)
    // Without the file name too.
    expect(sniff(fixture(name))[0].id).toBe(id)
  })

  test.each([
    ['{"type":"LineString","coordinates":[[0,0],[1,1]]}', "geojson"],
    ['{"type":"Topology","objects":{},"arcs":[]}', "topojson"],
    ['{"type":"Feature","geometry":null,"properties":{}}\n{"type":"Feature","geometry":null,"properties":{}}', "geojsonl"],
    ['\x1e{"type":"Feature","geometry":null,"properties":{}}\n', "geojsons"],
    ["LINESTRING (30 10, 10 30, 40 40)", "wkt"],
    ["SRID=4326;LINESTRING(30 10,10 30)", "ewkt"],
    ["010200000002000000000000000000F03F000000000000F03F00000000000000400000000000000040", "wkb"],
    ["0102000020E610000002000000000000000000F03F000000000000F03F00000000000000400000000000000040", "ewkb"],
    ["lat,lng\n38.5,-120.2\n40.7,-120.95", "csv"],
    ["38.5,-120.2\n40.7,-120.95", "csv"],
  ])("%s", (input, id) => {
    expect(sniff(input)[0].id).toBe(id)
  })

  test("an encoded polyline isn't any of these", () => {
    expect(sniff("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([])
    expect(sniff("kviyHviWkCbkBsg@guA")).toEqual([])
  })
})

describe("WKB", () => {
  test("big-endian, ISO Z and EWKB flags read the same", () => {
    const g = { type: "LineString" as const, coordinates: [[1, 2, 3], [4, 5, 6]] }
    const iso = encodeWkb(g)
    expect(decodeWkb(iso).geometry).toEqual(g)
    const ewkb = encodeWkb(g, { ewkb: true, srid: 4326 })
    expect(decodeWkb(ewkb)).toMatchObject({ geometry: g, srid: 4326 })
    // Big-endian, like PostGIS's ST_AsBinary(geom, 'XDR').
    const xdr = new Uint8Array(41)
    const v = new DataView(xdr.buffer)
    v.setUint32(1, 2, false)
    v.setUint32(5, 2, false)
    ;[2, 2, 4, 5].forEach((x, i) => v.setFloat64(9 + 8 * i, x, false))
    expect(decodeWkb(xdr).geometry).toEqual({ type: "LineString", coordinates: [[2, 2], [4, 5]] })
    expect(toHex(fromHex("\\x0102"))).toBe("0102")
  })

  test("refuses another SRID", async () => {
    const hex = toHex(encodeWkb({ type: "LineString", coordinates: [[0, 0], [1, 1]] }, { ewkb: true, srid: 3857 }))
    await expect((await loadFormat("ewkb")).read(hex)).rejects.toThrow(/3857/)
  })
})

describe("WKT", () => {
  test("geometry collections, Z and EMPTY", () => {
    expect(parseWkt("GEOMETRYCOLLECTION (POINT (1 2), LINESTRING Z (1 2 3, 4 5 6))")).toEqual({
      type: "GeometryCollection",
      geometries: [
        { type: "Point", coordinates: [1, 2] },
        { type: "LineString", coordinates: [[1, 2, 3], [4, 5, 6]] },
      ],
    })
    expect(parseWkt("LINESTRING EMPTY")).toEqual({ type: "GeometryCollection", geometries: [] })
    expect(() => parseWkt("LINESTRING (1 2, 3")).toThrow()
  })
  test("EWKT with another SRID is refused", async () => {
    await expect((await loadFormat("ewkt")).read("SRID=3857;LINESTRING(0 0,1 1)")).rejects.toThrow(/reproject/)
  })
})

describe("GeoPackage blobs", () => {
  test("every envelope variant and both byte orders", () => {
    const g = { type: "LineString" as const, coordinates: [[1, 2], [3, 4]] }
    const wkb = encodeWkb(g)
    for (const [code, size] of [[0, 0], [1, 32], [2, 48], [3, 48], [4, 64]]) {
      for (const le of [true, false]) {
        const blob = new Uint8Array(8 + size + wkb.length)
        blob.set([0x47, 0x50, 0, (code << 1) | (le ? 1 : 0)])
        new DataView(blob.buffer).setInt32(4, 4326, le)
        blob.set(wkb, 8 + size)
        expect(decodeGpkgBlob(blob)).toEqual({ geometry: g, srid: 4326 })
      }
    }
    expect(decodeGpkgBlob(encodeGpkgBlob(g)).geometry).toEqual(g)
  })
})

describe("GeoJSONL", () => {
  test("RS records and plain lines split the same", () => {
    expect(records('\x1e{"a":1}\n\x1e{"a":2}\n')).toEqual(['{"a":1}', '{"a":2}'])
    expect(records('{"a":1}\r\n\n{"a":2}')).toEqual(['{"a":1}', '{"a":2}'])
  })

  test("NDJSON with an encoded polyline field goes through polytini's decodeLines", async () => {
    const shape = encode([[38.5, -120.2], [40.7, -120.95]])
    const input = [{ id: 1, shape, name: "a" }, { id: 2, shape, name: "b" }].map((o) => JSON.stringify(o)).join("\n")
    const c = await (await loadFormat("geojsonl")).read(input)
    expect(c.features).toHaveLength(2)
    expect(c.features[1]).toEqual({ lines: [{ pts: [[38.5, -120.2], [40.7, -120.95]], ring: false }], props: { id: 2, name: "b" } })
  })

  test("polyline6 with the precision option", async () => {
    const shape = encode([[52.517034, 13.38882], [52.523239, 13.428554]], 6)
    const c = await (await loadFormat("geojsonl")).read(`{"geometry6":${JSON.stringify(shape)}}\n`, { precision: 6 })
    expect(c.features[0].lines[0].pts[1]).toEqual([52.523239, 13.428554])
  })

  test("a big file yields to the event loop and keeps every line", async () => {
    const line = '{"type":"Feature","properties":{"i":0},"geometry":{"type":"LineString","coordinates":[[0,0],[1,1]]}}'
    const c = await (await loadFormat("geojsonl")).read(Array(5000).fill(line).join("\n"))
    expect(c.features).toHaveLength(5000)
  })
})

describe("GeoJSON", () => {
  test("points are skipped, polygons get parts, ids become properties", async () => {
    const c = await (await loadFormat("geojson")).read(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          { type: "Feature", id: "p", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } },
          {
            type: "Feature",
            id: 9,
            properties: { name: "two" },
            geometry: { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6]]]] },
          },
        ],
      })
    )
    expect(c.features).toHaveLength(1)
    expect(c.features[0].props).toEqual({ name: "two", id: 9 })
    expect(c.features[0].lines.map((l) => l.part)).toEqual([0, 1])
    // An unclosed ring is closed.
    expect(c.features[0].lines[1].pts).toHaveLength(4)
  })
})

describe("CSV", () => {
  test("lng,lat without a header is noticed from the range", async () => {
    const c = await (await loadFormat("csv")).read("-120.2,38.5\n-120.95,40.7\n")
    expect(c.features[0].lines[0].pts).toEqual([[38.5, -120.2], [40.7, -120.95]])
  })
  test("semicolons, tabs and quoted headers", async () => {
    const c = await (await loadFormat("csv")).read('"Latitude";"Longitude";"Elevation"\n38.5;-120.2;10\n40.7;-120.95;12\n')
    expect(c.features[0].lines[0].pts).toEqual([[38.5, -120.2, 10], [40.7, -120.95, 12]])
  })
  test("a header without coordinates is an error", async () => {
    await expect((await loadFormat("csv")).read("a,b\n1,2\n")).rejects.toThrow(/lat and lng/)
  })
})

describe("shapefile", () => {
  test("a projected shapefile is refused with a hint", async () => {
    const { zipSync, strToU8, unzipSync } = await import("fflate")
    const files = unzipSync(fixture("gdal-shapefile.shp.zip"))
    const prj = Object.keys(files).find((n) => n.endsWith(".prj"))!
    files[prj] = strToU8('PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere"]')
    await expect((await loadFormat("shapefile")).read(zipSync(files))).rejects.toThrow(/reproject/)
  })
  test("long and clashing property names fit dBASE's 10 bytes", async () => {
    const f = await loadFormat("shapefile")
    const c = { features: [{ lines: [{ pts: [[0, 0], [1, 1]], ring: false }], props: { description_a: "x", description_b: "y" } }] }
    const back = await f.read(await f.write(c))
    expect(Object.keys(back.features[0].props)).toEqual(["descriptio", "descripti1"])
  })
})
