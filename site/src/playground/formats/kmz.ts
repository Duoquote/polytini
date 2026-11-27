// KMZ: a zip with doc.kml inside. Binary, so download and upload only.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import type { Converter } from "./types"
import { asBytes } from "./geo"
import { writeKml } from "./kml"
import { readKml } from "./xml"

export default {
  async read(input) {
    const files = unzipSync(asBytes(input))
    // doc.kml by convention, but any .kml at the top level will do.
    const name = Object.keys(files).find((n) => /(^|\/)doc\.kml$/i.test(n)) ?? Object.keys(files).find((n) => /\.kml$/i.test(n))
    if (!name) throw new SyntaxError("KMZ: no .kml file inside")
    return readKml(strFromU8(files[name]))
  },
  async write(c, options) {
    return zipSync({ "doc.kml": strToU8(writeKml(c, options)) }, { level: 9 })
  },
} satisfies Converter
