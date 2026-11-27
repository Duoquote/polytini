// EWKB hex: WKB with PostGIS's SRID 4326 and Z flag bits.
import type { Converter } from "./types"
import { asText } from "./geo"
import { readWkbHex, writeWkbHex } from "./wkb"

export default {
  async read(input) {
    return readWkbHex(asText(input))
  },
  async write(c) {
    return writeWkbHex(c, true)
  },
} satisfies Converter
