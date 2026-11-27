// Distances and the small amount of projection the playground needs.
import type { Pt } from "./model"

const R = 6371008.8
const RAD = Math.PI / 180

/** Great-circle distance in meters between two lat-first points. */
export function haversine(a: Pt, b: Pt): number {
  const dLat = (b[0] - a[0]) * RAD
  const dLng = (b[1] - a[1]) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export const inRange = (p: Pt) => Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180

/** Distances between consecutive points. */
export function steps(pts: Pt[]): number[] {
  const out = new Array(Math.max(0, pts.length - 1))
  for (let i = 1; i < pts.length; i++) out[i - 1] = haversine(pts[i - 1], pts[i])
  return out
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const lengthOf = (pts: Pt[]) => steps(pts).reduce((a, b) => a + b, 0)

/**
 * A local equirectangular projection to meters around a latitude, for the
 * simplification math. Good to well under 1% over a few hundred km, which
 * is all a tolerance in meters needs.
 */
export function projector(lat0: number) {
  const kx = R * RAD * Math.cos(lat0 * RAD)
  const ky = R * RAD
  return (p: Pt): [number, number] => [p[1] * kx, p[0] * ky]
}

export function meanLat(pts: Pt[]): number {
  let s = 0
  for (const p of pts) s += p[0]
  return pts.length ? s / pts.length : 0
}

/** Distance from point p to segment ab, all in projected meters. */
export function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len = dx * dx + dy * dy
  let t = len ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

export function bbox(pts: Pt[]): [number, number, number, number] | null {
  if (!pts.length) return null
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity
  for (const p of pts) {
    s = Math.min(s, p[0]); n = Math.max(n, p[0])
    w = Math.min(w, p[1]); e = Math.max(e, p[1])
  }
  return [s, w, n, e]
}

export function formatMeters(m: number): string {
  if (!Number.isFinite(m)) return "n/a"
  if (m < 1) return `${(m * 100).toFixed(1)} cm`
  if (m < 1000) return `${m.toFixed(m < 10 ? 2 : 1)} m`
  if (m < 100000) return `${(m / 1000).toFixed(2)} km`
  return `${Math.round(m / 1000).toLocaleString("en")} km`
}
