// GeoPackage: SQLite through sql.js (the SQLite WASM build, MIT) and a
// small GPKG layer written here. A full GeoPackage library would add a lot
// on top of SQLite for features the playground doesn't use (tiles,
// extensions, other projections). sql.js and its 670 KB .wasm load only
// when a .gpkg is opened or exported.
//
// Writing: the required tables (gpkg_spatial_ref_sys with the -1, 0 and
// 4326 rows, gpkg_contents, gpkg_geometry_columns), one feature table with
// an fid, a geom column of GPKG blobs (header plus ISO WKB) and one column
// per property. Reading: every feature table in gpkg_geometry_columns,
// with any envelope variant and either byte order.
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js"
import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url"
import type { Collection, Feature } from "../model"
import type { Converter, WriteOptions } from "./types"
import { asBytes, featureGeometry, geometryLines, hasZ, type Geometry, type Position } from "./geo"
import { decodeWkb, encodeWkb } from "./wkb"

let sql: Promise<SqlJsStatic> | null = null
let config: Parameters<typeof initSqlJs>[0] = { locateFile: () => wasmUrl }

/** Where sql.js finds its WASM. Tests in Node pass the bytes. */
export function configureSql(c: Parameters<typeof initSqlJs>[0]) {
  config = c
  sql = null
}
const SQL = () => (sql ??= initSqlJs(config))

const WGS84 =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AXIS["Latitude",NORTH],AXIS["Longitude",EAST],AUTHORITY["EPSG","4326"]]'

// ---------- geometry blobs ----------

function envelope(g: Geometry): [number, number, number, number] {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  const walk = (c: unknown) => {
    if (!Array.isArray(c)) return
    if (typeof c[0] === "number") {
      const p = c as Position
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0])
      y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1])
    } else c.forEach(walk)
  }
  if (g.type === "GeometryCollection") g.geometries.forEach((x) => walk("coordinates" in x ? x.coordinates : []))
  else walk(g.coordinates)
  return [x0, x1, y0, y1]
}

/** A GPKG geometry blob: "GP", version 0, flags, SRS id, envelope, ISO WKB. */
export function encodeGpkgBlob(g: Geometry, srid = 4326, z?: boolean): Uint8Array {
  // One layer has one Z flag, so every blob in it follows the layer.
  const wkb = encodeWkb(g, { z })
  const out = new Uint8Array(8 + 32 + wkb.length)
  const v = new DataView(out.buffer)
  out[0] = 0x47
  out[1] = 0x50
  out[2] = 0
  // Little endian (bit 0), envelope code 1: [minx, maxx, miny, maxy] (bits 1 to 3).
  out[3] = 0b0000_0011
  v.setInt32(4, srid, true)
  envelope(g).forEach((x, i) => v.setFloat64(8 + 8 * i, x, true))
  out.set(wkb, 40)
  return out
}

const ENVELOPE_BYTES = [0, 32, 48, 48, 64]

export function decodeGpkgBlob(blob: Uint8Array): { geometry: Geometry | null; srid: number } {
  if (blob[0] !== 0x47 || blob[1] !== 0x50) throw new SyntaxError("GeoPackage: geometry blob without the GP magic")
  const flags = blob[3]
  const le = (flags & 1) === 1
  const env = (flags >> 1) & 0b111
  if (env > 4) throw new SyntaxError(`GeoPackage: bad envelope code ${env}`)
  const v = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  const srid = v.getInt32(4, le)
  if (flags & 0b1_0000) return { geometry: null, srid } // empty geometry
  return { geometry: decodeWkb(blob, 8 + ENVELOPE_BYTES[env]).geometry, srid }
}

// ---------- writing ----------

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`

function geometryTypeName(geoms: Geometry[]): { name: string; promote: (g: Geometry) => Geometry } {
  const types = new Set(geoms.map((g) => g.type))
  const only = (...t: string[]) => [...types].every((x) => t.includes(x))
  const id = (g: Geometry) => g
  if (types.size === 1 && !types.has("GeometryCollection")) return { name: [...types][0].toUpperCase(), promote: id }
  // Mixed single and multi: store all as multi, which QGIS reads as one layer type.
  if (only("LineString", "MultiLineString"))
    return {
      name: "MULTILINESTRING",
      promote: (g) => (g.type === "LineString" ? { type: "MultiLineString", coordinates: [g.coordinates] } : g),
    }
  if (only("Polygon", "MultiPolygon"))
    return {
      name: "MULTIPOLYGON",
      promote: (g) => (g.type === "Polygon" ? { type: "MultiPolygon", coordinates: [g.coordinates] } : g),
    }
  return { name: "GEOMETRY", promote: id }
}

function columnType(values: unknown[]): "INTEGER" | "REAL" | "TEXT" | "BOOLEAN" {
  const vs = values.filter((v) => v !== null && v !== undefined)
  if (vs.length && vs.every((v) => typeof v === "boolean")) return "BOOLEAN"
  if (vs.length && vs.every((v) => typeof v === "number" && Number.isInteger(v))) return "INTEGER"
  if (vs.length && vs.every((v) => typeof v === "number")) return "REAL"
  return "TEXT"
}

type Row = { f: Feature; g: Geometry }

function addLayer(db: Database, table: string, rows: Row[]) {
  const { name: typeName, promote } = geometryTypeName(rows.map((r) => r.g))
  const z = rows.some((r) => hasZ(r.g))
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.f.props)))].filter((k) => !/^(fid|geom)$/i.test(k))
  const types = keys.map((k) => columnType(rows.map((r) => r.f.props[k])))
  const bounds = rows.reduce(
    (b, r) => {
      const [x0, x1, y0, y1] = envelope(r.g)
      return [Math.min(b[0], x0), Math.max(b[1], x1), Math.min(b[2], y0), Math.max(b[3], y1)]
    },
    [Infinity, -Infinity, Infinity, -Infinity]
  )
  db.run(
    `INSERT INTO gpkg_contents (table_name, data_type, identifier, description, min_x, min_y, max_x, max_y, srs_id) VALUES (?, 'features', ?, '', ?, ?, ?, ?, 4326)`,
    rows.length ? [table, table, bounds[0], bounds[2], bounds[1], bounds[3]] : [table, table, null, null, null, null]
  )
  db.run(`INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', ?, 4326, ?, 0)`, [table, typeName, z ? 1 : 0])
  const cols = keys.map((k, i) => `${quote(k)} ${types[i]}`)
  db.run(`CREATE TABLE ${quote(table)} (fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, geom ${typeName}${cols.length ? ", " + cols.join(", ") : ""})`)
  const insert = db.prepare(
    `INSERT INTO ${quote(table)} (geom${keys.map((k) => ", " + quote(k)).join("")}) VALUES (?${keys.map(() => ", ?").join("")})`
  )
  for (const r of rows) {
    const values = keys.map((k, i) => {
      const v = r.f.props[k]
      if (v === undefined || v === null) return null
      if (types[i] === "BOOLEAN") return v ? 1 : 0
      if (types[i] === "TEXT" && typeof v === "object") return JSON.stringify(v)
      return types[i] === "TEXT" ? String(v) : (v as number)
    })
    insert.run([encodeGpkgBlob(promote(r.g), 4326, z), ...values])
  }
  insert.free()
}

