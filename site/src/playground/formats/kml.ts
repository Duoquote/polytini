// KML 2.2, the way Google Earth writes it: a Document of Placemarks with a
// name, ExtendedData for the other properties, and LineString, Polygon or
// MultiGeometry. Coordinates are lng,lat[,alt].
import type { Collection, Feature } from "../model"
import type { Converter, WriteOptions } from "./types"
import { asText, closeRing, escapeXml, num } from "./geo"
import { readKml } from "./xml"

const coords = (pts: number[][]) => pts.map((p) => [p[1], p[0], ...(p.length > 2 ? [p[2]] : [])].map(num).join(",")).join(" ")

function geometry(f: Feature, indent: string): string[] {
  const parts: string[][] = []
  for (const l of f.lines.filter((l) => !l.ring))
    parts.push([`<LineString><tessellate>1</tessellate><coordinates>${coords(l.pts)}</coordinates></LineString>`])
  const polys = new Map<number, number[][][]>()
  f.lines.filter((l) => l.ring).forEach((l, i) => {
    const key = l.part ?? -1 - i
    if (!polys.has(key)) polys.set(key, [])
    polys.get(key)!.push(closeRing(l.pts))
  })
  for (const rings of polys.values()) {
    const [outer, ...holes] = rings
    parts.push([
      "<Polygon>",
      `  <outerBoundaryIs><LinearRing><coordinates>${coords(outer)}</coordinates></LinearRing></outerBoundaryIs>`,
      ...holes.map((h) => `  <innerBoundaryIs><LinearRing><coordinates>${coords(h)}</coordinates></LinearRing></innerBoundaryIs>`),
      "</Polygon>",
    ])
  }
  if (parts.length === 1) return parts[0].map((s) => indent + s)
  return [indent + "<MultiGeometry>", ...parts.flat().map((s) => indent + "  " + s), indent + "</MultiGeometry>"]
}

export function writeKml(c: Collection, options: WriteOptions = {}): string {
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "<Document>",
    `  <name>${escapeXml(options.name ?? "polytini")}</name>`,
  ]
  c.features.forEach((f, i) => {
    const { name, description, ...rest } = f.props
    out.push("  <Placemark>", `    <name>${escapeXml(String(name ?? `Line ${i + 1}`))}</name>`)
    if (description !== undefined) out.push(`    <description>${escapeXml(String(description))}</description>`)
    const extra = Object.entries(rest).filter(([, v]) => v !== undefined && v !== null)
    if (extra.length) {
      out.push("    <ExtendedData>")
      for (const [k, v] of extra)
        out.push(`      <Data name="${escapeXml(k)}"><value>${escapeXml(typeof v === "object" ? JSON.stringify(v) : String(v))}</value></Data>`)
      out.push("    </ExtendedData>")
    }
    out.push(...geometry(f, "    "), "  </Placemark>")
  })
  out.push("</Document>", "</kml>")
  return out.join("\n") + "\n"
}

export default {
  async read(input) {
    return readKml(asText(input))
  },
  async write(c, options) {
    return writeKml(c, options)
  },
} satisfies Converter
