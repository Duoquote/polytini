// A GPS-like track for the 10,000-point example: a copy of
// polyline-benchmark's generator (test/fixtures-core.js in polytini), so the
// site doesn't import the repo's test files. Sampled at about 1 Hz, speed
// drifting between walking and highway pace, with stops that repeat a point.

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function gpsTrack(points: number, seed: number, anchor: { lat: number; lng: number }, precision = 5): number[][] {
  const rand = rng(seed)
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
  // Integer units of 1e-6 degrees; 300 units a second is about 120 km/h.
  let lat = Math.round(anchor.lat * 1e6)
  let lng = Math.round(anchor.lng * 1e6)
  let vlat = int(-100, 100)
  let vlng = int(-100, 100)
  let stopped = 0
  const step = 10 ** (6 - precision)
  const factor = 10 ** precision
  const out: number[][] = new Array(points)
  for (let i = 0; i < points; i++) {
    out[i] = [Math.round(lat / step) / factor, Math.round(lng / step) / factor]
    if (stopped > 0) {
      stopped--
      continue
    }
    if (int(0, 199) === 0) stopped = int(3, 40)
    if (int(0, 99) === 0) {
      // A sharp turn.
      const t = vlat
      vlat = int(0, 1) ? vlng : -vlng
      vlng = int(0, 1) ? t : -t
    }
    vlat = clamp(vlat + int(-15, 15), -300, 300)
    vlng = clamp(vlng + int(-15, 15), -300, 300)
    lat = clamp(lat + vlat, -90e6, 90e6)
    lng += vlng
    if (lng > 180e6) lng -= 360e6
    if (lng < -180e6) lng += 360e6
  }
  return out
}
