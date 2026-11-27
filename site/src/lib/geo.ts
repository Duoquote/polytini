/** Great-circle distance in meters between two [lat, lng] points. */
export function distance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const r = Math.PI / 180
  const dLat = (b[0] - a[0]) * r
  const dLng = (b[1] - a[1]) * r
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function formatDistance(m: number): string {
  if (m < 1) return `${(m * 100).toFixed(0)} cm`
  if (m < 1000) return `${m.toFixed(0)} m`
  if (m < 100000) return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`
  return `${Math.round(m / 1000).toLocaleString("en")} km`
}

/** [lat, lng] or [lng, lat] tuples to [lng, lat], for GeoJSON and maps. */
export function toLngLat(
  points: ArrayLike<number>[],
  order: "latlng" | "lnglat"
): [number, number][] {
  return points.map((p) =>
    order === "latlng" ? [p[1], p[0]] : [p[0], p[1]]
  )
}

/** Tuples as compact JSON, one point per line. */
export function pointsJson(points: ArrayLike<number>[]): string {
  if (!points.length) return "[]"
  return (
    "[\n" +
    points.map((p) => "  [" + Array.from(p).join(", ") + "]").join(",\n") +
    "\n]"
  )
}

export function errorInfo(e: unknown) {
  const err = e as { name?: string; code?: string; index?: number; message?: string }
  return {
    name: err?.name ?? "Error",
    code: err?.code,
    index: err?.index,
    message: err?.message ?? String(e),
  }
}
