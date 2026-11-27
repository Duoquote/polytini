// The polyline side of the output: Google format at any precision or
// preset, and HERE Flexible Polyline. File formats are in formats/.
import { encode } from "@duoquote/polytini"
import * as flexible from "@duoquote/polytini/flexible"
import { presets } from "@duoquote/polytini/presets"
import { allLines, type Collection, type Line } from "./model"
import { lengthOf, steps, median, bbox } from "./geo"

export type PolylineOut =
  | { kind: "google"; precision: number; preset?: string; dims: 2 | 3; zFactor?: number }
  | { kind: "flexible"; precision: number; thirdDim: 0 | 1 | 2 | 3 | 6 | 7; thirdDimPrecision: number }

export const PRESET_LIST = Object.keys(presets)

/** The output options a preset sets. Its order doesn't matter here: the string is always latitude first. */
export function presetOut(name: string): PolylineOut {
  const p = (presets as Record<string, { precision: number; dimensions?: number; zFactor?: number }>)[name]
  return { kind: "google", precision: p.precision, preset: name, dims: p.dimensions === 3 ? 3 : 2, zFactor: p.zFactor }
}

export function encodeLine(line: Line, out: PolylineOut): string {
  if (out.kind === "flexible") {
    const third = out.thirdDim !== 0
    return flexible.encode({
      polyline: line.pts.map((p) => (third ? [p[0], p[1], p[2] ?? 0] : [p[0], p[1]])),
      precision: out.precision,
      thirdDim: out.thirdDim,
      thirdDimPrecision: out.thirdDimPrecision,
    })
  }
  const pts = out.dims === 3 ? line.pts.map((p) => [p[0], p[1], p[2] ?? 0]) : line.pts.map((p) => [p[0], p[1]])
  return encode(pts, { precision: out.precision, dimensions: out.dims, zFactor: out.dims === 3 ? out.zFactor : undefined })
}

/** One encoded string per line, one per row of text. */
export const encodeCollection = (c: Collection, out: PolylineOut): string =>
  allLines(c)
    .map((l) => encodeLine(l.line, out))
    .join("\n")

export type Stats = {
  lines: number
  points: number
  length: number
  bbox: [number, number, number, number] | null
  chars: number
  charsPerPoint: number
  segment: { min: number; median: number; max: number }
}

export function stats(c: Collection, encoded: string): Stats {
  const lines = allLines(c).map((l) => l.line.pts)
  const pts = lines.flat()
  const segs = lines.flatMap(steps)
  return {
    lines: lines.length,
    points: pts.length,
    length: lines.reduce((s, l) => s + lengthOf(l), 0),
    bbox: bbox(pts),
    chars: encoded.length,
    charsPerPoint: pts.length ? encoded.replace(/\n/g, "").length / pts.length : 0,
    segment: segs.length
      ? { min: Math.min(...segs), median: median(segs), max: Math.max(...segs) }
      : { min: 0, median: 0, max: 0 },
  }
}

/** Gzipped size in bytes, with the browser's own CompressionStream. */
export async function gzipSize(text: string): Promise<number | null> {
  if (typeof CompressionStream === "undefined") return null
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))
  return (await new Response(stream).arrayBuffer()).byteLength
}
