/// <reference types="vite/client" />

declare const __POLYTINI_VERSION__: string
declare const __LIB_VERSIONS__: Record<string, string>

declare module "google-polyline" {
  const polyline: {
    encode(points: ArrayLike<ArrayLike<number>>): string
    decode(str: string): [number, number][]
  }
  export default polyline
}

declare module "virtual:highlighted" {
  const html: Record<string, string>
  export default html
}
