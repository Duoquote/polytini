// EWKT: WKT with PostGIS's SRID=4326; prefix on each geometry.
import type { Converter } from "./types"
import { asText } from "./geo"
import { readWkt, writeWkt } from "./wkt"

export default {
  async read(input) {
    return readWkt(asText(input))
  },
  async write(c) {
    return writeWkt(c, true)
  },
} satisfies Converter