export async function writeGpkg(c: Collection, options: WriteOptions = {}): Promise<Uint8Array> {
  const SQLite = await SQL()
  const db = new SQLite.Database()
  try {
    const base = (options.name ?? "lines").replace(/[^\w]+/g, "_") || "lines"
    const rows = c.features.map((f) => ({ f, g: featureGeometry(f) })).filter((r): r is Row => !!r.g)
    db.run(`PRAGMA application_id = 1196444487; PRAGMA user_version = 10300;`)
    db.run(`
      CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER NOT NULL PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
      CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER, CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
      CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name), CONSTRAINT uk_gc_table_name UNIQUE (table_name), CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name), CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys (srs_id));
    `)
    const srs = db.prepare("INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)")
    srs.run(["Undefined cartesian SRS", -1, "NONE", -1, "undefined", "undefined cartesian coordinate reference system"])
    srs.run(["Undefined geographic SRS", 0, "NONE", 0, "undefined", "undefined geographic coordinate reference system"])
    srs.run(["WGS 84 geodetic", 4326, "EPSG", 4326, WGS84, "longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid"])
    srs.free()
    // One table per geometry kind, like a shapefile: QGIS then opens each as
    // a plain line or polygon layer instead of asking how to split a mixed one.
    const kind = (f: Feature) => (f.lines.every((l) => !l.ring) ? "lines" : f.lines.every((l) => l.ring) ? "polygons" : "mixed")
    const groups = new Map<string, Row[]>()
    for (const r of rows) {
      const k = kind(r.f)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(r)
    }
    db.run("BEGIN")
    if (groups.size <= 1) addLayer(db, base, rows)
    else for (const [k, rs] of groups) addLayer(db, `${base}_${k}`, rs)
    db.run("COMMIT")
    return db.export()
  } finally {
    db.close()
  }
}

// ---------- reading ----------

export async function readGpkg(input: Uint8Array): Promise<Collection> {
  const SQLite = await SQL()
  let db: Database
  try {
    db = new SQLite.Database(input)
  } catch {
    throw new SyntaxError("GeoPackage: not an SQLite file")
  }
  try {
    const layers = db.exec("SELECT table_name, column_name, srs_id FROM gpkg_geometry_columns")[0]?.values ?? []
    const features: Feature[] = []
    for (const [table, column, srs] of layers as [string, string, number][]) {
      if (srs !== 4326 && srs !== 0 && srs !== -1) {
        const org = db.exec("SELECT organization, organization_coordsys_id FROM gpkg_spatial_ref_sys WHERE srs_id = ?", [srs])[0]?.values[0]
        if (!org || !(String(org[0]).toUpperCase() === "EPSG" && org[1] === 4326))
          throw new SyntaxError(`GeoPackage: layer ${table} uses SRS ${srs}; reproject it to WGS84 (EPSG:4326) first`)
      }
      const pk = (db.exec(`PRAGMA table_info(${quote(table)})`)[0]?.values ?? []).find((c) => c[5] === 1)?.[1] as string | undefined
      const stmt = db.prepare(`SELECT * FROM ${quote(table)}`)
      while (stmt.step()) {
        const row = stmt.getAsObject()
        const blob = row[column]
        if (!(blob instanceof Uint8Array)) continue
        const lines = geometryLines(decodeGpkgBlob(blob).geometry)
        if (!lines.length) continue
        const props: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(row)) if (k !== column && k !== pk) props[k] = v
        features.push({ lines, props })
      }
      stmt.free()
    }
    return { features }
  } finally {
    db.close()
  }
}

export default {
  async read(input) {
    return readGpkg(asBytes(input))
  },
  async write(c, options) {
    return writeGpkg(c, options)
  },
} satisfies Converter
