// @vitest-environment jsdom
// Every format: collection, write, read back, compare. jsdom gives KML
// and GPX the DOMParser they use in the browser.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { beforeAll, describe, expect, test } from "vitest"
import type { FormatId } from "./types"
import { loadFormat } from "./index"
import { configureSql } from "./gpkg"
import { expectSameCollection, sample, sample3d, type Keeps } from "./testkit"

beforeAll(() => {
  const require = createRequire(import.meta.url)
  configureSql({ wasmBinary: readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm")) as unknown as ArrayBuffer })
})

const all: Keeps = { props: "exact", rings: true, z: true, features: true }
const geometryOnly: Keeps = { props: "none", rings: true, z: true, features: true }

const CASES: [FormatId, Keeps][] = [
  ["geojson", all],
  ["geojsonl", all],
  ["geojsons", all],
  ["topojson", all],
  ["flatgeobuf", all],
  ["gpkg", { ...all, props: "sqlite" }],
  ["shapefile", all],
  ["kml", { ...all, props: "strings" }],
  ["kmz", { ...all, props: "strings" }],
  // GPX has no polygons: rings come back as closed lines, and only names.
  ["gpx", { props: "name", rings: false, z: true, features: true }],
  ["wkt", geometryOnly],
  ["ewkt", geometryOnly],
  ["wkb", geometryOnly],
  ["ewkb", geometryOnly],
  // CSV keeps lines and closed rings, but not which rings are holes.
  ["csv", { props: "none", rings: false, z: true, features: true }],
]

describe.each(CASES)("%s round trip", (id, keeps) => {
  test("2D lines, a multi-part line and a polygon with a hole", async () => {
    const f = await loadFormat(id)
    const out = await f.write(sample(), { name: "test" })
    expectSameCollection(await f.read(out), sample(), { ...keeps, z: false })
  })
  test("with elevation", async () => {
    const f = await loadFormat(id)
    const out = await f.write(sample3d(), { name: "test" })
    expectSameCollection(await f.read(out), sample3d(), keeps)
  })
  test("an empty collection", async () => {
    const f = await loadFormat(id)
    if (id === "flatgeobuf") return void (await expect(f.write({ features: [] })).rejects.toThrow(/no features/))
    const out = await f.write({ features: [] })
    expect((await f.read(out)).features).toEqual([])
  })
})

test("CSV in lng,lat order round-trips with the same option", async () => {
  const f = await loadFormat("csv")
  const out = (await f.write(sample(), { order: "lnglat" })) as string
  expect(out.split("\n")[0]).toBe("feature,line,lng,lat")
  expectSameCollection(await f.read(out), sample(), { props: "none", rings: false, z: false, features: true })
})

test("binary formats write bytes, text formats write strings", async () => {
  for (const [id] of CASES) {
    const out = await (await loadFormat(id)).write(sample())
    const binary = ["kmz", "shapefile", "flatgeobuf", "gpkg"].includes(id)
    expect(out instanceof Uint8Array).toBe(binary)
  }
})
