// Shared by the format tests: a sample collection with every shape the
// playground cares about, and a comparison that allows for what each format
// can't keep.
import { expect } from "vitest"
import type { Collection, Line, Pt } from "../model"
import { signedArea } from "./shapefile"

export function sample(): Collection {
  return {
    features: [
      {
        lines: [{ pts: [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]], ring: false }],
        props: { name: "Google example", id: 1, speed: 12.5, ok: true },
      },
      {
        lines: [
          { pts: [[51.5007, -0.1246], [51.5014, -0.1419]], ring: false },
          { pts: [[51.5014, -0.1419], [51.5079, -0.1281]], ring: false },
        ],
        props: { name: "Two parts", id: 2, speed: 3, ok: false },
      },
      {
        // A square park with a square pond: outer ring and one hole.
        lines: [
          { pts: [[52.51, 13.37], [52.51, 13.38], [52.52, 13.38], [52.52, 13.37], [52.51, 13.37]], ring: true, part: 0 },
          { pts: [[52.513, 13.373], [52.517, 13.373], [52.517, 13.377], [52.513, 13.377], [52.513, 13.373]], ring: true, part: 0 },
        ],
        props: { name: "Park", id: 3, speed: 0, ok: true },
      },
    ],
  }
}

/** The same shapes with elevation on every point. */
export function sample3d(): Collection {
  const c = sample()
  let z = 10
  for (const f of c.features)
    for (const l of f.lines) {
      l.pts = l.pts.map((p) => [p[0], p[1], (z += 1.5)])
      // A closed ring repeats its first point exactly, elevation included.
      if (l.ring) l.pts[l.pts.length - 1] = l.pts[0].slice()
    }
  return c
}

export type Keeps = {
  /** Properties: all with types, as strings, booleans as 1 and 0 (SQLite), only the name, or none. */
  props: "exact" | "strings" | "sqlite" | "name" | "none"
  /** Polygon rings come back as rings with their part numbers. */
  rings: boolean
  /** Elevation survives. */
  z: boolean
  /** Lines of one feature stay in one feature. */
  features: boolean
}

const orient = (l: Line): Pt[] => (l.ring && signedArea(l.pts) < 0 ? [...l.pts].reverse() : l.pts)

function points(c: Collection, z: boolean, rings: boolean): number[][] {
  return c.features.flatMap((f) => f.lines.flatMap((l) => (rings ? orient(l) : l.pts).map((p) => (z ? p.slice(0, 3) : p.slice(0, 2)))))
}

export function expectSameCollection(got: Collection, want: Collection, keeps: Keeps, eps = 1e-9) {
  const g = points(got, keeps.z, keeps.rings)
  const w = points(want, keeps.z, keeps.rings)
  expect(g.length).toBe(w.length)
  g.forEach((p, i) => p.forEach((x, k) => expect(Math.abs(x - w[i][k])).toBeLessThanOrEqual(eps)))
  if (keeps.features) {
    expect(got.features.length).toBe(want.features.length)
    got.features.forEach((f, i) => expect(f.lines.length).toBe(want.features[i].lines.length))
  }
  if (keeps.rings) {
    const rings = (c: Collection) => c.features.map((f) => f.lines.map((l) => (l.ring ? `r${l.part ?? 0}` : "l")).join(","))
    expect(rings(got)).toEqual(rings(want))
  }
  if (keeps.props !== "none")
    got.features.forEach((f, i) => {
      const wp = want.features[i].props
      if (keeps.props === "name") expect(f.props.name).toBe(wp.name)
      else
        for (const [k, v] of Object.entries(wp))
          expect(f.props[k]).toEqual(
            keeps.props === "strings" && typeof v !== "string" ? String(v) : keeps.props === "sqlite" && typeof v === "boolean" ? Number(v) : v
          )
    })
}
