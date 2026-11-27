export const LIBS = [
  { id: "mapbox", name: "@mapbox/polyline" },
  { id: "googlemaps", name: "@googlemaps/polyline-codec" },
  { id: "google-polyline", name: "google-polyline" },
  { id: "polytini", name: "@duoquote/polytini" },
  { id: "polytini-wasm", name: "@duoquote/polytini/wasm" },
] as const

export const CASES = [
  { id: "decode-10", op: "decode", label: "Decode, 10 points" },
  { id: "decode-route", op: "decode", label: "Decode, the Berlin route (319 points)" },
  { id: "decode-1000", op: "decode", label: "Decode, 1,000 points" },
  { id: "encode-10", op: "encode", label: "Encode, 10 points" },
  { id: "encode-route", op: "encode", label: "Encode, the Berlin route (319 points)" },
  { id: "encode-1000", op: "encode", label: "Encode, 1,000 points" },
] as const

export type LibId = (typeof LIBS)[number]["id"]
export type CaseId = (typeof CASES)[number]["id"]

export type BenchMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "result"; case: CaseId; lib: LibId; ops: number; ok: boolean }
  | { type: "done" }
  | { type: "error"; message: string }
