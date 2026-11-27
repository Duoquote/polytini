// GPX 1.1: each feature becomes a track, each line a track segment, with
// its name. Elevation goes in <ele>. Polygon rings are written as closed
// segments, since GPX has no polygons. Routes and tracks both read.
import type { Collection } from "../model"
import type { Converter, WriteOptions } from "./types"
import { asText, escapeXml, num } from "./geo"
import { readGpx } from "./xml"

export function writeGpx(c: Collection, options: WriteOptions = {}): string {
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="polytini playground" xmlns="http://www.topografix.com/GPX/1/1">',
  ]
  if (options.name) out.push(`  <metadata><name>${escapeXml(options.name)}</name></metadata>`)
  c.features.forEach((f, i) => {
    const name = f.props.name ?? f.props.title ?? `Line ${i + 1}`
    out.push("  <trk>", `    <name>${escapeXml(String(name))}</name>`)
    if (typeof f.props.desc === "string") out.push(`    <desc>${escapeXml(f.props.desc)}</desc>`)
    for (const l of f.lines) {
      out.push("    <trkseg>")
      for (const p of l.pts)
        out.push(
          p.length > 2
            ? `      <trkpt lat="${num(p[0])}" lon="${num(p[1])}"><ele>${num(p[2])}</ele></trkpt>`
            : `      <trkpt lat="${num(p[0])}" lon="${num(p[1])}"/>`
        )
      out.push("    </trkseg>")
    }
    out.push("  </trk>")
  })
  out.push("</gpx>")
  return out.join("\n") + "\n"
}

export default {
  async read(input) {
    return readGpx(asText(input))
  },
  async write(c, options) {
    return writeGpx(c, options)
  },
} satisfies Converter
