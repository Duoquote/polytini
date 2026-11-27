// Times polytini against other libraries, in a worker so the page stays
// responsive. Every library gets the same inputs at precision 5 (the only
// precision google-polyline has), and its output is checked against
// polytini's before it's timed.
import * as polytini from "@duoquote/polytini"
import * as wasm from "@duoquote/polytini/wasm"
import mapbox from "@mapbox/polyline"
import * as googlemaps from "@googlemaps/polyline-codec"
import googlePolyline from "google-polyline"
import { BERLIN } from "@/lib/examples"
import { CASES, LIBS, type BenchMessage, type LibId } from "./cases"

type Points = number[][]
type Codec = { decode: (s: string) => Points; encode: (p: Points) => string }

const post = (m: BenchMessage) => (self as unknown as Worker).postMessage(m)

const codecs: Record<LibId, Codec> = {
  mapbox: { decode: (s) => mapbox.decode(s, 5), encode: (p) => mapbox.encode(p as [number, number][], 5) },
  googlemaps: { decode: (s) => googlemaps.decode(s, 5), encode: (p) => googlemaps.encode(p as [number, number][], 5) },
  "google-polyline": { decode: (s) => googlePolyline.decode(s), encode: (p) => googlePolyline.encode(p) },
  polytini: { decode: (s) => polytini.decode(s), encode: (p) => polytini.encode(p) },
  "polytini-wasm": { decode: (s) => wasm.decode(s), encode: (p) => wasm.encode(p) },
}

// A random walk like a GPS track, the same every run (seeded).
function walk(n: number, seed: number): Points {
  let s = seed
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  let lat = 40 + rand() * 10, lng = -10 + rand() * 20
  const out: Points = []
  for (let i = 0; i < n; i++) {
    lat += (rand() - 0.5) * 0.01
    lng += (rand() - 0.5) * 0.01
    out.push([Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5])
  }
  return out
}

const inputs: Record<string, Points> = {
  "10": walk(10, 1),
  route: polytini.decode(polytini.encode(polytini.decode(BERLIN, 6))),
  "1000": walk(1000, 2),
}

const same = (a: Points, b: Points) =>
  a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-9 && Math.abs(p[1] - b[i][1]) < 1e-9)

let sink = 0
function time(fn: () => unknown, ms: number): { calls: number; elapsed: number } {
  // Batches long enough that the timer's resolution doesn't matter.
  let batch = 1, calls = 0
  const start = performance.now()
  let now = start
  while (now - start < ms) {
    for (let i = 0; i < batch; i++) {
      const r = fn() as { length: number }
      sink += r.length
    }
    calls += batch
    now = performance.now()
    if (now - start < 2) batch *= 2
  }
  return { calls, elapsed: now - start }
}

const WARMUP = 30
const SLICE = 60
const ROUNDS = 3

self.onmessage = async () => {
  try {
    await wasm.init()
    const total = CASES.length * LIBS.length * (ROUNDS + 1)
    let done = 0
    for (const c of CASES) {
      const points = inputs[c.id.split("-")[1]]
      const str = polytini.encode(points)
      const fns = LIBS.map((lib) => {
        const codec = codecs[lib.id]
        const ok = c.op === "decode" ? same(codec.decode(str), points) : codec.encode(points) === str
        const fn = c.op === "decode" ? () => codec.decode(str) : () => codec.encode(points)
        return { lib: lib.id, fn, ok, calls: 0, elapsed: 0 }
      })
      for (const f of fns) {
        time(f.fn, WARMUP)
        post({ type: "progress", done: ++done, total })
      }
      // Interleave the libraries so a slow moment of the machine doesn't
      // land on one of them only.
      for (let round = 0; round < ROUNDS; round++) {
        const order = round % 2 ? [...fns].reverse() : fns
        for (const f of order) {
          const t = time(f.fn, SLICE)
          f.calls += t.calls
          f.elapsed += t.elapsed
          post({ type: "progress", done: ++done, total })
        }
      }
      for (const f of fns) {
        post({ type: "result", case: c.id, lib: f.lib, ops: (f.calls / f.elapsed) * 1000, ok: f.ok })
      }
    }
    if (sink === -1) console.log(sink)
    post({ type: "done" })
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) })
  }
}
