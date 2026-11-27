// Deno entry: the core plus the TextEncoder/TextDecoder byte paths in
// text.js. Deno has no global Buffer, and node:buffer measured slower than
// the portable core there (see the README), so this doesn't use it. It is
// also the "workerd" export, for Cloudflare Workers: there it decoded faster
// than the browser entry in every run (docs/platforms.md).
/* @ts-self-types="../types/index.d.ts" */
import { decode, encode, tune } from './text.js';
import { latLngs, toGeo, fromGeo } from './core.js';

// A UTF-8 TextDecoder: in Deno 2.5 it made a string from the encoded bytes
// about 3 times as fast as a 'latin1' one, so encoding got 9 to 13% faster
// from 600 points up. With the cheaper call, Deno encodes through bytes from
// 16 points: 10 to 49% faster up to 400 points, and 7 to 11% on the
// real-world lines. In workerd the UTF-8 decoder was 5 to 9% faster in most
// runs, but I can only time it from outside there, to about 10%. Starting at
// 16 points made its real-world lines 6% slower, so it stays at 512.
tune(new TextDecoder(), globalThis.Deno ? 16 : 512);

export { PolylineError } from './core.js';
export { decode, decodeFlat, encode, encodeFlat } from './text.js';
export const decodeLatLng = /* @__PURE__ */ latLngs(decode);
export const toGeoJSON = /* @__PURE__ */ toGeo(decode);
export const fromGeoJSON = /* @__PURE__ */ fromGeo(encode);
