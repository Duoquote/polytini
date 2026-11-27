// The playground's geometry model, shared by the detector, the fixes,
// compaction, the map editor and every file format.
//
// Coordinates are always latitude first inside the playground, like
// polytini's default and the encoded string itself: [lat, lng] or
// [lat, lng, z]. Formats that store [lng, lat] (GeoJSON, WKT, WKB,
// shapefiles, ...) swap at the edge, in their reader and writer.

/** [lat, lng] or [lat, lng, z]. */
export type Pt = number[]

export type Line = {
  pts: Pt[]
  /** A polygon ring: closed, first point repeated at the end. */
  ring: boolean
  /**
   * Rings with the same part number in one feature form one polygon: the
   * first is the outer ring, the rest are holes. Unused for plain lines.
   */
  part?: number
}

export type Feature = {
  lines: Line[]
  /** Properties where the format has them: GeoJSON, KML, DBF, GPX names, ... */
  props: Record<string, unknown>
}

export type Collection = { features: Feature[] }

export const emptyCollection = (): Collection => ({ features: [] })

/** Every line in the collection, with where it came from. */
export function allLines(c: Collection): { line: Line; feature: number; index: number }[] {
  return c.features.flatMap((f, feature) => f.lines.map((line, index) => ({ line, feature, index })))
}

export const pointCount = (c: Collection) => allLines(c).reduce((n, l) => n + l.line.pts.length, 0)

/** 3 when any point carries a third value, else 2. */
export const dimsOf = (c: Collection): 2 | 3 => (allLines(c).some((l) => l.line.pts.some((p) => p.length > 2)) ? 3 : 2)

/** A collection with one feature per line, no properties. */
export const fromLines = (lines: Line[]): Collection => ({ features: lines.map((line) => ({ lines: [line], props: {} })) })

/** Maps every line, keeping features and properties. */
export function mapLines(c: Collection, fn: (l: Line) => Line | Line[] | null): Collection {
  return {
    features: c.features
      .map((f) => ({ ...f, lines: f.lines.flatMap((l) => fn(l) ?? []) }))
      .filter((f) => f.lines.length > 0),
  }
}
