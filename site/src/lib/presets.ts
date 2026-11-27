import { presets } from "@duoquote/polytini/presets"
import type { Options } from "@duoquote/polytini"

export type Order = "latlng" | "lnglat"

export const PRESET_NAMES = Object.keys(presets) as (keyof typeof presets)[]

export const PRESET_NOTES: Record<string, string> = {
  google: "Google Maps Platform",
  osrm: "OSRM, geometries=polyline",
  osrm6: "OSRM, geometries=polyline6",
  valhalla: "Valhalla shapes",
  stadia: "Stadia Maps (Valhalla)",
  graphhopper: "GraphHopper, points_encoded",
  graphhopper3d: "GraphHopper with elevation=true",
  openrouteservice: "openrouteservice",
  openrouteservice3d: "openrouteservice with elevation",
  mapbox: "Mapbox Directions, polyline",
  mapbox6: "Mapbox Directions, polyline6",
  strava: "Strava activity maps",
  otp: "OpenTripPlanner",
}

export function presetOptions(name: string): Options | undefined {
  return (presets as Record<string, Options>)[name]
}

/** The preset as it would be written in code: { precision: 6, order: 'lnglat' } */
export function describe(options: Options): string {
  return (
    "{ " +
    Object.entries(options)
      .map(([k, v]) => `${k}: ${typeof v === "string" ? `'${v}'` : v}`)
      .join(", ") +
    " }"
  )
}
