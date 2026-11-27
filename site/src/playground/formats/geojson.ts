// GeoJSON: Feature, FeatureCollection or a bare geometry in, one
// FeatureCollection out. Points are skipped on the way in.
import type { Converter } from "./types"
import { asText, fromGeoJSON, toGeoJSON } from "./geo"

export default {
  async read(input) {
    return fromGeoJSON(JSON.parse(asText(input)))
  },
  async write(c) {
    return JSON.stringify(toGeoJSON(c))
  },
} satisfies Converter
