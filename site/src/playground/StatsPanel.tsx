import { useEffect, useState } from "react"
import { encodeCollection, gzipSize, stats, type PolylineOut } from "./encode"
import { formatMeters } from "./geo"
import type { Collection } from "./model"

export function StatsPanel({ collection, out }: { collection: Collection; out: PolylineOut }) {
  const encoded = encodeCollection(collection, out)
  const s = stats(collection, encoded)
  const [gz, setGz] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    gzipSize(encoded).then((v) => live && setGz(v))
    return () => {
      live = false
    }
  }, [encoded])
  const f = (x: number, d = 5) => x.toFixed(d)
  const rows: [string, string][] = [
    ["Lines", s.lines.toLocaleString("en")],
    ["Points", s.points.toLocaleString("en")],
    ["Length", formatMeters(s.length)],
    ["Bounding box", s.bbox ? `${f(s.bbox[0])}, ${f(s.bbox[1])} to ${f(s.bbox[2])}, ${f(s.bbox[3])}` : "n/a"],
    ["Encoded size", `${s.chars.toLocaleString("en")} B${gz !== null ? `, ${gz.toLocaleString("en")} B gzipped` : ""}`],
    ["Characters per point", s.charsPerPoint.toFixed(2)],
    ["Shortest segment", formatMeters(s.segment.min)],
    ["Median segment", formatMeters(s.segment.median)],
    ["Longest segment", formatMeters(s.segment.max)],
  ]
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">Statistics of the current geometry</caption>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-t first:border-t-0">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted-foreground">
              {k}
            </th>
            <td className="py-1.5 font-mono tabular-nums">{v}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={2} className="pt-2 text-muted-foreground">
            Lengths are great-circle (haversine) distances. Sizes are for the output format above, one ASCII byte per character.
          </td>
        </tr>
      </tfoot>
    </table>
  )
}
