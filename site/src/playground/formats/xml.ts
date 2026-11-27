// Shared by KML, KMZ and GPX: parse XML with the browser's DOMParser (the
// tests run in happy-dom) and convert with @tmcw/togeojson, which knows
// the many ways real exports write their tracks.
import { gpx, kml } from "@tmcw/togeojson"
import type { Collection } from "../model"
import { fromGeoJSON } from "./geo"

function parse(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "text/xml")
  const err = doc.getElementsByTagName("parsererror")[0]
  if (err) throw new SyntaxError(`XML: ${err.textContent?.trim().split("\n")[0] ?? "can't parse"}`)
  return doc
}

// togeojson adds style and type bookkeeping that isn't data; drop it so it
// doesn't turn into columns on export.
const NOISE = new Set(["styleUrl", "styleHash", "styleMapHash", "stroke", "stroke-opacity", "stroke-width", "fill", "fill-opacity", "_gpxType", "coordinateProperties"])

function clean(c: Collection): Collection {
  for (const f of c.features) for (const k of Object.keys(f.props)) if (NOISE.has(k)) delete f.props[k]
  return c
}

export const readKml = (text: string) => clean(fromGeoJSON(kml(parse(text))))
export const readGpx = (text: string) => clean(fromGeoJSON(gpx(parse(text))))
