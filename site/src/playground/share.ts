// The playground's state in the URL hash, so a link reproduces it. The
// geometry goes in as precision 7 polylines (exact to about a centimeter,
// already compact), then everything is deflated with the browser's own
// CompressionStream and written as base64url.
import { decode, encode } from "@duoquote/polytini"
import type { Collection, Line } from "./model"
import type { PolylineOut } from "./encode"

export type Shared = { collection: Collection; out: PolylineOut }

type Wire = {
  v: 1
  /** Per feature: its lines as [encoded, ring, part, dims] and its properties. */
  f: { l: [string, 0 | 1, number | null, 2 | 3][]; p?: Record<string, unknown> }[]
  o: PolylineOut
}

const b64url = (bytes: Uint8Array) => {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))

async function pipe(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(t)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

export async function toHash(s: Shared): Promise<string> {
  const wire: Wire = {
    v: 1,
    f: s.collection.features.map((f) => ({
      l: f.lines.map((l) => {
        const dims = l.pts.some((p) => p.length > 2) ? 3 : 2
        return [encode(l.pts, { precision: 7, dimensions: dims, zFactor: dims === 3 ? 100 : undefined }), l.ring ? 1 : 0, l.part ?? null, dims]
      }),
      ...(Object.keys(f.props).length ? { p: f.props } : {}),
    })),
    o: s.out,
  }
  const json = new TextEncoder().encode(JSON.stringify(wire))
  // "z" marks deflated data, "j" plain JSON where CompressionStream is missing.
  if (typeof CompressionStream === "undefined") return "j" + b64url(json)
  return "z" + b64url(await pipe(json, new CompressionStream("deflate-raw")))
}

export async function fromHash(hash: string): Promise<Shared | null> {
  try {
    const kind = hash[0]
    const bytes = unb64url(hash.slice(1))
    const json = kind === "z" ? await pipe(bytes, new DecompressionStream("deflate-raw")) : bytes
    const wire = JSON.parse(new TextDecoder().decode(json)) as Wire
    if (wire.v !== 1) return null
    return {
      collection: {
        features: wire.f.map((f) => ({
          lines: f.l.map(([s, ring, part, dims]): Line => ({
            pts: decode(s, { precision: 7, dimensions: dims, zFactor: dims === 3 ? 100 : undefined }),
            ring: ring === 1,
            ...(part !== null ? { part } : {}),
          })),
          props: f.p ?? {},
        })),
      },
      out: wire.o,
    }
  } catch {
    return null
  }
}
