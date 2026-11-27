// The interface every file format implements. Each format lives in its own
// module and is loaded with import() only when it's used, so none of them
// add to the main bundle. formats/index.ts has the list and the sniffer.
import type { Collection } from "../model"

export type FormatId =
  | "geojson"
  | "geojsonl"
  | "geojsons"
  | "kml"
  | "kmz"
  | "gpx"
  | "wkt"
  | "ewkt"
  | "wkb"
  | "ewkb"
  | "shapefile"
  | "csv"
  | "topojson"
  | "flatgeobuf"
  | "gpkg"

export type FormatInfo = {
  id: FormatId
  label: string
  /** File extensions, without the dot. */
  ext: string[]
  mime: string
  /** Binary formats can't go through the clipboard: download and upload only. */
  binary: boolean
}

export type ReadOptions = {
  /** CSV: the column order when there's no header. Default "latlng". */
  order?: "latlng" | "lnglat"
  /** File name, for formats that care (zip contents, layer names). */
  name?: string
  /** NDJSON with an encoded polyline field: its precision. Default 5. */
  precision?: number
}

export type WriteOptions = {
  /** CSV: the column order. Default "latlng". */
  order?: "latlng" | "lnglat"
  /** Layer, track or document name where the format has one. */
  name?: string
  /** GeoJSON Text Sequences: RS-prefixed records instead of plain lines. */
  rs?: boolean
}

export interface Converter {
  read(input: string | Uint8Array, options?: ReadOptions): Promise<Collection>
  write(c: Collection, options?: WriteOptions): Promise<string | Uint8Array>
}

export type Sniffed = { id: FormatId; confidence: number; why: string }
