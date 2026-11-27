// FlatGeobuf through the official flatgeobuf package (BSD-3-Clause).
// Binary, so download and upload only. Written with CRS EPSG:4326.
import { deserialize, serialize } from "flatgeobuf/geojson"
import type { Collection, Feature } from "../model"
import type { Converter } from "./types"
import { asBytes, featureGeometry, geometryLines, type Geometry, type GeoCollection } from "./geo"

export default {
  async read(input) {
    const features: Feature[] = []
    for await (const f of deserialize(asBytes(input))) {
      const lines = geometryLines(f.geometry as unknown as Geometry)
      if (lines.length) features.push({ lines, props: { ...(f.properties ?? {}) } })
    }
    return { features } satisfies Collection
  },
  async write(c) {
    // The library takes the columns and geometry type from the first feature.
    if (!c.features.length) throw new Error("FlatGeobuf: there are no features to write")
    // FlatGeobuf takes its columns from the first feature, so give every
    // feature every key (missing ones as null) and the same geometry kind.
    const keys = [...new Set(c.features.flatMap((f) => Object.keys(f.props)))]
    const fc: GeoCollection = {
      type: "FeatureCollection",
      features: c.features.map((f) => ({
        type: "Feature",
        properties: Object.fromEntries(keys.map((k) => [k, f.props[k] ?? null])),
        geometry: featureGeometry(f),
      })),
    }
    return serialize(fc as unknown as Parameters<typeof serialize>[0], 4326)
  },
} satisfies Converter
