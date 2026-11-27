// @vitest-environment jsdom
// Writes one file per format for checking with GDAL, only when FORMATS_OUT
// names a directory (CI skips it):
//
//   FORMATS_OUT=/tmp/out npx vitest run gdal-samples
//   docker run --rm -v /tmp/out:/data osgeo/gdal:alpine-normal-3.6.3 ogrinfo -al /data/lines.gpkg
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "vitest"
import { unzipSync } from "fflate"
import { loadFormat } from "./index"
import { configureSql } from "./gpkg"
import { sample3d } from "./testkit"
import type { FormatId } from "./types"

const dir = process.env.FORMATS_OUT

test.skipIf(!dir)("write a sample in every format for GDAL", async () => {
  const require = createRequire(import.meta.url)
  configureSql({ wasmBinary: readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm")) as unknown as ArrayBuffer })
  mkdirSync(dir!, { recursive: true })
  const files: [FormatId, string][] = [
    ["geojson", "lines.geojson"],
    ["geojsonl", "lines.geojsonl"],
    ["geojsons", "lines.geojsons"],
    ["kml", "lines.kml"],
    ["kmz", "lines.kmz"],
    ["gpx", "lines.gpx"],
    ["flatgeobuf", "lines.fgb"],
    ["gpkg", "lines.gpkg"],
    ["shapefile", "lines.zip"],
    ["csv", "lines.csv"],
    ["topojson", "lines.topojson"],
  ]
  for (const [id, name] of files) {
    const out = await (await loadFormat(id)).write(sample3d(), { name: "lines" })
    writeFileSync(join(dir!, name), out)
    // GDAL 3.6 reads a zipped shapefile through /vsizip/; unzip it too for plain ogrinfo.
    if (id === "shapefile") for (const [n, b] of Object.entries(unzipSync(out as Uint8Array))) writeFileSync(join(dir!, n), b)
  }
})
