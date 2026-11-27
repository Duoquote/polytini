// TopoJSON through topojson-server and topojson-client (ISC). Written
// without quantization, so coordinates come back exactly; shared borders
// between polygons are stored once, which is what TopoJSON is for.
import { topology } from "topojson-server"
import { feature } from "topojson-client"
import type { Topology } from "topojson-specification"
import type { Collection, Feature } from "../model"
import type { Converter, WriteOptions } from "./types"
import { asText, fromGeoJSON, toGeoJSON } from "./geo"

export default {
  async read(input) {
    const topo = JSON.parse(asText(input)) as Topology
    if (topo?.type !== "Topology" || !topo.objects) throw new SyntaxError("TopoJSON: not a Topology")
    const features: Feature[] = []
    for (const obj of Object.values(topo.objects)) features.push(...fromGeoJSON(feature(topo, obj)).features)
    return { features } satisfies Collection
  },
  async write(c, options: WriteOptions = {}) {
    // topojson-server's types want its own GeoJSON types; the shapes match.
    const objects = { [options.name ?? "lines"]: toGeoJSON(c) } as unknown as Parameters<typeof topology>[0]
    return JSON.stringify(topology(objects))
  },
} satisfies Converter
